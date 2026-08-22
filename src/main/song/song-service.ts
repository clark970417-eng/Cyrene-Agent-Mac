// 昔漣唱歌：把一支翻唱影片變成「可播的音訊 + 嘴型時間軸」。
//
// 兩件事都很慢（下載幾秒、對齊十幾秒），但一首歌只需要做一次，之後整包留在
// userData/songs/<影片 id>/ 下，再點同一首就是即時的。

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";
import ffmpegStaticPath from "ffmpeg-static";
import {
  ensureYtDlpBinary,
  resolveDiscordMusicTracks,
  searchDiscordMusicTracks,
  bilibiliCookieArgs,
  type DiscordMusicTrack,
} from "../channels/adapters/discord/music-source";
import { transcribeWhisperTimestamps, type WhisperLanguage } from "../asr/whisper-worker";
import { buildLipTimeline, hasSingableText, lipChunkQuality, type LipTimelineChunk } from "./lip-timeline";
import { buildDefaultSongTracks, findBilibiliInstrumental } from "./song-catalog";
import { createSingingCover, isSingingCoverReady, type SingingCover } from "./singing-service";
import type {
  SongCatalog,
  SongLipTimeline,
  SongPrepareProgress,
  SongPrepared,
  SongTrack,
} from "../../shared/song-types";

const ALIGN_SAMPLE_RATE = 16_000;
/** 對齊用的取樣格式：16k 單聲道 s16le，正好是 Whisper 要的輸入。 */
const ALIGN_BYTES_PER_SECOND = ALIGN_SAMPLE_RATE * 2;
const CATALOG_TTL_MS = 24 * 60 * 60_000;
/** 對齊的切窗長度。
 *
 * 拿這首歌的實測結果挑的（用影片自己的卡拉OK字幕當標準答案）：
 *   整檔一次對齊      命中 75.4%、間奏誤開 2.6%
 *   自切 20 秒窗       命中 82.3%、誤開 17.2%
 *   20 秒窗＋人聲強化   命中 87.0%、誤開 3.5%   ← 現在用這組
 * 整檔對齊會在段落邊界把整段間奏併進前一句、還會漏掉整段主歌；切窗把時間戳的
 * 錯誤關在窗內。人聲強化（帶通 + 動態正規化）則讓 Whisper 聽得到被伴奏蓋住的
 * 唱句，同時大幅減少它在純伴奏段落亂編的機會。 */
const ALIGN_WINDOW_SEC = 20;
/** 一窗完全對不到東西時，依序換這些位移重切再試。 */
const ALIGN_RETRY_SHIFTS_SEC = [7, 13];
/** 判斷第二趟的句子是不是「第一趟已經交代過的時間」時，前後各留這麼多寬容。 */
const COVERAGE_MARGIN_MS = 500;
/** 力度取樣格子。50ms 夠細到分得出一個字的強弱，也不會讓快取檔變大。 */
const LOUDNESS_HOP_MS = 50;
/** 真實人聲門控要比一個音節細，才能抓到起音、停頓與收尾。 */
const VOICE_ACTIVITY_HOP_MS = 25;
const SONG_LANGUAGE_PROBE_POSITIONS = [0.25, 0.55];
interface SongRecognitionCandidate {
  id: "zh" | "yue" | "en" | "ja" | "ko";
  language: WhisperLanguage;
  prompt: string;
}
const SONG_LANGUAGE_CANDIDATES: SongRecognitionCandidate[] = [
  { id: "zh", language: "zh", prompt: "這是一首中文普通話歌曲。" },
  { id: "yue", language: "zh", prompt: "呢首係粵語歌，請辨識廣東話歌詞。" },
  { id: "en", language: "en", prompt: "This is an English song." },
  { id: "ja", language: "ja", prompt: "これは日本語の歌です。" },
  { id: "ko", language: "ko", prompt: "이것은 한국어 노래입니다." },
];
/** v5 改由昔漣轉換後的獨立人聲建立時間軸，嘴型和實際播出的歌聲共用同一素材。 */
const LIP_TIMELINE_FORMAT_VERSION = 5;

export type SongProgressReporter = (
  progress: string | Omit<SongPrepareProgress, "trackId">,
) => void;

function ffmpegBinary(): string {
  const staticPath = ffmpegStaticPath as string | null;
  if (!staticPath) return "ffmpeg";
  return staticPath.replace("app.asar", "app.asar.unpacked");
}

