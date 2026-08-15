import type { WebContents } from "electron";
import { buildReplyPollScript, executePageScript } from "../dom-executor";

/**
 * 所有跟 Gemini 網頁 DOM 結構有關的邏輯集中在這個檔案。
 * Google 網頁改版時，理論上只需要更新這裡的選擇器／腳本，不用動 gemini-bridge 或其他程式。
 *
 * 每個函式都對應「讀懂教學文件」10 種必要狀態裡的一部分：
 * detectPageState → 登入態 / CAPTCHA
 * sendMessage     → 輸入訊息、送出訊息
 * pollLatestReply → 等待新回覆、判斷回覆完成、只擷取本輪最新回覆、額度限制
 */

export type GeminiPageState = "login" | "captcha" | "app" | "unknown";

export interface GeminiPollResult {
  text: string;
  isGenerating: boolean;
  quotaLimited: boolean;
  hasNewResponse: boolean;
  error?: string;
}

export interface GeminiReplySnapshot {
  count: number;
  lastText: string;
}

export interface GeminiFileAttachment {
  name: string;
  mime: string;
  dataUrl: string;
}

/** 移除 Gemini 回覆節點為螢幕閱讀器附加的說話者標籤。 */
export function stripGeminiAccessibilityPrefix(text: string): string {
  return text
    .replace(/^\s*(?:Google\s+)?Gemini\s+(?:said|says)\s*[:：]?\s*/i, "")
    .replace(/^\s*Gemini\s*(?:說|表示)\s*[:：]?\s*/i, "")
    .trim();
}

const COMPOSER_SELECTOR = [
  'rich-textarea div[contenteditable="true"]',
  '.ql-editor[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
  '[data-test-id="text-input"] [contenteditable="true"]',
].join(", ");

const RESPONSE_SELECTOR = [
  "message-content",
  "model-response",
  '[data-message-author-role="model"]',
  '[data-message-author-role="assistant"]',
  '[data-test-id="model-response"]',
  ".model-response-text",
  ".response-container-content",
].join(", ");

const STOP_SELECTOR = [
  'button[data-test-id="stop-button"]',
  'button[aria-label*="Stop" i]',
  'button[aria-label*="停止" i]',
  'button[aria-label*="中止" i]',
].join(", ");

