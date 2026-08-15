import { describe, it, expect } from "vitest";
import { StepGuard } from "./step-guard";

describe("StepGuard", () => {
  it("tracks steps and triggers warning at threshold", () => {
    const guard = new StepGuard({ maxSteps: 10, warningRatio: 0.8 }); // warning at step 8

    for (let i = 1; i <= 7; i++) {
      const status = guard.incrementAndCheck();
      expect(status.currentStep).toBe(i);
      expect(status.isWarningTriggered).toBe(false);
      expect(status.isHardLimitReached).toBe(false);
    }

    const step8 = guard.incrementAndCheck();
    expect(step8.currentStep).toBe(8);
    expect(step8.isWarningTriggered).toBe(true);
    expect(step8.isHardLimitReached).toBe(false);
    expect(step8.advisoryPrompt).toContain("[步驟預警]");

    const step9 = guard.incrementAndCheck();
    expect(step9.currentStep).toBe(9);
    expect(step9.isWarningTriggered).toBe(true);

    const step10 = guard.incrementAndCheck();
    expect(step10.currentStep).toBe(10);
    expect(step10.isHardLimitReached).toBe(true);
    expect(step10.advisoryPrompt).toContain("[步驟上限熔斷]");
  });

  it("handles reset properly", () => {
    const guard = new StepGuard({ maxSteps: 5 });
    guard.incrementAndCheck();
    guard.incrementAndCheck();
    expect(guard.getStatus().currentStep).toBe(2);

    guard.reset();
    expect(guard.getStatus().currentStep).toBe(0);
    expect(guard.getStatus().isHardLimitReached).toBe(false);
  });
});
