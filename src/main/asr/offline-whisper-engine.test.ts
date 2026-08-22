import { describe, expect, it } from "vitest";
import { hasSpeechSignal, isWhisperHallucination, pcm16ToFloat32, trimSilence } from "./offline-whisper-engine";
import { whisperLanguageName } from "./whisper-worker";

describe("Whisper language selection", () => {
  it("supports Chinese, English, Japanese and automatic detection", () => {
    expect(whisperLanguageName("zh")).toBe("chinese");
    expect(whisperLanguageName("en")).toBe("english");
    expect(whisperLanguageName("ja")).toBe("japanese");
    expect(whisperLanguageName("de")).toBe("german");
    expect(whisperLanguageName("ko")).toBe("korean");
    expect(whisperLanguageName("auto")).toBeUndefined();
  });
});

/** 16kHz PCM16：1ms = 32 byte。測試裡用毫秒描述長度比較好讀。 */
const msToBytes = (ms: number) => Math.round(16_000 * 2 * (ms / 1000));
const bytesToMs = (bytes: number) => Math.round(bytes / 32);

/** 產生一段 16kHz PCM16：以 amplitude 當基準音量，loudRange 內改用 loudAmplitude。 */
function makePcm(
  ms: number,
  amplitude: number,
  loud?: { fromMs: number; toMs: number; amplitude: number },
): Buffer {
  const sampleCount = Math.round((16000 * ms) / 1000);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const atMs = (i / 16000) * 1000;
    const inLoud = loud && atMs >= loud.fromMs && atMs < loud.toMs;
    const amp = inLoud ? loud.amplitude : amplitude;
    // 正負交替，RMS 就等於 amp，不用另外算波形。
    pcm.writeInt16LE(Math.round((i % 2 === 0 ? amp : -amp) * 32767), i * 2);
  }
  return pcm;
}

describe("offline Whisper audio conversion", () => {
  it("converts little-endian PCM16 samples to normalized floats", () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(-32768, 0);
    pcm.writeInt16LE(0, 2);
    pcm.writeInt16LE(16384, 4);
    pcm.writeInt16LE(32767, 6);

    const audio = pcm16ToFloat32(pcm);
    expect(audio[0]).toBe(-1);
    expect(audio[1]).toBe(0);
    expect(audio[2]).toBeCloseTo(16384 / 32767, 6);
    expect(audio[3]).toBe(1);
  });
});

describe("hasSpeechSignal", () => {
  it("rejects a buffer that is only room noise", () => {
    expect(hasSpeechSignal(makePcm(3000, 0.003))).toBe(false);
  });

  it("rejects a short transient like a keyboard click", () => {
    expect(hasSpeechSignal(makePcm(3000, 0.003, { fromMs: 1000, toMs: 1060, amplitude: 0.2 }))).toBe(false);
  });

  it("accepts a short utterance buried in a long silence", () => {
    expect(hasSpeechSignal(makePcm(4000, 0.003, { fromMs: 1000, toMs: 1600, amplitude: 0.08 }))).toBe(true);
  });

  it("accepts a buffer that is speech throughout", () => {
    expect(hasSpeechSignal(makePcm(1500, 0.06))).toBe(true);
  });

  it("rejects an empty buffer", () => {
    expect(hasSpeechSignal(Buffer.alloc(0))).toBe(false);
  });
});

