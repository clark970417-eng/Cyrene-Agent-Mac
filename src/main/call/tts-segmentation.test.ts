import { describe, expect, it } from "vitest";
import { splitForEarlySpeech, StreamingSentenceSplitter } from "./tts-segmentation";

/** 只看會被唸出來的部分——mood 與 gesture 標籤留在段落裡是給表情手勢用的，不朗讀。 */
function spokenOnly(segments: string[]): string {
  return segments.join("").replace(/\[(?:mood:[a-z]+|gesture:[a-z0-9_]+)\]/gi, "");
}

describe("call TTS segmentation", () => {
  it("returns short replies as one segment", () => {
    expect(splitForEarlySpeech("好呀，我在這裡。")) .toEqual(["好呀，我在這裡。"]);
  });

  it("splits a long reply early at Chinese punctuation", () => {
    const chunks = splitForEarlySpeech("今天確實有一點冷，你出門時記得多穿一件外套。回家後也可以喝點熱飲。", 34);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe("今天確實有一點冷，你出門時記得多穿一件外套。回家後也可以喝點熱飲。");
    expect(Array.from(chunks[0]).length).toBeLessThanOrEqual(34);
  });

  // 旁白不朗讀，但認得出情緒時會換成 mood 標籤——否則那幾個字就白白蒸發，
  // 她臉上一點反應都沒有。
  it("turns a stage direction into a mood tag instead of letting it vanish", () => {
    expect(splitForEarlySpeech("（輕聲笑了笑）我一直都在這裡。"))
      .toEqual(["[mood:happy]我一直都在這裡。"]);
  });

  it("still drops a stage direction it cannot read an emotion from", () => {
    expect(splitForEarlySpeech("（她沒有回答）我一直都在這裡。"))
      .toEqual(["我一直都在這裡。"]);
  });

  it("keeps mood and sticker tags so the mood extractor can still read them", () => {
    expect(splitForEarlySpeech("[mood:happy]今天過得怎麼樣呀？[mood:wink]人家剛剛還在想你呢。"))
      .toEqual(["[mood:happy]今天過得怎麼樣呀？", "[mood:wink]人家剛剛還在想你呢。"]);
    expect(splitForEarlySpeech("[sticker:hug_01]抱一個。")).toEqual(["[sticker:hug_01]抱一個。"]);
  });

  it("still drops brackets that are not mood or sticker tags", () => {
    expect(splitForEarlySpeech("[旁白]我在這裡。")).toEqual(["我在這裡。"]);
  });

  it("does not count tag characters towards the segment length", () => {
    const sentence = "一二三四五六七八九十一二三四五六七八九十";
    const [first] = splitForEarlySpeech(`[mood:surprised]${sentence}`, 20);
    // 標籤若被算進長度，第一段會在第 4 個字就被切開。
    expect(first).toBe(`[mood:surprised]${sentence}`);
  });
});