function songsRoot(): string {
  return path.join(app.getPath("userData"), "songs");
}

function trackDirectory(trackId: string): string {
  // 影片 id 直接當目錄名，但擋掉路徑分隔字元，避免奇怪的 id 逃出快取目錄。
  const safe = trackId.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
  return path.join(songsRoot(), safe);
}

/** 歌單快取的格式版本。歌名呈現規則改過就往上加，舊快取才不會撐著過期時間
 * 繼續拿舊寫法的標題出來。 */
const CATALOG_FORMAT_VERSION = 4;
const INSTRUMENTAL_SEARCH_TTL_MS = 30 * 24 * 60 * 60_000;

function catalogPath(sourceUrl: string): string {
  const hash = createHash("sha1").update(sourceUrl).digest("hex").slice(0, 16);
  return path.join(songsRoot(), `catalog-v${CATALOG_FORMAT_VERSION}-${hash}.json`);
}

function toSongTrack(track: DiscordMusicTrack): SongTrack {
  return {
    id: track.id ?? createHash("sha1").update(track.url).digest("hex").slice(0, 12),
    title: track.title,
    url: track.url,
    playbackUrl: track.playbackUrl,
    thumbnail: track.thumbnail,
    durationSec: track.duration,
    index: track.index,
    total: track.total,
  };
}

async function enrichInstrumentals(
  tracks: SongTrack[],
  previous: SongCatalog | null,
): Promise<SongTrack[]> {
  const oldById = new Map((previous?.tracks ?? []).map((track) => [track.id, track]));
  return tracks.map((track) => {
    const old = oldById.get(track.id);
    return {
      ...track,
      instrumentalUrl: track.instrumentalUrl ?? old?.instrumentalUrl,
      instrumentalSearchedAt: track.instrumentalUrl
        ? Date.now()
        : old?.instrumentalSearchedAt,
    };
  });
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value), "utf8");
}

function run(binary: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim().split("\n").at(-1);
      reject(new Error(detail || `${path.basename(binary)} 結束代碼 ${code}`));
    });
  });
}

/** 取得（並快取）一份歌單。不給來源就是昔漣自己的內建歌單。 */
export async function listSongTracks(source = "", forceRefresh = false): Promise<SongCatalog> {
  const trimmed = source.trim();
  const cacheFile = catalogPath(trimmed || "__default__");
  const previous = await readJson<SongCatalog>(cacheFile);

  if (!trimmed) {
    if (!forceRefresh) {
      const cached = previous;
      if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS && cached.tracks.length) {
        return cached;
      }
    }
    const tracks = await enrichInstrumentals(await buildDefaultSongTracks(), previous);
    if (!tracks.length) throw new Error("讀不到昔漣的歌單，等一下再試。");
    const catalog: SongCatalog = {
      sourceUrl: "",
      title: "昔漣的歌",
      tracks,
      fetchedAt: Date.now(),
    };
    await writeJson(cacheFile, catalog);
    return catalog;
  }

  if (!forceRefresh) {
    const cached = previous;
    if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS && cached.tracks.length) {
      return cached;
    }
  }

  const resolved = await resolveDiscordMusicTracks(trimmed);
  const catalog: SongCatalog = {
    sourceUrl: trimmed,
    title: resolved[0]?.playlistTitle,
    tracks: await enrichInstrumentals(resolved.map(toSongTrack), previous),
    fetchedAt: Date.now(),
  };
  await writeJson(cacheFile, catalog);
  return catalog;
}

/** 關鍵字找歌（沒有合集時的補救路徑）。 */
export async function searchSongTracks(keyword: string, limit = 8): Promise<SongTrack[]> {
  const found = await searchDiscordMusicTracks(keyword, limit);
  return found.map(toSongTrack);
}

async function findExisting(directory: string, prefix: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(directory);
    const hit = entries.find((entry) => entry.startsWith(prefix));
    return hit ? path.join(directory, hit) : null;
  } catch {
    return null;
  }
}

