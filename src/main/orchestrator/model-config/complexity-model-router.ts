export type ComplexityLevel = "low" | "medium" | "high" | "reasoning";

export interface ComplexityAssessment {
  level: ComplexityLevel;
  score: number;
  reasons: string[];
  recommendedTier: "fast" | "standard" | "frontier" | "reasoning";
}

export interface ModelRouteConfig {
  fastModel?: string;      // e.g. "gemini-2.0-flash" / "claude-3-5-haiku"
  standardModel?: string;  // e.g. "gpt-4o-mini" / "claude-3-5-sonnet"
  frontierModel?: string;  // e.g. "claude-3-7-sonnet" / "gpt-4.5"
  reasoningModel?: string; // e.g. "o3-mini" / "deepseek-r1"
}

export class ComplexityModelRouter {
  private config: ModelRouteConfig;

  constructor(config: ModelRouteConfig = {}) {
    this.config = {
      fastModel: config.fastModel || "gemini-2.0-flash",
      standardModel: config.standardModel || "claude-3-5-sonnet",
      frontierModel: config.frontierModel || "claude-3-7-sonnet",
      reasoningModel: config.reasoningModel || "deepseek-r1",
    };
  }

  /**
   * 根據用戶指令、歷史長度與上下文特徵評估複雜度
   */
  public assessComplexity(input: {
    userPrompt: string;
    conversationLength?: number;
    hasCodeFiles?: boolean;
    availableToolCount?: number;
  }): ComplexityAssessment {
    const text = input.userPrompt.toLowerCase();
    let score = 0;
    const reasons: string[] = [];

    // 1. 推理與演算法關鍵詞 (+5 分)
    if (
      /prove|proof|algorithm|math|complex logic|architecture design|refactor entire|重構整個|數學證明|架構設計|演算法|深度思考|推導/i.test(
        text,
      )
    ) {
      score += 5;
      reasons.push("包含複雜邏輯推導、數學證明或系統架構設計關鍵詞");
    }

    // 2. 代碼重構與跨多檔操作 (+3 分)
    if (
      /multi-file|across codebase|fullstack|debug bug|fix crash|修復當機|多檔案重構/i.test(
        text,
      ) ||
      input.hasCodeFiles
    ) {
      score += 3;
      reasons.push("涉及代碼修改、錯誤排查或多檔案操作");
    }

    // 3. 簡單查詢 / 格式化 / 摘要 (-2 分)
    if (
      /summary|summarize|translate|format json|quick search|誰是|什麼是|翻譯|摘要/i.test(
        text,
      ) &&
      text.length < 150
    ) {
      score -= 2;
      reasons.push("屬於短文本摘要、翻譯或直接問答");
    }

    // 4. 指令長度加權
    if (text.length > 500) {
      score += 2;
      reasons.push("輸入提示詞詳細且篇幅較長");
    }

    // 5. 對話輪數深度加權
    if ((input.conversationLength ?? 0) > 15) {
      score += 1;
      reasons.push("長對話上下文");
    }

    let level: ComplexityLevel = "standard" as ComplexityLevel;
    let recommendedTier: ComplexityAssessment["recommendedTier"] = "standard";

    if (score >= 5) {
      level = "reasoning";
      recommendedTier = "reasoning";
    } else if (score >= 3) {
      level = "high";
      recommendedTier = "frontier";
    } else if (score <= 0) {
      level = "low";
      recommendedTier = "fast";
    } else {
      level = "medium";
      recommendedTier = "standard";
    }

    return {
      level,
      score,
      reasons,
      recommendedTier,
    };
  }

  /**
   * 根據評估結果推薦最適模型名稱
   */
  public routeModel(assessment: ComplexityAssessment): string {
    switch (assessment.recommendedTier) {
      case "fast":
        return this.config.fastModel!;
      case "reasoning":
        return this.config.reasoningModel!;
      case "frontier":
        return this.config.frontierModel!;
      case "standard":
      default:
        return this.config.standardModel!;
    }
  }
}
