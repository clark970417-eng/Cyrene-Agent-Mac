// 把原唱轉成昔漣音色：Demucs 拆人聲，Seed-VC 保留旋律與節奏換音色，再混回伴奏。

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";
import ffmpegStaticPath from "ffmpeg-static";
import type { SongPrepareProgress, SongTrack } from "../../shared/song-types";

export type SingingProgressReporter = (
  progress: string | Omit<SongPrepareProgress, "trackId">,
) => void;

/** v4：保存昔漣獨立人聲與純伴奏；有外部 off-vocal 時自動校時後取代分離伴奏。 */
const COVER_FORMAT_VERSION = 4;
const DIFFUSION_STEPS = 20;
const PROCESS_TIMEOUT_MS = 90 * 60_000;

interface SingingRuntime {
  root: string;
  python: string;
  reference: string;
}

interface CoverMetadata {
  formatVersion: number;
  engine: "seed-vc-v1-f0";
  diffusionSteps: number;
  createdAt: number;
  instrumentalSourceUrl?: string;
  instrumentalAccepted?: boolean;
}

export interface SingingCover {
  coverFile: string;
  /** 沒有伴奏的昔漣歌聲，專門交給 Whisper 與活動偵測。 */
  alignmentFile: string;
  vocalFile?: string;
  instrumentalFile?: string;
}

function ffmpegBinary(): string {
  const staticPath = ffmpegStaticPath as string | null;
  if (!staticPath) return "ffmpeg";
  return staticPath.replace("app.asar", "app.asar.unpacked");
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function findFirst(directory: string, prefix: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(directory);
    const found = entries.find((entry) => entry.startsWith(prefix));
    return found ? path.join(directory, found) : null;
  } catch {
    return null;
  }
}

async function resolveRuntime(): Promise<SingingRuntime> {
  const home = app.getPath("home");
  const roots = [
    process.env.CYRENE_SEED_VC_ROOT,
    path.join(app.getPath("userData"), "singing-tools", "seed-vc"),
    path.join(home, "Agent", ".cyrene-cache", "seed-vc"),
  ].filter((value): value is string => Boolean(value));
  const root = (await Promise.all(
    roots.map(async (candidate) => ((await exists(path.join(candidate, "inference.py"))) ? candidate : null)),
  )).find((candidate): candidate is string => Boolean(candidate));
  if (!root) {
    throw new Error("找不到昔漣歌聲引擎（Seed-VC）。請保留 Agent/.cyrene-cache/seed-vc 資料夾。");
  }

  const pythonCandidates = [
    process.env.CYRENE_SEED_VC_PYTHON,
    path.join(root, ".venv", "bin", "python"),
  ].filter((value): value is string => Boolean(value));
  const python = (await Promise.all(
    pythonCandidates.map(async (candidate) => ((await exists(candidate)) ? candidate : null)),
  )).find((candidate): candidate is string => Boolean(candidate));
  if (!python) throw new Error("昔漣歌聲引擎缺少 Python 執行環境。");

  const managedReference = path.join(app.getPath("userData"), "singing", "voice-reference.wav");
  if (!(await exists(managedReference))) {
    const candidates = [
      process.env.CYRENE_SINGING_REFERENCE,
      path.join(home, "Agent", "voice-refs", "昔涟測試語音_官方包.wav"),
    ].filter((value): value is string => Boolean(value));
    const source = (await Promise.all(
      candidates.map(async (candidate) => ((await exists(candidate)) ? candidate : null)),
    )).find((candidate): candidate is string => Boolean(candidate));
    if (!source) throw new Error("找不到昔漣的參考語音素材。");
    await fs.mkdir(path.dirname(managedReference), { recursive: true });
    await fs.copyFile(source, managedReference);
  }

  return { root, python, reference: managedReference };
}

function runProcess(
  binary: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; onOutput?: (text: string) => void } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const accept = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      tail = (tail + text).slice(-40_000);
      options.onOutput?.(text);
    };
    child.stdout.on("data", accept);
    child.stderr.on("data", accept);
    const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const lines = tail.replace(/\r/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
      const detail = [...lines].reverse().find((line) =>
        /error|failed|not installed|no channel|exception/i.test(line)
      ) ?? lines.at(-1);
      reject(new Error(detail || `${path.basename(binary)} 結束代碼 ${code}`));
    });
  });
}

function reportPercent(
  report: SingingProgressReporter,
  stage: SongPrepareProgress["stage"],
  message: string,
  percent: number,
): void {
  report({ stage, message, completed: Math.round(percent), total: 100 });
}

