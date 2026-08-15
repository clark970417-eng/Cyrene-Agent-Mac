import type { Live2DManager } from "./manager";
import { UPDATE_PRIORITY, type Ticker } from "pixi.js";

export interface ClickThroughOptions {
  /**
   * Pixel alpha (0-255) at/above which a point is treated as the model and
   * thus clickable. Below it, the point is "transparent" and clicks should
   * pass through to whatever is behind the window. The default is low so
   * that anti-aliased model edges (semi-transparent) still register.
   */
  alphaThreshold?: number;
  /**
   * Invoked when the interactive state should change. `true` = the window
   * captures pointer events over the model; `false` = clicks pass through.
   */
  onInteractive?: (interactive: boolean) => void;
  /** Maximum alpha samples per second. Pixel readback is a GPU/CPU sync point. */
  sampleRate?: number;
}

/**
 * Drives per-pixel click-through on a transparent Live2D window.
 *
 * Electron's `setIgnoreMouseEvents(ignore, { forward: true })` is a
 * whole-window, binary switch: either the entire window rectangle
 * captures clicks, or none of it does. It does *not* pass clicks through
 * transparent pixels. So a window-sized canvas with a model floating in
 * the middle would capture clicks everywhere, including the transparent
 * border.
 *
 * This controller samples the alpha of the rendered pixel under the cursor
 * on every pointer move (forwarded mouse-move messages still reach the
 * renderer even while the window ignores clicks). When the pixel is
 * transparent it tells the main process to ignore mouse events (clicks pass
 * through); when it's opaque it switches back to capturing so the user can
 * interact with the model. This is independent of model scale/position:
 * it reads the *actual rendered* frame, so any scale or layout works.
 */
export class ClickThroughController {
  private readonly canvas: HTMLCanvasElement;
  private readonly manager: Live2DManager;
  private readonly alphaThreshold: number;
  private readonly onInteractive?: (interactive: boolean) => void;
  private readonly sampleIntervalMs: number;
  private readonly pixel = new Uint8Array(4);
  private readonly ticker: Ticker | null;
  private pixelPackBuffer: WebGLBuffer | null = null;
  private pixelFence: WebGLSync | null = null;

  private pendingPoint: { x: number; y: number } | null = null;
  private currentState: boolean | null = null;
  private paused = false;
  private disposed = false;
  private lastSampleAt = -Infinity;
  private sampleCount = 0;
  private totalSampleMs = 0;

  constructor(
    canvas: HTMLCanvasElement,
    manager: Live2DManager,
    options: ClickThroughOptions = {},
  ) {
    this.canvas = canvas;
    this.manager = manager;
    this.alphaThreshold = options.alphaThreshold ?? 10;
    this.onInteractive = options.onInteractive;
    this.sampleIntervalMs = 1000 / Math.max(1, options.sampleRate ?? 30);
    this.ticker = manager.getTicker();

    canvas.addEventListener("pointermove", this.handleMove);
    // PIXI renders at UPDATE_PRIORITY.LOW. Sampling one priority later keeps
    // readPixels inside the same animation frame while the default framebuffer
    // is valid, so the renderer does not need preserveDrawingBuffer=true.
    this.ticker?.add(this.sampleAfterRender, this, UPDATE_PRIORITY.LOW - 1);
  }

