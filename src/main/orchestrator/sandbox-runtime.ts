// Sandbox Runtime -- 代码执行环境分级安全沙箱与越界审批机制
//
// 三级沙箱策略：
// - Level 1 (Safe / Direct): 只读操作（代码搜索、读取信任工作区文件）直接执行，零弹窗无阻碍。
// - Level 2 (Workspace Scoped): 写入操作限制在已绑定的当前工作区范围内；越界或路径逃逸直接拦截并提示审批。
// - Level 3 (Isolated Script Runtime): 运行 Python / Node / Shell 脚本时，在严格清理的环境变量、指定工作目录与超时保护中隔离运行。

import * as path from "path";
import { execFile } from "child_process";

export type SandboxTier = 1 | 2 | 3;

export interface SandboxEvaluation {
  tier: SandboxTier;
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

export interface IsolatedExecutionOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  maxBufferBytes?: number;
}

export interface IsolatedExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** 评估操作的安全分级与边界合法性 */
export function evaluateSandboxPolicy(
  operationKind: "read" | "write" | "exec" | "network",
  targetPath?: string,
  workspaceRoot?: string,
): SandboxEvaluation {
  // 1. Level 1: 纯只读或网络查询（受控）
  if (operationKind === "read") {
    return {
      tier: 1,
      allowed: true,
      requiresApproval: false,
    };
  }

  // 2. Level 2: 工作区写入约束
  if (operationKind === "write") {
    if (!workspaceRoot) {
      return {
        tier: 2,
        allowed: false,
        requiresApproval: true,
        reason: "未指定或未绑定有效工作区目录，禁止写操作",
      };
    }

    if (targetPath) {
      const resolved = path.resolve(workspaceRoot, targetPath);
      const normalizedRoot = path.normalize(workspaceRoot);
      const isInside = resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);

      if (!isInside) {
        return {
          tier: 2,
          allowed: false,
          requiresApproval: true,
          reason: `目标路径 [${targetPath}] 超出当前工作区边界 [${workspaceRoot}]，需要人工审批`,
        };
      }
    }

    return {
      tier: 2,
      allowed: true,
      requiresApproval: false,
    };
  }

  // 3. Level 3: 脚本与命令执行
  if (operationKind === "exec") {
    return {
      tier: 3,
      allowed: true,
      requiresApproval: false,
      reason: "命令需在隔离沙箱环境中受控执行",
    };
  }

  return {
    tier: 1,
    allowed: true,
    requiresApproval: false,
  };
}

/**
 * 在隔离受限环境中执行命令
 */
export async function runInIsolatedSandbox(
  command: string,
  options: IsolatedExecutionOptions = {},
): Promise<IsolatedExecutionResult> {
  const timeout = options.timeoutMs ?? 30_000;
  const cwd = options.cwd ?? process.cwd();
  const maxBuffer = options.maxBufferBytes ?? 5 * 1024 * 1024; // 5MB

  // 净化敏感环境变量
  const safeEnv: Record<string, string> = {
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: process.env.HOME || "/tmp",
    LANG: "en_US.UTF-8",
    NODE_ENV: "production",
    ...(options.env || {}),
  };

  if (process.platform !== "darwin") {
    throw new Error("E_MACOS_SANDBOX_UNAVAILABLE");
  }

  const escapeProfileString = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const writablePaths = [cwd, process.env.TMPDIR || "/private/tmp"];
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    ...writablePaths.map((allowedPath) => `(allow file-write* (subpath "${escapeProfileString(path.resolve(allowedPath))}"))`),
  ].join("\n");

  return new Promise<IsolatedExecutionResult>((resolve) => {
    let timedOut = false;

    const child = execFile(
      "/usr/bin/sandbox-exec",
      ["-p", profile, "/bin/zsh", "-lc", command],
      {
        cwd,
        env: safeEnv,
        timeout,
        maxBuffer,
      },
      (error, stdout, stderr) => {
        if (error && (error as any).killed && (error as any).signal === "SIGTERM") {
          timedOut = true;
        }

        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          timedOut,
        });
      },
    );

    // 额外超时保险
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeout + 2000);

    child.on("close", () => {
      clearTimeout(timer);
    });
  });
}