/** 下載音訊（只抓聲音，不碰影片本體）。 */
async function ensureAudioFile(track: SongTrack, report: SongProgressReporter): Promise<string> {
  const directory = trackDirectory(track.id);
  await fs.mkdir(directory, { recursive: true });
  const existing = await findExisting(directory, "audio.");
  if (existing) return existing;

  report({ stage: "downloading", message: "正在下載原曲音訊…", completed: 0, total: 100 });
  const binary = await ensureYtDlpBinary();
  const source = track.playbackUrl ?? track.url;
  await run(
    binary,
    [
      ...bilibiliCookieArgs(source),
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--retries",
      "5",
      "--socket-timeout",
      "15",
      "--ffmpeg-location",
      ffmpegBinary(),
      "--format",
      "bestaudio[ext=m4a]/bestaudio/best",
      "--output",
      path.join(directory, "audio.%(ext)s"),
      source,
    ],
    10 * 60_000,
  );

  const downloaded = await findExisting(directory, "audio.");
  if (!downloaded) throw new Error("音訊下載後找不到檔案。");
  return downloaded;
}

async function ensureInstrumentalFile(
  track: SongTrack,
  report: SongProgressReporter,
): Promise<string | undefined> {
  if (!track.instrumentalUrl) return undefined;
  const directory = trackDirectory(track.id);
  await fs.mkdir(directory, { recursive: true });
  const existing = await findExisting(directory, "instrumental-source.");
  if (existing) return existing;
  report({ stage: "downloading", message: "正在下載另外找到的純伴奏…", completed: 2, total: 100 });
  const binary = await ensureYtDlpBinary();
  await run(
    binary,
    [
      ...bilibiliCookieArgs(track.instrumentalUrl),
      "--no-playlist", "--no-warnings", "--no-progress", "--retries", "5",
      "--socket-timeout", "15", "--ffmpeg-location", ffmpegBinary(),
      "--format", "bestaudio[ext=m4a]/bestaudio/best",
      "--output", path.join(directory, "instrumental-source.%(ext)s"),
      track.instrumentalUrl,
    ],
    10 * 60_000,
  );
  const downloaded = await findExisting(directory, "instrumental-source.");
  if (!downloaded) throw new Error("純伴奏下載後找不到檔案。");
  return downloaded;
}

/** 瀏覽器不見得吃得下每一種容器（B 站偶爾給 webm/opus 以外的東西）。
 * m4a 與 webm/opus 都能直接播，其餘一律轉成 m4a。 */
async function ensurePlayableAudio(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if ([".m4a", ".mp4", ".mp3", ".webm", ".ogg", ".opus"].includes(ext)) return file;
  const converted = path.join(path.dirname(file), "audio.m4a");
  await run(ffmpegBinary(), ["-y", "-loglevel", "error", "-i", file, "-vn", "-c:a", "aac", "-b:a", "192k", converted], 5 * 60_000);
  return converted;
}

function mimeTypeFor(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".webm":
      return "audio/webm";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    default:
      return "audio/mp4";
  }
}

/** 解出對齊用的 PCM。
 *
 * 帶通留住人聲主要的能量帶（200~4000Hz，濾掉貝斯與大鼓），再做動態正規化把
 * 被伴奏壓住的唱句拉起來。實測這一步讓命中率從 82% 提到 87%，同時把間奏誤開
 * 從 17% 壓到 3.5%——Whisper 聽得清楚時就不太需要亂編。 */
async function decodeForAlignment(file: string): Promise<Buffer> {
  return await run(
    ffmpegBinary(),
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      file,
      "-af",
      "pan=mono|c0=0.5*c0+0.5*c1,highpass=f=200,lowpass=f=4000,dynaudnorm=f=200",
      "-ar",
      String(ALIGN_SAMPLE_RATE),
      "-ac",
      "1",
      "-f",
      "s16le",
      "-",
    ],
    10 * 60_000,
  );
}

/** 不做動態增益的隔離人聲。對齊版會把小聲段拉大方便 Whisper，但那也會把間奏
 * 殘留放大；真實人聲門控必須保留原始強弱。 */
async function decodeForVoiceActivity(file: string): Promise<Buffer> {
  return await run(
    ffmpegBinary(),
    [
      "-y", "-loglevel", "error", "-i", file,
      "-af", "highpass=f=80,lowpass=f=8000",
      "-ar", String(ALIGN_SAMPLE_RATE), "-ac", "1", "-f", "s16le", "-",
    ],
    10 * 60_000,
  );
}

