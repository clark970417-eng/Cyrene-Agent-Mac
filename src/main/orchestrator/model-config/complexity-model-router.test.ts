import { describe, it, expect } from "vitest";
import { ComplexityModelRouter } from "./complexity-model-router";

describe("ComplexityModelRouter", () => {
  const router = new ComplexityModelRouter({
    fastModel: "gemini-2.0-flash",
    standardModel: "claude-3-5-sonnet",
    frontierModel: "claude-3-7-sonnet",
    reasoningModel: "deepseek-r1",
  });

  it("routes short simple QA to fast model", () => {
    const assessment = router.assessComplexity({
      userPrompt: "請幫我翻譯這句日文為繁體中文",
    });
    expect(assessment.level).toBe("low");
    expect(assessment.recommendedTier).toBe("fast");
    expect(router.routeModel(assessment)).toBe("gemini-2.0-flash");
  });

  it("routes complex algorithm & math reasoning to reasoning model", () => {
    const assessment = router.assessComplexity({
      userPrompt: "請幫我設計一個分散式共識演算法並提供數學證明架構設計",
    });
    expect(assessment.level).toBe("reasoning");
    expect(assessment.recommendedTier).toBe("reasoning");
    expect(router.routeModel(assessment)).toBe("deepseek-r1");
  });

  it("routes multi-file refactoring and debugging to frontier model", () => {
    const assessment = router.assessComplexity({
      userPrompt: "請跨多檔案重構用戶驗證模組並修復當機 bug",
      hasCodeFiles: true,
    });
    expect(assessment.level).toBe("high");
    expect(assessment.recommendedTier).toBe("frontier");
    expect(router.routeModel(assessment)).toBe("claude-3-7-sonnet");
  });
});
