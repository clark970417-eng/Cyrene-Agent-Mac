import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GitCheckpointManager } from "./git-checkpoint";

describe("GitCheckpointManager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-chk-test-"));
    // 初始化 git repo
    execSync("git init", { cwd: tempDir });
    execSync("git config user.name 'Test User'", { cwd: tempDir });
    execSync("git config user.email 'test@example.com'", { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "initial.txt"), "hello world");
    execSync("git add -A && git commit -m 'Initial commit'", { cwd: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("identifies git repo and reads HEAD commit", () => {
    const manager = new GitCheckpointManager({ cwd: tempDir });
    expect(manager.isGitRepo()).toBe(true);
    expect(manager.getHeadCommit()).toMatch(/^[0-9a-f]{40}$/);
  });

  it("creates checkpoint and rollbacks modifications cleanly", () => {
    const manager = new GitCheckpointManager({ cwd: tempDir });
    const checkpoint = manager.createCheckpoint("Before bad change");

    // 建立破壞性修改與新檔案
    fs.writeFileSync(path.join(tempDir, "initial.txt"), "corrupted content");
    fs.writeFileSync(path.join(tempDir, "unwanted.txt"), "bad file");
    expect(manager.getChangedFiles().length).toBeGreaterThan(0);

    // 還原
    const success = manager.rollbackToCheckpoint(checkpoint);
    expect(success).toBe(true);

    expect(fs.readFileSync(path.join(tempDir, "initial.txt"), "utf8")).toBe("hello world");
    expect(fs.existsSync(path.join(tempDir, "unwanted.txt"))).toBe(false);
    expect(manager.getChangedFiles()).toEqual([]);
  });

  it("auto commits changes with semantic prefix", () => {
    const manager = new GitCheckpointManager({ cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, "feature.txt"), "new feature");

    const committed = manager.autoCommit("add feature");
    expect(committed).toBe(true);

    const log = execSync("git log -n 1 --pretty=%B", { cwd: tempDir, encoding: "utf8" });
    expect(log).toContain("[AI Agent] add feature");
  });
});