/** 每 50ms 一格的人聲力度（0~1，全曲相對值）。只用來微調開口幅度。 */
function loudnessSeries(pcm: Buffer): number[] {
  const samplesPerHop = Math.round((ALIGN_SAMPLE_RATE * LOUDNESS_HOP_MS) / 1000);
  const totalSamples = Math.floor(pcm.length / 2);
  const series: number[] = [];
  let peak = 0;
  for (let start = 0; start + samplesPerHop <= totalSamples; start += samplesPerHop) {
    let sum = 0;
    for (let i = 0; i < samplesPerHop; i += 1) {
      const sample = pcm.readInt16LE((start + i) * 2) / 32768;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / samplesPerHop);
    series.push(rms);
    if (rms > peak) peak = rms;
  }
  if (peak <= 0) return series;
  return series.map((value) => value / peak);
}

/** 從未正規化的隔離人聲建立 25ms 活動包絡。底噪門檻依每首歌自己的 20% 與 95%
 * 分位數計算，兼容安靜主歌與大聲副歌；收尾放慢，避免嘴型顫動。 */
export function voiceActivitySeries(pcm: Buffer): number[] {
  const samplesPerHop = Math.round((ALIGN_SAMPLE_RATE * VOICE_ACTIVITY_HOP_MS) / 1000);
  const totalSamples = Math.floor(pcm.length / 2);
  const rms: number[] = [];
  for (let start = 0; start + samplesPerHop <= totalSamples; start += samplesPerHop) {
    let sum = 0;
    for (let i = 0; i < samplesPerHop; i += 1) {
      const sample = pcm.readInt16LE((start + i) * 2) / 32768;
      sum += sample * sample;
    }
    rms.push(Math.sqrt(sum / samplesPerHop));
  }
  if (!rms.length) return [];
  const sorted = [...rms].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const strongVoice = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const gate = Math.max(noise * 2.4, strongVoice * 0.025);
  const range = Math.max(1e-6, strongVoice - gate);
  const activity: number[] = [];
  let smoothed = 0;
  for (const value of rms) {
    const normalized = Math.max(0, Math.min(1, (value - gate) / range));
    const shaped = Math.pow(normalized, 0.65);
    const rate = shaped > smoothed ? 0.58 : 0.2;
    smoothed += (shaped - smoothed) * rate;
    activity.push(smoothed < 0.065 ? 0 : Number(smoothed.toFixed(3)));
  }
  return activity;
}

/** 切窗對齊：每段各自送進 Whisper，再把時間加回窗的位移。
 *
 * 直接把整首歌丟給 Whisper 也會跑，但它的長音檔時間戳會在段落邊界漂掉，實測
 * 會把一整段間奏併進前一句、或整段主歌漏掉。錯誤關在窗內就頂多影響那 20 秒。 */
async function alignWindow(
  pcm: Buffer,
  fromBytes: number,
  toBytes: number,
  language: WhisperLanguage,
  prompt = "",
): Promise<LipTimelineChunk[]> {
  const offsetMs = Math.round((fromBytes / ALIGN_BYTES_PER_SECOND) * 1000);
  const part = await transcribeWhisperTimestamps(
    pcm.subarray(fromBytes, toBytes),
    language,
    prompt,
  );
  return part.map((item) => ({
    startMs: item.startMs + offsetMs,
    endMs: item.endMs + offsetMs,
    text: item.text,
  }));
}

class AlignmentSuperseded extends Error {
  constructor() {
    super("alignment superseded");
    this.name = "AlignmentSuperseded";
  }
}

/** 目前唯一該跑的對齊工作。換歌時舊的那首會在下一個窗口邊界收手，把 CPU 讓出來。 */
let activeAlignmentTrackId: string | null = null;

interface AlignContext {
  trackId: string;
  report: SongProgressReporter;
  /** 每對完一個窗呼叫一次。目前只用來讓呼叫端有機會觀察進度。 */
  onWindow: (chunks: LipTimelineChunk[]) => void;
  /** 一整趟跑完時呼叫，用來先把成果存檔。 */
  onPassDone?: (chunks: LipTimelineChunk[]) => Promise<void>;
}

