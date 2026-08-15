import { describe, expect, it, vi } from "vitest";
import { ClickThroughController } from "./click-through";

describe("ClickThroughController", () => {
  it("uses the real drawing-buffer scale and caps synchronous samples", () => {
    let move: ((event: PointerEvent) => void) | undefined;
    const canvas = {
      addEventListener: vi.fn((name: string, listener: (event: PointerEvent) => void) => {
        if (name === "pointermove") move = listener;
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }),
    } as unknown as HTMLCanvasElement;
    const readPixels = vi.fn();
    const getBufferSubData = vi.fn((_target, _offset, pixel: Uint8Array) => { pixel[3] = 255; });
    const fence = {} as WebGLSync;
    const gl = {
      drawingBufferWidth: 200,
      drawingBufferHeight: 100,
      isContextLost: () => false,
      readPixels,
      createBuffer: vi.fn(() => ({})),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      fenceSync: vi.fn(() => fence),
      clientWaitSync: vi.fn(() => 1),
      getBufferSubData,
      deleteSync: vi.fn(),
      deleteBuffer: vi.fn(),
      flush: vi.fn(),
      RGBA: 1,
      UNSIGNED_BYTE: 2,
      PIXEL_PACK_BUFFER: 3,
      STREAM_READ: 4,
      SYNC_GPU_COMMANDS_COMPLETE: 5,
      TIMEOUT_EXPIRED: 6,
    } as unknown as WebGL2RenderingContext;
    let afterRender: (() => void) | undefined;
    const ticker = {
      add: vi.fn((callback: () => void) => { afterRender = callback; }),
      remove: vi.fn(),
    };
    const manager = { getGL: () => gl, getTicker: () => ticker };
    let now = 100;
    vi.stubGlobal("performance", { now: () => now });
    const onInteractive = vi.fn();
    const controller = new ClickThroughController(canvas, manager as never, { sampleRate: 30, onInteractive });

    move?.({ clientX: 50, clientY: 25 } as PointerEvent);
    afterRender?.();
    expect(readPixels).toHaveBeenCalledWith(100, 49, 1, 1, 1, 2, 0);
    expect(onInteractive).not.toHaveBeenCalled();
    afterRender?.();
    expect(onInteractive).toHaveBeenCalledWith(true);

    move?.({ clientX: 60, clientY: 30 } as PointerEvent);
    now = 110;
    afterRender?.();
    expect(readPixels).toHaveBeenCalledTimes(1);
    now = 135;
    afterRender?.();
    expect(readPixels).toHaveBeenCalledTimes(2);
    afterRender?.();
    expect(controller.getDiagnostics().sampleCount).toBe(2);

    controller.dispose();
    expect(ticker.remove).toHaveBeenCalledOnce();
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
