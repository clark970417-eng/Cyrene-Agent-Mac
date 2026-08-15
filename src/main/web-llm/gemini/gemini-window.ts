import { app, BrowserWindow, type WebContents } from "electron";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GEMINI_PERSIST_PARTITION } from "./gemini-session";

const GEMINI_URL = "https://gemini.google.com/app";
const CONVERSATION_STORAGE_KEY = "cyrene-agent.gemini-conversation";
export const SHARED_GEMINI_CONVERSATION_NAME = "Cyrene-Agent";
export const SHARED_GEMINI_PROMPT_VERSION = "cyrene-shared-v1";
// 使用者指定的 Cyrene-Agent 分享對話所對應之可續寫內部網址。
// share.gemini.google 是公開分享入口，背景聊天必須使用 /app/<id> 才能追加訊息。
export const SHARED_GEMINI_CONVERSATION_URL = "https://gemini.google.com/app/b9a358e56a56adf0";

export interface GeminiConversationBinding {
  url: string;
  promptVersion?: string;
}

function conversationBindingPath(): string {
  return join(app.getPath("userData"), "gemini-conversation.json");
}

async function persistGeminiConversationBinding(
  webContents: WebContents,
  binding: GeminiConversationBinding,
): Promise<void> {
  const serialized = JSON.stringify(binding);
  await webContents.executeJavaScript(
    `localStorage.setItem(${JSON.stringify(CONVERSATION_STORAGE_KEY)}, ${JSON.stringify(serialized)})`,
    true,
  ).catch(() => undefined);

  const target = conversationBindingPath();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, serialized, "utf8");
  await rename(temporary, target);
}

export function isSafeGeminiConversationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://gemini.google.com"
      && /^\/app\/[^/?#]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export async function readGeminiConversationBinding(
  webContents: WebContents,
): Promise<GeminiConversationBinding | null> {
  const fileRaw = await readFile(conversationBindingPath(), "utf8").catch(() => null);
  if (fileRaw) {
    try {
      const parsed = JSON.parse(fileRaw) as GeminiConversationBinding;
      if (isSafeGeminiConversationUrl(parsed.url)) return parsed;
    } catch {
      // 檔案損壞時繼續嘗試 Gemini origin 的 localStorage 備份。
    }
  }

  const raw = await webContents.executeJavaScript(
    `localStorage.getItem(${JSON.stringify(CONVERSATION_STORAGE_KEY)})`,
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
): Promise<GeminiConversationBinding | null> {
  const url = webContents.getURL();
  if (!isSafeGeminiConversationUrl(url)) return null;
  const binding: GeminiConversationBinding = { url, ...(promptVersion ? { promptVersion } : {}) };
  await persistGeminiConversationBinding(webContents, binding).catch(() => undefined);
  return binding;
}

async function findNamedGeminiConversation(
  webContents: WebContents,
  name: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = await webContents.executeJavaScript(`
      (function() {
        const desiredName = ${JSON.stringify(name)};
        const link = Array.from(document.querySelectorAll('a[href]')).find((node) => {
          const labels = [node.getAttribute('aria-label'), node.textContent]
            .filter(Boolean)
            .map((value) => String(value).replace(/\\s+/g, ' ').trim());
          return labels.some((label) => label === desiredName);
        });
        return link?.href || null;
      })();
    `, true).catch(() => null) as string | null;
    if (url && isSafeGeminiConversationUrl(url)) return url;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

let bgWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;

/**
 * 背景視窗：平常聊天時完全隱藏（show:false），只用來代替使用者操作 Gemini 網頁。
 * 與登入視窗共用同一個 persist:cyrene-gemini partition，登入狀態會同步。
 */
export async function getOrCreateBackgroundWindow(): Promise<BrowserWindow> {
  if (bgWindow && !bgWindow.isDestroyed()) {
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
  let remembered = await readGeminiConversationBinding(bgWindow.webContents);
  if (isSafeGeminiConversationUrl(SHARED_GEMINI_CONVERSATION_URL)) {
    remembered = {
      url: SHARED_GEMINI_CONVERSATION_URL,
      promptVersion: SHARED_GEMINI_PROMPT_VERSION,
    };
    await persistGeminiConversationBinding(bgWindow.webContents, remembered).catch(() => undefined);
  } else if (!remembered) {
    const namedUrl = await findNamedGeminiConversation(
      bgWindow.webContents,
      SHARED_GEMINI_CONVERSATION_NAME,
    );
    if (namedUrl) {
      remembered = { url: namedUrl, promptVersion: SHARED_GEMINI_PROMPT_VERSION };
      await persistGeminiConversationBinding(bgWindow.webContents, remembered).catch(() => undefined);
    }
  }
  if (remembered && bgWindow.webContents.getURL() !== remembered.url) {
    await bgWindow.loadURL(remembered.url);
  }
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
