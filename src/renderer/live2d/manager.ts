import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import type { HitAreaDef } from "./interaction";
import { type Live2DTarget } from "../../shared/live2d-actions";

export type { HitAreaDef } from "./interaction";

/**
 * Base window dimensions at zoom = 1.0. Must stay in sync with the matching
 * constants in src/main/index.ts (PET_WINDOW_BASE_WIDTH/HEIGHT). baseScale is
 * always computed against these fixed values so it stays zoom-invariant.
 */
const PET_WINDOW_BASE_WIDTH = 400;
const PET_WINDOW_BASE_HEIGHT = 500;

export interface Live2DManagerOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  modelPath: string;
  onLoad?: () => void;
  onError?: (err: Error) => void;
}

export interface Live2DPerformanceMetrics {
  sampleCount: number;
  averageFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  framesOver20Ms: number;
  framesOver33Ms: number;
  contextLossCount: number;
}

interface MotionEntry {
  Name?: string;
  File?: string;
  Expression?: string;
  [k: string]: unknown;
}

interface ModelJsonShape {
  HitAreas?: { Name?: string; Id?: string; Motion?: string }[];
  Motions?: Record<string, MotionEntry[]>;
}

function buildHitAreaDefs(json: ModelJsonShape): HitAreaDef[] {
  const out: HitAreaDef[] = [];
  const hitAreas = json.HitAreas ?? [];
  const motions = json.Motions ?? {};
  for (const area of hitAreas) {
    const name = area.Name;
    const id = area.Id;
    const trigger = area.Motion;
    if (!name || !id || !trigger) continue;
    const sep = trigger.indexOf(":");
    if (sep <= 0) continue;
    const group = trigger.substring(0, sep);
    const motionName = trigger.substring(sep + 1);
    const list = motions[group];
    const motionIndex = list ? list.findIndex((m) => m.Name === motionName) : -1;
    const motion = motionIndex >= 0 && list ? list[motionIndex] : undefined;
    const expressionName = motion?.Expression;
    out.push({ name, id, group, motionName, motionIndex, expressionName });
  }
  return out;
}

function buildMotionIndexMap(json: ModelJsonShape): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const motions = json.Motions ?? {};
  for (const [group, list] of Object.entries(motions)) {
    const inner = new Map<string, number>();
    list.forEach((entry, i) => {
      const name = entry?.Name;
      if (typeof name === "string" && name.length > 0) inner.set(name, i);
    });
    out.set(group, inner);
  }
  return out;
}

export class Live2DManager {
  private app: PIXI.Application | null = null;
  private model: Live2DModel | null = null;
  private hitAreaDefs: HitAreaDef[] = [];
  /** group -> motionName -> index in internalModel.motionManager.definitions[group]. */
  private motionIndexMap: Map<string, Map<string, number>> = new Map();
  private options: Live2DManagerOptions;
  private disposed = false;
  private initialized = false;
  /** In-flight init() promise, so concurrent callers await the same load instead of racing two model loads. */
  private initPromise: Promise<void> | null = null;
  /** Scale that fits the model into the base window (zoom=1.0). Cached once
   *  at load so applyZoom can multiply it by the user's zoom factor. */
  private baseScale = 1;
  /** Current zoom factor (1.0 = default). Window size is driven separately by
   *  the main process; this only scales the model relative to baseScale. */
  private zoom = 1;
  private lastWidth = 0;
  private lastHeight = 0;
  private readonly pauseReasons = new Set<string>();
  private readonly frameTimes: number[] = [];
  private frameTimeCursor = 0;
  private contextLossCount = 0;

