import { describe, expect, it } from "vitest";
import {
  addTraditionalChineseTurnRequirement,
  buildTraditionalChineseRepairPrompt,
  classifyTraditionalChineseStreamSample,
  needsTraditionalChineseRepair,
  requiresTraditionalChineseReply,
} from "./reply-language-policy";

describe("channel reply language policy", () => {
  it("中文提問預設必須回臺灣繁體中文", () => {
    expect(requiresTraditionalChineseReply("你知道台灣亞太美國學校嗎")).toBe(true);
    expect(addTraditionalChineseTurnRequirement("你知道這間學校嗎")).toContain("只能使用臺灣繁體中文回覆");
  });

  it("使用者明確要求英文時不強制中文", () => {
    expect(requiresTraditionalChineseReply("請用英文回答這題")).toBe(false);
    expect(requiresTraditionalChineseReply("把這句翻譯成英文")).toBe(false);
  });

  it("會攔截英文為主與內部指令洩漏的回覆", () => {
    const english = "Yes, Taiwan Asia-Pacific American School is a private school. Its curriculum prepares students for universities worldwide.";
    expect(needsTraditionalChineseRepair("你知道這間學校嗎", english)).toBe(true);
    expect(needsTraditionalChineseRepair("你知道這間學校嗎", "know format instruction limit: strict completion rule for fact checks.")).toBe(true);
  });

  it("正常繁中回覆可以直接通過", () => {
    const reply = "知道喔。台灣亞太美國學校（APAS）是位於新竹縣竹北市的私立學校。";
    expect(needsTraditionalChineseRepair("你知道這間學校嗎", reply)).toBe(false);
    expect(classifyTraditionalChineseStreamSample("你知道這間學校嗎", reply)).toBe("accept");
  });

  it("修復提示要求只輸出最終繁中回覆", () => {
    const prompt = buildTraditionalChineseRepairPrompt("這是什麼？", "This is a school.");
    expect(prompt).toContain("臺灣繁體中文");
    expect(prompt).toContain("只輸出最終回覆");
  });
});
