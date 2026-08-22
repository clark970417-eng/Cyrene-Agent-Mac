import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ size: 2048, isFile: () => true, mtimeMs: Date.now() + 10000 })),
}));

import { registerCodingProfile, codingProfile } from "./coding-agent";
import { isProfileRegistered, runSubAgent } from "./runner";
import { registerBuiltInSubAgentProfiles, _resetSubAgentInit } from "./init";
import { toolRegistry } from "../tool-registry";
import type { SubAgentRunContext } from "./types";

describe("Coding Agent Subagent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSubAgentInit();
    registerBuiltInSubAgentProfiles();
  });

  it("should register coding profile via built-in init", () => {
    expect(isProfileRegistered("coding")).toBe(true);
  });

  it("creates initial plan for code search and patch tasks", () => {
    const ctx: SubAgentRunContext = {
      profile: "coding",
      taskId: "task-code-1",
      args: {
        objective: "重构用户认证模块",
        searchPattern: "function authenticate",
        patch: "*** test patch ***",
      },
      parentContext: {
        runId: "run-1",
        resolvedWorkspaceRoot: "/mock/workspace",
      },
    };

    const plan = codingProfile.createInitialPlan(ctx);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps[0].objective).toContain("检索代码");
    expect(plan.steps[1].objective).toContain("代码编辑");
  });

  it("decides tool calls correctly for patch application", () => {
    const state: any = {
      ctx: {
        profile: "coding",
        taskId: "task-code-2",
        args: {
          patch: "patch content",
        },
      },
      plan: {
        steps: [
          {
            id: "step-1",
            objective: "执行代码编辑与补丁应用",
          },
        ],
      },
      currentStepId: "step-1",
      toolResults: [],
    };

    const decision = codingProfile.decide(state);
    expect(decision).toEqual({
      action: "call_tool",
      toolId: "apply_patch",
      args: { patch: "patch content" },
    });
  });

  it("builds succeeded public result with artifacts and findings", () => {
    const state: any = {
      ctx: {
        profile: "coding",
        taskId: "task-code-3",
        args: {
          objective: "添加新工具",
        },
      },
      plan: {
        steps: [{ status: "completed" }],
      },
      budgetUsage: { startedAt: Date.now() },
      toolResults: [
        {
          toolId: "apply_patch",
          status: "succeeded",
          output: JSON.stringify({
            applied: ["src/test.ts"],
          }),
        },
      ],
    };

    const result = codingProfile.buildResult(state);
    expect(result.status).toBe("succeeded");
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].name).toBe("test.ts");
    expect(result.primaryArtifact?.path).toBe("src/test.ts");
  });
});
