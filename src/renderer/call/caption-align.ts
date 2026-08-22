// 字幕與語音的對齊。
//
// 以前字幕是照 `currentTime / duration` 線性推的。問題是聲音根本不是線性的：
//   - TTS 產出的音檔開頭結尾都有一小段靜音，線性推法會在她還沒開口時就吐字；
//   - 句中的停頓（逗號、換氣）在文字上只是一個標點，在音訊上卻是好幾百毫秒，
//     字幕會在停頓期間繼續往前跑，然後整段都比聲音早；
//   - 標點本身不發聲，卻和「出」「來」一樣各佔一格進度。
//
// 這裡改成兩件事對齊：
//   1. 進度不看時間，看「已經發出多少聲音」——靜音的格子不算進度，字就停在
//      原地等她開口。中文音節長度相當平均，所以已發聲時間的比例和講到第幾個
//      字對得相當準。
//   2. 每個字依字種給不同權重，標點權重為零，跟著前一個字一起冒出來。
//
// 露字的時機取「這個字的聲音開始的瞬間」，而不是「這個字唸完」——後者會讓每個
// 字都慢一拍。

/** 10ms 一格。再細只是讓曲線佔更多記憶體，人眼分辨不出來。 */
export const CAPTION_FRAME_MS = 10;

export interface CaptionAlignment {
  /** progressAt[i] = 播到第 i 格為止，這一段已經發出的聲音佔全段的比例（0..1）。 */
  progressAt: Float32Array;
  frameMs: number;
}

/**
 * 從波形算出發聲進度曲線。整段都安靜（合成失敗、純靜音）時回 null，
 * 呼叫端會退回線性推法。
 */
export function buildCaptionAlignment(
  samples: Float32Array,
  sampleRate: number,
  frameMs: number = CAPTION_FRAME_MS,
): CaptionAlignment | null {
  if (!samples.length || sampleRate <= 0) return null;
  const samplesPerFrame = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const frameCount = Math.ceil(samples.length / samplesPerFrame);
  if (frameCount === 0) return null;

  const rms = new Float32Array(frameCount);
  let peak = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * samplesPerFrame;
    const end = Math.min(samples.length, start + samplesPerFrame);
    let squareSum = 0;
    for (let i = start; i < end; i += 1) squareSum += samples[i] * samples[i];
    const value = Math.sqrt(squareSum / Math.max(1, end - start));
    rms[frame] = value;
    if (value > peak) peak = value;
  }
  if (peak <= 0) return null;

  // 相對門檻：TTS 的輸出很乾淨，用峰值的一小部分就能穩定分出有聲／無聲，
  // 不必去猜絕對音量。下限擋住整段近乎無聲的情況。
  const threshold = Math.max(0.008, peak * 0.08);

  // progressAt 多一格：第 0 格代表「還沒開始播」，進度必為 0。
  const progressAt = new Float32Array(frameCount + 1);
  let voiced = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (rms[frame] >= threshold) voiced += 1;
    progressAt[frame + 1] = voiced;
  }
  if (voiced === 0) return null;
  for (let i = 1; i <= frameCount; i += 1) progressAt[i] /= voiced;

  return { progressAt, frameMs };
}

/** 播到 currentTime 秒時的發聲進度。 */
export function progressAtTime(alignment: CaptionAlignment, currentTimeSec: number): number {
  if (!(currentTimeSec > 0)) return 0;
  const frame = Math.floor((currentTimeSec * 1000) / alignment.frameMs);
  const index = Math.min(alignment.progressAt.length - 1, Math.max(0, frame));
  return alignment.progressAt[index];
}

/** 不發聲的字：標點、空白。它們不該佔進度，但要跟著前一個字一起出現。 */
function isSilentChar(char: string): boolean {
  return /[\s，。、；：！？「」『』（）《》…—·,.;:!?"'()\[\]-]/.test(char);
}

/**
 * 每個字佔多少發聲時間。
 * 中文一字一音節，取 1；拉丁字母平均約三個字母才一個音節；數字唸出來接近一個字。
 */
export function captionCharWeight(char: string): number {
  if (isSilentChar(char)) return 0;
  if (/[a-zA-Z]/.test(char)) return 0.35;
  if (/[0-9]/.test(char)) return 0.7;
  return 1;
}

/**
 * 依發聲進度決定字幕露出到哪裡。
 *
 * 一個字在它的聲音「開始」時就露出來（而不是唸完才露），所以判斷用的是這個字
 * 的起點權重。後面緊接著的標點會一起帶出來——標點不發聲，等下一個字才冒出來
 * 會讓句子看起來斷在奇怪的地方。
 */
export function revealedCaptionByProgress(full: string, progress: number): string {
  if (!full) return "";
  if (!(progress > 0)) return "";

  const chars = [...full];
  const weights = chars.map(captionCharWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return progress > 0 ? full : "";

  const target = Math.min(1, progress) * total;
  let consumed = 0;
  let revealed = 0;
  for (let i = 0; i < chars.length; i += 1) {
    // 這個字的聲音還沒開始就停手。用嚴格大於，播放起點（progress=0）才不會
    // 在她開口之前就先吐出第一個字。
    if (weights[i] > 0 && consumed >= target) break;
    consumed += weights[i];
    revealed = i + 1;
  }
  // 把緊接在後面的標點一起帶出來。
  while (revealed < chars.length && weights[revealed] === 0) revealed += 1;

  return chars.slice(0, revealed).join("");
}

/**
 * 依據對話文字與音訊播放時間，精確計算音節開口度（Syllable-driven Lip-Sync）
 * 包含：母音張嘴、輔音收口、標點/換氣停頓完全閉合，以及語音結束立即歸零。
 */
export function computeSyllableMouthOpen(
  text: string,
  currentTime: number,
  duration: number
): number {
  if (!text || duration <= 0 || currentTime <= 0 || currentTime >= duration) {
    return 0;
  }

  // 1. 去除表情符號與標籤
  const clean = text.replace(/\[[^\]]+\]/g, "").replace(/[\r\n\t]/g, "").trim();
  if (!clean.length) {
    // 無文字時採用自然人聲說話頻率（~4.2Hz）振盪
    const phase = (currentTime * 4.2 * Math.PI * 2) % (Math.PI * 2);
    return Math.max(0, Math.sin(phase) * 0.7);
  }

  // 2. 計算當前發音位置
  const progress = Math.min(1, Math.max(0, currentTime / duration));
  const charIdx = Math.min(clean.length - 1, Math.floor(progress * clean.length));
  const char = clean[charIdx];

  // 3. 標點符號、空格、破折號判定為停頓（嘴巴完全閉合）
  if (/[，。！？!?、；;…—\s~～「」『』（）]/.test(char)) {
    return 0;
  }

  // 4. 音節波形（每個字為一個獨立音節波峰）
  const charsCount = Math.max(1, clean.length);
  const charProgress = (progress * charsCount) % 1; // 0..1 該字符內的進度
  // 音節前半段開口（母音爆發），後半段閉合（輔音/過渡）
  const syllableWave = Math.sin(charProgress * Math.PI);

  // 5. 依字音調整開口幅度
  let openScale = 0.75;
  if (/[啊呀啦吧嘛哪哇哈開大笑晚亮真開心好]/.test(char)) {
    openScale = 0.95; // 大開口音
  } else if (/[一七西裡閉不起意機咪妳你細]/.test(char)) {
    openScale = 0.45; // 扁平音
  } else if (/[不沒摸抱朋閉夢風分問]/.test(char)) {
    openScale = 0.25; // 閉唇音
  }

  return Math.max(0, Math.min(1.0, syllableWave * openScale));
}

