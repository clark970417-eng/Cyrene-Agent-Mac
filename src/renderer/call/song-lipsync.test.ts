import { describe, expect, it } from "vitest";
import { mouthShapeAt, syllableEnvelope, syllableIndexAt, vowelShapeFor, voiceActivityAt } from "./song-lipsync";
import type { SongLipTimeline } from "../../shared/song-types";

const timeline: SongLipTimeline = {
  durationMs: 10_000,
  syllables: [
    { startMs: 1000, endMs: 1400, char: "黑" },
    { startMs: 1400, endMs: 1800, char: "色" },
    { startMs: 5000, endMs: 5600, char: "啊" },
  ],
};

const openness = (shape: ReturnType<typeof mouthShapeAt>) =>
  shape.a + shape.i + shape.u + shape.e + shape.o;

describe("mouthShapeAt", () => {
  it("前奏（第一個字之前）嘴巴是閉的", () => {
    expect(openness(mouthShapeAt(timeline, 0))).toBe(0);
    expect(openness(mouthShapeAt(timeline, 999))).toBe(0);
  });

  it("間奏（字與字之間的長空隙）嘴巴是閉的——配樂再大聲也不動", () => {
    expect(openness(mouthShapeAt(timeline, 3000))).toBe(0);
    expect(openness(mouthShapeAt(timeline, 4900))).toBe(0);
  });

  it("唱到某個字的中段時嘴巴是開的", () => {
    expect(openness(mouthShapeAt(timeline, 1200))).toBeGreaterThan(0.3);
  });

  it("歌曲結束後不再有嘴型", () => {
    expect(openness(mouthShapeAt(timeline, 9000))).toBe(0);
  });

  it("同一個字每次都給同一個口型", () => {
    expect(vowelShapeFor("色")).toEqual(vowelShapeFor("色"));
  });

  it("大開口音比閉唇音張得大", () => {
    expect(openness(vowelShapeFor("啊"))).toBeGreaterThan(openness(vowelShapeFor("不")));
  });

  it("Whisper 即使誤判有字，隔離人聲安靜時仍然閉嘴", () => {
    const gated: SongLipTimeline = {
      durationMs: 1000,
      syllables: [{ startMs: 0, endMs: 1000, char: "啊" }],
      voiceHopMs: 250,
      voiceActivity: [0, 0, 0.9, 0.9],
    };
    expect(openness(mouthShapeAt(gated, 200))).toBe(0);
    expect(openness(mouthShapeAt(gated, 650))).toBeGreaterThan(0.2);
  });
});

describe("voiceActivityAt", () => {
  it("在相鄰活動格之間平滑插值", () => {
    const gated: SongLipTimeline = {
      durationMs: 1000,
      syllables: [],
      voiceHopMs: 100,
      voiceActivity: [0, 1],
    };
    expect(voiceActivityAt(gated, 50)).toBeCloseTo(0.5);
  });
});

describe("syllableIndexAt", () => {
  it("字的起點屬於這個字，終點屬於下一個字", () => {
    expect(syllableIndexAt(timeline, 1400)).toBe(1);
    expect(syllableIndexAt(timeline, 1800)).toBe(-1);
  });
});

describe("syllableEnvelope", () => {
  it("起音與收尾比中段小", () => {
    expect(syllableEnvelope(0, 400)).toBeLessThan(syllableEnvelope(200, 400));
    expect(syllableEnvelope(400, 400)).toBeLessThan(syllableEnvelope(200, 400));
  });

  it("超出音節長度就是 0", () => {
    expect(syllableEnvelope(500, 400)).toBe(0);
    expect(syllableEnvelope(-10, 400)).toBe(0);
  });
});