  constructor(options: Live2DManagerOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    if (this.disposed || this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInit(): Promise<void> {
    if (this.disposed) return;
    const { canvas, width, height } = this.options;
    this.app = new PIXI.Application({
      view: canvas,
      width,
      height,
      transparent: true,
      backgroundAlpha: 0,
      antialias: true,
      // Click-through reads the target pixel immediately after PIXI renders,
      // before Chromium composites/invalidates the default framebuffer. This
      // lets us keep preserveDrawingBuffer disabled: retaining the full Retina
      // framebuffer every frame costs bandwidth and prevents WebGL from using
      // its fastest swap path.
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
      // 2x 已足夠維持桌寵清晰度；限制高 DPI drawing buffer 可顯著降低
      // 4K／縮放螢幕上的 GPU 與記憶體負擔，不改變畫面尺寸或 UI。
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    this.lastWidth = width;
    this.lastHeight = height;
    this.app.ticker.add(this.recordFrame, this, PIXI.UPDATE_PRIORITY.LOW);
    if (this.pauseReasons.size > 0) this.app.ticker.stop();
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    try {
      await this.loadModel();
      if (!this.disposed && this.model) this.initialized = true;
    } catch (err) {
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
      // Leave retries with a clean slate. Previously a failed load kept an
      // orphan PIXI application/ticker, and a later init() created a second
      // rendering loop on the same canvas.
      canvas.removeEventListener("webglcontextlost", this.handleContextLost);
      canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
      if (this.app) {
        this.app.ticker.remove(this.recordFrame, this);
        this.app.destroy(false, { children: true, texture: true, baseTexture: true });
        this.app = null;
      }
    }
  }

  private async loadModel(): Promise<void> {
    const { modelPath } = this.options;
    // Kick off the Live2D load and the raw JSON fetch in parallel so the
    // hit-area / motion index map is ready the moment the model is.
    const modelPromise = Live2DModel.from(modelPath, {
      ticker: this.app!.ticker,
      autoHitTest: false,
      autoFocus: false,
    });
    const jsonPromise = fetch(modelPath).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch " + modelPath + ": " + r.status);
      return r.json() as Promise<ModelJsonShape>;
    });
    const [model, json] = await Promise.all([modelPromise, jsonPromise]);
    if (!this.app || this.disposed) {
      model.destroy();
      return;
    }
    this.model = model;
    this.hitAreaDefs = buildHitAreaDefs(json);
    this.motionIndexMap = buildMotionIndexMap(json);
    this.app.stage.addChild(this.model);
    this.model.anchor.set(0.5, 0.5);
    // baseScale is always computed against the *base* window size, never the
    // current (possibly zoomed) one. The main process resizes the window to
    // base × zoom before the renderer loads, so reading the live window here
    // would fold zoom into baseScale and then applyZoom would double-count
    // it. Using fixed base dimensions keeps baseScale zoom-invariant.
    const baseScaleX = PET_WINDOW_BASE_WIDTH / this.model.width;
    const baseScaleY = PET_WINDOW_BASE_HEIGHT / this.model.height;
    this.baseScale = Math.min(baseScaleX, baseScaleY, 1.0);
    this.applyZoom(this.zoom);
    // A UI/controller setup error must not be misreported as a model loading
    // failure or leave a successfully loaded model in an indeterminate state.
    try {
      this.options.onLoad?.();
    } catch (error) {
      console.error("[Cyrene] Live2D onLoad setup failed", error);
    }
  }

  /**
   * Apply the user's zoom factor on top of the cached base scale. The window
   * itself is resized separately by the main process (window = base × zoom),
   * so this just sets model scale = baseScale × zoom and re-centres it in the
   * (now resized) canvas. Reads the live window size rather than the stale
   * constructor options, since the main process has already resized the
   * window by the time this is invoked. Proportions never change, so the
   * model always fills the window and is never clipped.
   */
  applyZoom(zoom: number): void {
    this.zoom = zoom;
    if (!this.model) return;
    this.model.scale.set(this.baseScale * zoom);
    this.resize(window.innerWidth, window.innerHeight);
  }

  getModel(): Live2DModel | null {
    return this.model;
  }

  getTicker(): PIXI.Ticker | null {
    return this.app?.ticker ?? null;
  }

  getPerformanceMetrics(): Live2DPerformanceMetrics {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const percentile = (p: number): number => {
      if (sorted.length === 0) return 0;
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    };
    const total = this.frameTimes.reduce((sum, value) => sum + value, 0);
    return {
      sampleCount: this.frameTimes.length,
      averageFrameMs: this.frameTimes.length > 0 ? total / this.frameTimes.length : 0,
      p95FrameMs: percentile(0.95),
      p99FrameMs: percentile(0.99),
      maxFrameMs: Math.max(0, ...this.frameTimes),
      framesOver20Ms: this.frameTimes.filter((value) => value > 20).length,
      framesOver33Ms: this.frameTimes.filter((value) => value > 33.34).length,
      contextLossCount: this.contextLossCount,
    };
  }

  /** Snapshot of live resource state, for diagnostics/leak-checking (e.g. after window reload cycles). */
  getResourceMetrics(): {
    appActive: boolean;
    modelLoaded: boolean;
    disposed: boolean;
    tickerStarted: boolean;
    stageChildren: number;
    initialized: boolean;
    pauseReasons: string[];
    drawingBufferPixels: number;
  } {
    return {
      appActive: this.app != null,
      modelLoaded: this.model != null,
      disposed: this.disposed,
      tickerStarted: this.app?.ticker.started ?? false,
      stageChildren: this.app?.stage.children.length ?? 0,
      initialized: this.initialized,
      pauseReasons: Array.from(this.pauseReasons),
      drawingBufferPixels: this.getGL()
        ? this.getGL()!.drawingBufferWidth * this.getGL()!.drawingBufferHeight
        : 0,
    };
  }

  /**
   * The underlying WebGL rendering context, or null before init/disposed.
   * Used by the click-through controller to sample pixel alpha under the
   * cursor (transparent -> click passes through, opaque -> capture).
   *
   * `app.renderer` is typed as the abstract `IRenderer`; only the concrete
   * WebGL `Renderer` exposes `.gl`, so we narrow with an instanceof check.
   */
  getGL(): WebGL2RenderingContext | null {
    const renderer = this.app?.renderer;
    return renderer instanceof PIXI.Renderer ? renderer.gl : null;
  }

  getHitAreaDefs(): HitAreaDef[] {
    return this.hitAreaDefs;
  }

  /**
   * Play a Live2D motion or expression described by a catalog target.
   *
   * - motion target: looks up the motion's index in the group's
   *   internalModel.motionManager.definitions and calls model.motion().
   *   Falls back to model.expression(motionName) if the motion isn't
   *   registered (matches the same fallback the hit-area controller uses).
   * - expression target: calls model.expression(name) directly.
   *
   * Swallows errors so a broken animation never crashes the renderer.
   * No-op when this.model is null (pet window not yet ready).
   */
  async playAction(target: Live2DTarget): Promise<void> {
    if (!this.model) return;
    try {
      if (target.kind === "motion") {
        const inner = this.motionIndexMap.get(target.group);
        const index = inner?.get(target.motionName);
        if (typeof index === "number") {
          await this.model.motion(target.group, index);
          return;
        }
        // Not registered as a motion — fall back to expression semantics.
        await this.model.expression(target.motionName);
        return;
      }
      // expression target
      await this.model.expression(target.name);
    } catch (err) {
      console.warn("[Cyrene] playAction failed", target, err);
    }
  }

  resize(width: number, height: number): void {
    if (!this.app) return;
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    if (safeWidth !== this.lastWidth || safeHeight !== this.lastHeight) {
      this.lastWidth = safeWidth;
      this.lastHeight = safeHeight;
      this.app.renderer.resize(safeWidth, safeHeight);
    }
    if (this.model) {
      this.model.x = safeWidth / 2;
      this.model.y = safeHeight / 2;
    }
  }

  /**
   * Pause the PIXI ticker. Stops all per-frame controllers (AutoBreath,
   * EyeBlink, MouseTracking, Physics) from advancing. The model freezes
   * on its last rendered frame.
   *
   * Used while the user is dragging the window, so that the Windows DWM
   * "drag image" stays bit-identical to the live canvas content -- this
   * kills the ghosting/flicker that transparent Electron windows show
   * during a drag on Windows.
   */
  pause(): void {
    this.setPaused("manual", true);
  }

  /** Resume the PIXI ticker. See pause(). */
  resume(): void {
    this.setPaused("manual", false);
  }

  setPaused(reason: string, paused: boolean): void {
    if (paused) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    if (!this.app) return;
    if (this.pauseReasons.size > 0) {
      this.app.ticker.stop();
      return;
    }
    this.app.render();
    this.app.ticker.start();
  }

  dispose(): void {
    this.disposed = true;
    this.initialized = false;
    this.options.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.options.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    if (this.model) {
      this.model.destroy();
      this.model = null;
    }
    if (this.app) {
      this.app.ticker.remove(this.recordFrame, this);
      this.app.destroy(false, { children: true, texture: true, baseTexture: true });
      this.app = null;
    }
    // pixi-live2d-display 會把模型貼圖留在 PIXI 全域快取；重載桌寵時若不
    // 清除，GPU 記憶體會逐次累積。dispose 只在整個 manager 結束時呼叫，
    // 因此在這裡清理不會影響其他作用中的畫面。
    const caches = (PIXI as unknown as {
      utils?: {
        TextureCache?: Record<string, unknown>;
        BaseTextureCache?: Record<string, unknown>;
      };
    }).utils;
    for (const cache of [caches?.TextureCache, caches?.BaseTextureCache]) {
      if (!cache) continue;
      for (const key of Object.keys(cache)) delete cache[key];
    }
  }

  private handleVisibilityChange = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.setPaused("visibility-hidden", true);
    } else {
      this.setPaused("visibility-hidden", false);
    }
  };

  private recordFrame(): void {
    const elapsedMs = this.app?.ticker.elapsedMS;
    if (!Number.isFinite(elapsedMs) || !elapsedMs || elapsedMs <= 0) return;
    if (this.frameTimes.length < 600) {
      this.frameTimes.push(elapsedMs);
      return;
    }
    this.frameTimes[this.frameTimeCursor] = elapsedMs;
    this.frameTimeCursor = (this.frameTimeCursor + 1) % this.frameTimes.length;
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLossCount += 1;
    this.setPaused("webgl-context", true);
    console.warn("[Cyrene] WebGL context lost; rendering paused until restoration");
  };

  private handleContextRestored = (): void => {
    console.info("[Cyrene] WebGL context restored");
    this.setPaused("webgl-context", false);
  };
}
