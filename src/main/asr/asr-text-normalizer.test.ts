import { describe, expect, it } from "vitest";
import { normalizeAsrText } from "./asr-text-normalizer";

describe("normalizeAsrText", () => {
  it("converts simplified Chinese to traditional Taiwan Chinese", () => {
    expect(normalizeAsrText("今天天气怎么样")).toBe("今天天氣怎麼樣");
    expect(normalizeAsrText("你在干嘛呢")).toBe("你在幹嘛呢");
  });

  it("corrects character name homophones and misrecognitions", () => {
    expect(normalizeAsrText("洗臉你好呀")).toBe("昔漣你好呀");
    expect(normalizeAsrText("吸臉今天開心嗎")).toBe("昔漣今天開心嗎");
    expect(normalizeAsrText("昔宝早上好")).toBe("昔寶早上好");
    expect(normalizeAsrText("西蓮可以幫我查一下天氣嗎")).toBe("昔漣可以幫我查一下天氣嗎");
  });

  it("removes unwanted whitespace between Chinese characters while preserving English spacing", () => {
    expect(normalizeAsrText("你 好 呀")).toBe("你好呀");
    expect(normalizeAsrText("測試 AppKey 參數")).toBe("測試 AppKey 參數");
  });

  it("handles empty or blank string gracefully", () => {
    expect(normalizeAsrText("")).toBe("");
    expect(normalizeAsrText("   ")).toBe("");
  });
});
