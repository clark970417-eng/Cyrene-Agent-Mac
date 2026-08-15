import { describe, it, expect, beforeEach } from "vitest";
import { LoopDetector, generateCallSignature } from "./loop-detector";

describe("generateCallSignature", () => {
  it("sorts object keys deterministically", () => {
    const sig1 = generateCallSignature("read_file", { path: "/a/b", line: 10 });
    const sig2 = generateCallSignature("read_file", { line: 10, path: "/a/b" });
    expect(sig1).toBe(sig2);
  });

  it("handles string arguments gracefully", () => {
    const sig1 = generateCallSignature("run_command", '{"command": "ls -la"}');
    const sig2 = generateCallSignature("run_command", { command: "ls -la" });
    expect(sig1).toBe(sig2);
  });
});

describe("LoopDetector", () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector({
      maxIdenticalConsecutive: 3,
      maxPingPongRepeats: 3,
      maxConsecutiveErrors: 3,
      windowSize: 10,
    });
  });

  it("detects identical consecutive tool calls and flags abort", () => {
    detector.recordAndCheck({ toolName: "read_file", args: { path: "test.ts" } });
    const r2 = detector.recordAndCheck({ toolName: "read_file", args: { path: "test.ts" } });
    expect(r2.isLoop).toBe(false);

    const r3 = detector.recordAndCheck({ toolName: "read_file", args: { path: "test.ts" } });
    expect(r3.isLoop).toBe(true);
    expect(r3.loopType).toBe("identical_consecutive");
    expect(r3.shouldAbort).toBe(true);
    expect(r3.message).toContain("連續 3 次完全相同");
  });

  it("detects ping-pong alternating loop (A-B-A-B-A-B)", () => {
    // 1st pair
    detector.recordAndCheck({ toolName: "toolA", args: {} });
    detector.recordAndCheck({ toolName: "toolB", args: {} });

    // 2nd pair
    detector.recordAndCheck({ toolName: "toolA", args: {} });
    detector.recordAndCheck({ toolName: "toolB", args: {} });

    // 3rd pair
    detector.recordAndCheck({ toolName: "toolA", args: {} });
    const r6 = detector.recordAndCheck({ toolName: "toolB", args: {} });

    expect(r6.isLoop).toBe(true);
    expect(r6.loopType).toBe("ping_pong");
    expect(r6.shouldAbort).toBe(true);
  });

  it("detects repeated consecutive execution errors", () => {
    detector.recordAndCheck({ toolName: "toolA", args: { x: 1 }, error: "File not found" });
    detector.recordAndCheck({ toolName: "toolB", args: { x: 2 }, error: "Permission denied" });
    const r3 = detector.recordAndCheck({ toolName: "toolC", args: { x: 3 }, error: "Syntax error" });

    expect(r3.isLoop).toBe(true);
    expect(r3.loopType).toBe("repeated_errors");
    expect(r3.shouldAbort).toBe(false);
    expect(r3.suggestion).toContain("請勿盲目重試");
  });

  it("resets state properly", () => {
    detector.recordAndCheck({ toolName: "read_file", args: { path: "test.ts" } });
    detector.recordAndCheck({ toolName: "read_file", args: { path: "test.ts" } });
    detector.reset();

    const r1 = detector.recordAndCheck({ toolName: "read_file", args: { path: "test.ts" } });
    expect(r1.isLoop).toBe(false);
  });
});
