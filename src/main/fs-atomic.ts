import * as fs from "fs";
import * as path from "path";

/**
 * 原子落盤：先寫同目錄下的 .tmp，再 rename 覆蓋目標檔。
 *
 * 直接 writeFileSync 覆蓋既有檔案時，若進程在寫入途中被殺掉（當機、斷電、
 * 使用者強制結束 Electron），目標檔會被截斷成半個 JSON，下次啟動直接 parse 失敗。
 * 對記憶／關係／設定這類「壞掉就回不來」的狀態檔，這是不能接受的失敗模式。
 *
 * rename 在同一個檔案系統上是原子操作，因此崩潰後檔案內容只會是「完整的舊值」
 * 或「完整的新值」兩者之一。Windows 上 rename 亦會覆蓋既有檔案。
 *
 * @param mode 密鑰類檔案傳 0o600，避免同機其他使用者讀取。
 */
export function writeFileAtomic(
  filePath: string,
  data: string | Buffer,
  options?: { mode?: number },
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, data, { encoding: "utf8", mode: options?.mode });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // rename 失敗時 .tmp 會留在磁碟上，清掉以免累積垃圾檔。
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* tmp 可能根本沒建立起來，忽略 */
    }
    throw err;
  }
}

/** {@link writeFileAtomic} 的 JSON 版本，統一用 2 空格縮排（與既有落盤格式一致）。 */
export function writeJsonAtomic(filePath: string, value: unknown, options?: { mode?: number }): void {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2), options);
}
