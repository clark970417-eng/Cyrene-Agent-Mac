import { app, BrowserWindow, type WebContents } from "electron";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GEMINI_PERSIST_PARTITION } from "./gemini-session";

const GEMINI_URL = "https://gemini.google.com/app";
/** 開新對話的入口。`/u/2/` 是 Google 多帳號索引，背景視窗的登入 session 綁在那個帳號。 */
export const GEMINI_NEW_CHAT_URL = "https://gemini.google.com/u/2/app";
const CONVERSATION_STORAGE_KEY = "cyrene-agent.gemini-conversation";
export const SHARED_GEMINI_CONVERSATION_NAME = "Cyrene-Agent";
export const SHARED_GEMINI_PROMPT_VERSION = "cyrene-shared-v1";
// 使用者指定的 Cyrene-Agent 分享對話所對應之可續寫內部網址。
// share.gemini.google 是公開分享入口，背景聊天必須使用 /app/<id> 才能追加訊息。
/** 昔漣專用的共用對話。
 *
 * 換對話的時機：這個對話會隨著使用累積歷史，而 Gemini 每輪都要重讀整段——
 * 舊的那個（b9a358e56a56adf0）被「每通電話重貼一次完整人設」的 bug 灌了好幾天，
 * 首字從 3 秒漲到 9 秒，最後出現 90 秒零產出的逾時。該 bug 已修，但塞進去的
 * 內容清不掉，只能換一個乾淨的。
 *
 * `/u/2/` 是 Google 多帳號的索引，要保留——背景視窗的登入 session 綁在那個帳號上。 */
export const SHARED_GEMINI_CONVERSATION_URL = "https://gemini.google.com/u/2/app/6ce9dc5274aebfed";

export interface GeminiConversationBinding {
  url: string;
  promptVersion?: string;
  /** 建立時間（ISO）。跨日就換一個新對話，見 isConversationBindingStale。 */
  createdAt?: string;
}

function normalizeConversationKey(key?: string): string {
  return key?.trim() || "default";
}

function conversationStorageKey(key?: string): string {
  const normalized = normalizeConversationKey(key);
  if (normalized === "default") return CONVERSATION_STORAGE_KEY;
  return `${CONVERSATION_STORAGE_KEY}.${createHash("sha256").update(normalized).digest("hex").slice(0, 20)}`;
}

function conversationBindingPath(key?: string): string {
  const normalized = normalizeConversationKey(key);
  if (normalized === "default") return join(app.getPath("userData"), "gemini-conversation.json");
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return join(app.getPath("userData"), `gemini-conversation-${digest}.json`);
}

async function persistGeminiConversationBinding(
  webContents: WebContents,
  binding: GeminiConversationBinding,
  conversationKey?: string,
): Promise<void> {
  const serialized = JSON.stringify(binding);
  await webContents.executeJavaScript(
    `localStorage.setItem(${JSON.stringify(conversationStorageKey(conversationKey))}, ${JSON.stringify(serialized)})`,
    true,
  ).catch(() => undefined);

  const target = conversationBindingPath(conversationKey);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, serialized, "utf8");
  await rename(temporary, target);
}

/**
 * 取出對話 ID（`/app/<id>` 或 `/u/<n>/app/<id>` 的 `<id>`）；不是對話網址就回 null。
 *
 * 判斷「現在這個視窗是不是停在我們綁定的那個對話」時要比這個，不能比整串網址：
 * Gemini 會把 `/u/2/` 正規化掉、也會自己加查詢參數，字串比對必然對不上，
 * 於是每輪都被判成「新對話」而重貼一萬字人設。實測 url_match=n 就是這樣來的。
 */
