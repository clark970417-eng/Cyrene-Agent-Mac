// Reviewer Agent (Critic / Evaluator) -- 自检与代码审查子代理 Profile
//
// 专注于 Evaluator-Optimizer 循环中的评估与反思：
// 审查代码安全、逻辑漏洞、语法正确性、规范与潜在 Bug。
// 输出结构化评分、问题清单与修复建议（Actionable Repair Plan）。

import { registerSubAgentProfile } from "./runner";
import { runSubAgentGraph } from "./graph";
import type {
  SubAgentRunContext,
  SubAgentState,
  SubAgentProfileConfig,
  SubAgentPlan,
  SubAgentPublicResultV1,
  SubAgentFinding,
  SubAgentDecision,
} from "./types";
import type { PlanStep, StepVerificationResult } from "../task-plan";
import { generatePlanId, generateStepId } from "../task-plan";

/** Reviewer Agent 工具白名单（纯只读检查与检索） */
export const REVIEWER_ALLOWED_TOOLS = new Set([
  "read_file",
  "search_code",
  "ast_grep_search",
  "file_outline",
  "git_diff",
  "git_status",
  "git_log",
]);

/** 审查问题项定义 */
export interface ReviewIssue {
  id: string;
  severity: "blocker" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  suggestion: string;
}

/** 审查评估结果 */
export interface CodeReviewOutcome {
  passed: boolean;
  score: number; // 0 - 100
  summary: string;
  issues: ReviewIssue[];
  repairPlan?: string;
}

