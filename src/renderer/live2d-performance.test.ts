import { describe, expect, it } from "vitest";
import { Live2DPerformanceGovernor } from "./live2d-performance";

describe("Live2D Performance Governor (Background GPU Throttle)", () => {
  it("defaults to full 60fps when active", () => {
    const gov = new Live2DPerformanceGovernor({ activeFps: 60, backgroundFps: 15 });
    expect(gov.getCurrentMode()).toBe("full");
    expect(gov.getTargetFps()).toBe(60);
  });

  it("paces rendering according to target FPS interval", () => {
    const gov = new Live2DPerformanceGovernor({ activeFps: 60 });
    const t0 = 1000;
    expect(gov.shouldRender(t0)).toBe(true);

    // Too soon (after 5ms)
    expect(gov.shouldRender(t0 + 5)).toBe(false);

    // After 16.6ms (1000/60)
    expect(gov.shouldRender(t0 + 17)).toBe(true);
  });
});
