import type { WebContents } from "electron";
import { buildReplyPollScript, executePageScript } from "./dom-executor";

export interface ChatGptReplySnapshot {
  count: number;
  lastText: string;
}

export interface ChatGptPollResult {
  text: string;
  isGenerating: boolean;
  hasNewResponse: boolean;
  error?: string;
}

const COMPOSER_SELECTOR = "#prompt-textarea, textarea";
const RESPONSE_SELECTOR = '[data-message-author-role="assistant"]';
const SEND_SELECTOR = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="傳送" i]',
  'button[aria-label*="送出" i]',
].join(", ");
const STOP_SELECTOR = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop" i]',
  'button[aria-label*="停止" i]',
].join(", ");

function pageHelpers(): string {
  return `
    const responseSelector = ${JSON.stringify(RESPONSE_SELECTOR)};
    const stopSelector = ${JSON.stringify(STOP_SELECTOR)};
    const responseSnapshot = () => {
      const elements = Array.from(document.querySelectorAll(responseSelector));
      const last = elements[elements.length - 1];
      return {
        count: elements.length,
        lastText: (last?.innerText || last?.textContent || '').trim(),
      };
    };
  `;
}

export async function getChatGptReplySnapshot(
  webContents: WebContents,
): Promise<ChatGptReplySnapshot> {
  try {
    return await executePageScript<ChatGptReplySnapshot>(
      webContents,
      `
      (function() {
        ${pageHelpers()}
        return responseSnapshot();
      })();
    `,
    );
  } catch {
    return { count: 0, lastText: "" };
  }
}

export async function sendChatGptMessage(
  webContents: WebContents,
  prompt: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const result = await executePageScript<{ ok?: true; error?: string }>(
      webContents,
      `
      (async function() {
        const input = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
        if (!input) return { error: '找不到 ChatGPT 輸入框，網頁介面可能已變更' };

        const prompt = ${JSON.stringify(prompt)};
        input.focus();
        if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
          const prototype = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          setter?.call(input, prompt);
        } else {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(input);
          selection?.removeAllRanges();
          selection?.addRange(range);
          let inserted = false;
          try { inserted = document.execCommand('insertText', false, prompt); } catch {}
          if (!inserted || !(input.textContent || '').trim()) input.textContent = prompt;
        }
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: prompt,
          inputType: 'insertText',
        }));

        await new Promise((resolve) => setTimeout(resolve, 300));
        const sendButton = document.querySelector(${JSON.stringify(SEND_SELECTOR)});
        if (!sendButton || sendButton.disabled) return { error: '找不到可用的 ChatGPT 發送按鈕' };
        sendButton.click();
        return { ok: true };
      })();
    `,
    );
    return result?.ok ? { ok: true } : { error: result?.error || "ChatGPT 沒有接受訊息" };
  } catch (error) {
    return { error: `輸入或送出訊息失敗：${String(error)}` };
  }
}

export async function pollChatGptReply(
  webContents: WebContents,
  baseline: ChatGptReplySnapshot,
): Promise<ChatGptPollResult> {
  try {
    return await executePageScript<ChatGptPollResult>(
      webContents,
      buildReplyPollScript({
        pageHelpers: pageHelpers(),
        baseline,
        isGeneratingExpression: "!!document.querySelector(stopSelector)",
      }),
    );
  } catch (error) {
    return { text: "", isGenerating: false, hasNewResponse: false, error: String(error) };
  }
}

export async function stopChatGptGeneration(webContents: WebContents): Promise<void> {
  await executePageScript(
    webContents,
    `
    (function() {
      document.querySelector(${JSON.stringify(STOP_SELECTOR)})?.click();
    })();
  `,
  ).catch(() => undefined);
}