function pageHelpers(): string {
  return `
    const composerSelector = ${JSON.stringify(COMPOSER_SELECTOR)};
    const responseSelector = ${JSON.stringify(RESPONSE_SELECTOR)};
    const stopSelector = ${JSON.stringify(STOP_SELECTOR)};
    const cleanResponseText = (text) => String(text || '')
      .replace(/^\\s*(?:Google\\s+)?Gemini\\s+(?:said|says)\\s*[:：]?\\s*/i, '')
      .replace(/^\\s*Gemini\\s*(?:說|表示)\\s*[:：]?\\s*/i, '')
      .trim();
    const responseElements = () => {
      const all = Array.from(document.querySelectorAll(responseSelector));
      return all.filter((element) => !all.some((other) => other !== element && other.contains(element)));
    };
    const responseSnapshot = () => {
      const elements = responseElements();
      const last = elements[elements.length - 1];
      return { count: elements.length, lastText: cleanResponseText(last?.innerText || last?.textContent || '') };
    };
    // Gemini 新版回覆卡片會常駐 sparkle/loading/progress 裝飾；真正生成中時則一定會
    // 顯示停止按鈕。只採用停止按鈕，避免完成後仍被誤判成 loading 而等到逾時。
    const isGeneratingNow = () => !!document.querySelector(stopSelector);
  `;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 將目前 Gemini 對話重新命名；介面改版時失敗也不影響聊天本身。 */
export async function ensureConversationNamed(
  webContents: WebContents,
  name: string,
): Promise<boolean> {
  const result = await executePageScript<boolean>(
    webContents,
    `
    (async function() {
      const desiredName = ${JSON.stringify(name)};
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const labelOf = (node) => [
        node?.getAttribute?.('aria-label'),
        node?.getAttribute?.('data-tooltip'),
        node?.getAttribute?.('title'),
        node?.textContent,
      ].filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim();

      if ((document.title || '').includes(desiredName)) return true;

      const currentPath = location.pathname.replace(/\\/$/, '');
      const currentLink = Array.from(document.querySelectorAll('a[href]')).find((link) => {
        try { return new URL(link.href, location.href).pathname.replace(/\\/$/, '') === currentPath; }
        catch { return false; }
      });
      const currentLabel = labelOf(currentLink);
      const scope = currentLink?.closest('li, [role="listitem"], [data-test-id*="conversation"], .conversation')
        || currentLink?.parentElement?.parentElement;
      const menuPattern = /more|options|menu|更多|選項|选项/i;
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const conversationMenuPattern = /more options for|open menu for conversation actions|對話.*更多|更多.*對話/i;
      const menuButton = allButtons.find((node) => {
        const label = labelOf(node);
        return conversationMenuPattern.test(label) && (!currentLabel || label.includes(currentLabel));
      }) || Array.from((scope || document).querySelectorAll('button, [role="button"]'))
        .find((node) => menuPattern.test(labelOf(node)));
      if (!menuButton) return false;
      menuButton.click();
      await pause(350);

      const renamePattern = /rename|重新命名|重命名/i;
      const renameItem = Array.from(document.querySelectorAll('button, [role="menuitem"], [role="option"]'))
        .find((node) => renamePattern.test(labelOf(node)));
      if (!renameItem) return false;
      renameItem.click();
      await pause(300);

      const dialog = document.querySelector('[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container');
      const input = dialog?.querySelector('input, textarea') || document.querySelector('input[aria-label*="rename" i]');
      if (!input) return false;
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(input, desiredName);
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      const savePattern = /save|done|rename|儲存|保存|完成|重新命名|重命名/i;
      const saveButton = Array.from((dialog || document).querySelectorAll('button, [role="button"]'))
        .find((node) => savePattern.test(labelOf(node)) && !node.disabled);
      if (!saveButton) return false;
      saveButton.click();
      await pause(350);
      return true;
    })();
  `,
  ).catch(() => false);
  return result === true;
}

/**
 * 把記憶體中的圖片轉成瀏覽器 File，交給 Gemini 自己的上傳事件處理。
 * 選擇器與點擊流程都留在 DOM adapter，Gemini 改版時只需維護這一處。
 */
export async function attachFiles(
  webContents: WebContents,
  attachments: GeminiFileAttachment[],
): Promise<{ ok: true } | { error: string }> {
  if (attachments.length === 0) return { ok: true };

  const files = attachments.slice(0, 4).map((attachment) => {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(attachment.dataUrl);
    return match
      ? { name: attachment.name, mime: attachment.mime || match[1], base64: match[2] }
      : null;
  });
  if (files.some((file) => !file)) return { error: "圖片附件格式無效" };

  // Gemini 可能先顯示「＋」按鈕，點開後才建立隱藏的 file input；最多走兩層選單。
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await executePageScript<{ ready?: boolean; clicked?: boolean }>(
      webContents,
      `
      (function() {
        const input = document.querySelector('input[type="file"]');
        if (input) return { ready: true };

        const nodes = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"]'));
        const labels = (node) => [
          node.getAttribute('aria-label'),
          node.getAttribute('data-tooltip'),
          node.getAttribute('title'),
          node.textContent,
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        const patterns = [
          /upload files?/i,
          /add files?/i,
          /open (?:the )?(?:upload|add) (?:file )?menu/i,
          /上傳檔案|上传文件|新增檔案|添加文件|附加檔案|附件/,
        ];
        const target = nodes.find((node) => patterns.some((pattern) => pattern.test(labels(node))));
        if (!target) return {};
        target.click();
        return { clicked: true };
      })();
    `,
    ).catch((): { ready?: boolean; clicked?: boolean } => ({}));
    if (state.ready) break;
    await wait(state.clicked ? 450 : 250);
  }

  const injected = await executePageScript<{ ok?: boolean; count?: number; error?: string }>(
    webContents,
    `
    (function() {
      const input = document.querySelector('input[type="file"]');
      if (!input) return { error: "找不到 Gemini 的圖片上傳入口，網頁介面可能已變更" };
      try {
        const payloads = ${JSON.stringify(files)};
        const transfer = new DataTransfer();
        for (const payload of payloads) {
          const binary = atob(payload.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          transfer.items.add(new File([bytes], payload.name, { type: payload.mime }));
        }
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { ok: true, count: transfer.files.length };
      } catch (error) {
        return { error: String(error) };
      }
    })();
  `,
  ).catch((error): { ok?: boolean; count?: number; error?: string } => ({ error: String(error) }));

  if (!injected.ok || injected.count !== files.length) {
    return { error: injected.error || "Gemini 沒有接受圖片附件" };
  }

  // 等 Gemini 建立附件預覽並完成前處理；上傳中的 spinner 消失後才允許送出 prompt。
  await wait(900);
  for (let attempt = 0; attempt < 12; attempt++) {
    const uploadState = await executePageScript<{ failed: boolean; busy: boolean }>(
      webContents,
      `
      (function() {
        const bodyText = document.body?.innerText || '';
        const failed = /upload failed|could(?:n't| not) upload|上傳失敗|上传失败/i.test(bodyText);
        const busy = !!document.querySelector(
          '[aria-label*="uploading" i], [data-test-id*="upload-progress" i], mat-progress-spinner, [role="progressbar"]'
        );
        return { failed, busy };
      })();
    `,
    ).catch(() => ({ failed: false, busy: false }));
    if (uploadState.failed) return { error: "Gemini 圖片上傳失敗" };
    if (!uploadState.busy) return { ok: true };
    await wait(300);
  }
  return { error: "Gemini 圖片上傳逾時" };
}

