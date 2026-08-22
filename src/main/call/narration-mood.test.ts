import { describe, expect, it } from "vitest";
import { inferMoodFromNarration, narrationMoodTag } from "./narration-mood";

describe("inferMoodFromNarration", () => {
  it("reads the plain emotions she writes most often", () => {
    expect(inferMoodFromNarration("（輕輕笑了）")).toBe("happy");
    expect(inferMoodFromNarration("（歪頭）")).toBe("thinking");
    expect(inferMoodFromNarration("（臉紅）")).toBe("shy");
    expect(inferMoodFromNarration("（愣住）")).toBe("surprised");
    expect(inferMoodFromNarration("（嘆了口氣）")).toBe("sad");
    expect(inferMoodFromNarration("（眨眨眼）")).toBe("wink");
    expect(inferMoodFromNarration("（得意地抬起下巴）")).toBe("smug");
  });

  // 「笑」這個字到處都有。排錯優先序的話，「苦笑」會被判成高興——那比完全
  // 沒有表情還糟。
  it("lets the more specific emotion win when the line also contains 笑", () => {
    expect(inferMoodFromNarration("（得意地笑了）")).toBe("smug");
    expect(inferMoodFromNarration("（害羞地笑）")).toBe("shy");
    expect(inferMoodFromNarration("（苦笑）")).toBe("sad");
    expect(inferMoodFromNarration("（眨眨眼笑了）")).toBe("wink");
  });

  it("handles simplified wording too, since the persona files mix both", () => {
    expect(inferMoodFromNarration("（脸红了）")).toBe("shy");
    expect(inferMoodFromNarration("（叹了口气）")).toBe("sad");
    expect(inferMoodFromNarration("（歪着头）")).toBe("thinking");
    expect(inferMoodFromNarration("（开心地）")).toBe("happy");
  });

  it("gives up on narration that is not about how she feels", () => {
    expect(inferMoodFromNarration("（她沒有回答）")).toBeNull();
    expect(inferMoodFromNarration("（背景音樂）")).toBeNull();
    expect(inferMoodFromNarration("[旁白]")).toBeNull();
    expect(inferMoodFromNarration("")).toBeNull();
  });
});

describe("narrationMoodTag", () => {
  it("emits a tag the mood extractor can read, or nothing at all", () => {
    expect(narrationMoodTag("（笑）")).toBe("[mood:happy]");
    expect(narrationMoodTag("（她沒有回答）")).toBe("");
  });
});
