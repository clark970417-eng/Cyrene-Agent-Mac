// Model Cascade Router -- 模型阶梯级联与投机执行路由器
//
// 根据任务类型与复杂度动态分流：
// - Fast Tier (轻量快模型): 意图识别、Observation 摘要、Scratchpad 滚动压缩、单步读取。
// - Reasoning Tier (重型思考模型): 复杂代码重构、架构设计、跨文件 Bug 定位、Critic 自检审查。
// 大幅降低执行延迟与 Token 成本。

export type ModelTier = "fast" | "reasoning";

export interface RoutingTaskContext {
  taskType?:
    | "intent"
    | "summary"
    | "scratchpad"
    | "file_read"
    | "code_refactor"
    | "bug_fix"
    | "review"
    | "architecture"
    | "general";
  profileId?: "document" | "search" | "crawler" | "coding" | "reviewer";
  promptLength?: number;
  complexityHint?: "low" | "medium" | "high";
  requiresDeepReasoning?: boolean;
}

export interface CascadeRouteDecision {
  tier: ModelTier;
  recommendedModel: string;
  reason: string;
  estimatedLatencySavingPercent: number;
}

export class ModelCascadeRouter {
  private fastModelName: string;
  private reasoningModelName: string;

  constructor(fastModel = "gemini-2.5-flash", reasoningModel = "gemini-2.5-pro") {
    this.fastModelName = fastModel;
    this.reasoningModelName = reasoningModel;
  }

  /**
   * 评估并分流至适宜的模型梯队
   */
  route(context: RoutingTaskContext): CascadeRouteDecision {
    // 1. 显式要求深度推理
    if (context.requiresDeepReasoning || context.complexityHint === "high") {
      return {
        tier: "reasoning",
        recommendedModel: this.reasoningModelName,
        reason: "任务显式要求高复杂度深度思考或高级推演",
        estimatedLatencySavingPercent: 0,
      };
    }

    // 2. 根据 Subagent Profile 分流
    if (context.profileId === "reviewer" || context.profileId === "coding") {
      return {
        tier: "reasoning",
        recommendedModel: this.reasoningModelName,
        reason: `Subagent Profile [${context.profileId}] 涉及代码逻辑修改与 Critic 审查，分配至推理模型`,
        estimatedLatencySavingPercent: 0,
      };
    }

    if (context.profileId === "document" || context.profileId === "search" || context.profileId === "crawler") {
      return {
        tier: "fast",
        recommendedModel: this.fastModelName,
        reason: `Subagent Profile [${context.profileId}] 主要为信息检索与文档格式生成，分配至快速轻量模型`,
        estimatedLatencySavingPercent: 60,
      };
    }

    // 3. 根据内部辅助任务类型分流
    switch (context.taskType) {
      case "intent":
      case "summary":
      case "scratchpad":
      case "file_read":
        return {
          tier: "fast",
          recommendedModel: this.fastModelName,
          reason: `辅助计算任务 [${context.taskType}] 适合快速模型处理`,
          estimatedLatencySavingPercent: 70,
        };

      case "code_refactor":
      case "bug_fix":
      case "review":
      case "architecture":
        return {
          tier: "reasoning",
          recommendedModel: this.reasoningModelName,
          reason: `核心工程任务 [${context.taskType}] 需要深度上下文理解`,
          estimatedLatencySavingPercent: 0,
        };

      default:
        // 默认若提示词短且复杂度低则走 Fast Tier
        if ((context.promptLength ?? 0) < 1000 && context.complexityHint !== "medium") {
          return {
            tier: "fast",
            recommendedModel: this.fastModelName,
            reason: "短提示且常规操作，默认采用快速模型以加速响应",
            estimatedLatencySavingPercent: 50,
          };
        }

        return {
          tier: "reasoning",
          recommendedModel: this.reasoningModelName,
          reason: "默认通用复杂任务分配至主力推理模型",
          estimatedLatencySavingPercent: 0,
        };
    }
  }
}

export const modelCascadeRouter = new ModelCascadeRouter();
