import { describe, it, expect } from "vitest";
import path from "node:path";
import { SafeEnvironmentManager } from "./safe-environment";

describe("SafeEnvironmentManager", () => {
  const manager = new SafeEnvironmentManager({
    allowedWorkspaces: ["/Users/clark/Agent"],
  });

  it("blocks dangerous destructive commands", () => {
    const r1 = manager.checkCommandSafety("rm -rf /");
    expect(r1.isSafe).toBe(false);
    expect(r1.reason).toContain("高危險破壞性規則");

    const r2 = manager.checkCommandSafety("mkfs.ext4 /dev/sdb");
    expect(r2.isSafe).toBe(false);

    const r3 = manager.checkCommandSafety(":(){ :|:& };:");
    expect(r3.isSafe).toBe(false);
  });

  it("allows safe normal commands", () => {
    const r1 = manager.checkCommandSafety("npm test");
    expect(r1.isSafe).toBe(true);

    const r2 = manager.checkCommandSafety("git status");
    expect(r2.isSafe).toBe(true);

    const r3 = manager.checkCommandSafety("ls -la src/");
    expect(r3.isSafe).toBe(true);
  });

  it("validates workspace path boundaries", () => {
    expect(manager.isPathWithinWorkspace("/Users/clark/Agent/src/index.ts")).toBe(true);
    expect(manager.isPathWithinWorkspace("/Users/clark/Agent")).toBe(true);
    expect(manager.isPathWithinWorkspace("/etc/passwd")).toBe(false);
    expect(manager.isPathWithinWorkspace("/Users/other/file.txt")).toBe(false);
  });
});