export function geminiConversationId(url: string): string | null {
  try {
    const match = /^(?:\/u\/\d+)?\/app\/([^/?#]+)\/?$/.exec(new URL(url).pathname);
    return new URL(url).origin === "https://gemini.google.com" && match ? match[1] : null;
  } catch {
    return null;
  }
}

/** 兩個網址是否指向同一個 Gemini 對話（忽略 /u/<n>、尾斜線與查詢參數）。 */
export function isSameGeminiConversation(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const idA = geminiConversationId(a);
  return idA !== null && idA === geminiConversationId(b);
}

/**
 * 這個 binding 是不是「不是今天建立的」。
 *
 * 對話會隨著使用累積歷史，而 Gemini 每輪都要重讀整段——舊對話曾經長到讓首字
 * 從 1.9 秒漲到 9 秒。除了每通電話開新的之外，跨日也換一次，避免一整天講下來
 * 又養出一個胖對話。
 *
 * 比的是本地日曆日，不是「24 小時」：使用者說的是「每天凌晨 12 點」。
 */
export function isConversationBindingStale(createdAt: string | undefined, now: Date): boolean {
  if (!createdAt) return true;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return true;
  return created.getFullYear() !== now.getFullYear()
    || created.getMonth() !== now.getMonth()
    || created.getDate() !== now.getDate();
}

export function isSafeGeminiConversationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // 兩種都要接受：`/app/<id>` 以及多帳號的 `/u/<n>/app/<id>`。
    // 只認前者的話，使用者從第二個 Google 帳號複製的網址會被判成不合法而靜默忽略。
    return parsed.origin === "https://gemini.google.com"
      && /^(?:\/u\/\d+)?\/app\/[^/?#]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export async function readGeminiConversationBinding(
  webContents: WebContents,
  conversationKey?: string,
): Promise<GeminiConversationBinding | null> {
  const fileRaw = await readFile(conversationBindingPath(conversationKey), "utf8").catch(() => null);
  if (fileRaw) {
    try {
      const parsed = JSON.parse(fileRaw) as GeminiConversationBinding;
      if (isSafeGeminiConversationUrl(parsed.url)) return parsed;
    } catch {
      // 檔案損壞時繼續嘗試 Gemini origin 的 localStorage 備份。
    }
  }

  const raw = await webContents.executeJavaScript(
    `localStorage.getItem(${JSON.stringify(conversationStorageKey(conversationKey))})`,
    true,
  ).catch(() => null) as string | null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GeminiConversationBinding;
    return isSafeGeminiConversationUrl(parsed.url) ? parsed : null;
  } catch {
    return null;
  }
}

export async function rememberGeminiConversation(
  webContents: WebContents,
  promptVersion?: string,
  conversationKey?: string,
): Promise<GeminiConversationBinding | null> {
  const url = webContents.getURL();
  if (!isSafeGeminiConversationUrl(url)) return null;
  // createdAt 是跨日輪替的依據，寫入時一定要帶上。
  const binding: GeminiConversationBinding = {
    url,
    createdAt: new Date().toISOString(),
    ...(promptVersion ? { promptVersion } : {}),
  };
  await persistGeminiConversationBinding(webContents, binding, conversationKey).catch(() => undefined);
  return binding;
}

let bgWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;

/** 恢復今天的綁定；若綁定屬於昨天，立刻切到乾淨的新對話入口。這個檢查每次
 * 取得背景視窗都會跑，所以 App 整晚不關、視窗一直存在時，凌晨 00:00 仍會輪替。 */
async function restoreConversation(win: BrowserWindow, conversationKey?: string): Promise<void> {
  const remembered = await readGeminiConversationBinding(win.webContents, conversationKey);
  if (!remembered && normalizeConversationKey(conversationKey) !== "default") {
    if (win.webContents.getURL() !== GEMINI_NEW_CHAT_URL) await win.loadURL(GEMINI_NEW_CHAT_URL);
    return;
  }
  // 舊的共用/通話對話維持每日輪替；具名 Conversation 必須永久固定。
  if (normalizeConversationKey(conversationKey) === "default"
    && remembered && isConversationBindingStale(remembered.createdAt, new Date())) {
    console.log("[Gemini] 綁定的對話不是今天建立的，改開新對話");
    await win.loadURL(GEMINI_NEW_CHAT_URL);
    return;
  }
  if (remembered && !isSameGeminiConversation(win.webContents.getURL(), remembered.url)) {
    await win.loadURL(remembered.url);
  }
}

/**
 * 背景視窗：平常聊天時完全隱藏（show:false），只用來代替使用者操作 Gemini 網頁。
 * 與登入視窗共用同一個 persist:cyrene-gemini partition，登入狀態會同步。
 */
export async function getOrCreateBackgroundWindow(conversationKey?: string): Promise<BrowserWindow> {
  if (bgWindow && !bgWindow.isDestroyed()) {
    await restoreConversation(bgWindow, conversationKey);
    return bgWindow;
  }

  bgWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      partition: GEMINI_PERSIST_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  bgWindow.on("closed", () => {
    bgWindow = null;
  });

  await bgWindow.loadURL(GEMINI_URL);
  await restoreConversation(bgWindow, conversationKey);
  return bgWindow;
}

export function isBackgroundWindowReady(): boolean {
  return !!bgWindow && !bgWindow.isDestroyed();
}

export async function reloadBackgroundWindow(): Promise<void> {
  if (bgWindow && !bgWindow.isDestroyed()) {
    bgWindow.destroy();
  }
  bgWindow = null;
  await getOrCreateBackgroundWindow();
}

/**
 * 獨立登入視窗：只在使用者第一次使用、或登入失效需要重新登入時開啟。
 * 密碼、兩步驟驗證、CAPTCHA 一律由使用者在這個視窗手動完成，
 * 昔漣不會讀取、攔截或自動填入任何帳號密碼資料。
 */
export function openGeminiLoginWindow(): BrowserWindow {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return loginWindow;
  }

  loginWindow = new BrowserWindow({
    width: 1080,
    height: 780,
    title: "登入 Gemini（昔漣背景模型）",
    autoHideMenuBar: true,
    webPreferences: {
      partition: GEMINI_PERSIST_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  loginWindow.loadURL(GEMINI_URL);

  loginWindow.on("closed", () => {
    loginWindow = null;
    // 登入視窗關閉後，讓背景視窗重新載入一次，確保拿到最新的登入 cookie。
    void reloadBackgroundWindow().catch((err) => {
      console.error("[Gemini] 登入後重新載入背景視窗失敗：", err);
    });
  });

  return loginWindow;
}

export function isLoginWindowOpen(): boolean {
  return !!loginWindow && !loginWindow.isDestroyed();
}

export function focusLoginWindowIfOpen(): boolean {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return true;
  }
  return false;
}

export function destroyGeminiWindows(): void {
  if (bgWindow && !bgWindow.isDestroyed()) bgWindow.destroy();
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
  bgWindow = null;
  loginWindow = null;
}
