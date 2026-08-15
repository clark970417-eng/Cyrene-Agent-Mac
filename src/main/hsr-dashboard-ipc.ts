import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { ipcMain } from "electron";
import { IPC } from "../shared/ipc-channels";
import {
  extractBoundAccounts,
  normalizeEnkaProfile,
  normalizeHsrProfile,
  type HsrBoundAccount,
  type HsrProfileSummary,
  type HsrStaticData,
} from "./hsr-dashboard-data";

const HSR_ROOT = path.join(os.homedir(), ".local", "share", "cyrene-hsr");
const DB_PATH = path.join(HSR_ROOT, "data", "hsr.sqlite");
const PREFERENCE_PATH = path.join(HSR_ROOT, "data", "dashboard.json");
const INSTALL_ROOT = path.join(HSR_ROOT, "hsr-discord-bot");
const STATIC_DATA_ROOT = path.join(INSTALL_ROOT, "src", "assets", "data");

function exec(file: string, args: string[], timeout = 3_000): Promise<string> {
  return new Promise((resolve, reject) => execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message));
    else resolve(stdout);
  }));
}

async function readSavedUid(): Promise<string | null> {
  try {
    const value = JSON.parse(await fs.readFile(PREFERENCE_PATH, "utf8")) as { uid?: unknown };
    const uid = String(value.uid ?? "").trim();
    return /^\d{9}$/.test(uid) ? uid : null;
  } catch { return null; }
}

async function saveUid(uid: string): Promise<void> {
  await fs.mkdir(path.dirname(PREFERENCE_PATH), { recursive: true });
  await fs.writeFile(PREFERENCE_PATH, `${JSON.stringify({ uid }, null, 2)}\n`, { mode: 0o600 });
}

async function readBoundAccounts(): Promise<HsrBoundAccount[]> {
  if (!fsSync.existsSync(DB_PATH)) return [];
  try {
    const output = await exec("sqlite3", ["-json", DB_PATH, "SELECT ID AS id, json FROM json;"]);
    const rows = JSON.parse(output || "[]") as Array<{ id?: unknown; json?: unknown }>;
    return extractBoundAccounts(rows);
  } catch (error) {
    console.warn("[HsrDashboard] 無法讀取 HSR 帳號索引：", error);
    return [];
  }
}

async function readJsonFile(fileName: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(path.join(STATIC_DATA_ROOT, fileName), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readStaticData(): Promise<HsrStaticData> {
  const [characters, lightCones, paths, elements, properties, relics] = await Promise.all([
    readJsonFile("characters_cht.json"),
    readJsonFile("lightcone.json"),
    readJsonFile("paths_cht.json"),
    readJsonFile("elements_cht.json"),
    readJsonFile("properties_cht.json"),
    readJsonFile("relicset.json"),
  ]);
  return { characters, lightCones, paths, elements, properties, relics };
}

async function fetchEnkaProfile(uid: string): Promise<HsrProfileSummary> {
  const response = await fetch(`https://enka.network/api/hsr/uid/${uid}`, {
    headers: { "User-Agent": "Cyrene-Agent/1.0 HSR-Dashboard" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) throw new Error("找不到這個 UID；請確認伺服器與數字是否正確。");
  if (response.status === 429) throw new Error("角色資料服務正在限流，請稍後再重新整理。");
  if (!response.ok) throw new Error(`Enka 備援服務暫時無法使用（HTTP ${response.status}）。`);
  return normalizeEnkaProfile(await response.json(), uid, await readStaticData());
}

async function fetchProfile(uid: string): Promise<HsrProfileSummary> {
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`https://api.mihomo.me/sr_info_parsed/${uid}?lang=cht`, {
        headers: { "User-Agent": "Cyrene-Agent/1.0 HSR-Dashboard" },
        signal: AbortSignal.timeout(20_000),
      });

      if (response.status === 404) throw new Error("找不到這個 UID；請確認伺服器與數字是否正確。");
      if (response.status === 429) throw new Error("角色資料服務正在限流，請稍後再重新整理。");
      if (response.status === 500) {
        const text = await response.text().catch(() => "");
        if (text.includes("Queue timeout") || text.includes("timeout")) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          throw new Error("米哈遊查詢隊列目前尖峰壅塞（Queue timeout），請稍候 1~2 分鐘後點擊重新整理。");
        }
      }
      if (!response.ok) throw new Error(`角色資料服務暫時無法使用（HTTP ${response.status}）。`);

      const profile = normalizeHsrProfile(await response.json(), uid);
      await saveUid(profile.uid);
      return profile;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes("找不到這個 UID")) break;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  try {
    const profile = await fetchEnkaProfile(uid);
    await saveUid(profile.uid);
    return profile;
  } catch (fallbackError) {
    const fallback = fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
    throw new Error(`${lastError?.message ?? "Mihomo 資料服務無法使用"}；備援服務亦失敗：${fallback.message}`);
  }
}

export function registerHsrDashboardIpc(): void {
  ipcMain.removeHandler(IPC.HSR_DASHBOARD_STATUS);
  ipcMain.removeHandler(IPC.HSR_DASHBOARD_PROFILE);

  ipcMain.handle(IPC.HSR_DASHBOARD_STATUS, async () => {
    const accounts = await readBoundAccounts();
    const savedUid = await readSavedUid();
    return {
      installed: fsSync.existsSync(path.join(INSTALL_ROOT, "dist", "index.js")),
      databaseReady: fsSync.existsSync(DB_PATH),
      accounts,
      activeUid: savedUid ?? accounts.find((account) => !account.invalid)?.uid ?? accounts[0]?.uid ?? null,
    };
  });

  ipcMain.handle(IPC.HSR_DASHBOARD_PROFILE, async (_event, value?: string) => {
    const uid = String(value ?? await readSavedUid() ?? "").trim();
    if (!/^\d{9}$/.test(uid)) return { ok: false, error: "請輸入 9 位數的崩壞：星穹鐵道 UID。" };
    try {
      return { ok: true, profile: await fetchProfile(uid) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
