// Coding Agent -- 独立代码工程子代理 Profile
//
// 专用于代码搜索、AST 分析、补丁应用、文件修改及 Git 审查。
// 在独立的 Context 与工具集中执行，避免污染主 Agent 记忆。

import { existsSync, statSync } from "fs";
import { registerSubAgentProfile } from "./runner";
import { runSubAgentGraph } from "./graph";
import type {
  SubAgentRunContext,
  SubAgentState,
  SubAgentProfileConfig,
  SubAgentPlan,
  SubAgentPublicResultV1,
  SubAgentFinding,
  SubAgentArtifact,
  SubAgentDecision,
} from "./types";
import type { PlanStep, StepVerificationResult } from "../task-plan";
import { generatePlanId, generateStepId } from "../task-plan";

/** Coding Agent 专有工具白名单 */
export const CODING_ALLOWED_TOOLS = new Set([
  "search_code",
  "ast_grep_search",
  "ast_grep_replace",
  "apply_patch",
  "read_file",
  "write_file",
  "list_dir",
  "file_outline",
  "lsp",
  "git_status",
  "git_diff",
  "git_commit",
  "git_log",
]);

/** 验证修改或生成的文件 */
function verifyArtifactFile(filePath: string, _runStartMs: number): {
  verified: boolean;
  sizeBytes?: number;
  reason?: string;
} {
  if (!existsSync(filePath)) return { verified: false, reason: `文件不存在: ${filePath}` };
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return { verified: false, reason: `路径非文件: ${filePath}` };
    return { verified: true, sizeBytes: stat.size };
  } catch (err: any) {
    return { verified: false, reason: err?.message ?? "无法访问文件状态" };
  }
}

/** 提取工具调用产生的文件产物与代码发现 */
function extractCodingOutcomes(state: SubAgentState): {
  artifacts: SubAgentArtifact[];
  findings: SubAgentFinding[];
} {
  const artifacts: SubAgentArtifact[] = [];
  const findings: SubAgentFinding[] = [];
  const seenPaths = new Set<string>();

  for (const tr of state.toolResults) {
    if (tr.status !== "succeeded") continue;

    // 1. apply_patch
    if (tr.toolId === "apply_patch") {
      try {
        const parsed = JSON.parse(tr.output);
        if (Array.isArray(parsed.applied)) {
          for (const p of parsed.applied) {
            if (!seenPaths.has(p)) {
              seenPaths.add(p);
              const vf = verifyArtifactFile(p, state.budgetUsage.startedAt);
              artifacts.push({
                id: `art-${p}`,
                name: p.split("/").pop() || p,
                path: p,
                verified: vf.verified,
                sizeBytes: vf.sizeBytes,
              });
            }
          }
        }
      } catch {
        // 非 JSON 输出回退
      }
    }

    // 2. write_file
    if (tr.toolId === "write_file") {
      if (tr.output.includes("成功") || tr.output.includes("written")) {
        findings.push({
          id: `f-${findings.length + 1}`,
          title: "文件写入成功",
          content: tr.output.slice(0, 300),
        });
      }
    }

    // 3. search_code / ast_grep_search / lsp
    if (tr.toolId === "search_code" || tr.toolId === "ast_grep_search" || tr.toolId === "lsp") {
      findings.push({
        id: `f-code-${findings.length + 1}`,
        title: `代码分析发现 [${tr.toolId}]`,
        content: tr.output.slice(0, 500),
        source: tr.toolId,
      });
    }
  }

  return { artifacts, findings };
}

