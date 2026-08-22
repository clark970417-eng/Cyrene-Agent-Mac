import { describe, expect, it } from "vitest";
import {
  buildCaptionAlignment,
  captionCharWeight,
  progressAtTime,
  revealedCaptionByProgress,
  computeSyllableMouthOpen,
} from "./caption-align";

const SAMPLE_RATE = 16_000;

/** 造一段波形：segments 依序描述「幾毫秒、振幅多少」。 */
function makeWave(segments: Array<{ ms: number; amplitude: number }>): Float32Array {
  const total = segments.reduce((sum, s) => sum + Math.round((SAMPLE_RATE * s.ms) / 1000), 0);
  const out = new Float32Array(total);
  let cursor = 0;
  for (const segment of segments) {
    const count = Math.round((SAMPLE_RATE * segment.ms) / 1000);
    for (let i = 0; i < count; i += 1) {
      out[cursor + i] = i % 2 === 0 ? segment.amplitude : -segment.amplitude;
    }
    cursor += count;
  }
  return out;
}

describe("buildCaptionAlignment", () => {
  // 這是整件事的重點：TTS 的音檔開頭都有一小段靜音，線性推法會在她還沒開口
  // 的時候就先吐字出來。
  it("holds progress at zero through leading silence", () => {
    const wave = makeWave([
      { ms: 500, amplitude: 0 },
      { ms: 1000, amplitude: 0.3 },
    ]);
    const alignment = buildCaptionAlignment(wave, SAMPLE_RATE)!;

    expect(alignment).not.toBeNull();
    expect(progressAtTime(alignment, 0.4)).toBe(0);
    expect(progressAtTime(alignment, 0.51)).toBeGreaterThan(0);
    expect(progressAtTime(alignment, 1.5)).toBeCloseTo(1, 2);
  });

  // 句中的停頓在文字上只是一個逗號，在音訊上卻是好幾百毫秒。
  it("freezes progress across a mid-sentence pause", () => {
    const wave = makeWave([
      { ms: 600, amplitude: 0.3 },   // 前半句
      { ms: 600, amplitude: 0 },     // 換氣
      { ms: 600, amplitude: 0.3 },   // 後半句
    ]);
    const alignment = buildCaptionAlignment(wave, SAMPLE_RATE)!;

    // 兩個取樣點都落在停頓之內（600ms 剛好是格線，往後挪一格避開量化邊界）。
    const beforePause = progressAtTime(alignment, 0.61);
    const afterPause = progressAtTime(alignment, 1.19);
    expect(afterPause).toBe(beforePause);
    // 停頓佔了總長一半，但一個字都不該前進——線性推法在這裡會走到 0.75。
    expect(afterPause).toBeCloseTo(0.5, 1);
  });

  it("ignores trailing silence so the last character lands on the last sound", () => {
    const wave = makeWave([
      { ms: 1000, amplitude: 0.3 },
      { ms: 1000, amplitude: 0 },
    ]);
    const alignment = buildCaptionAlignment(wave, SAMPLE_RATE)!;
    expect(progressAtTime(alignment, 1.02)).toBeCloseTo(1, 2);
  });

  it("gives up on audio with no sound at all, letting the caller fall back", () => {
    expect(buildCaptionAlignment(makeWave([{ ms: 500, amplitude: 0 }]), SAMPLE_RATE)).toBeNull();
    expect(buildCaptionAlignment(new Float32Array(0), SAMPLE_RATE)).toBeNull();
  });
});

describe("captionCharWeight", () => {
  it("gives punctuation no share of the audio, since it makes no sound", () => {
    expect(captionCharWeight("，")).toBe(0);
    expect(captionCharWeight("！")).toBe(0);
    expect(captionCharWeight(" ")).toBe(0);
  });

  it("counts one Han character as one syllable, and latin letters as a fraction", () => {
    expect(captionCharWeight("出")).toBe(1);
    expect(captionCharWeight("a")).toBeLessThan(1);
  });
});

describe("revealedCaptionByProgress", () => {
  const line = "你好呀我是昔漣";

  it("shows nothing before she has made a sound", () => {
    expect(revealedCaptionByProgress(line, 0)).toBe("");
  });

  // 使用者的要求：講到「出」的當下就要看到「出」，不能等它唸完才冒出來。
  it("reveals a character the moment its sound starts, not after it finishes", () => {
    // 七個字，進度剛過第三個字的起點 → 第三個字（呀）就該在了。
    expect(revealedCaptionByProgress(line, 2.01 / 7)).toBe("你好呀");
    // 還沒碰到第三個字的起點時就只有兩個字。
    expect(revealedCaptionByProgress(line, 1.99 / 7)).toBe("你好");
  });

  it("carries trailing punctuation out with the character before it", () => {
    // 「好」的聲音一開始，後面那個不發聲的逗號就跟著出來，句子才不會斷在半空。
    expect(revealedCaptionByProgress("你好，我是昔漣", 1.01 / 6)).toBe("你好，");
  });

  it("shows the whole line once the audio is done", () => {
    expect(revealedCaptionByProgress(line, 1)).toBe(line);
    expect(revealedCaptionByProgress(line, 1.5)).toBe(line);
  });

  it("handles an empty line and a line that is only punctuation", () => {
    expect(revealedCaptionByProgress("", 0.5)).toBe("");
    expect(revealedCaptionByProgress("……", 0.5)).toBe("……");
  });

  // 對齊曲線和文字合起來看：停頓期間字幕必須原地不動。
  it("keeps the caption still while she is pausing mid-sentence", () => {
    const wave = makeWave([
      { ms: 600, amplitude: 0.3 },
      { ms: 600, amplitude: 0 },
      { ms: 600, amplitude: 0.3 },
    ]);
    const alignment = buildCaptionAlignment(wave, SAMPLE_RATE)!;
    const text = "你好呀，我是昔漣";

    const atPauseStart = revealedCaptionByProgress(text, progressAtTime(alignment, 0.61));
    const atPauseEnd = revealedCaptionByProgress(text, progressAtTime(alignment, 1.19));
    expect(atPauseEnd).toBe(atPauseStart);
  });
});

describe("computeSyllableMouthOpen", () => {
  it("returns 0 when audio has not started or has ended", () => {
    expect(computeSyllableMouthOpen("你好呀", 0, 2.0)).toBe(0);
    expect(computeSyllableMouthOpen("你好呀", -0.1, 2.0)).toBe(0);
    expect(computeSyllableMouthOpen("你好呀", 2.0, 2.0)).toBe(0);
    expect(computeSyllableMouthOpen("你好呀", 2.5, 2.0)).toBe(0);
  });

  it("returns natural mouth opening during syllable pronunciation and closes on punctuation", () => {
    const text = "你好呀，我是昔漣！";
    // 講話中某音節高點
    const openAmount = computeSyllableMouthOpen(text, 0.4, 3.0);
    expect(openAmount).toBeGreaterThanOrEqual(0);
    expect(openAmount).toBeLessThanOrEqual(1.0);

    // 遇到逗號或停頓時，開口歸零
    const pauseOpen = computeSyllableMouthOpen(text, 1.15, 3.0);
    expect(pauseOpen).toBe(0);
  });
});