  pause(): void {
    this.paused = true;
    this.cancelPending();
  }

  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    // Reset so the next move re-evaluates rather than short-circuiting on a
    // stale "already interactive" state.
    this.currentState = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
    this.ticker?.remove(this.sampleAfterRender, this);
    this.disposeAsyncReadback();
    this.canvas.removeEventListener("pointermove", this.handleMove);
  }

  getDiagnostics(): { sampleCount: number; averageSampleMs: number } {
    return {
      sampleCount: this.sampleCount,
      averageSampleMs: this.sampleCount > 0 ? this.totalSampleMs / this.sampleCount : 0,
    };
  }

  private handleMove = (event: PointerEvent): void => {
    if (this.disposed || this.paused) return;
    this.pendingPoint = { x: event.clientX, y: event.clientY };
  };

  private sampleAfterRender = (): void => {
    if (this.disposed || this.paused) return;
    if (this.pollAsyncReadback()) return;
    const now = performance.now();
    if (now - this.lastSampleAt < this.sampleIntervalMs) return;
    const point = this.pendingPoint;
    this.pendingPoint = null;
    if (!point) return;

    const startedAt = performance.now();
    const interactive = this.beginAlphaSample(point.x, point.y);
    this.totalSampleMs += performance.now() - startedAt;
    this.lastSampleAt = now;
    // Async WebGL2 readback resolves on a later frame. Immediate boolean
    // results are bounds checks or the WebGL1 compatibility fallback.
    if (interactive === null) return;
    this.sampleCount += 1;
    this.applyInteractive(interactive);
  };

  private applyInteractive(interactive: boolean): void {
    if (interactive === this.currentState) return; // idempotent: avoid IPC spam
    this.currentState = interactive;
    this.onInteractive?.(interactive);
  }

  /**
   * True when the pixel under the given CSS coordinate is opaque enough to
   * belong to the model. Queues a single 1x1 read immediately after render,
   * while the default framebuffer is valid.
   */
  private beginAlphaSample(cssX: number, cssY: number): boolean | null {
    const gl = this.manager.getGL();
    if (!gl) return true; // before init, be permissive (don't block)

    const rect = this.canvas.getBoundingClientRect();
    // CSS -> canvas pixels. autoDensity makes the drawing buffer match the
    // CSS size * devicePixelRatio.
    if (rect.width <= 0 || rect.height <= 0 || gl.isContextLost()) return false;
    // Derive the scale from the real drawing buffer. devicePixelRatio may be
    // 3 while the renderer intentionally caps its resolution at 2; using raw
    // DPR here sampled the wrong pixel (or outside the buffer) on Retina Macs.
    const x = Math.floor((cssX - rect.left) * (gl.drawingBufferWidth / rect.width));
    const y = Math.floor((cssY - rect.top) * (gl.drawingBufferHeight / rect.height));
    if (x < 0 || y < 0 || x >= gl.drawingBufferWidth || y >= gl.drawingBufferHeight) {
      return false;
    }
    // WebGL Y grows upward; readPixels origin is the bottom-left.
    const flippedY = gl.drawingBufferHeight - 1 - y;

    // readPixels into a client Uint8Array is a hard GPU -> CPU synchronization
    // point (74 ms was observed on the production Retina renderer). WebGL2's
    // PIXEL_PACK_BUFFER queues the copy on the GPU; a fence lets a later frame
    // collect the four bytes only after they are ready, without blocking Live2D.
    if (
      typeof gl.fenceSync === "function"
      && typeof gl.clientWaitSync === "function"
      && typeof gl.getBufferSubData === "function"
    ) {
      this.pixelPackBuffer ??= gl.createBuffer();
      if (this.pixelPackBuffer) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelPackBuffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
        gl.readPixels(x, flippedY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this.pixelFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        return null;
      }
    }

    // Compatibility fallback for WebGL1/old drivers. Modern Electron uses the
    // async path above; retaining this keeps click-through functional instead
    // of turning the whole transparent window into a click blocker.
    gl.readPixels(x, flippedY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
    return this.pixel[3] >= this.alphaThreshold;
  }

  /** Returns true while a GPU read is still in flight or was just resolved. */
  private pollAsyncReadback(): boolean {
    const gl = this.manager.getGL();
    const fence = this.pixelFence;
    const buffer = this.pixelPackBuffer;
    if (!gl || !fence || !buffer) return false;

    const status = gl.clientWaitSync(fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return true;

    const startedAt = performance.now();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixel);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteSync(fence);
    this.pixelFence = null;
    this.totalSampleMs += performance.now() - startedAt;
    this.sampleCount += 1;
    this.applyInteractive(this.pixel[3] >= this.alphaThreshold);
    return true;
  }

  private disposeAsyncReadback(): void {
    const gl = this.manager.getGL();
    if (!gl) return;
    if (this.pixelFence) gl.deleteSync(this.pixelFence);
    if (this.pixelPackBuffer) gl.deleteBuffer(this.pixelPackBuffer);
    this.pixelFence = null;
    this.pixelPackBuffer = null;
  }

  private cancelPending(): void {
    this.pendingPoint = null;
  }
}
