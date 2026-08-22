import { describe, expect, it } from "vitest";
import { evaluateSandboxPolicy, runInIsolatedSandbox } from "./sandbox-runtime";

describe("Sandbox Runtime (Tiered Execution Policy)", () => {
  it("allows Level 1 read-only operations directly", () => {
    const res = evaluateSandboxPolicy("read", "/path/to/any/file.ts");
    expect(res.tier).toBe(1);
    expect(res.allowed).toBe(true);
    expect(res.requiresApproval).toBe(false);
  });

  it("permits Level 2 writes within workspace boundary", () => {
    const ws = "/Users/clark/Agent";
    const res = evaluateSandboxPolicy("write", "/Users/clark/Agent/src/test.ts", ws);
    expect(res.tier).toBe(2);
    expect(res.allowed).toBe(true);
    expect(res.requiresApproval).toBe(false);
  });

  it("intercepts and requires approval for Level 2 path escape attempts", () => {
    const ws = "/Users/clark/Agent";
    const res = evaluateSandboxPolicy("write", "/etc/passwd", ws);
    expect(res.tier).toBe(2);
    expect(res.allowed).toBe(false);
    expect(res.requiresApproval).toBe(true);
    expect(res.reason).toContain("超出当前工作区边界");
  });

  it("runs commands inside isolated sandbox runtime with timeout control", async () => {
    const res = await runInIsolatedSandbox("echo 'sandbox test'", { timeoutMs: 5000 });
    if (res.exitCode === 71 && res.stderr.includes("sandbox_apply: Operation not permitted")) {
      // Some CI/agent hosts already run inside Seatbelt and macOS rejects a
      // nested sandbox. The same command is verified in the unsandboxed
      // packaging smoke check.
      return;
    }
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("sandbox test");
    expect(res.timedOut).toBe(false);
  });

  it("blocks writes outside the selected workspace", async () => {
    const marker = `/private/cyrene-sandbox-${process.pid}`;
    const res = await runInIsolatedSandbox(`touch '${marker}'`, {
      cwd: "/private/tmp",
      timeoutMs: 5000,
    });
    if (res.exitCode === 71 && res.stderr.includes("sandbox_apply: Operation not permitted")) return;
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("Operation not permitted");
  });
});
