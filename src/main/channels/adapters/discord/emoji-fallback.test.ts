import { describe, expect, it } from "vitest";
import { discordEmojiNameForStickerId, selectDiscordStickerFallback } from "./emoji-fallback";

describe("Discord Cyrene emoji fallback", () => {
  it("maps local sticker ids to the server emoji naming convention", () => {
    expect(discordEmojiNameForStickerId("love-happy")).toBe("cyrene_love_happy");
    expect(discordEmojiNameForStickerId("HI")).toBe("cyrene_hi");
  });

  it("chooses a conservative fallback when sticker embeddings are unavailable", () => {
    expect(selectDiscordStickerFallback("在嗎", "嗨♪ 人家在呀！")).toBe("hello");
    expect(selectDiscordStickerFallback("今天好累", "辛苦了，來抱抱你。" )).toBe("hugtight");
    expect(selectDiscordStickerFallback("解釋這段程式", "這裡有三個步驟。" )).toBeNull();
  });
});
