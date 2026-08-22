// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStreamThrottle } from "./useStreamThrottle";

describe("useStreamThrottle (React Streaming RAF Governor)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates immediately when not streaming", () => {
    const { result, rerender } = renderHook(
      ({ text, streaming }) => useStreamThrottle(text, streaming),
      { initialProps: { text: "Hello", streaming: false } },
    );

    expect(result.current).toBe("Hello");

    rerender({ text: "Hello World", streaming: false });
    expect(result.current).toBe("Hello World");
  });

  it("throttles high-frequency text changes while streaming", () => {
    const { result, rerender } = renderHook(
      ({ text, streaming }) => useStreamThrottle(text, streaming, { throttleMs: 50 }),
      { initialProps: { text: "T", streaming: true } },
    );

    expect(result.current).toBe("T");

    // Rapid tokens arrival
    rerender({ text: "Token 1", streaming: true });
    rerender({ text: "Token 1 Token 2", streaming: true });
    rerender({ text: "Token 1 Token 2 Token 3", streaming: true });

    // Advance time to allow throttle timer to trigger flush
    act(() => {
      vi.runAllTimers();
    });

    expect(result.current).toBe("Token 1 Token 2 Token 3");
  });
});
