import { describe, it, expect } from "vitest";
import { AutoRepairLoop } from "./auto-repair-loop";

describe("AutoRepairLoop", () => {
  it("runs successful command and reports passed", () => {
    const loop = new AutoRepairLoop({ cwd: process.cwd(), testCommand: "node -e 'process.exit(0)'" });
    const result = loop.runVerification();
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);

    const feedback = loop.recordAndGetFeedback(result);
    expect(feedback.passed).toBe(true);
    expect(feedback.shouldContinue).toBe(false);
  });

  it("captures errors and generates self-healing feedback prompt", () => {
    const loop = new AutoRepairLoop({
      cwd: process.cwd(),
      testCommand: "node -e 'console.error(\"TypeError: Cannot read properties of undefined\"); process.exit(1)'",
      maxRepairAttempts: 2,
    });

    const res1 = loop.runVerification();
    expect(res1.success).toBe(false);
    expect(res1.parsedErrors.some((e) => e.includes("TypeError"))).toBe(true);

    const feedback1 = loop.recordAndGetFeedback(res1);
    expect(feedback1.passed).toBe(false);
    expect(feedback1.shouldContinue).toBe(true);
    expect(feedback1.feedbackPrompt).toContain("第 1/2 次");
    expect(feedback1.feedbackPrompt).toContain("TypeError");
    expect(feedback1.feedbackPrompt).toContain("自我修復指引");

    // 第 2 次失敗
    const res2 = loop.runVerification();
    const feedback2 = loop.recordAndGetFeedback(res2);
    expect(feedback2.shouldContinue).toBe(false);
    expect(feedback2.feedbackPrompt).toContain("已達最大修復次數");
  });
});
