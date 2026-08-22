import { describe, expect, it } from "vitest";
import { AffectionService } from "./affection-service";

describe("AffectionService", () => {
  it("initializes with starting level and progress", () => {
    const service = new AffectionService(50);
    const state = service.getState();

    expect(state.level).toBe(1);
    expect(state.exp).toBe(50);
    expect(state.unlockedActions).toContain("微笑");
  });

  it("levels up when exp thresholds are crossed", () => {
    const service = new AffectionService(50);
    const updated = service.addExp({ amount: 100 });

    expect(updated.level).toBe(2);
    expect(updated.unlockedActions).toContain("裝可愛");
  });

  it("records focus minutes and unlocks badges", () => {
    const service = new AffectionService(0, 0);
    service.recordFocusMinutes(70);
    const state = service.getState();

    expect(state.focusMinutes).toBe(70);
    expect(state.badges.some((b) => b.id === "badge-focus-60")).toBe(true);
  });
});