describe("StreamingSentenceSplitter", () => {
  it("yields segments incrementally as tokens arrive (emits 2-char acknowledgment immediately on soft break)", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const tokens = ["[mood:happy]好呀，", "我在這裡呢！", "你有什麼想聊的嗎？"];
    const results: string[] = [];

    for (const token of tokens) {
      results.push(...splitter.push(token));
    }
    results.push(...splitter.finish());

    expect(results).toEqual([
      "[mood:happy]好呀，",
      "我在這裡呢！",
      "你有什麼想聊的嗎？",
    ]);
  });

  it("splits early on 2-char acknowledgment like '夥伴，' or '好喔，'", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const chunk1 = splitter.push("夥伴，");
    expect(chunk1).toEqual(["夥伴，"]);
    const chunk2 = splitter.push("今天有什麼想聊的嗎？");
    expect(chunk2).toEqual(["今天有什麼想聊的嗎？"]);
  });

  it("splits early on the first sentence when receiving soft break if long enough", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const chunk1 = splitter.push("今天的天氣真不錯，");
    expect(chunk1).toEqual(["今天的天氣真不錯，"]);
    const chunk2 = splitter.push("我們出去走走吧！");
    expect(chunk2).toEqual(["我們出去走走吧！"]);
    const chunk3 = splitter.finish();
    expect(chunk3).toEqual([]);
  });

  it("splits early on 10 characters even without punctuation on the first segment", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const chunk1 = splitter.push("這是一段完全沒有標點的句子"); // 13 字，前 10 字被切出
    expect(chunk1).toEqual(["這是一段完全沒有標點"]);
    const chunk2 = splitter.finish();
    expect(chunk2).toEqual(["的句子"]);
  });

  it("flushes remaining buffer on finish", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const chunk1 = splitter.push("五個字以內");
    expect(chunk1).toEqual([]);
    const chunk2 = splitter.finish();
    expect(chunk2).toEqual(["五個字以內"]);
  });

  // 以前是先把旁白 replace 掉，再拿刪過的字串長度去切原始 buffer。刪掉幾個字
  // 就有幾個字被「還」回 buffer，於是整句話會被唸第二次，中間還夾著旁白殘骸。
  it("consumes the stage direction it dropped, instead of speaking the line twice", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const spoken = [
      ...splitter.push("（輕輕笑了）今天天氣真好呀，我們出去走走吧。"),
      ...splitter.finish(),
    ];

    expect(spokenOnly(spoken)).toBe("今天天氣真好呀，我們出去走走吧。");
    expect(spoken[0]).toContain("[mood:happy]");
  });

  it("keeps offsets straight when narration lands between two sentences", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const spoken = [
      ...splitter.push("我在這裡喔。（歪頭）你想聊什麼呢？"),
      ...splitter.finish(),
    ];

    expect(spokenOnly(spoken)).toBe("我在這裡喔。你想聊什麼呢？");
    // 旁白夾在兩句之間，標籤要落在它修飾的那一句前面，不能黏到上一句尾巴。
    expect(spoken[1]).toContain("[mood:thinking]");
    expect(spoken[1]).toContain("[gesture:tiltHead]");
  });

  it("keeps offsets straight for asterisk narration and non-tag brackets", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const spoken = [
      ...splitter.push("*小聲*[旁白]好呀，那就這樣說定了。"),
      ...splitter.finish(),
    ];

    expect(spokenOnly(spoken)).toBe("好呀，那就這樣說定了。");
  });

  it("does not speak a stage direction that never got closed", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const spoken = [
      ...splitter.push("好呀，我知道了。（她小聲地"),
      ...splitter.finish(),
    ];

    expect(spokenOnly(spoken)).toBe("好呀，我知道了。");
  });

  it("waits for an unclosed bracket to finish instead of reading it aloud mid-stream", () => {
    const splitter = new StreamingSentenceSplitter(34);
    expect(splitter.push("（她想了")).toEqual([]);
    const spoken = [
      ...splitter.push("一下）嗯，我覺得可以喔。"),
      ...splitter.finish(),
    ];

    expect(spokenOnly(spoken)).toBe("嗯，我覺得可以喔。");
    expect(spoken[0]).toContain("[mood:thinking]");
  });

  // 標籤跟旁白混在一起時，位置最容易算錯——mood 掉了整輪表情都不會動。
  it("carries mood tags through even when narration sits next to them", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const spoken = [
      ...splitter.push("[mood:happy]（笑）好呀，我很期待呢。"),
      ...splitter.finish(),
    ];

    expect(spoken[0]).toContain("[mood:happy]");
    expect(spoken.join("").replace(/\[mood:happy\]/g, "")).toBe("好呀，我很期待呢。");
  });

  it("does not split an emoji in half", () => {
    const splitter = new StreamingSentenceSplitter(34);
    const spoken = [
      ...splitter.push("好耶🎉真的嗎，太好了。"),
      ...splitter.finish(),
    ];

    expect(spokenOnly(spoken)).toBe("好耶🎉真的嗎，太好了。");
  });
});