// 這段在每一次辨識的必經路徑上。裁過頭會吃掉使用者第一個字，而那種錯誤是靜默的
// ——畫面上只會看到她答非所問，不會有任何報錯。
describe("trimSilence", () => {
  it("drops the dead air on both sides of a short utterance", () => {
    // 前 2 秒靜音、中間 600ms 說話、後 2 秒靜音
    const pcm = makePcm(4600, 0.003, { fromMs: 2000, toMs: 2600, amplitude: 0.08 });
    const trimmed = trimSilence(pcm);

    expect(trimmed.length).toBeLessThan(pcm.length);
    // 說話 600ms＋前後各 150ms 緩衝＝約 900ms，容許一格 20ms 的邊界誤差
    expect(bytesToMs(trimmed.length)).toBeGreaterThanOrEqual(880);
    expect(bytesToMs(trimmed.length)).toBeLessThanOrEqual(960);
  });

  // 緩衝存在的唯一理由：VAD 的門檻永遠比人耳晚一點點察覺開口，
  // 貼著切會削掉第一個字的起音。
  it("keeps a safety margin before the first loud frame", () => {
    const speechStartMs = 2000;
    const pcm = makePcm(4000, 0.003, { fromMs: speechStartMs, toMs: 2600, amplitude: 0.08 });
    const trimmed = trimSilence(pcm);

    // subarray 共用同一塊記憶體，byteOffset 的差就是「前面丟掉多少」。
    const droppedFromHeadMs = bytesToMs(trimmed.byteOffset - pcm.byteOffset);
    expect(droppedFromHeadMs).toBeLessThan(speechStartMs);
    // 而且要真的留下約 150ms 的緩衝，不能貼著說話起點切
    expect(speechStartMs - droppedFromHeadMs).toBeGreaterThanOrEqual(140);
  });

  it("returns the audio untouched when it is silence all the way through", () => {
    const pcm = makePcm(3000, 0.003);
    expect(trimSilence(pcm)).toBe(pcm);
  });

  it("barely trims audio that is speech throughout", () => {
    const pcm = makePcm(2000, 0.06);
    const trimmed = trimSilence(pcm);
    expect(bytesToMs(pcm.length - trimmed.length)).toBeLessThanOrEqual(40);
  });

  it("never grows the buffer, and never returns a negative slice", () => {
    for (const pcm of [
      Buffer.alloc(0),
      Buffer.alloc(10),                                    // 不足一格
      makePcm(50, 0.08),                                   // 只有兩格多
      makePcm(1000, 0.003, { fromMs: 0, toMs: 40, amplitude: 0.2 }),   // 說話貼在最開頭
      makePcm(1000, 0.003, { fromMs: 960, toMs: 1000, amplitude: 0.2 }), // 說話貼在最結尾
    ]) {
      const trimmed = trimSilence(pcm);
      expect(trimmed.length).toBeGreaterThanOrEqual(0);
      expect(trimmed.length).toBeLessThanOrEqual(pcm.length);
    }
  });

  // 裁切後的音訊還是要 16-bit 對齊，否則 pcm16ToFloat32 會整段錯位變成雜訊。
  it("keeps the result aligned to whole 16-bit samples", () => {
    const pcm = makePcm(3000, 0.003, { fromMs: 1000, toMs: 1600, amplitude: 0.08 });
    expect(trimSilence(pcm).length % 2).toBe(0);
  });

  it("still contains the loud part after trimming", () => {
    const pcm = makePcm(4000, 0.003, { fromMs: 1500, toMs: 2100, amplitude: 0.08 });
    const trimmed = trimSilence(pcm);
    // 裁完的片段自己必須仍然通過人聲判定，否則就是把說話的部分切掉了
    expect(hasSpeechSignal(trimmed)).toBe(true);
  });
});

describe("isWhisperHallucination", () => {
  it("drops the subtitle-credit templates Whisper emits on silence", () => {
    expect(isWhisperHallucination("（字幕:薛宗）")).toBe(true);
    expect(isWhisperHallucination("字幕by索兰娅")).toBe(true);
    expect(isWhisperHallucination("(音樂)")).toBe(true);
    expect(isWhisperHallucination("請不吝點贊 訂閱")).toBe(true);
    expect(isWhisperHallucination("Thanks for watching!")).toBe(true);
    expect(isWhisperHallucination("   ")).toBe(true);
  });

  it("keeps real speech, including sentences that happen to mention subtitles", () => {
    expect(isWhisperHallucination("幫我把明天下午三點的行程改到五點")).toBe(false);
    expect(isWhisperHallucination("昔漣可以幫我把影片的字幕打開嗎")).toBe(false);
    expect(isWhisperHallucination("我想訂閱這個頻道的電子報，你幫我看看要怎麼弄好不好")).toBe(false);
  });
});
