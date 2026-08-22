import { describe, expect, it, vi, beforeEach } from "vitest";

import { reviewerProfile, analyzeReviewTarget } from "./reviewer-agent";
import { isProfileRegistered } from "./runner";
import { registerBuiltInSubAgentProfiles, _resetSubAgentInit } from "./init";
import type { SubAgentRunContext } from "./types";

describe("Reviewer Agent (Critic / Evaluator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSubAgentInit();
    registerBuiltInSubAgentProfiles();
  });

  it("should register reviewer profile via built-in init", () => {
    expect(isProfileRegistered("reviewer")).toBe(true);
  });

  it("identifies security blocker issues such as eval/exec", () => {
    const code = `
      function runDynamic(codeStr: string) {
        return eval(codeStr);
      }
    `;
    const review = analyzeReviewTarget({ code });
    expect(review.passed).toBe(false);
    expect(review.issues.some((i) => i.id === "sec-eval-exec")).toBe(true);
    expect(review.repairPlan).toBeDefined();
  });

  it("passes clean code with high score", () => {
    const code = `
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;
    const review = analyzeReviewTarget({ code });
    expect(review.passed).toBe(true);
    expect(review.score).toBe(100);
    expect(review.issues.length).toBe(0);
  });

  it("builds public result correctly for failed review", () => {
    const state: any = {
      ctx: {
        profile: "reviewer",
        taskId: "task-rev-1",
        args: {
          code: "const x = eval('1+1');",
        },
      },
      plan: {
        steps: [{ status: "completed" }],
      },
      budgetUsage: { startedAt: Date.now(), toolCallsUsed: 0 },
      toolResults: [],
    };

    const result = reviewerProfile.buildResult(state);
    expect(result.status).toBe("blocked");
    expect(result.error?.code).toBe("REVIEW_FAILED");
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