/** 取兩段通常已有主歌／副歌的位置，三種常見歌曲語言各試一次，選可信唱句最多者。 */
async function detectSongLanguage(
  pcm: Buffer,
  context: AlignContext,
  progressTotal: number,
): Promise<SongRecognitionCandidate> {
  const windowBytes = ALIGN_WINDOW_SEC * ALIGN_BYTES_PER_SECOND;
  const scores = new Map<SongRecognitionCandidate["id"], number>(
    SONG_LANGUAGE_CANDIDATES.map((candidate) => [candidate.id, 0]),
  );
  const total = SONG_LANGUAGE_PROBE_POSITIONS.length * SONG_LANGUAGE_CANDIDATES.length;
  let completed = 0;

  for (const position of SONG_LANGUAGE_PROBE_POSITIONS) {
    const centered = Math.round(pcm.length * position - windowBytes / 2);
    const from = Math.max(0, Math.min(centered, Math.max(0, pcm.length - windowBytes)));
    const to = Math.min(pcm.length, from + windowBytes);
    for (const candidate of SONG_LANGUAGE_CANDIDATES) {
      if (activeAlignmentTrackId !== context.trackId) throw new AlignmentSuperseded();
      context.report({
        stage: "aligning",
        message: `正在辨識歌曲語言…（${completed + 1}/${total}）`,
        completed,
        total: progressTotal,
      });
      const chunks = await alignWindow(
        pcm,
        from,
        to,
        candidate.language,
        candidate.prompt,
      );
      scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + lipChunkQuality(chunks));
      completed += 1;
    }
  }

  return SONG_LANGUAGE_CANDIDATES.reduce((best, candidate) =>
    (scores.get(candidate.id) ?? 0) > (scores.get(best.id) ?? 0) ? candidate : best
  );
}

async function alignPass(
  pcm: Buffer,
  startBytes: number,
  label: string,
  context: AlignContext,
  progressOffset: number,
  progressTotal: number,
  recognition: SongRecognitionCandidate,
): Promise<LipTimelineChunk[]> {
  const windowBytes = ALIGN_WINDOW_SEC * ALIGN_BYTES_PER_SECOND;
  const windows = Math.ceil(Math.max(0, pcm.length - startBytes) / windowBytes);
  const chunks: LipTimelineChunk[] = [];

  for (let index = 0; index < windows; index += 1) {
    if (activeAlignmentTrackId !== context.trackId) throw new AlignmentSuperseded();

    const offset = startBytes + index * windowBytes;
    const end = Math.min(pcm.length, offset + windowBytes);
    const windowEndMs = Math.round((end / ALIGN_BYTES_PER_SECOND) * 1000);
    context.report({
      stage: "aligning",
      message: `${label}（${index + 1}/${windows}）`,
      completed: progressOffset + index,
      total: progressTotal,
    });

    const found = await alignWindow(
      pcm,
      offset,
      end,
      recognition.language,
      recognition.prompt,
    );
    if (found.some((item) => hasSingableText(item.text))) {
      chunks.push(...found);
      context.onWindow(chunks);
      continue;
    }

    // 一句都沒對到，但這段其實不安靜——多半是 Whisper 從窗頭就卡進重複幻覺
    // 出不來（實測整段主歌被吃掉）。換個切點重跑通常就正常了。
    for (const shiftSec of ALIGN_RETRY_SHIFTS_SEC) {
      const retryFrom = offset + shiftSec * ALIGN_BYTES_PER_SECOND;
      if (retryFrom >= end) break;
      const retry = await alignWindow(
        pcm,
        retryFrom,
        Math.min(pcm.length, retryFrom + windowBytes),
        recognition.language,
        recognition.prompt,
      );
      const retryOffsetMs = Math.round((retryFrom / ALIGN_BYTES_PER_SECOND) * 1000);
      // 只收下這一窗還沒交代的時間，剩下的留給下一窗自己對，免得重覆。
      const inside = retry.filter(
        (item) => item.startMs >= retryOffsetMs && item.startMs < windowEndMs,
      );
      if (inside.some((item) => hasSingableText(item.text))) {
        chunks.push(...inside);
        break;
      }
    }
    context.onWindow(chunks);
  }

  return chunks;
}

/**
 * 對齊整首歌：同一首用兩種切法各跑一次，第二趟只補第一趟沒交代到的時間。
 *
 * 一個唱句剛好被切在窗邊界時，那一窗常常整段對不到；把窗整體位移半窗再跑一次，
 * 被切壞的句子就會落在窗中間。實測第二首歌（粵語）命中率 63.5% → 74.0%，
 * 第一首維持 93%，間奏誤開沒有變差。代價是準備時間變兩倍，但一首歌只做一次，
 * 而且第一趟的結果會先送出去用，不必等到全部跑完。
 */
