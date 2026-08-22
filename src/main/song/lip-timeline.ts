// 把 Whisper 的帶時間戳結果，轉成「哪個字在什麼時候被唱出來」的嘴型時間軸。
//
// 為什麼不直接用音量：翻唱影片是人聲和伴奏混在一起的成品，鼓點和主旋律的音量
// 常常比人聲還大。用音量驅動嘴型，她會在前奏、間奏、鼓點上一直開合。這裡改成
// 只認「有人在唱」的時間段——沒有字的地方一律閉嘴，配樂再吵也帶不動她。
//
// Whisper 在唱腔下辨出來的「字」常常是錯的（「黑色的眼線」會變成「黑色的眼神」），
// 但每一段的起訖時間相當準。畫面上不顯示歌詞，所以字錯無妨；嘴型要的是節奏、
// 音節數與開口大小，這三件事錯字並不影響。

import { isWhisperHallucination } from "../asr/offline-whisper-engine";
import type { SongLipTimeline, SongSyllable } from "../../shared/song-types";

export interface LipTimelineChunk {
  startMs: number;
  endMs: number;
  text: string;
}

/** 一個音節最短開多久。再短人眼只會看到抖動。 */
const MIN_SYLLABLE_MS = 90;
/** 沒有結尾時間戳時，估一個字唱多久。中文唱腔大約每字 0.3 秒。 */
const FALLBACK_CHAR_MS = 300;
/** 一個音節最長撐多久。超過就不是「唱得慢」，是這一段的時間戳不可信
 * （Whisper 偶爾把一整段間奏併進前一句），那時改用自然語速把字排在段落開頭，
 * 剩下的時間留白——寧可她少動，也不要對著伴奏張嘴。 */
const MAX_SYLLABLE_MS = 700;

/** 製作署名：Whisper 在純伴奏段落最常吐出來的東西。 */
const CREDIT_PATTERN =
  /(作詞|作词|作曲|編曲|编曲|填詞|填词|字幕|翻譯|翻译|製作|制作|監製|监制|演唱|原唱|詞|词|曲|唱)\s*[:：]\s*\S*/g;

/** 重複幻覺的判定門檻：壓掉重複後只剩不到四成，代表這一段幾乎整段都是機器在
 * 空轉。那種段落連沒重複的部分也不可信，整段丟掉比留著保險。 */
const REPEAT_JUNK_RATIO = 0.4;

/**
 * 壓掉重複幻覺。
 *
 * Whisper 在沒有人聲、或是段落邊界上會卡住，把同一個 token 連吐上百次
 * （實測有「詞: 詞: 詞: …」重複 110 次、「字幕:郭文貴」重複 48 次）。這些字
 * 一旦當真，一段兩秒的音訊會被塞進上百個音節，嘴巴就變成抽搐。
 * 連續重複三次以上的單元一律壓成一次。
 */
export function collapseRepeats(text: string): string {
  let result = text;
  for (let unit = 1; unit <= 8; unit += 1) {
    result = result.replace(new RegExp(`(.{${unit}})\\1{2,}`, "gs"), "$1");
  }
  return result;
}

/** 清掉署名與重複幻覺之後，這一段真正被唱出來的文字。整段都是空轉時回空字串。 */
export function cleanChunkText(text: string): string {
  const source = text.trim();
  if (!source) return "";
  const collapsed = collapseRepeats(source);
  if (collapsed.length < source.length * REPEAT_JUNK_RATIO) return "";
  return collapsed.replace(CREDIT_PATTERN, " ").replace(/\s+/g, " ").trim();
}

/** 不發聲的字元：標點、空白。它們不佔時間，也不該讓嘴巴動。 */
function isSilentChar(char: string): boolean {
  return /[\s，。、；：！？「」『』（）《》…—·,.;:!?"'()[\]\-~～♪♫♬♩]/.test(char);
}

const LATIN_LETTER = /[a-zA-ZÀ-ÖØ-öø-ÿĀ-ž']/;
const LATIN_VOWEL_GROUP = /[aeiouyàáâãäåæèéêëìíîïòóôõöøœùúûüýÿāēīōū]+/gi;

/** 英文與歐語單字按母音核拆成近似音節；嘴型只需要母音，不必保留輔音拼字。 */
export function latinVowelSyllables(word: string): string[] {
  const nuclei = word.match(LATIN_VOWEL_GROUP);
  return nuclei?.length ? nuclei : [word];
}

/**
 * 把一段唱詞拆成「會發出聲音的字」。
 * 中文一字一音節，直接拆；連續的拉丁字母合成一個音節（唱英文時一個字才一拍）。
 */
export function syllableChars(text: string): string[] {
  const cleaned = text.replace(/\[[^\]]*\]/g, "").replace(/[（(][^）)]*[）)]/g, "");
  const out: string[] = [];
  let latin = "";
  const flushLatin = () => {
    if (!latin) return;
    out.push(...latinVowelSyllables(latin));
    latin = "";
  };
  for (const char of cleaned) {
    if (LATIN_LETTER.test(char)) {
      latin += char;
      continue;
    }
    flushLatin();
    if (isSilentChar(char)) continue;
    out.push(char);
  }
  flushLatin();
  return out;
}

