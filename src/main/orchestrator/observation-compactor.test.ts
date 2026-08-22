import { describe, expect, it, beforeEach } from "vitest";
import {
  compactObservation,
  putObservationCache,
  getObservationCache,
  clearObservationCache,
  getObservationCacheSize,
} from "./observation-compactor";

describe("Observation Compactor (Context Pruning)", () => {
  beforeEach(() => {
    clearObservationCache();
  });

  it("does not compact short outputs", () => {
    const text = "Short tool execution output result";
    const res = compactObservation(text, { maxChars: 100 });
    expect(res.isCompacted).toBe(false);
    expect(res.text).toBe(text);
    expect(getObservationCacheSize()).toBe(0);
  });

  it("compacts large output and caches full raw content", () => {
    const head = "HEAD_START: Initial information line\n";
    const middle = "x".repeat(10000);
    const tail = "\nTAIL_END: Final result summary line";
    const raw = `${head}${middle}${tail}`;

    const res = compactObservation(raw, { maxChars: 500, headChars: 50, tailChars: 50 });
    expect(res.isCompacted).toBe(true);
    expect(res.text.startsWith(head.slice(0, 50))).toBe(true);
    expect(res.text.endsWith(tail.slice(-50))).toBe(true);
    expect(res.text).toContain("[TRUNCATED / COMPACTED:");
    expect(res.cacheRefId).toBeDefined();

    // Verify cache retrieval
    const cached = getObservationCache(res.cacheRefId!);
    expect(cached).toBe(raw);
  });

  it("manages LRU cache size limits cleanly", () => {
    for (let i = 0; i < 550; i++) {
      putObservationCache(`output-${i}`);
    }
    expect(getObservationCacheSize()).toBeLessThanOrEqual(500);
  });
});
