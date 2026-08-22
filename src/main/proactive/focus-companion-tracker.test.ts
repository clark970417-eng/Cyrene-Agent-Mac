import { describe, expect, it, beforeEach } from "vitest";
import { FocusCompanionTracker } from "./focus-companion-tracker";

describe("Focus Companion Tracker (Pomodoro Companion)", () => {
  let tracker: FocusCompanionTracker;

  beforeEach(() => {
    tracker = new FocusCompanionTracker();
  });

  it("tracks focus sessions and triggers break reminder after threshold", () => {
    tracker.startFocusSession("编写 TypeScript 代码");
    const t0 = tracker.getState().sessionStartedAt;

    // After 20 minutes (no reminder)
    const check1 = tracker.checkBreakReminder(45, t0 + 20 * 60_000);
    expect(check1.shouldRemind).toBe(false);

    // After 50 minutes (should remind)
    const check2 = tracker.checkBreakReminder(45, t0 + 50 * 60_000);
    expect(check2.shouldRemind).toBe(true);
    expect(check2.message).toContain("已经连续专注 50 分钟啦");
  });
});
