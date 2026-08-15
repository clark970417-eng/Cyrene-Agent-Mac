import { BrowserWindow } from "electron";
import { openWebLlmLoginWindow } from "./web-llm-manager";
import {
  getChatGptReplySnapshot,
  pollChatGptReply,
  sendChatGptMessage,
  stopChatGptGeneration,
} from "./chatgpt-dom-adapter";

const DEFAULT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 350;
const STABLE_TICKS_TO_FINISH = 2;

export interface ChatGptPromptOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

let bgWindow: BrowserWindow | null = null;

async function getOrCreateBgWindow(url: string): Promise<BrowserWindow> {
  if (bgWindow && !bgWindow.isDestroyed()) {
    return bgWindow;
  }

  bgWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // 背景隱藏執行
    webPreferences: {
      partition: "persist:web-llm",
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  await bgWindow.loadURL(url);
  return bgWindow;
}

export async function runChatGPTWebPrompt(
  prompt: string,
  onChunk?: (text: string) => void,
  options: ChatGptPromptOptions = {},
): Promise<string> {
  const win = await getOrCreateBgWindow("https://chatgpt.com");
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // 檢查是否處於未登入介面
  const isLoginPage = win.webContents.getURL().includes("/auth/login");
  if (isLoginPage) {
    await openWebLlmLoginWindow("chatgpt_web");
    throw new Error("請先在彈出的登入視窗完成 ChatGPT Plus 帳號登入！");
  }

  if (options.signal?.aborted) throw new Error("ChatGPT Web 生成已取消");
  const baseline = await getChatGptReplySnapshot(win.webContents);
  const sendResult = await sendChatGptMessage(win.webContents, prompt);
  if ("error" in sendResult) {
    throw new Error(`ChatGPT Web 驅動失敗: ${sendResult.error}`);
  }

  let accumulated = "";
  let stableTicks = 0;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      await stopChatGptGeneration(win.webContents);
      throw new Error("ChatGPT Web 生成已取消");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const poll = await pollChatGptReply(win.webContents, baseline);
    if (poll.error) continue;

    if (poll.text && poll.text !== accumulated) {
      const delta = poll.text.startsWith(accumulated) ? poll.text.slice(accumulated.length) : poll.text;
      accumulated = poll.text;
      if (onChunk && delta) onChunk(delta);
      stableTicks = 0;
    } else if (accumulated && poll.hasNewResponse && !poll.isGenerating) {
      stableTicks++;
      if (stableTicks >= STABLE_TICKS_TO_FINISH) return accumulated;
    }
  }

  if (!accumulated) {
    throw new Error("ChatGPT Web 生成超時或尚未登入，請確認登入狀態！");
  }

  return accumulated;
}
