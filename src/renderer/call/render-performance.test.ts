import { describe, expect, it } from "vitest";
import { FixedStepScheduler, renderPixelRatio } from "./render-performance";

describe("render performance helpers", () => {
  it("caps Retina rendering without reducing standard-density displays", () => {
    expect(renderPixelRatio(1)).toBe(1);
    expect(renderPixelRatio(2)).toBe(1.5);
    expect(renderPixelRatio(Number.NaN)).toBe(1);
  });

  // 步長比畫面更新率長時，布料每隔幾幀才動一次，看起來是一格一格地抖。
  // 先前是 1/30，在 60Hz 螢幕上等於每兩幀才更新一次。
  it("advances once per frame on a 60 Hz display", () => {
    const scheduler = new FixedStepScheduler();
    expect(scheduler.advance(1 / 60)).toBeCloseTo(1 / 60);
    expect(scheduler.advance(1 / 60)).toBeCloseTo(1 / 60);
    expect(scheduler.advance(1 / 60)).toBeCloseTo(1 / 60);
  });

  it("keeps the step stable on a 120 Hz display", () => {
    const scheduler = new FixedStepScheduler();
    // 每幀只有半步，所以是隔幀推進——但步長本身不變，手感才會一致。
    expect(scheduler.advance(1 / 120)).toBe(0);
    expect(scheduler.advance(1 / 120)).toBeCloseTo(1 / 60);
  });

  it("bounds catch-up work after a long pause", () => {
    const scheduler = new FixedStepScheduler();
    expect(scheduler.advance(10)).toBeCloseTo(1 / 60);
    expect(scheduler.advance(0)).toBeCloseTo(1 / 60);
    expect(scheduler.advance(0)).toBe(0);
  });

  it("exposes its step length", () => {
    expect(new FixedStepScheduler().step).toBeCloseTo(1 / 60);
    expect(new FixedStepScheduler(1 / 30).step).toBeCloseTo(1 / 30);
  });
});
