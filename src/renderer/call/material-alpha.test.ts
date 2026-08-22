/**
 * 釘住材質透明度的三向分類。
 *
 * 這裡的數字不是憑感覺挑的，是拿模型真正的貼圖量出來的（256 點取樣，
 * 半透 = alpha 落在 20~235 之間的 texel 佔比）：
 *
 *   纱.png   全透  5.7%  半透 24.5%  不透 69.9%   → 真薄紗
 *   衣2.png  全透 36.4%  半透  0.5%  不透 63.1%   → 二值鏤空
 *   衣3.png  全透 97.3%  半透  1.1%  不透  1.6%   → 二值鏤空
 *   衣5.png  全透 97.1%  半透  1.3%  不透  1.7%   → 二值鏤空
 *   衣.png   全透  0.0%  半透  0.0%  不透  100%   → 完全不透明
 *
 * 分界要保住的性質：**只有 纱.png 走混合通道**。先前的規則是照材質名稱
 * （含 袖／衣2／叶／发饰／裙链）判定，把主裙與上衣這兩萬多個面一起丟進
 * 混合通道，衣服邊緣就會把底下的身體透出來 —— 使用者看到的就是「人物半透明、穿模」。
 */

import { describe, it, expect } from "vitest";
import { classifyAlpha, type AlphaProfile } from "./pmx-loader";

const 纱: AlphaProfile = { hasAlpha: true, softRatio: 0.245 };
const 衣2: AlphaProfile = { hasAlpha: true, softRatio: 0.005 };
const 衣3: AlphaProfile = { hasAlpha: true, softRatio: 0.011 };
const 衣5: AlphaProfile = { hasAlpha: true, softRatio: 0.013 };
const 衣: AlphaProfile = { hasAlpha: false, softRatio: 0 };

describe("classifyAlpha", () => {
  it("薄紗（纱.png）走混合，但仍然寫深度", () => {
    const p = classifyAlpha(纱, 1.0, false);
    expect(p.transparent).toBe(true);
    expect(p.alphaTest).toBeCloseTo(0.01);
    // 不寫深度的話後處理的景深會拿它背後（背景）的深度算 CoC，
    // 把貼在頭上的白葉子當遠景糊掉。見 classifyAlpha 的說明。
    expect(p.depthWrite).toBe(true);
  });

  it("二值鏤空的衣服全部走不透明通道並寫深度", () => {
    for (const profile of [衣2, 衣3, 衣5]) {
      const p = classifyAlpha(profile, 1.0, false);
      expect(p.transparent).toBe(false);
      expect(p.depthWrite).toBe(true);
      // 鏤空沒有混合幫忙柔邊，門檻要在中間，不能是「幾乎全留」的 0.08
      expect(p.alphaTest).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("沒有 alpha 通道的貼圖連 alphaTest 都不開", () => {
    const p = classifyAlpha(衣, 1.0, false);
    expect(p.transparent).toBe(false);
    expect(p.depthWrite).toBe(true);
    expect(p.alphaTest).toBe(0);
  });

  it("作者把 diffuse alpha 調低的一律是真半透明，跟貼圖無關", () => {
    const p = classifyAlpha(衣, 0.3, false);
    expect(p.transparent).toBe(true);
    expect(p.translucent).toBe(true);
  });

  it("零厚度雙殼即使半透明也要寫深度", () => {
    expect(classifyAlpha(纱, 1.0, true).depthWrite).toBe(true);
    expect(classifyAlpha(纱, 1.0, true).transparent).toBe(true);
  });

  it("分界不是壓在邊界上：薄紗與最接近的鏤空之間差了一個量級", () => {
    // 纱 0.245 vs 衣5 0.013 —— 門檻落在中間任何一點結論都一樣
    const 薄紗 = classifyAlpha(纱, 1.0, false).translucent;
    const 鏤空 = classifyAlpha(衣5, 1.0, false).translucent;
    expect(薄紗).toBe(true);
    expect(鏤空).toBe(false);
    expect(纱.softRatio / 衣5.softRatio).toBeGreaterThan(10);
  });
});
