import path from "node:path";

export interface CommandSafetyCheckResult {
  isSafe: boolean;
  reason?: string;
  matchedPattern?: string;
}

export interface EnvironmentSafetyConfig {
  allowedWorkspaces?: string[];
  blockedCommands?: RegExp[];
  allowNetwork?: boolean;
}

const DEFAULT_BLOCKED_COMMANDS: RegExp[] = [
  /\brm\s+-(?:r|f|rf|fr)\s+(?:\/|~|\$HOME|\.\.)(?:\s|$)/i,
  /\bmkfs\b/i,
  /\bfdisk\b/i,
  /\bdd\s+if=/i,
  /:(){ :|:& };:/, // Fork bomb
  />\s*\/dev\/sda/i,
  /\bchmod\s+-R\s+777\s+\//i,
];

export class SafeEnvironmentManager {
  private config: EnvironmentSafetyConfig;

  constructor(config: EnvironmentSafetyConfig = {}) {
    this.config = {
      allowedWorkspaces: (config.allowedWorkspaces || [process.cwd()]).map((p) => path.resolve(p)),
      blockedCommands: config.blockedCommands || DEFAULT_BLOCKED_COMMANDS,
      allowNetwork: config.allowNetwork ?? true,
    };
  }

  /**
   * 檢查命令是否包含高危破壞性指令
   */
  public checkCommandSafety(command: string): CommandSafetyCheckResult {
    const trimmed = command.trim();
    if (!trimmed) {
      return { isSafe: true };
    }

    for (const pattern of this.config.blockedCommands!) {
      if (pattern.test(trimmed)) {
        return {
          isSafe: false,
          reason: `指令命中高危險破壞性規則: ${pattern.toString()}`,
          matchedPattern: pattern.toString(),
        };
      }
    }

    return { isSafe: true };
  }

  /**
   * 檢查目標路徑是否在允許的工作區範圍內
   */
  public isPathWithinWorkspace(targetPath: string): boolean {
    const resolvedTarget = path.resolve(targetPath);
    for (const ws of this.config.allowedWorkspaces!) {
      const rel = path.relative(ws, resolvedTarget);
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        return true;
      }
      if (rel === "") return true;
    }
    return false;
  }
}
