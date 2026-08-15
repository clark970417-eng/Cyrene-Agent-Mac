import type { Live2DModel } from "pixi-live2d-display/cubism4";
import { UPDATE_PRIORITY, type Ticker } from "pixi.js";

const MAX_MOUTH_DURATION_MS = 5 * 60 * 1000;
const MOUTH_PHASE_MS = 120;
const MIN_MOUTH_VALUE = 0.15;
const MAX_MOUTH_VALUE = 0.85;
const SMOOTHING_TIME_MS = 48;

type CoreModelWithParameters = {
  setParameterValueById?: (id: string, value: number) => void;
  setParameterValueByIndex?: (index: number, value: number) => void;
  getParameterIndex?: (id: string) => number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class MouthSyncController {
  private readonly model: Live2DModel;
  private readonly ticker: Ticker;
  private timeoutId: number | null = null;
  private disposed = false;
  private mouthOpen = false;
  private active = false;
  private phaseElapsedMs = 0;
  private currentValue = 0;
  private targetValue = 0;

  constructor(model: Live2DModel, ticker: Ticker) {
    this.model = model;
    this.ticker = ticker;
  }

  start(durationMs: number): void {
    if (this.disposed) return;
    this.stop();
    const safeDuration = clamp(Number.isFinite(durationMs) ? durationMs : 0, 0, MAX_MOUTH_DURATION_MS);
    if (safeDuration <= 0) {
      this.setMouth(0);
      return;
    }

    this.active = true;
    this.phaseElapsedMs = MOUTH_PHASE_MS;
    this.ticker.add(this.update, this, UPDATE_PRIORITY.LOW + 1);
    this.timeoutId = window.setTimeout(() => this.stop(), safeDuration);
  }

  stop(): void {
    if (this.active) this.ticker.remove(this.update, this);
    this.active = false;
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.mouthOpen = false;
    this.phaseElapsedMs = 0;
    this.currentValue = 0;
    this.targetValue = 0;
    this.setMouth(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  private update = (): void => {
    if (!this.active || this.disposed) return;
    const elapsedMs = Math.min(50, Math.max(0, this.ticker.elapsedMS || 0));
    this.phaseElapsedMs += elapsedMs;
    if (this.phaseElapsedMs >= MOUTH_PHASE_MS) {
      this.phaseElapsedMs %= MOUTH_PHASE_MS;
      this.mouthOpen = !this.mouthOpen;
      const random = Math.random() * 0.18;
      this.targetValue = this.mouthOpen
        ? MAX_MOUTH_VALUE - random
        : MIN_MOUTH_VALUE + random;
    }
    // Exponential smoothing follows the target quickly without the visible
    // square-wave snapping of the old 180 ms interval.
    const alpha = 1 - Math.exp(-elapsedMs / SMOOTHING_TIME_MS);
    this.currentValue += (this.targetValue - this.currentValue) * alpha;
    this.setMouth(this.currentValue);
  };

  private setMouth(value: number): void {
    try {
      const coreModel = (this.model.internalModel as unknown as { coreModel?: CoreModelWithParameters }).coreModel;
      if (!coreModel) return;
      if (typeof coreModel.setParameterValueById === "function") {
        coreModel.setParameterValueById("ParamMouthOpenY", value);
        return;
      }
      if (typeof coreModel.getParameterIndex === "function" && typeof coreModel.setParameterValueByIndex === "function") {
        const index = coreModel.getParameterIndex("ParamMouthOpenY");
        if (index >= 0) coreModel.setParameterValueByIndex(index, value);
      }
    } catch (err) {
      console.warn("[Cyrene] mouth sync failed", err);
      this.stop();
    }
  }
}