async function alignSong(pcm: Buffer, context: AlignContext): Promise<LipTimelineChunk[]> {
  const windowBytes = ALIGN_WINDOW_SEC * ALIGN_BYTES_PER_SECOND;
  const halfWindowBytes = Math.floor((ALIGN_WINDOW_SEC / 2) * ALIGN_BYTES_PER_SECOND);
  const primaryWindows = Math.ceil(pcm.length / windowBytes);
  const secondaryWindows = Math.ceil(Math.max(0, pcm.length - halfWindowBytes) / windowBytes);
  const languageProbeSteps = SONG_LANGUAGE_PROBE_POSITIONS.length * SONG_LANGUAGE_CANDIDATES.length;
  const totalWindows = languageProbeSteps + primaryWindows + secondaryWindows;
  const recognition = await detectSongLanguage(pcm, context, totalWindows);

  const primary = await alignPass(
    pcm,
    0,
    "正在對齊唱詞…",
    context,
    languageProbeSteps,
    totalWindows,
    recognition,
  );
  await context.onPassDone?.(primary);
  const covered = primary
    .filter((item) => hasSingableText(item.text))
    .map((item): [number, number] => [
      item.startMs - COVERAGE_MARGIN_MS,
      (Number.isFinite(item.endMs) ? item.endMs : item.startMs + 1500) + COVERAGE_MARGIN_MS,
    ]);
  const isCovered = (timeMs: number) => covered.some(([from, to]) => timeMs >= from && timeMs < to);

  const merged = [...primary];
  const secondary = await alignPass(pcm, halfWindowBytes, "正在補齊漏掉的唱句…", {
    ...context,
    onWindow: (chunks) => {
      const extra = chunks.filter((item) => hasSingableText(item.text) && !isCovered(item.startMs));
      context.onWindow([...primary, ...extra]);
    },
  }, languageProbeSteps + primaryWindows, totalWindows, recognition);
  merged.push(...secondary.filter((item) => hasSingableText(item.text) && !isCovered(item.startMs)));
  return merged;
}

async function ensureTimeline(
  track: SongTrack,
  audioFile: string,
  report: SongProgressReporter,
): Promise<SongLipTimeline> {
  const timelineFile = path.join(trackDirectory(track.id), "lip.json");
  const cached = await readJson<SongLipTimeline>(timelineFile);
  if (
    cached?.formatVersion === LIP_TIMELINE_FORMAT_VERSION &&
    cached.refined === true &&
    cached.syllables
  ) return cached;

  report({ stage: "aligning", message: "正在對齊昔漣的嘴型…", completed: 0, total: 1 });
  const [pcm, rawVoicePcm] = await Promise.all([
    decodeForAlignment(audioFile),
    decodeForVoiceActivity(audioFile),
  ]);
  const durationMs = Math.round((pcm.length / ALIGN_BYTES_PER_SECOND) * 1000);
  const loudness = loudnessSeries(pcm);
  const voiceActivity = voiceActivitySeries(rawVoicePcm);
  const buildOptions = {
    voiceActivity,
    voiceHopMs: VOICE_ACTIVITY_HOP_MS,
    loudnessAt: (startMs: number, endMs: number) => {
      const from = Math.floor(startMs / LOUDNESS_HOP_MS);
      const to = Math.max(from + 1, Math.ceil(endMs / LOUDNESS_HOP_MS));
      let peak = 0;
      for (let i = from; i < to && i < loudness.length; i += 1) {
        if (loudness[i] > peak) peak = loudness[i];
      }
      return Number(peak.toFixed(3));
    },
  };

  const chunks = await alignSong(pcm, {
    trackId: track.id,
    report,
    // 對完一個窗就送一次。歌是從頭往後播，對齊也是從頭往後跑，所以嘴型幾秒後
    // 就能開始動，而且會一路跑在播放前面。
    onWindow: () => {},
    // 第一趟跑完先存一次。第二趟是補漏，跑到一半被打斷（換歌、關 App）時，
    // 有這一份就不必整首重練。
    onPassDone: async (partial) => {
      await writeJson(timelineFile, {
        ...buildLipTimeline(partial, durationMs, buildOptions),
        formatVersion: LIP_TIMELINE_FORMAT_VERSION,
      });
    },
  });

  const timeline = {
    ...buildLipTimeline(chunks, durationMs, buildOptions),
    formatVersion: LIP_TIMELINE_FORMAT_VERSION,
    refined: true,
  };
  await writeJson(timelineFile, timeline);
  report({ stage: "ready", message: "唱詞對齊完成", completed: 1, total: 1 });
  return timeline;
}

