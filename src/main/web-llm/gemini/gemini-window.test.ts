import { describe, expect, it } from "vitest";
import {
  isConversationBindingStale,
  isSafeGeminiConversationUrl,
  isSameGeminiConversation,
  SHARED_GEMINI_CONVERSATION_URL,
} from "./gemini-window";

describe("isSafeGeminiConversationUrl", () => {
  it("accepts a plain conversation URL", () => {
    expect(isSafeGeminiConversationUrl("https://gemini.google.com/app/b9a358e56a56adf0")).toBe(true);
  });

  // 使用者從第二個 Google 帳號複製出來的網址長這樣。只認 /app/ 的話會被判成
  // 不合法而「靜默」忽略——沒有錯誤訊息，只是換對話沒生效。
  it("accepts the multi-account form Google hands out", () => {
    expect(isSafeGeminiConversationUrl("https://gemini.google.com/u/2/app/6ce9dc5274aebfed")).toBe(true);
    expect(isSafeGeminiConversationUrl("https://gemini.google.com/u/0/app/abc123")).toBe(true);
  });

  it("rejects anything that is not a Gemini conversation", () => {
    expect(isSafeGeminiConversationUrl("https://evil.example.com/app/x")).toBe(false);
    expect(isSafeGeminiConversationUrl("https://gemini.google.com/app")).toBe(false);
    expect(isSafeGeminiConversationUrl("https://gemini.google.com/settings/x")).toBe(false);
    expect(isSafeGeminiConversationUrl("https://gemini.google.com/u/2/settings/x")).toBe(false);
    expect(isSafeGeminiConversationUrl("not a url")).toBe(false);
  });

  // 常數自己要通過驗證，否則整條「沿用共用對話」的路會靜默失效，
  // 每輪都重貼完整人設。
  it("keeps the configured shared conversation URL valid", () => {
    expect(isSafeGeminiConversationUrl(SHARED_GEMINI_CONVERSATION_URL)).toBe(true);
  });
});

describe("isSameGeminiConversation", () => {
  // Gemini 會把 /u/<n>/ 正規化掉、也會自己加查詢參數。用字串比對的話，同一個
  // 對話會被判成不同，於是每輪重貼一萬字人設。
  it("sees through the account prefix, trailing slash and query string", () => {
    const a = "https://gemini.google.com/u/2/app/6ce9dc5274aebfed";
    for (const b of [
      "https://gemini.google.com/app/6ce9dc5274aebfed",
      "https://gemini.google.com/app/6ce9dc5274aebfed/",
      "https://gemini.google.com/u/0/app/6ce9dc5274aebfed?pageId=none",
    ]) {
      expect(isSameGeminiConversation(a, b)).toBe(true);
    }
  });

  it("still tells different conversations apart", () => {
    expect(isSameGeminiConversation(
      "https://gemini.google.com/app/aaaa",
      "https://gemini.google.com/app/bbbb",
    )).toBe(false);
  });

  it("never matches when either side is missing or not a conversation", () => {
    expect(isSameGeminiConversation(undefined, "https://gemini.google.com/app/x")).toBe(false);
    expect(isSameGeminiConversation("https://gemini.google.com/app", "https://gemini.google.com/app")).toBe(false);
    expect(isSameGeminiConversation("https://evil.example.com/app/x", "https://evil.example.com/app/x")).toBe(false);
  });
});

describe("isConversationBindingStale", () => {
  const now = new Date(2026, 7, 17, 0, 0, 1);

  it("keeps a conversation created on the same local calendar day", () => {
    expect(isConversationBindingStale(new Date(2026, 7, 17, 0, 0, 0).toISOString(), now)).toBe(false);
  });

  it("rotates immediately after local midnight", () => {
    expect(isConversationBindingStale(new Date(2026, 7, 16, 23, 59, 59).toISOString(), now)).toBe(true);
  });

  it("treats legacy or invalid timestamps as stale", () => {
    expect(isConversationBindingStale(undefined, now)).toBe(true);
    expect(isConversationBindingStale("not-a-date", now)).toBe(true);
  });
});
