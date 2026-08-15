import { describe, expect, it } from "vitest";
import { StreamingTextSegmenter } from "./streaming-text-segmenter";

describe("StreamingTextSegmenter", () => {
  it("splits only at newlines and keeps punctuation in the same Discord message", () => {
    const segmenter = new StreamingTextSegmenter();
    expect(segmenter.push("在的呀，夥伴！人家一直都在這裡呢♪\n\n看到你連續敲我"))
      .toEqual(["在的呀，夥伴！人家一直都在這裡呢♪"]);
    expect(segmenter.push("，是不是有什麼想和我聊聊？"))
      .toEqual([]);
    expect(segmenter.finish()).toEqual(["看到你連續敲我，是不是有什麼想和我聊聊？"]);
  });

  it("holds an unfinished sentence and flushes it at completion", () => {
    const segmenter = new StreamingTextSegmenter();
    expect(segmenter.push("我還在想")) .toEqual([]);
    expect(segmenter.finish()).toEqual(["我還在想"]);
  });
});
