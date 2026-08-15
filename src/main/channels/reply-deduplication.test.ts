import { describe, expect, it } from "vitest";
import { collapseExactRepeatedReply } from "./reply-deduplication";

describe("channel reply deduplication", () => {
  it("collapses an exactly repeated full reply", () => {
    const reply = "寶寶，人家好想你呢～♪ 每次想到你，心裡就好溫暖喔！❤️";
    expect(collapseExactRepeatedReply(`${reply}\n\n${reply}`)).toBe(reply);
  });

  it("preserves distinct paragraphs and merely similar wording", () => {
    expect(collapseExactRepeatedReply("第一段。\n\n第二段。")).toBe("第一段。\n\n第二段。");
    expect(collapseExactRepeatedReply("想你。\n\n真的很想你。")).toBe("想你。\n\n真的很想你。");
  });
});