const preparingCovers = new Map<string, Promise<SingingCover>>();
const aligning = new Map<string, Promise<SongLipTimeline>>();
const instrumentalLookups = new Map<string, Promise<SongTrack>>();
/** Demucs 與 Seed-VC 都很吃記憶體；所有歌曲共用一條佇列，避免背景練習和手動點歌
 * 同時把兩份模型塞進 MPS。 */
let coverQueue: Promise<void> = Promise.resolve();
let alignmentQueue: Promise<void> = Promise.resolve();

function share<T>(pool: Map<string, Promise<T>>, key: string, job: () => Promise<T>): Promise<T> {
  const running = pool.get(key);
  if (running) return running;
  const started = job();
  pool.set(key, started);
  void started.catch(() => undefined).finally(() => pool.delete(key));
  return started;
}

async function resolveTrackInstrumental(track: SongTrack): Promise<SongTrack> {
  return await share(instrumentalLookups, track.id, async () => {
    const directory = trackDirectory(track.id);
    const saved = await readJson<SongTrack>(path.join(directory, "track.json"));
    const resolved: SongTrack = {
      ...track,
      instrumentalUrl: track.instrumentalUrl ?? saved?.instrumentalUrl,
      instrumentalSearchedAt: track.instrumentalSearchedAt ?? saved?.instrumentalSearchedAt,
    };
    const recentlySearched = resolved.instrumentalSearchedAt &&
      Date.now() - resolved.instrumentalSearchedAt < INSTRUMENTAL_SEARCH_TTL_MS;
    if (!resolved.instrumentalUrl && !recentlySearched) {
      try {
        resolved.instrumentalUrl = await findBilibiliInstrumental(
          resolved.title,
          resolved.durationSec,
        );
        resolved.instrumentalSearchedAt = Date.now();
      } catch (error) {
        // 搜尋站限流或離線不算「確認找不到」，下次練習仍可再試。
        console.warn(`[Song] 搜尋《${resolved.title}》純伴奏暫時失敗:`, error);
      }
    }
    await writeJson(path.join(directory, "track.json"), resolved);
    return resolved;
  });
}

function serializeCover<T>(job: () => Promise<T>): Promise<T> {
  const started = coverQueue.catch(() => undefined).then(job);
  coverQueue = started.then(() => undefined, () => undefined);
  return started;
}

function serializeAlignment<T>(job: () => Promise<T>): Promise<T> {
  const started = alignmentQueue.catch(() => undefined).then(job);
  alignmentQueue = started.then(() => undefined, () => undefined);
  return started;
}

async function ensureSingingAssets(
  track: SongTrack,
  report: SongProgressReporter,
): Promise<SingingCover> {
  const resolvedTrack = await resolveTrackInstrumental(track);
  return await share(preparingCovers, resolvedTrack.id, async () => {
    const directory = trackDirectory(resolvedTrack.id);
    if (await isSingingCoverReady(directory, resolvedTrack)) {
      return {
        coverFile: path.join(directory, "cover.m4a"),
        alignmentFile: path.join(directory, "cover-vocals.m4a"),
        vocalFile: path.join(directory, "cover-singing.m4a"),
        instrumentalFile: path.join(directory, "cover-instrumental.m4a"),
      };
    }
    const downloaded = await ensureAudioFile(resolvedTrack, report);
    const playable = await ensurePlayableAudio(downloaded);
    const instrumental = await ensureInstrumentalFile(resolvedTrack, report);
    await writeJson(path.join(directory, "track.json"), resolvedTrack);
    return await serializeCover(() => createSingingCover(
      resolvedTrack,
      playable,
      directory,
      report,
      instrumental,
    ));
  });
}

/**
 * 拿到可以馬上播的音訊。
 *
 * 未練的新歌會先完成歌聲轉換；同一首之後都直接讀快取。
 */