/** Seed-VC 很久才吐一次訊息，期間用保守估時推進，永遠不會在真正完成前跳到 90%。 */
function startConversionTicker(
  report: SingingProgressReporter,
  durationSec: number | undefined,
): () => void {
  const expectedMs = Math.max(90_000, (durationSec ?? 240) * 2_800);
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const fraction = Math.min(0.96, (Date.now() - startedAt) / expectedMs);
    reportPercent(report, "converting", "正在把歌聲換成昔漣的音色…", 25 + fraction * 60);
  }, 1_000);
  return () => clearInterval(timer);
}

export async function isSingingCoverReady(directory: string, track?: SongTrack): Promise<boolean> {
  const metadata = await readJson<CoverMetadata>(path.join(directory, "cover.json"));
  const baseReady = Boolean(
    metadata && metadata.formatVersion >= 3 &&
    await exists(path.join(directory, "cover.m4a")) &&
    await exists(path.join(directory, "cover-vocals.m4a")),
  );
  if (!baseReady) return false;
  if (!track?.instrumentalUrl) return true;
  return Boolean(
    metadata?.formatVersion === COVER_FORMAT_VERSION &&
    metadata.instrumentalSourceUrl === track.instrumentalUrl &&
    await exists(path.join(directory, "cover-singing.m4a")) &&
    await exists(path.join(directory, "cover-instrumental.m4a")),
  );
}

const ALIGN_HOP_MS = 20;

function rmsEnvelope(pcm: Buffer): number[] {
  const sampleRate = 8_000;
  const samplesPerHop = Math.round(sampleRate * ALIGN_HOP_MS / 1000);
  const sampleCount = Math.floor(pcm.length / 2);
  const result: number[] = [];
  for (let start = 0; start + samplesPerHop <= sampleCount; start += samplesPerHop) {
    let energy = 0;
    for (let i = 0; i < samplesPerHop; i += 1) {
      const value = pcm.readInt16LE((start + i) * 2) / 32768;
      energy += value * value;
    }
    result.push(Math.sqrt(energy / samplesPerHop));
  }
  return result;
}

/** 比對外部伴奏與原曲伴奏；正 offset 要裁外部開頭，負值要補延遲。 */
export function accompanimentAlignment(
  referencePcm: Buffer,
  candidatePcm: Buffer,
): { offsetMs: number; confidence: number } {
  const reference = rmsEnvelope(referencePcm);
  const candidate = rmsEnvelope(candidatePcm);
  const maxShift = Math.round(3_000 / ALIGN_HOP_MS);
  const start = Math.round(5_000 / ALIGN_HOP_MS);
  const end = Math.min(reference.length, Math.round(150_000 / ALIGN_HOP_MS));
  let bestShift = 0;
  let bestScore = -Infinity;
  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    let dot = 0;
    let refPower = 0;
    let candidatePower = 0;
    for (let i = start; i < end; i += 1) {
      const j = i + shift;
      if (j < 0 || j >= candidate.length) continue;
      const a = reference[i];
      const b = candidate[j];
      dot += a * b;
      refPower += a * a;
      candidatePower += b * b;
    }
    const score = dot / Math.sqrt(Math.max(1e-12, refPower * candidatePower));
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }
  return { offsetMs: bestShift * ALIGN_HOP_MS, confidence: bestScore };
}

export function accompanimentOffsetMs(referencePcm: Buffer, candidatePcm: Buffer): number {
  return accompanimentAlignment(referencePcm, candidatePcm).offsetMs;
}

async function alignExternalAccompaniment(
  reference: string,
  candidate: string,
  work: string,
): Promise<string> {
  const referencePcmFile = path.join(work, "reference-accompaniment.pcm");
  const candidatePcmFile = path.join(work, "candidate-accompaniment.pcm");
  await Promise.all([
    runProcess(ffmpegBinary(), ["-y", "-loglevel", "error", "-i", reference, "-ar", "8000", "-ac", "1", "-f", "s16le", referencePcmFile]),
    runProcess(ffmpegBinary(), ["-y", "-loglevel", "error", "-i", candidate, "-ar", "8000", "-ac", "1", "-f", "s16le", candidatePcmFile]),
  ]);
  const alignment = accompanimentAlignment(
    await fs.readFile(referencePcmFile),
    await fs.readFile(candidatePcmFile),
  );
  if (!Number.isFinite(alignment.confidence) || alignment.confidence < 0.42) {
    throw new Error(`純伴奏與原曲編排不一致（相似度 ${alignment.confidence.toFixed(2)}）`);
  }
  const offsetMs = alignment.offsetMs;
  const output = path.join(work, "aligned-instrumental.wav");
  const filter = offsetMs >= 0
    ? `atrim=start=${(offsetMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS`
    : `adelay=${Math.abs(offsetMs)}:all=1`;
  await runProcess(ffmpegBinary(), [
    "-y", "-loglevel", "error", "-i", candidate,
    "-af", filter, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", output,
  ]);
  return output;
}

