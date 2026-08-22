// 把主行程的 console 輸出同時寫進檔案。
//
// 為什麼需要：正式版是用 Finder／Dock 啟動的，stdout 直接進虛空。要診斷延遲就得
// 從終端機重新啟動一次把輸出接出來——而 app 只要自己重啟（更新、崩潰、使用者
// 重開），接管就斷了，人卻不會發現，只會看到「怎麼又沒有 log」。2026-08-17 為了
// 這件事讓使用者重測了好幾輪。
//
// 檔案永遠寫，不看環境變數：這是個桌面 app，磁碟成本可以忽略，而需要 log 的時候
// 通常已經來不及叫使用者「先用特殊方式重啟再重現一次」。

import * as fs from "node:fs";
import * as path from "node:path";

/** 超過就從頭來過。保留上一份，才不會在追問題時剛好被自己蓋掉。 */
const MAX_BYTES = 8 * 1024 * 1024;

type ConsoleMethod = "log" | "warn" | "error" | "info";

let installed = false;

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * 讓 console.log/warn/error/info 除了原本的行為之外，再append 到 logDir/cyrene-main.log。
 * 重複呼叫無效果（避免熱重載時把 console 疊好幾層）。
 */
export function installMainLogFile(logDir: string): string | null {
  if (installed) return null;

  let filePath: string;
  let stream: fs.WriteStream;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    filePath = path.join(logDir, "cyrene-main.log");
    // 太大就先轉存成 .1，永遠留得住上一份。
    try {
      if (fs.statSync(filePath).size > MAX_BYTES) {
        fs.renameSync(filePath, `${filePath}.1`);
      }
    } catch { /* 檔案還不存在，正常 */ }
    stream = fs.createWriteStream(filePath, { flags: "a" });
  } catch (error) {
    // 寫不了檔就算了——絕不能因為記 log 失敗而影響 app 啟動。
    console.warn("[MainLog] 無法建立 log 檔:", error instanceof Error ? error.message : String(error));
    return null;
  }

  installed = true;
  stream.on("error", () => { /* 磁碟滿了之類的，靜默放棄，不要炸掉 app */ });

  for (const method of ["log", "warn", "error", "info"] as ConsoleMethod[]) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]): void => {
      original(...args);
      try {
        const line = args.map(formatArg).join(" ");
        stream.write(`${new Date().toISOString()} [${method}] ${line}\n`);
      } catch { /* 寫檔失敗不影響原本的輸出 */ }
    };
  }

  console.log(`[MainLog] 主行程輸出同步寫入 ${filePath}`);
  return filePath;
}
