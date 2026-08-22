import { describe, expect, it } from "vitest";
import { buildLipTimeline, cleanChunkText, collapseRepeats, latinVowelSyllables, lipChunkQuality, syllableChars } from "./lip-timeline";

describe("syllableChars", () => {
  it("does not treat musical-note hallucinations as sung syllables", () => {
    expect(syllableChars("♪ ♫♬♩")).toEqual([]);
  });
  it("中文一字一音節，標點不算", () => {
    expect(syllableChars("黑色的眼線，你的指間")).toEqual([
      "黑", "色", "的", "眼", "線", "你", "的", "指", "間",
    ]);
  });

  it("拉丁單字按母音核拆成近似音節", () => {
    expect(latinVowelSyllables("trembling")).toEqual(["e", "i"]);
    expect(syllableChars("baby 別走")).toEqual(["a", "y", "別", "走"]);
  });

  it("括號內容（Whisper 的署名幻覺）整段丟掉", () => {
    expect(syllableChars("回不到從前(字幕:J Chong)")).toEqual(["回", "不", "到", "從", "前"]);
  });
});

describe("cleanChunkText", () => {
  it("連續重複三次以上的單元壓成一次", () => {
    expect(collapseRepeats("鑑定 鑑定 鑑定 鑑定 ")).toBe("鑑定 ");
    expect(collapseRepeats("字幕:郭文貴".repeat(48))).toBe("字幕:郭文貴");
  });

  it("重複兩次的正常疊詞不會被吃掉", () => {
    expect(collapseRepeats("好好聽")).toBe("好好聽");
  });

  it("製作署名不算唱詞", () => {
    expect(cleanChunkText("回不到從前 作词:李宗晨")).toBe("回不到從前");
  });
});

describe("lipChunkQuality", () => {
  it("偏好真正唱句，拒絕音樂標記與重複幻覺", () => {
    const lyrics = [{ startMs: 0, endMs: 4000, text: "And I softly let go of your hand" }];
    const music = [{ startMs: 0, endMs: 20_000, text: "[Music]" }];
    const repeated = [{ startMs: 0, endMs: 20_000, text: "心裡的".repeat(80) }];
    expect(lipChunkQuality(lyrics)).toBeGreaterThan(5);
    expect(lipChunkQuality(music)).toBe(0);
    expect(lipChunkQuality(repeated)).toBe(0);
  });
});

describe("buildLipTimeline", () => {
  it("段內把字平均鋪開", () => {
    const timeline = buildLipTimeline([{ startMs: 1000, endMs: 2000, text: "有一點" }], 10_000);
    expect(timeline.syllables).toEqual([
      { startMs: 1000, endMs: 1333, char: "有" },
      { startMs: 1333, endMs: 1667, char: "一" },
      { startMs: 1667, endMs: 2000, char: "點" },
    ]);
  });

  it("把隔離人聲活動包絡寫進時間軸", () => {
    const timeline = buildLipTimeline(
      [{ startMs: 0, endMs: 500, text: "唱" }],
      1000,
      { voiceActivity: [0, 0.8], voiceHopMs: 25 },
    );
    expect(timeline.voiceActivity).toEqual([0, 0.8]);
    expect(timeline.voiceHopMs).toBe(25);
  });

  it("沒有唱詞的時間完全空白——間奏不會有音節", () => {
    const timeline = buildLipTimeline(
      [
        { startMs: 0, endMs: 1000, text: "前段" },
        { startMs: 30_000, endMs: 31_000, text: "後段" },
      ],
      60_000,
    );
    const gap = timeline.syllables.filter((s) => s.startMs >= 1000 && s.endMs <= 30_000);
    expect(gap).toHaveLength(0);
  });

  it("幻覺樣板句不產生嘴型", () => {
    const timeline = buildLipTimeline(
      [
        { startMs: 0, endMs: 2000, text: "請不吝點贊訂閱" },
        { startMs: 5000, endMs: 6000, text: "字幕組製作" },
      ],
      10_000,
    );
    expect(timeline.syllables).toHaveLength(0);
  });

  it("缺結尾時間戳時用每字 300ms 估算", () => {
    const timeline = buildLipTimeline([{ startMs: 0, endMs: Number.NaN, text: "四個字了" }], 60_000);
    expect(timeline.syllables.at(-1)?.endMs).toBe(1200);
  });

  it("下一段開唱就是上一段的硬邊界，不重疊", () => {
    const timeline = buildLipTimeline(
      [
        { startMs: 0, endMs: 8000, text: "長段落" },
        { startMs: 2000, endMs: 3000, text: "後" },
      ],
      60_000,
    );
    expect(timeline.syllables.filter((s) => s.char !== "後").at(-1)?.endMs).toBe(2000);
  });

  it("時間戳明顯不可信的超長段落，用自然語速排在開頭，其餘留白", () => {
    // 一段 60 秒卻只有兩個字：中間那段間奏被 Whisper 併了進來。
    const timeline = buildLipTimeline([{ startMs: 0, endMs: 60_000, text: "一二" }], 90_000);
    expect(timeline.syllables.at(-1)?.endMs).toBe(1400);
  });

  it("重複幻覺不會把一段塞成上百個音節", () => {
    const timeline = buildLipTimeline(
      [{ startMs: 0, endMs: 2000, text: "詞: ".repeat(110) }],
      10_000,
    );
    expect(timeline.syllables.length).toBeLessThanOrEqual(2);
  });

  it("時間戳溢出音訊長度時裁到音訊尾端", () => {
    const timeline = buildLipTimeline(
      [{ startMs: 0, endMs: 20_000, text: "一二三四五六七八九十" }],
      5000,
    );
    expect(timeline.syllables.at(-1)?.endMs).toBeLessThanOrEqual(5000);
    expect(timeline.syllables.every((s) => s.endMs <= 5000)).toBe(true);
  });
});