/** 执行代码与变更审查分析 */
export function analyzeReviewTarget(args: Record<string, unknown>): CodeReviewOutcome {
  const diff = String(args.diff ?? "");
  const content = String(args.content ?? args.code ?? "");
  const target = diff || content;
  const issues: ReviewIssue[] = [];

  // 1. 安全漏洞与越界检测
  if (/eval\(|new Function\(|exec\(|spawn\(|child_process/i.test(target)) {
    issues.push({
      id: "sec-eval-exec",
      severity: "blocker",
      message: "检测到危险的动态代码执行或进程生成调用 (eval/exec/spawn)",
      suggestion: "请使用安全封装的执行接口，避免未受限的代码执行。",
    });
  }

  if (/\.\.\/|\.\.\\/g.test(target) && /(?:readFile|writeFile|open|unlink)/.test(target)) {
    issues.push({
      id: "sec-path-traversal",
      severity: "blocker",
      message: "检测到可能存在路径逃逸 (Path Traversal) 风险的相对路径操作",
      suggestion: "请使用 path.resolve 并校验是否位于工作区目录范围内。",
    });
  }

  // 2. 语法与逻辑常见隐患
  if (/debugger;|console\.log\(/.test(target) && !args.allowDebugLogs) {
    issues.push({
      id: "code-quality-debug",
      severity: "info",
      message: "代码中残留调试代码 (debugger 或 console.log)",
      suggestion: "正式代码建议使用专用 logger 替代 console.log，并移除 debugger。",
    });
  }

  if (/TODO:|FIXME:/i.test(target)) {
    issues.push({
      id: "code-quality-todo",
      severity: "warning",
      message: "代码包含未完成的 TODO / FIXME 标记",
      suggestion: "请确认关键逻辑已完整实现，或补充对应任务追踪。",
    });
  }

  // 3. 错误处理与未捕获异常
  if (/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(target)) {
    issues.push({
      id: "code-empty-catch",
      severity: "warning",
      message: "检测到空 catch 块，可能导致异常被静默吞掉",
      suggestion: "请至少记录日志或在 catch 中进行妥善的错误降级处理。",
    });
  }

  const blockerCount = issues.filter((i) => i.severity === "blocker").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  let score = 100 - blockerCount * 40 - warningCount * 15;
  if (score < 0) score = 0;

  const passed = blockerCount === 0 && score >= 70;
  const summary = passed
    ? `审查通过 (得分: ${score}/100)，发现 ${warningCount} 个建议优化项。`
    : `审查未通过 (得分: ${score}/100)，发现 ${blockerCount} 个严重阻塞问题与 ${warningCount} 个警告。`;

  let repairPlan: string | undefined;
  if (!passed) {
    repairPlan = issues
      .filter((i) => i.severity === "blocker" || i.severity === "warning")
      .map((i, idx) => `${idx + 1}. [${i.severity.toUpperCase()}] ${i.message} -> 建议: ${i.suggestion}`)
      .join("\n");
  }

  return {
    passed,
    score,
    summary,
    issues,
    repairPlan,
  };
}

/** Reviewer Profile 配置 */
export const reviewerProfile: SubAgentProfileConfig = {
  id: "reviewer",
  allowedTools: REVIEWER_ALLOWED_TOOLS,
  budget: {
    maxSteps: 6,
    maxToolCalls: 8,
    maxReplans: 1,
    timeoutMs: 60_000,
  },

  createInitialPlan(ctx: SubAgentRunContext): SubAgentPlan {
    const now = Date.now();
    const objective = String(ctx.args.objective ?? "对目标代码或变更执行 Critic 审查");
    const steps: PlanStep[] = [];

    if (ctx.args.file || ctx.args.filePath) {
      steps.push({
        id: generateStepId(),
        objective: `读取目标文件: ${ctx.args.file ?? ctx.args.filePath}`,
        status: "pending",
        completionPolicy: { allOf: [{ kind: "tool_succeeded", capabilityId: "read_file" }] },
        toolCallCount: 0,
        retryCount: 0,
      });
    }

    steps.push({
      id: generateStepId(),
      objective: "评估代码规范、安全性与逻辑完整性",
      status: "pending",
      completionPolicy: {},
      toolCallCount: 0,
      retryCount: 0,
    });

    return {
      id: generatePlanId(),
      goal: objective,
      steps,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
  },

  decide(state: SubAgentState): SubAgentDecision {
    const step = state.plan.steps.find((s) => s.id === state.currentStepId);
    if (!step) {
      return { action: "fail", reason: "无当前步骤", code: "NO_STEP", recoverable: false };
    }

    const args = state.ctx.args;

    if (step.objective.includes("读取目标文件") && (args.file || args.filePath)) {
      return {
        action: "call_tool",
        toolId: "read_file",
        args: {
          path: String(args.file ?? args.filePath),
        },
      };
    }

    return { action: "skip" };
  },

  verifyStep(_state: SubAgentState): StepVerificationResult {
    return { status: "completed" };
  },

  buildResult(state: SubAgentState): SubAgentPublicResultV1 {
    // 从 args 或工具读取内容中聚合审查目标
    let targetCode = String(state.ctx.args.diff ?? state.ctx.args.content ?? state.ctx.args.code ?? "");
    for (const tr of state.toolResults) {
      if (tr.status === "succeeded" && tr.output) {
        targetCode += "\n" + tr.output;
      }
    }

    const review = analyzeReviewTarget({
      ...state.ctx.args,
      content: targetCode,
    });

    const findings: SubAgentFinding[] = review.issues.map((issue) => ({
      id: issue.id,
      title: `[${issue.severity.toUpperCase()}] ${issue.message}`,
      content: `建议修復方案: ${issue.suggestion}`,
      source: issue.file,
    }));

    const status: SubAgentPublicResultV1["status"] = review.passed ? "succeeded" : "blocked";

    return {
      kind: "subagent_result",
      version: 1,
      taskId: state.ctx.taskId,
      profile: "reviewer",
      status,
      summary: `${review.summary} ${review.repairPlan ? "\n修復指引:\n" + review.repairPlan : ""}`,
      findings,
      artifacts: [],
      completionEvidence: [
        {
          criterion: "Critic / Reviewer 自检评估完成",
          satisfied: true,
          evidenceRefs: review.issues.map((i) => i.id),
        },
      ],
      missingInformation: review.passed ? undefined : [review.repairPlan || "需要针对严重问题进行修复"],
      error: review.passed
        ? undefined
        : {
            code: "REVIEW_FAILED",
            message: `代码审查未达标 (得分 ${review.score}/100): ${review.summary}`,
            recoverable: true,
          },
    };
  },

  hasValidResults(state: SubAgentState): boolean {
    return state.toolResults.length >= 0;
  },

  extractProgressEvidence(state: SubAgentState): string {
    const completedSteps = state.plan.steps.filter((s) => s.status === "completed").length;
    return JSON.stringify({
      stepCount: completedSteps,
      toolCalls: state.budgetUsage.toolCallsUsed,
    });
  },
};

/** 注册 Reviewer Profile 执行器 */
export function registerReviewerProfile(): void {
  registerSubAgentProfile("reviewer", async (ctx) => {
    return runSubAgentGraph(ctx, reviewerProfile);
  });
}