/**
 * 這一段有沒有真的唱出字。
 *
 * 判斷標準必須和 `buildLipTimeline` 實際採用的一致——Whisper 會用括號標示
 * 「這裡是音樂不是人聲」（`(我愛你)`、`( day)`），那種段落清洗後字串非空，
 * 卻一個音節都產不出來。對齊流程要用這個函式決定「這一窗是不是空手而回」，
 * 用「字串非空」判斷會漏掉整段主歌。
 */
export function hasSingableText(text: string): boolean {
  return isSungChunk(cleanChunkText(text));
}

/**
 * 語言探測用的可信度分數。真正的唱句會有多個可發聲音節，且通常會拆成數段；
 * `[Music]`、署名與重複幻覺經清洗後得 0 分。長達十幾秒卻只有一兩個 token 的
 * 結果也會被降權，避免選中 Whisper 硬湊出來的語言。
 */
export function lipChunkQuality(chunks: LipTimelineChunk[]): number {
  let score = 0;
  for (const chunk of chunks) {
    const text = cleanChunkText(chunk.text);
    if (!isSungChunk(text)) continue;
    const syllables = syllableChars(text).length;
    const declaredDuration = (chunk.endMs - chunk.startMs) / 1000;
    const durationSec = Number.isFinite(declaredDuration)
      ? Math.max(0.1, declaredDuration)
      : Math.max(0.3, syllables * 0.3);
    const density = syllables / durationSec;
    score += syllables + Math.min(2, density) + 1;
    if (durationSec > 10 && density < 0.5) score *= 0.35;
  }
  return score;
}

/** 這一段到底算不算「有人在唱」。 */
function isSungChunk(text: string): boolean {
  if (!text) return false;
  // Whisper 遇到純伴奏會補署名、字幕組、訂閱那類樣板句，那些時間點其實沒有人在唱。
  if (isWhisperHallucination(text)) return false;
  return syllableChars(text).length > 0;
}

/**
 * 建立嘴型時間軸。
 *
 * `durationMs` 是音訊總長，用來裁掉 Whisper 偶爾溢出音訊尾端的時間戳。
 */
export interface LipTimelineOptions {
  /** 回傳這段時間內的人聲力度（0~1）。只用來微調開口幅度。 */
  loudnessAt?: (startMs: number, endMs: number) => number;
  /** 與音訊同長的隔離人聲活動包絡。 */
  voiceActivity?: number[];
  voiceHopMs?: number;
}

export function buildLipTimeline(
  chunks: LipTimelineChunk[],
  durationMs: number,
  options: LipTimelineOptions = {},
): SongLipTimeline {
  const sung = chunks
    .map((chunk) => ({ ...chunk, text: cleanChunkText(chunk.text) }))
    // 起訖都是 0 是 Whisper 放棄計時的訊號（幾乎都出現在純伴奏段），這種段落
    // 沒有可信的時間可用，不如不動嘴。
    .filter((chunk) => Number.isFinite(chunk.startMs) && !(chunk.startMs === 0 && chunk.endMs === 0))
    .filter((chunk) => isSungChunk(chunk.text))
    .sort((a, b) => a.startMs - b.startMs);

  const syllables: SongSyllable[] = [];

  for (let i = 0; i < sung.length; i += 1) {
    const chunk = sung[i];
    const chars = syllableChars(chunk.text);
    const start = Math.max(0, Math.min(chunk.startMs, durationMs));
    // 下一段開唱就是這一段的硬邊界——不然重疊會讓兩段的嘴型互相打架。
    const nextStart = i + 1 < sung.length ? sung[i + 1].startMs : Number.POSITIVE_INFINITY;
    const declared = Number.isFinite(chunk.endMs) ? chunk.endMs : start + chars.length * FALLBACK_CHAR_MS;
    const end = Math.min(
      Math.max(declared, start + chars.length * MIN_SYLLABLE_MS),
      nextStart,
      durationMs,
    );
    if (!(end > start)) continue;

    // 段內平均分配。唱腔的字長本來就不平均，但沒有逐字時間戳可用時，平均分配
    // 的誤差（半個字）遠小於「整段一起開合」看起來的假。
    //
    // 例外是時間戳明顯不可信的段落：一段 50 秒卻只有十來個字，代表中間那段
    // 間奏被併了進來。這時不把字攤平到 50 秒（她會對著伴奏一直動嘴），而是用
    // 自然語速排在段落開頭，其餘留白。
    const evenSlot = (end - start) / chars.length;
    const slot = Math.min(evenSlot, MAX_SYLLABLE_MS);
    for (let index = 0; index < chars.length; index += 1) {
      const charStart = start + slot * index;
      if (charStart >= end) break;
      const startMs = Math.round(charStart);
      const endMs = Math.round(Math.min(charStart + slot, end));
      syllables.push({
        startMs,
        endMs,
        char: chars[index],
        gain: options.loudnessAt ? options.loudnessAt(startMs, endMs) : undefined,
      });
    }
  }

  return {
    durationMs: Math.max(0, Math.round(durationMs)),
    syllables,
    voiceActivity: options.voiceActivity,
    voiceHopMs: options.voiceHopMs,
  };
}
