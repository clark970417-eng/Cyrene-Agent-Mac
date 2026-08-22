// Live2D Performance Governor -- 背景智能降频与 GPU 节能调度器
//
// 监控渲染窗口的焦点与可见性状态：
// - 窗口聚焦/前台活跃：全速 60 FPS 渲染。
// - 窗口处于后台/失焦：智能降频至 15 FPS（GPU 功耗直降 75%）。
// - 窗口完全最小化/隐藏：暂停 WebGL 渲染循环（0 GPU 占用）。

export type PowerMode = "full" | "throttled" | "paused";

export interface PerformanceGovernorOptions {
  activeFps?: number;
  backgroundFps?: number;
  onModeChange?: (mode: PowerMode, targetFps: number) => void;
}

export class Live2DPerformanceGovernor {
  private activeFps: number;
  private backgroundFps: number;
  private currentMode: PowerMode = "full";
  private targetFps: number;
  private frameIntervalMs: number;
  private lastRenderTimestamp = 0;
  private isWindowFocused = true;
  private isDocumentVisible = true;
  private onModeChange?: (mode: PowerMode, targetFps: number) => void;

  constructor(options: PerformanceGovernorOptions = {}) {
    this.activeFps = options.activeFps ?? 60;
    this.backgroundFps = options.backgroundFps ?? 15;
    this.targetFps = this.activeFps;
    this.frameIntervalMs = 1000 / this.activeFps;
    this.onModeChange = options.onModeChange;

    this.initWindowListeners();
  }

  private initWindowListeners(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    window.addEventListener("focus", () => {
      this.isWindowFocused = true;
      this.evaluateState();
    });

    window.addEventListener("blur", () => {
      this.isWindowFocused = false;
      this.evaluateState();
    });

    document.addEventListener("visibilitychange", () => {
      this.isDocumentVisible = document.visibilityState === "visible";
      this.evaluateState();
    });
  }

  /** 状态重估与模式切换 */
  evaluateState(): void {
    if (!this.isDocumentVisible) {
      this.setMode("paused", 0);
    } else if (!this.isWindowFocused) {
      this.setMode("throttled", this.backgroundFps);
    } else {
      this.setMode("full", this.activeFps);
    }
  }

  private setMode(mode: PowerMode, fps: number): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.targetFps = fps;
    this.frameIntervalMs = fps > 0 ? 1000 / fps : Infinity;

    if (this.onModeChange) {
      this.onModeChange(mode, fps);
    }
  }

  /**
   * 判断当前时间点是否满足渲染帧条件
   */
  shouldRender(now = Date.now()): boolean {
    if (this.currentMode === "paused" || this.targetFps === 0) {
      return false;
    }

    const elapsed = now - this.lastRenderTimestamp;
    if (elapsed >= this.frameIntervalMs - 2) {
      // -2ms 容差避免帧抖动
      this.lastRenderTimestamp = now;
      return true;
    }

    return false;
  }

  getCurrentMode(): PowerMode {
    return this.currentMode;
  }

  getTargetFps(): number {
    return this.targetFps;
  }
}

export const live2dPerformanceGovernor = new Live2DPerformanceGovernor();
