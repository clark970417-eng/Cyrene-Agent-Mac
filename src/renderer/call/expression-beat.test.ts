import { describe, expect, it } from "vitest";
import {
  BLINK_OVERLAPPING_MORPHS,
  blinkSafeWinkWeight,
  expressionBeatDuration,
  expressionBeatWeight,
  type ExpressionBeatShape,
} from "./vrm-viewer";

// 眨眼以前是把 ウィンク 釘在 1.0，setMood 只有在下一個「不同的」mood 到來時
// 才歸零，於是一次眨眼會掛著整輪對話不放，隨機眨眼又獨立作用在雙眼上。
const WINK: ExpressionBeatShape = { attack: 0.09, hold: 0.13, release: 0.22, peak: 1.0 };

describe("expressionBeatWeight", () => {
  it("starts closed-open at zero", () => {
    expect(expressionBeatWeight(WINK, 0)).toBe(0);
    expect(expressionBeatWeight(WINK, -1)).toBe(0);
  });

  it("reaches full close during the hold", () => {
    expect(expressionBeatWeight(WINK, WINK.attack + WINK.hold / 2)).toBe(1);
  });

  it("returns to zero once the beat is over — the eye always opens again", () => {
    expect(expressionBeatWeight(WINK, expressionBeatDuration(WINK))).toBe(0);
    expect(expressionBeatWeight(WINK, 10)).toBe(0);
  });

  it("never leaves the eye stuck part-way", () => {
    // 掃過整個包絡，權重必須落在 0~peak 之間且首尾為 0。
    const duration = expressionBeatDuration(WINK);
    for (let t = 0; t <= duration + 0.05; t += 0.005) {
      const w = expressionBeatWeight(WINK, t);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it("rises then falls without a discontinuity", () => {
    const mid = expressionBeatWeight(WINK, WINK.attack / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    const releasing = expressionBeatWeight(WINK, WINK.attack + WINK.hold + WINK.release / 2);
    expect(releasing).toBeGreaterThan(0);
    expect(releasing).toBeLessThan(1);
  });

  it("scales with peak", () => {
    const half: ExpressionBeatShape = { ...WINK, peak: 0.5 };
    expect(expressionBeatWeight(half, half.attack + half.hold / 2)).toBe(0.5);
  });
});

describe("expressionBeatDuration", () => {
  it("sums the three phases", () => {
    expect(expressionBeatDuration(WINK)).toBeCloseTo(0.44, 5);
  });
});

// 昔漣的左眼被壓兩次：`ウィンク` 只作用在左眼，`まばたき` 作用在雙眼，
// morph 權重相加，眨眼撞上眨單眼時左眼會被壓到 2.0，眼窩看起來凹陷。
describe("blinkSafeWinkWeight", () => {
  it("沒有在眨眼時，眨單眼維持原本的強度", () => {
    expect(blinkSafeWinkWeight(1, 0)).toBe(1);
    expect(blinkSafeWinkWeight(0.4, 0)).toBe(0.4);
  });

  it("眨眼全閉時，單眼 morph 完全讓位", () => {
    expect(blinkSafeWinkWeight(1, 1)).toBe(0);
  });

  it("兩者重疊時合計不超過 1", () => {
    for (let wink = 0; wink <= 1; wink += 0.1) {
      for (let blink = 0; blink <= 1; blink += 0.1) {
        const safe = blinkSafeWinkWeight(wink, blink);
        expect(safe + blink).toBeLessThanOrEqual(1 + 1e-9);
        expect(safe).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("在笑瞇瞇閉眼時，單眼 morph 依剩餘開合度限制，避免單眼抽動", () => {
    expect(blinkSafeWinkWeight(1, 0, 0.9)).toBeCloseTo(0.1);
    expect(blinkSafeWinkWeight(1, 0, 1.0)).toBe(0);
  });

  it("永遠不會回傳負值", () => {
    expect(blinkSafeWinkWeight(0.2, 1.5)).toBe(0);
  });
});

describe("BLINK_OVERLAPPING_MORPHS", () => {
  it("涵蓋模型裡所有的單眼 morph", () => {
    // 星穹铁道—大昔涟 物理优化.pmx 的眼部 morph：まばたき(雙) / ウィンク(左)
    // / ウィンク２(左) / ウィンク右(右) / ｳｨﾝｸ２右(右)。
    expect(BLINK_OVERLAPPING_MORPHS.has("ウィンク")).toBe(true);
    expect(BLINK_OVERLAPPING_MORPHS.has("ウィンク２")).toBe(true);
    expect(BLINK_OVERLAPPING_MORPHS.has("ウィンク右")).toBe(true);
    expect(BLINK_OVERLAPPING_MORPHS.has("ｳｨﾝｸ２右")).toBe(true);
    // まばたき 本身是雙眼，不該被列進來，否則會自己壓自己。
    expect(BLINK_OVERLAPPING_MORPHS.has("まばたき")).toBe(false);
  });
});