/** 完整歌聲製作。輸出採暫存檔後 rename，App 中途退出也不會留下「看似完成」的半檔。 */
export async function createSingingCover(
  track: SongTrack,
  sourceAudio: string,
  directory: string,
  report: SingingProgressReporter,
  externalInstrumental?: string,
): Promise<SingingCover> {
  const coverFile = path.join(directory, "cover.m4a");
  const alignmentFile = path.join(directory, "cover-vocals.m4a");
  const vocalFile = path.join(directory, "cover-singing.m4a");
  const instrumentalFile = path.join(directory, "cover-instrumental.m4a");
  if (await isSingingCoverReady(directory, track)) {
    return { coverFile, alignmentFile, vocalFile, instrumentalFile };
  }

  const previousMetadata = await readJson<CoverMetadata>(path.join(directory, "cover.json"));
  const canReuseExistingCover = !externalInstrumental && previousMetadata?.formatVersion === 2 && await exists(coverFile);

  const runtime = await resolveRuntime();
  const work = path.join(directory, "singing-work");
  const separatedRoot = path.join(work, "separated");
  const convertedRoot = path.join(work, "converted");
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });

  try {
    // App 從 Finder 啟動時 PATH 裡通常沒有 ffmpeg。Demucs 自己讀 m4a 會因此失敗，
    // 所以先用 App 隨附的 ffmpeg 解成 WAV；WAV 可由 soundfile 直接讀，不靠 PATH。
    const demucsInput = path.join(work, "source.wav");
    reportPercent(report, "separating", "正在準備分離音軌…", 4);
    await runProcess(ffmpegBinary(), [
      "-y", "-loglevel", "error", "-i", sourceAudio,
      "-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", demucsInput,
    ]);

    reportPercent(report, "separating", "正在分離主唱與伴奏…", 8);
    await runProcess(
      runtime.python,
      [
        "-m", "demucs", "-n", "htdemucs", "--two-stems", "vocals",
        "--shifts", "0", "--segment", "7", "-j", "1", "-d", "mps",
        "-o", separatedRoot, demucsInput,
      ],
      {
        cwd: runtime.root,
        // 模型已在安裝階段下載；不要每首歌都連網做一次 HEAD，也避免離線時卡住。
        env: { HF_HUB_OFFLINE: "1", PYTORCH_ENABLE_MPS_FALLBACK: "1" },
        onOutput: (text) => {
          const matches = [...text.matchAll(/(\d{1,3})%/g)];
          const percent = Number(matches.at(-1)?.[1]);
          if (Number.isFinite(percent)) {
            reportPercent(report, "separating", "正在分離主唱與伴奏…", 8 + percent * 0.16);
          }
        },
      },
    );

    const stemDirectory = path.join(
      separatedRoot,
      "htdemucs",
      path.parse(demucsInput).name,
    );
    const sourceVocals = path.join(stemDirectory, "vocals.wav");
    const separatedAccompaniment = path.join(stemDirectory, "no_vocals.wav");
    if (!(await exists(sourceVocals)) || !(await exists(separatedAccompaniment))) {
      throw new Error("人聲分離完成，但找不到輸出的音軌。");
    }

    let usedExternalInstrumental = false;
    let accompaniment = separatedAccompaniment;
    if (externalInstrumental) {
      try {
        reportPercent(report, "mixing", "正在校準另外找到的純伴奏…", 23);
        accompaniment = await alignExternalAccompaniment(
          separatedAccompaniment,
          externalInstrumental,
          work,
        );
        usedExternalInstrumental = true;
      } catch (error) {
        console.warn("[Song] 純伴奏校準失敗，改用本機分離伴奏:", error);
        reportPercent(report, "separating", "純伴奏版本不同，改用本機分離伴奏…", 24);
      }
    }

    // v2 → v3 只需換掉嘴型分析用的人聲，不重跑昂貴的 Seed-VC 20 步轉換與混音。
    if (canReuseExistingCover) {
      const alignmentTemp = path.join(work, "cover-vocals.m4a");
      await runProcess(ffmpegBinary(), [
        "-y", "-loglevel", "error", "-i", sourceVocals,
        "-vn", "-af", "highpass=f=70,lowpass=f=16000", "-ac", "1",
        "-c:a", "aac", "-b:a", "96k", alignmentTemp,
      ]);
      await fs.rename(alignmentTemp, alignmentFile);
      await fs.writeFile(path.join(directory, "cover.json"), JSON.stringify({
        ...previousMetadata,
        formatVersion: COVER_FORMAT_VERSION,
      } satisfies CoverMetadata), "utf8");
      reportPercent(report, "mixing", "乾淨主唱已更新，正在重新對嘴型…", 92);
      return { coverFile, alignmentFile };
    }

    reportPercent(report, "converting", "正在載入昔漣的歌聲模型…", 25);
    const stopTicker = startConversionTicker(
      report,
      track.durationSec ? track.durationSec * (DIFFUSION_STEPS / 10) : undefined,
    );
    try {
      await runProcess(
        runtime.python,
        [
          path.join(runtime.root, "inference.py"),
          "--source", sourceVocals,
          "--target", runtime.reference,
          "--output", convertedRoot,
          "--diffusion-steps", String(DIFFUSION_STEPS),
          "--f0-condition", "true",
          "--auto-f0-adjust", "false",
          "--fp16", "false",
        ],
        {
          cwd: runtime.root,
          // MPS 優先；遇到 Apple 尚未實作的個別算子時才落回 CPU。
          env: { PYTORCH_ENABLE_MPS_FALLBACK: "1" },
        },
      );
    } finally {
      stopTicker();
    }

    const convertedVocals = await findFirst(convertedRoot, "vc_");
    if (!convertedVocals) throw new Error("歌聲轉換完成，但找不到昔漣的人聲音軌。");

    reportPercent(report, "mixing", "正在把昔漣歌聲混回伴奏…", 88);
    const coverTemp = path.join(work, "cover.m4a");
    const alignmentTemp = path.join(work, "cover-vocals.m4a");
    const vocalTemp = path.join(work, "cover-singing.m4a");
    const instrumentalTemp = path.join(work, "cover-instrumental.m4a");
    await Promise.all([
      runProcess(ffmpegBinary(), [
        "-y", "-loglevel", "error", "-i", accompaniment, "-i", convertedVocals,
        "-filter_complex", "[0:a]volume=0.90[a0];[1:a]highpass=f=70,lowpass=f=16000,volume=1.10[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.96[out]",
        "-map", "[out]", "-c:a", "aac", "-b:a", "192k", coverTemp,
      ]),
      runProcess(ffmpegBinary(), [
        "-y", "-loglevel", "error", "-i", convertedVocals,
        "-vn", "-af", "highpass=f=70,lowpass=f=16000", "-ac", "1",
        "-c:a", "aac", "-b:a", "96k", alignmentTemp,
      ]),
      runProcess(ffmpegBinary(), [
        "-y", "-loglevel", "error", "-i", convertedVocals,
        "-vn", "-af", "highpass=f=70,lowpass=f=16000", "-ac", "1",
        "-c:a", "aac", "-b:a", "160k", vocalTemp,
      ]),
      runProcess(ffmpegBinary(), [
        "-y", "-loglevel", "error", "-i", accompaniment,
        "-vn", "-c:a", "aac", "-b:a", "192k", instrumentalTemp,
      ]),
    ]);

    await fs.rename(coverTemp, coverFile);
    await fs.rename(alignmentTemp, alignmentFile);
    await fs.rename(vocalTemp, vocalFile);
    await fs.rename(instrumentalTemp, instrumentalFile);
    await fs.writeFile(path.join(directory, "cover.json"), JSON.stringify({
      formatVersion: COVER_FORMAT_VERSION,
      engine: "seed-vc-v1-f0",
      diffusionSteps: DIFFUSION_STEPS,
      createdAt: Date.now(),
      instrumentalSourceUrl: track.instrumentalUrl,
      instrumentalAccepted: usedExternalInstrumental,
    } satisfies CoverMetadata), "utf8");
    reportPercent(report, "mixing", "昔漣的歌聲完成，正在對嘴型…", 92);
    return { coverFile, alignmentFile, vocalFile, instrumentalFile };
  } finally {
    // 中間 WAV 一首可能佔數百 MB；成品與隔離人聲已另外保存，工作檔可安全清掉。
    await fs.rm(work, { recursive: true, force: true });
  }
}
