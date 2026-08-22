const MAX_RENDER_PIXEL_RATIO = 1.5;

export function renderPixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, MAX_RENDER_PIXEL_RATIO);
}

/**
 * 用固定步長推進次級物理（彈簧骨），與畫面更新率脫鉤。
 *
 * 為什麼需要固定步長：這裡的 Verlet 積分把阻尼寫成「每幀保留 1 - drag 的
 * 慣性」，是**每幀**而不是每秒，所以步長一變手感就跟著變。固定步長能讓
 * 60Hz 與 120Hz 的螢幕看到同樣的擺動。
 *
 * 為什麼是 1/60 而不是 1/30：步長比畫面更新率長時，布料會每隔幾幀才動一次，
 * 看起來就是一格一格地抖。先前設 1/30，在 60Hz 螢幕上等於每兩幀才更新一次
 * ——布料幾乎不動的時候看不出來，等布料真的會飄之後就變成明顯的抖動。
 * 1/60 讓最常見的 60Hz 螢幕每幀剛好推進一步。
 *
 * 長時間停頓（分頁切走）會被累加上限擋住，恢復時不會一次補算一大批。
 */
export class FixedStepScheduler {
  private accumulator = 0;

  constructor(private readonly stepSeconds = 1 / 60) {}

  /** 這一步的長度（秒）。 */
  public get step(): number {
    return this.stepSeconds;
  }

  /**
   * 距離下一步還差多少，以步長為單位（0~1）。
   *
   * 畫面用它在最近兩個物理步之間插值（見 SpringBoneSystem.applyInterpolated）：
   * 物理維持固定步長的穩定性，畫面上的運動則與畫面更新率同步，
   * 不會因為某一幀剛好湊不滿一步而卡住、下一幀又走雙倍。
   */
  public get alpha(): number {
    return this.accumulator / this.stepSeconds;
  }

  /**
   * 累加時間並取出一個可推進的步長；不足一步時回傳 0。
   *
   * 傳 0 可以在同一幀內把累積的餘量繼續取出來（掉幀後補算），
   * 累加上限是兩步，所以一幀最多補兩步，不會出現追不完的雪球。
   */
  public advance(deltaSeconds: number): number {
    const safeDelta = Number.isFinite(deltaSeconds)
      ? Math.max(0, Math.min(deltaSeconds, this.stepSeconds * 2))
      : 0;
    this.accumulator = Math.min(this.accumulator + safeDelta, this.stepSeconds * 2);
    if (this.accumulator < this.stepSeconds) return 0;
    this.accumulator -= this.stepSeconds;
    return this.stepSeconds;
  }

  public reset(): void {
    this.accumulator = 0;
  }
}
