import { normalizeAsrText } from "./asr-text-normalizer";
import {
  pcm16ToFloat32 as pcm16ToFloat32Impl,
  transcribeWhisper,
  warmUpWhisper,
  type WhisperLanguage,
} from "./whisper-worker";

/** 20ms 一格算能量，夠短能抓到單字、夠長不會被單一取樣雜訊帶偏。 */
const ENERGY_FRAME_MS = 20;
/** 一段音訊至少要有這麼久的「明顯比底噪大聲」才算有人講話。
 * 鍵盤聲、桌子碰撞多半只有 30～60ms，過不了這關。 */
const MIN_SPEECH_MS = 200;

function frameRmsSeries(pcm: Buffer, sampleRate: number): number[] {
  const samplesPerFrame = Math.max(1, Math.round((sampleRate * ENERGY_FRAME_MS) / 1000));
  const totalSamples = Math.floor(pcm.length / 2);
  const series: number[] = [];
  for (let start = 0; start + samplesPerFrame <= totalSamples; start += samplesPerFrame) {
    let sum = 0;
    for (let i = 0; i < samplesPerFrame; i += 1) {
      const sample = pcm.readInt16LE((start + i) * 2) / 32768;
      sum += sample * sample;
    }
    series.push(Math.sqrt(sum / samplesPerFrame));
  }
  return series;
}

/**
 * 這段 PCM 裡到底有沒有人聲。
 *
 * 門檻同時看絕對值和底噪：安靜房間的底噪大約 0.001～0.005，正常說話是
 * 0.03 以上；但每個人的麥克風增益差很多，所以再拿第 10 百分位（字與字
 * 之間的空隙）當底噪，取兩者較大的當門檻。
 */
export function hasSpeechSignal(pcm: Buffer, sampleRate = 16000): boolean {
  const frames = frameRmsSeries(pcm, sampleRate);
  if (!frames.length) return false;
  const sorted = [...frames].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  // 上限很重要：整段都是連續說話時，第 10 百分位本身就已經是人聲的音量，
  // 沒有封頂的話門檻會被推到沒有任何一格過得了，真的講話反而被判成靜音。
  const threshold = Math.min(0.03, Math.max(0.01, noiseFloor * 3.5));
  const loudMs = frames.filter((rms) => rms >= threshold).length * ENERGY_FRAME_MS;
  return loudMs >= MIN_SPEECH_MS;
}

/**
 * Whisper 遇到沒有人聲的片段不會回空字串——它會補一句訓練語料裡最常見的
 * 東西。中文語料大量來自帶硬字幕的影片，所以吐出來的是「（字幕:某某某）」
 * 「請不吝點贊訂閱」這類署名。整句比對，而且只在短句上判定，免得誤殺
 * 真的在講字幕、訂閱的句子。
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
  /^[（(【[][^）)】\]]*[）)】\]]$/,
  /^字幕\s*(by|：|:)/i,
  /字幕(組|组|志願者|志愿者|製作|制作)/,
  /(請不吝|请不吝)/,
  /(點贊|点赞|按讚|按赞).*(訂閱|订阅)/,
  /(明鏡|明镜).*(點點|点点)/,
  /^(thanks?\s+for\s+watching|please\s+subscribe)[.!]?$/i,
  /^(you|bye|thank you)[.!]?$/i,
];

/** 判斷這行辨識結果是不是幻覺樣板；空字串也算，呼叫端一律當成沒聽到。 */
export function isWhisperHallucination(text: string): boolean {
  const line = text.trim();
  if (!line) return true;
  // 長句是真的有人在講話，樣板句都很短。
  if (line.length > 30) return false;
  return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * 裁切音訊前後的無聲死區（保留 150ms 安全緩衝），大幅降低 Whisper 運算量與推論耗時。
 */
export function trimSilence(pcm: Buffer, sampleRate = 16000): Buffer {
  const frames = frameRmsSeries(pcm, sampleRate);
  if (!frames.length) return pcm;
  const sorted = [...frames].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const threshold = Math.min(0.03, Math.max(0.01, noiseFloor * 3.5));

  const firstSpeechIdx = frames.findIndex((rms) => rms >= threshold);
  if (firstSpeechIdx === -1) return pcm;
  let lastSpeechIdx = frames.length - 1;
  while (lastSpeechIdx >= 0 && frames[lastSpeechIdx] < threshold) {
    lastSpeechIdx -= 1;
  }

  const padFrames = Math.round(150 / ENERGY_FRAME_MS);
  const startFrame = Math.max(0, firstSpeechIdx - padFrames);
  const endFrame = Math.min(frames.length, lastSpeechIdx + padFrames + 1);

  const bytesPerFrame = Math.round((sampleRate * ENERGY_FRAME_MS * 2) / 1000);
  const startByte = startFrame * bytesPerFrame;
  const endByte = Math.min(pcm.length, endFrame * bytesPerFrame);
  return pcm.subarray(startByte, endByte);
}

export const pcm16ToFloat32 = pcm16ToFloat32Impl;

/** 先把模型載進記憶體。第一次轉寫要多花約 6 秒載入，剛好卡在使用者講完
 * 第一句話之後最難等的位置；通話一開始就先暖起來，等使用者真的說完話時
 * pipeline 已經就緒。失敗不影響通話——真正轉寫時會再試一次並報錯。 */
export function prewarmOfflineWhisper(): void {
  warmUpWhisper();
}

export async function transcribeOfflineWhisper(
  pcm: Buffer,
  language: string,
  onProgress?: (message: string) => void,
  initialPrompt = "你好昔漣，這是一段繁體中文日常對話。",
): Promise<string> {
  const lang: WhisperLanguage = language === "en" ? "en" : "zh";
  const trimmedPcm = trimSilence(pcm);
  const rawText = await transcribeWhisper(trimmedPcm, lang, initialPrompt, onProgress);
  return normalizeAsrText(rawText);
}
