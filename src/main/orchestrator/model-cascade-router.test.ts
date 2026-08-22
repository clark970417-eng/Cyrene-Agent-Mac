import { describe, expect, it } from "vitest";
import { ModelCascadeRouter } from "./model-cascade-router";

describe("Model Cascade Router (Speculative Tiered Model Execution)", () => {
  const router = new ModelCascadeRouter("fast-model", "reasoning-model");

  it("routes helper tasks (summary, intent, scratchpad) to Fast Tier", () => {
    const res1 = router.route({ taskType: "summary" });
    expect(res1.tier).toBe("fast");
    expect(res1.recommendedModel).toBe("fast-model");
    expect(res1.estimatedLatencySavingPercent).toBeGreaterThan(0);

    const res2 = router.route({ taskType: "scratchpad" });
    expect(res2.tier).toBe("fast");
  });

  it("routes coding, review, and high complexity tasks to Reasoning Tier", () => {
    const resCode = router.route({ profileId: "coding" });
    expect(resCode.tier).toBe("reasoning");
    expect(resCode.recommendedModel).toBe("reasoning-model");

    const resRev = router.route({ profileId: "reviewer" });
    expect(resRev.tier).toBe("reasoning");

    const resComplex = router.route({ complexityHint: "high" });
    expect(resComplex.tier).toBe("reasoning");
  });
});
