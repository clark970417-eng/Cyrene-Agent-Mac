// Process Tree Killer -- 子进程树级联终止与防僵尸进程清理
//
// 当用户取消操作、超时或会话重置时，递归终结目标 PID 及其派生的
// 所有子进程（Process Group / Process Tree），彻底杜绝后台僵尸进程占用资源。

import { exec } from "child_process";

export async function killProcessTree(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<boolean> {
  if (!pid || pid <= 0) return false;

  const isWindows = process.platform === "win32";

  return new Promise<boolean>((resolve) => {
    if (isWindows) {
      // Windows 使用 taskkill 级联 /T /F 杀死进程树
      exec(`taskkill /pid ${pid} /T /F`, (err) => {
        resolve(!err);
      });
    } else {
      // Unix / macOS: 首先尝试通过 process group 负 PID 杀死整个进程组
      try {
        process.kill(-pid, signal);
        resolve(true);
      } catch (err: any) {
        // 若非 group leader，回退使用 pkill 杀死所有子进程后杀死主进程
        exec(`pkill -P ${pid}`, () => {
          try {
            process.kill(pid, signal);
            resolve(true);
          } catch {
            resolve(false);
          }
        });
      }
    }
  });
}
