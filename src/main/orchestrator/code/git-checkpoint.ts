import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitCheckpointOptions {
  cwd: string;
}

export interface CheckpointInfo {
  id: string;
  headCommit: string;
  timestamp: number;
  description?: string;
}

export class GitCheckpointManager {
  private cwd: string;

  constructor(options: GitCheckpointOptions) {
    this.cwd = path.resolve(options.cwd);
  }

  /**
   * 檢查當前目錄是否為 Git Repo
   */
  public isGitRepo(): boolean {
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd: this.cwd, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 取得當前 HEAD Commit Hash
   */
  public getHeadCommit(): string {
    if (!this.isGitRepo()) return "";
    try {
      return execSync("git rev-parse HEAD", { cwd: this.cwd, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  }

  /**
   * 建立變更前的快照 (Checkpoint)
   */
  public createCheckpoint(description = "Agent Checkpoint"): CheckpointInfo {
    const head = this.getHeadCommit();
    const id = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      id,
      headCommit: head,
      timestamp: Date.now(),
      description,
    };
  }

  /**
   * 取得自快照以來變更的檔案狀態清單 (git status --short)
   */
  public getChangedFiles(): string[] {
    if (!this.isGitRepo()) return [];
    try {
      const output = execSync("git status --short", { cwd: this.cwd, encoding: "utf8" });
      return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * 自動為 Agent 修改建立語意化 Commit
   */
  public autoCommit(message: string, files?: string[]): boolean {
    if (!this.isGitRepo()) return false;
    try {
      if (files && files.length > 0) {
        execSync(`git add ${files.map((f) => `"${f}"`).join(" ")}`, { cwd: this.cwd });
      } else {
        execSync("git add -A", { cwd: this.cwd });
      }
      const safeMessage = message.replace(/"/g, '\\"');
      execSync(`git commit -m "[AI Agent] ${safeMessage}"`, { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 還原工作目錄至指定的 HEAD Commit（丟棄所有未提交的修改）
   */
  public rollbackToCheckpoint(checkpoint: CheckpointInfo): boolean {
    if (!this.isGitRepo()) return false;
    try {
      // 清除未追蹤的檔案與目錄
      execSync("git clean -fd", { cwd: this.cwd });
      // 還原工作目錄
      execSync("git reset --hard", { cwd: this.cwd });
      if (checkpoint.headCommit) {
        execSync(`git reset --hard ${checkpoint.headCommit}`, { cwd: this.cwd });
      }
      return true;
    } catch {
      return false;
    }
  }
}