/** 判斷目前頁面狀態：需要登入／CAPTCHA／正常進入聊天頁。 */
export async function detectPageState(webContents: WebContents): Promise<GeminiPageState> {
  const url = webContents.getURL();
  if (url.includes("accounts.google.com")) return "login";
  if (/\/sorry\/|recaptcha/i.test(url)) return "captcha";

  const script = `
    (function() {
      const hasCaptcha = !!document.querySelector('iframe[src*="recaptcha"], div.g-recaptcha, #captcha-form');
      if (hasCaptcha) return "captcha";
      const hasComposer = !!document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
      if (hasComposer) return "app";
      return "unknown";
    })();
  `;
  try {
    const state = await executePageScript<GeminiPageState>(webContents, script);
    return state ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** 在輸入框打字並送出訊息。prompt 以 JSON 字串安全帶入，避免任何注入問題。 */
export async function sendMessage(
  webContents: WebContents,
  promptText: string,
): Promise<{ ok: true } | { error: string }> {
  const script = `
    (function() {
      const inputEl = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
      if (!inputEl) return { error: "找不到 Gemini 輸入欄，介面可能已變更" };

      inputEl.focus();
      const prompt = ${JSON.stringify(promptText)};
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection?.removeAllRanges();
      selection?.addRange(range);
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, prompt); } catch {}
      if (!inserted || !(inputEl.textContent || '').trim()) inputEl.textContent = prompt;
      try {
        inputEl.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: prompt,
          inputType: 'insertText',
        }));
      } catch {
        inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      return { __pending: true };
    })();
  `;
  try {
    const res = await executePageScript<{ __pending?: true; error?: string }>(webContents, script);
    if (res?.error) return { error: res.error };
  } catch (err) {
    return { error: `輸入訊息失敗：${String(err)}` };
  }

  // 送出按鈕通常要等輸入框內容變化後才會從 disabled 變成可點擊，稍等一輪再找按鈕。
  await new Promise((r) => setTimeout(r, 500));

  const sendScript = `
    (function() {
      const sendBtn =
        document.querySelector('button[data-test-id="send-button"]:not([disabled])') ||
        document.querySelector('button.send-button:not([disabled])') ||
        document.querySelector('button[aria-label*="Send" i]:not([disabled])') ||
        document.querySelector('button[aria-label*="傳送" i]:not([disabled])') ||
        document.querySelector('button[aria-label*="送出" i]:not([disabled])') ||
        Array.from(document.querySelectorAll('button:not([disabled])')).find((button) =>
          /^(send|傳送|送出)$/i.test((button.textContent || '').trim()) ||
          /send|傳送|送出/i.test(button.querySelector('mat-icon')?.textContent || '')
        );
      if (!sendBtn) return { ok: false };
      sendBtn.click();
      return { ok: true };
    })();
  `;
  try {
    const res = await executePageScript<{ ok?: true; error?: string }>(webContents, sendScript);
    if (res?.error) return { error: res.error };
    if (!res?.ok) {
      // Gemini 有時只在 contenteditable 聚焦時接受真正的鍵盤 Enter。
      webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
      webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
    }
  } catch (err) {
    return { error: `送出訊息失敗：${String(err)}` };
  }

  // 不再把「點過按鈕」當成功；確認 composer 清空、開始生成或新增回覆其一發生。
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, 250));
    const verified = await executePageScript<boolean>(
      webContents,
      `
      (function() {
        ${pageHelpers()}
        const composer = document.querySelector(composerSelector);
        const composerText = (composer?.innerText || composer?.textContent || '').trim();
        return !composerText || isGeneratingNow();
      })();
    `,
    ).catch(() => false);
    if (verified) return { ok: true };
  }
  return { error: "Gemini 沒有接受送出的訊息，請重新載入登入頁後再試。" };
}