export async function getSongAudio(
  track: SongTrack,
  report: SongProgressReporter = () => {},
): Promise<{ audio: Uint8Array; mimeType: string }> {
  const { coverFile } = await ensureSingingAssets(track, report);
  const audio = await fs.readFile(coverFile);
  return { audio: new Uint8Array(audio), mimeType: mimeTypeFor(coverFile) };
}

/** 拿到嘴型時間軸。已經對齊過就是即時的；沒有的話跑一次並存起來。 */
export async function getSongTimeline(
  track: SongTrack,
  report: SongProgressReporter = () => {},
): Promise<SongLipTimeline> {
  const resolvedTrack = await resolveTrackInstrumental(track);
  return await share(aligning, resolvedTrack.id, async () => {
    const directory = trackDirectory(resolvedTrack.id);
    const cached = await readJson<SongLipTimeline>(path.join(directory, "lip.json"));
    if (
      await isSingingCoverReady(directory, resolvedTrack) &&
      cached?.formatVersion === LIP_TIMELINE_FORMAT_VERSION &&
      cached.refined === true &&
      cached.syllables
    ) return cached;

    const { alignmentFile } = await ensureSingingAssets(resolvedTrack, report);

    const alignmentReporter: SongProgressReporter = (progress) => {
      if (typeof progress === "string") {
        report({ stage: "aligning", message: progress, completed: 92, total: 100 });
        return;
      }
      if (progress.stage === "ready") return;
      const fraction = progress.total && progress.completed !== undefined
        ? progress.completed / progress.total
        : 0;
      report({
        ...progress,
        stage: "aligning",
        completed: Math.round(92 + Math.max(0, Math.min(1, fraction)) * 8),
        total: 100,
      });
    };

    // Whisper 也只跑一首。舞台手動點歌與開機背景練習必須排隊，不能把另一首做到
    // 一半的時間軸取消，否則清單會永遠停在「有 partial、但未完成」。
    return await serializeAlignment(async () => {
      activeAlignmentTrackId = resolvedTrack.id;
      try {
        const timeline = await ensureTimeline(resolvedTrack, alignmentFile, alignmentReporter);
        report({ stage: "ready", message: "練習完成，可以唱了", completed: 100, total: 100 });
        return timeline;
      } finally {
        if (activeAlignmentTrackId === resolvedTrack.id) activeAlignmentTrackId = null;
      }
    });
  });
}

/** 下載＋對齊一次做完（工具與測試用；介面走的是上面兩支）。 */
export async function prepareSong(
  track: SongTrack,
  report: SongProgressReporter = () => {},
): Promise<SongPrepared> {
  const [{ audio, mimeType }, timeline] = [await getSongAudio(track, report), await getSongTimeline(track, report)];
  return { track, audio, mimeType, timeline, silent: timeline.syllables.length === 0 };
}

/** 已經練好唱詞的歌（有嘴型時間軸，點下去可以直接唱）。 */
export async function listReadySongIds(): Promise<string[]> {
  try {
    const entries = await fs.readdir(songsRoot(), { withFileTypes: true });
    const ready: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(songsRoot(), entry.name);
      const timeline = await readJson<SongLipTimeline>(
        path.join(directory, "lip.json"),
      );
      if (
        await isSingingCoverReady(directory) &&
        timeline?.formatVersion === LIP_TIMELINE_FORMAT_VERSION &&
        timeline.refined === true &&
        timeline.syllables?.length
      ) ready.push(entry.name);
    }
    return ready;
  } catch {
    return [];
  }
}

/** 已經準備好的歌（快取命中就不必再下載或對齊）。 */
export async function isSongReady(trackOrId: SongTrack | string): Promise<boolean> {
  const track = typeof trackOrId === "string" ? undefined : await resolveTrackInstrumental(trackOrId);
  const trackId = typeof trackOrId === "string" ? trackOrId : trackOrId.id;
  const directory = trackDirectory(trackId);
  const [cover, timeline] = await Promise.all([
    isSingingCoverReady(directory, track),
    readJson<SongLipTimeline>(path.join(directory, "lip.json")),
  ]);
  return Boolean(
    cover &&
    timeline?.formatVersion === LIP_TIMELINE_FORMAT_VERSION &&
    timeline.refined === true &&
    timeline.syllables,
  );
}