/** Coding Profile 配置 */
export const codingProfile: SubAgentProfileConfig = {
  id: "coding",
  allowedTools: CODING_ALLOWED_TOOLS,
  budget: {
    maxSteps: 10,
    maxToolCalls: 15,
    maxReplans: 2,
    timeoutMs: 120_000,
  },

  createInitialPlan(ctx: SubAgentRunContext): SubAgentPlan {
    const now = Date.now();
    const objective = String(ctx.args.objective ?? ctx.args.instruction ?? "执行代码修改与分析任务");
    const steps: PlanStep[] = [];

    // 步骤 1: 代码检索与定位
    if (ctx.args.searchPattern || ctx.args.query) {
      steps.push({
        id: generateStepId(),
        objective: `检索代码: ${ctx.args.searchPattern ?? ctx.args.query}`,
        status: "pending",
        completionPolicy: {
          anyOf: [[
            { kind: "tool_succeeded", capabilityId: "search_code" },
            { kind: "tool_succeeded", capabilityId: "ast_grep_search" },
            { kind: "tool_succeeded", capabilityId: "lsp" },
          ]],
        },
        toolCallCount: 0,
        retryCount: 0,
      });
    }

    // 步骤 2: 补丁应用或代码重构
    if (ctx.args.patch || ctx.args.replacePattern || ctx.args.file) {
      steps.push({
        id: generateStepId(),
        objective: "执行代码编辑与补丁应用",
        status: "pending",
        completionPolicy: {
          anyOf: [[
            { kind: "tool_succeeded", capabilityId: "apply_patch" },
            { kind: "tool_succeeded", capabilityId: "ast_grep_replace" },
            { kind: "tool_succeeded", capabilityId: "write_file" },
          ]],
        },
        toolCallCount: 0,
        retryCount: 0,
      });
    }

    // 步骤 3: 验证代码变更与 Git 状态
    steps.push({
      id: generateStepId(),
      objective: "验证代码修改与变更完整性",
      status: "pending",
      completionPolicy: {},
      toolCallCount: 0,
      retryCount: 0,
    });

    if (steps.length === 1) {
      // 默认单步直通
      steps.unshift({
        id: generateStepId(),
        objective: "执行代码工程操作",
        status: "pending",
        completionPolicy: {},
        toolCallCount: 0,
        retryCount: 0,
      });
    }

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

    // 1. 检索步骤
    if (step.objective.includes("检索代码")) {
      if (args.astPattern) {
        return {
          action: "call_tool",
          toolId: "ast_grep_search",
          args: {
            pattern: String(args.astPattern),
            language: String(args.language ?? "typescript"),
          },
        };
      }
      return {
        action: "call_tool",
        toolId: "search_code",
        args: {
          pattern: String(args.searchPattern ?? args.query ?? ""),
          path: args.path ? String(args.path) : undefined,
        },
      };
    }

    // 2. 编辑 / 补丁步骤
    if (step.objective.includes("代码编辑") || step.objective.includes("代码工程操作")) {
      if (args.patch) {
        return {
          action: "call_tool",
          toolId: "apply_patch",
          args: { patch: String(args.patch) },
        };
      }
      if (args.replacePattern && args.astPattern) {
        return {
          action: "call_tool",
          toolId: "ast_grep_replace",
          args: {
            pattern: String(args.astPattern),
            rewrite: String(args.replacePattern),
            language: String(args.language ?? "typescript"),
            dryRun: false,
          },
        };
      }
      if (args.filePath && args.content) {
        return {
          action: "call_tool",
          toolId: "write_file",
          args: {
            path: String(args.filePath),
            content: String(args.content),
          },
        };
      }
    }

    // 3. 验证步骤：调用 git_status 验证或跳过
    if (step.objective.includes("验证")) {
      return { action: "skip" };
    }

    return { action: "skip" };
  },

  verifyStep(state: SubAgentState): StepVerificationResult {
    const step = state.plan.steps.find((s) => s.id === state.currentStepId);
    if (!step) return { status: "failed", failureReason: "无当前步骤" };

    const lastResult = state.toolResults[state.toolResults.length - 1];
    if (!lastResult) {
      if (step.objective.includes("验证")) {
        return { status: "completed" };
      }
      return { status: "running" };
    }

    if (lastResult.status === "failed") {
      return {
        status: "failed",
        failureReason: lastResult.output || lastResult.errorCode || "工具调用失败",
      };
    }

    return { status: "completed" };
  },

  buildResult(state: SubAgentState): SubAgentPublicResultV1 {
    const { artifacts, findings } = extractCodingOutcomes(state);
    const objective = String(state.ctx.args.objective ?? "代码任务");

    const failedTools = state.toolResults.filter((r) => r.status === "failed");
    const hasSuccess = state.toolResults.some((r) => r.status === "succeeded");

    let status: SubAgentPublicResultV1["status"] = "succeeded";
    let error: SubAgentPublicResultV1["error"];

    if (state.toolResults.length > 0 && !hasSuccess) {
      status = "failed";
      error = {
        code: "CODING_EXECUTION_FAILED",
        message: failedTools[0]?.output || failedTools[0]?.errorCode || "代码执行均未成功",
        recoverable: true,
      };
    } else if (failedTools.length > 0) {
      status = "partial";
      error = {
        code: "PARTIAL_TOOL_FAILURE",
        message: `部分工具执行失败 (${failedTools.length} 次失败)`,
        recoverable: true,
      };
    }

    return {
      kind: "subagent_result",
      version: 1,
      taskId: state.ctx.taskId,
      profile: "coding",
      status,
      summary: `代码子代理执行任务 "${objective}" 完成，產出 ${artifacts.length} 个变更产物，${findings.length} 条分析记录`,
      findings,
      artifacts,
      completionEvidence: [
        {
          criterion: "代码工程工具调用已完成",
          satisfied: status === "succeeded" || status === "partial",
          evidenceRefs: artifacts.map((a) => a.path ?? a.name),
        },
      ],
      error,
      primaryArtifact: artifacts[0]
        ? {
            name: artifacts[0].name,
            path: artifacts[0].path ?? artifacts[0].name,
            verified: artifacts[0].verified,
          }
        : undefined,
    };
  },

  hasValidResults(state: SubAgentState): boolean {
    const { artifacts, findings } = extractCodingOutcomes(state);
    return artifacts.length > 0 || findings.length > 0;
  },

  extractProgressEvidence(state: SubAgentState): string {
    const { artifacts, findings } = extractCodingOutcomes(state);
    const completedSteps = state.plan.steps.filter((s) => s.status === "completed").length;
    return JSON.stringify({
      artifactCount: artifacts.length,
      artifactPaths: artifacts.map((a) => a.path).sort(),
      findingsCount: findings.length,
      completedSteps,
    });
  },
};

/** 注册 Coding Profile 执行器 */
export function registerCodingProfile(): void {
  registerSubAgentProfile("coding", async (ctx) => {
    return runSubAgentGraph(ctx, codingProfile);
  });
}