const QUOTA_PATTERNS = [
  "reached your limit",
  "已達.*上限",
  "已达.*上限",
  "usage limit",
  "try again later",
];

/** 輪詢目前最新一則回覆；只取「本輪」最後一則 assistant 訊息的完整文字。 */
export async function getLatestReplySnapshot(
  webContents: WebContents,
): Promise<GeminiReplySnapshot> {
  const script = `
    (function() {
      ${pageHelpers()}
      return responseSnapshot();
    })();
  `;
  try {
    const snapshot = await executePageScript<GeminiReplySnapshot>(webContents, script);
    return snapshot
      ? { ...snapshot, lastText: stripGeminiAccessibilityPrefix(snapshot.lastText) }
      : { count: 0, lastText: "" };
  } catch {
    return { count: 0, lastText: "" };
  }
}

export async function pollLatestReply(
  webContents: WebContents,
  baseline: GeminiReplySnapshot = { count: 0, lastText: "" },
): Promise<GeminiPollResult> {
  const script = buildReplyPollScript({
    pageHelpers: pageHelpers(),
    baseline,
    isGeneratingExpression: "isGeneratingNow()",
    additionalFields: "quotaLimited: false,",
  });
  try {
    const raw = await executePageScript<GeminiPollResult>(webContents, script);
    const res = raw ? { ...raw, text: stripGeminiAccessibilityPrefix(raw.text) } : raw;
    if (!res)
      return {
        text: "",
        isGenerating: false,
        hasNewResponse: false,
        quotaLimited: false,
        error: "輪詢無回應",
      };
    const lower = res.text.toLowerCase();
    const quotaLimited = QUOTA_PATTERNS.some(
      (p) => new RegExp(p, "i").test(lower) || new RegExp(p, "i").test(res.text),
    );
    return { ...res, quotaLimited };
  } catch (err) {
    return {
      text: "",
      isGenerating: false,
      hasNewResponse: false,
      quotaLimited: false,
      error: String(err),
    };
  }
}

/** 點擊 Gemini 頁面上的「停止產生」按鈕（若存在），用於使用者主動取消。 */
export async function clickStopGenerating(webContents: WebContents): Promise<void> {
  const script = `
    (function() {
      const stopBtn = document.querySelector(${JSON.stringify(STOP_SELECTOR)});
      if (stopBtn) stopBtn.click();
    })();
  `;
  try {
    await executePageScript(webContents, script);
  } catch {
    // 找不到就算了，取消本來就是 best-effort。
  }
}
