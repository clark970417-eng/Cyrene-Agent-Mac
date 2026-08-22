import { describe, expect, it } from "vitest";
import { appendSentence, extractMoodAndCleanSegment, resolveTtsFormat, type CallTtsSettings } from "./call-manager";
import { splitForEarlySpeech } from "./tts-segmentation";

describe("extractMoodAndCleanSegment", () => {
  it("extracts mood tag and strips it from text", () => {
    const result = extractMoodAndCleanSegment("[mood:happy] 今天心情很好呀！");
    expect(result.mood).toBe("happy");
    expect(result.text).toBe("今天心情很好呀！");
  });

  it("handles text with no mood tag and inherits previous mood", () => {
    const result = extractMoodAndCleanSegment("接下來要做什麼呢？", "happy");
    expect(result.mood).toBe("happy");
    expect(result.text).toBe("接下來要做什麼呢？");
  });

  it("strips sticker tags along with mood tags", () => {
    const result = extractMoodAndCleanSegment("[mood:shy][sticker:123] 這樣有點不好意思呢");
    expect(result.mood).toBe("shy");
    expect(result.text).toBe("這樣有點不好意思呢");
  });

  it("handles case insensitive mood tags", () => {
    const result = extractMoodAndCleanSegment("[MOOD:SURPRISED] 真的假的！？");
    expect(result.mood).toBe("surprised");
    expect(result.text).toBe("真的假的！？");
  });
});

// endTurn 實際上是先切段再抽情緒。分開測兩個函式都會過，但切段若把方括號
// 一併刪掉，抽情緒就永遠拿到 undefined、3D 表情整通電話都不會動。
describe("splitForEarlySpeech → extractMoodAndCleanSegment", () => {
  const run = (reply: string) => {
    let previousMood: string | undefined;
    return splitForEarlySpeech(reply).map((segment) => {
      const cleaned = extractMoodAndCleanSegment(segment, previousMood);
      previousMood = cleaned.mood;
      return cleaned;
    });
  };

  it("carries a per-segment mood through to what the renderer receives", () => {
    expect(run("[mood:happy]今天過得怎麼樣呀？[mood:wink]人家剛剛還在想你呢。")).toEqual([
      { mood: "happy", text: "今天過得怎麼樣呀？" },
      { mood: "wink", text: "人家剛剛還在想你呢。" },
    ]);
  });

  it("lets a segment without its own tag inherit the previous mood", () => {
    expect(run("[mood:shy]這樣講有點害羞。那我先說到這裡。")).toEqual([
      { mood: "shy", text: "這樣講有點害羞。" },
      { mood: "shy", text: "那我先說到這裡。" },
    ]);
  });

  // 她被教過用 [mood:] 標籤，但常常還是寫成括號旁白。那幾個字以前直接蒸發：
  // 不朗讀，也不驅動任何表情。現在會先換成標籤再丟掉。
  it("turns a stage direction she wrote in brackets into a real expression", () => {
    expect(run("（輕輕笑了）今天過得怎麼樣呀？")).toEqual([
      { mood: "happy", text: "今天過得怎麼樣呀？" },
    ]);
  });

  it("keeps her own explicit tag when it sits next to a stage direction", () => {
    expect(run("[mood:shy]（笑）這樣講有點不好意思。")).toEqual([
      { mood: "shy", text: "這樣講有點不好意思。" },
    ]);
  });

  it("never leaves a tag in the text handed to TTS", () => {
    for (const { text } of run("[mood:smug]哼哼，[sticker:proud_02]這種事難不倒我。")) {
      expect(text).not.toMatch(/\[/);
    }
  });
});

// 阿里雲的 max_sentence_silence 是 800ms，渲染端 VAD 的靜默結算是 1000ms，
// 所以一輪之內講兩句話是常態。以前的 callback 是覆寫，前半句就這樣沒了。
describe("appendSentence", () => {
  it("keeps every sentence of a multi-sentence turn", () => {
    let acc = "";
    for (const sentence of ["我今天很累。", "晚點再說吧。"]) {
      acc = appendSentence(acc, sentence);
    }
    expect(acc).toBe("我今天很累。晚點再說吧。");
  });

  it("joins Chinese without inserting a space", () => {
    expect(appendSentence("你好", "世界")).toBe("你好世界");
  });

  it("keeps a space between adjacent English words", () => {
    expect(appendSentence("hello", "world")).toBe("hello world");
  });

  it("does not add a space after punctuation", () => {
    expect(appendSentence("Are you ok?", "Yes.")).toBe("Are you ok?Yes.");
  });

  it("ignores empty or whitespace-only pieces", () => {
    expect(appendSentence("", "第一句")).toBe("第一句");
    expect(appendSentence("第一句", "   ")).toBe("第一句");
  });
});

describe("resolveTtsFormat", () => {
  const base = {
    ttsGptsovitsFormat: "wav",
    ttsCustomCloudFormat: "wav",
  } as unknown as CallTtsSettings;

  it("uses the GPT-SoVITS setting only for GPT-SoVITS", () => {
    expect(resolveTtsFormat({ ...base, ttsEngine: "gptsovits" })).toBe("wav");
  });

  it("uses the custom-cloud setting only for custom-cloud", () => {
    expect(resolveTtsFormat({ ...base, ttsEngine: "custom-cloud" })).toBe("wav");
  });

  it("does not let the GPT-SoVITS format leak into other engines", () => {
    expect(resolveTtsFormat({ ...base, ttsEngine: "minimax" })).toBe("mp3");
    expect(resolveTtsFormat({ ...base, ttsEngine: "mimo" })).toBe("mp3");
  });
});
