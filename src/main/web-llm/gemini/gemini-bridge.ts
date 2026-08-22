import {
  getOrCreateBackgroundWindow,
  openGeminiLoginWindow,
  readGeminiConversationBinding,
  rememberGeminiConversation,
  SHARED_GEMINI_CONVERSATION_NAME,
  SHARED_GEMINI_PROMPT_VERSION,
  isSameGeminiConversation,
  GEMINI_NEW_CHAT_URL,
} from "./gemini-window";
import {
  detectPageState,
  sendMessage,
  pollLatestReply,
  clickStopGenerating,
  getLatestReplySnapshot,
  attachFiles,
  ensureConversationNamed,
  type GeminiFileAttachment,
} from "./gemini-dom-adapter";
import { hasGoogleLoginCookies } from "./gemini-session";
import {
  GeminiLoginRequiredError,
  GeminiCaptchaError,
  GeminiRateLimitError,
  GeminiNetworkError,
  GeminiDomChangedError,
  GeminiTimeoutError,
  makeGeminiCancelledError,
} from "./gemini-errors";

// Gemini DOM 已經在本機背景視窗中，輪詢不會增加外部 API 請求，成本只有一次
// executeJavaScript。但輪詢間隔就是「昔漣講話速度」的硬下限：通話端要等文字
// 湊到一個可朗讀的句子才發 TTS，抓字慢多少，她就晚開口多少。
//
// 所以分兩檔：
//   - 還沒抓到第一個字、或上一次輪詢真的抓到新字（正在串流）→ 120ms 貼著抓。
//   - 只是在等生成收尾的穩定計數 → 350ms 就夠，不必空轉。
const FAST_POLL_INTERVAL_MS = 120;
const IDLE_POLL_INTERVAL_MS = 350;
/** 首字最多貼著等這麼久；Gemini 若想很久就退回慢輪詢，別讓背景視窗一直被掃。 */
const FIRST_TOKEN_FAST_WINDOW_MS = 4_000;
/** 連續幾次「文字沒變化且不在產生中」才視為回覆完成，避免抓到還沒渲染完的中間狀態。
 * 這個判定固定走 IDLE 節奏，收尾的保守程度不受上面的加速影響。 */
const STABLE_TICKS_TO_FINISH = 2;
const DEFAULT_TIMEOUT_MS = 90_000;

/** 共用對話初始化後，只送最後一則使用者訊息，避免重複貼完整人設與歷史。 */
export function compactSharedConversationPrompt(promptText: string): string {
  const matches = [...promptText.matchAll(/(?:^|\n)夥伴:\s*/g)];
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return promptText;
  return promptText.slice(last.index + last[0].length).trim() || promptText;
}

export interface GeminiPromptOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  attachments?: GeminiFileAttachment[];
  /** 下游是不是還在消化上一批文字（通話裡＝TTS 還有段落沒合成完）。
   * 回 true 時就不必貼著抓字了——見 runGeminiPrompt 裡的輪詢節奏說明。 */
  isDownstreamBusy?: () => boolean;
  conversationKey?: string;
  conversationName?: string;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(makeGeminiCancelledError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeGeminiCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForGeminiPageState(
  webContents: Parameters<typeof detectPageState>[0],
  deadline: number,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<typeof detectPageState>>> {
  let state = await detectPageState(webContents);
  while (state === "unknown" && Date.now() < deadline) {
    await abortableDelay(250, signal);
    state = await detectPageState(webContents);
  }
  return state;
}

/** 供設定頁「登入狀態」與聊天前置檢查共用：綜合 cookie + DOM 兩層判斷。 */
export async function getGeminiLoginState(): Promise<{ isLoggedIn: boolean; state: "login" | "captcha" | "app" | "unknown" }> {
  const hasCookies = await hasGoogleLoginCookies();
  if (!hasCookies) return { isLoggedIn: false, state: "login" };

  try {
    const win = await getOrCreateBackgroundWindow();
    const state = await detectPageState(win.webContents);
    return { isLoggedIn: state === "app", state };
  } catch {
    // 背景視窗建立失敗，僅回報 cookie 層的判斷，避免整個狀態查詢卡死。
    return { isLoggedIn: hasCookies, state: "unknown" };
  }
}

/** 設定頁「測試連線」：只確認能不能進到 Gemini 聊天頁面，不會真的送出訊息、不消耗額度。 */
export async function testGeminiConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const { isLoggedIn, state } = await getGeminiLoginState();
    if (state === "captcha") {
      return { ok: false, message: "Gemini 網頁出現驗證（CAPTCHA），請重新登入並手動完成驗證。" };
    }
    if (!isLoggedIn) {
      return { ok: false, message: "尚未登入 Gemini，請先完成登入。" };
    }
    return { ok: true, message: "已登入，Gemini 背景模型可以正常使用。" };
  } catch (err) {
    return { ok: false, message: `連線測試失敗：${String(err)}` };
  }
}

/**
 * 開一個乾淨的對話，把人設 prompt 餵進去讀完，然後把她的回話丟掉。
 *
 * 為什麼要這樣做：人設有一萬多字，塞進第一輪等於讓使用者第一句話多等四秒
 * （實測 send 1220ms ＋ Gemini 讀 1591ms）。把它挪到「通話剛接通」——那時候
 * 使用者還在戴耳機、還沒開口，這段等待是免費的。之後每一輪只要送他講的話。
 *
 * 為什麼要等她回完才 return：Gemini 正在生成時收不了下一則訊息。不等的話
 * 使用者的第一句會被吞掉。回話內容一律丟棄。
 *
 * 每通電話都開新的，加上跨日輪替（isConversationBindingStale），對話就不會養胖
 * ——舊的那個被灌了好幾天，首字從 1.9 秒漲到 9 秒。
 */
export async function primeGeminiConversation(
  personaPrompt: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();

  const win = await getOrCreateBackgroundWindow();
  await win.loadURL(GEMINI_NEW_CHAT_URL);

  const state = await waitForGeminiPageState(win.webContents, Math.min(deadline, Date.now() + 12_000), options.signal);
  if (state !== "app") {
    console.warn(`[Gemini] 開場注入放棄：頁面狀態 ${state}`);
    return null;
  }

  const baseline = await getLatestReplySnapshot(win.webContents);
  const sendResult = await sendMessage(win.webContents, personaPrompt);
  if ("error" in sendResult) {
    console.warn("[Gemini] 開場注入送出失敗：", sendResult.error);
    return null;
  }

  // 等她讀完。內容不要，只要「生成結束」這個事實。
  let seen = "";
  let stableTicks = 0;
  let completed = false;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      await clickStopGenerating(win.webContents).catch(() => undefined);
      return null;
    }
    await abortableDelay(IDLE_POLL_INTERVAL_MS, options.signal).catch(() => undefined);
    const poll = await pollLatestReply(win.webContents, baseline);
    if (poll.error) continue;
    if (poll.quotaLimited) {
      console.warn("[Gemini] 開場注入遇到額度限制");
      return null;
    }
    if (poll.text && poll.text !== seen) {
      seen = poll.text;
      stableTicks = 0;
      continue;
    }
    if (seen && poll.hasNewResponse && !poll.isGenerating) {
      stableTicks += 1;
      if (stableTicks >= STABLE_TICKS_TO_FINISH) {
        completed = true;
        break;
      }
    }
  }

  if (!completed) {
    await clickStopGenerating(win.webContents).catch(() => undefined);
    console.warn(`[Gemini] 開場注入逾時 ${Date.now() - startedAt}ms，未建立對話綁定`);
    return null;
  }

  const url = win.webContents.getURL();
  await rememberGeminiConversation(win.webContents, SHARED_GEMINI_PROMPT_VERSION).catch(() => undefined);
  await ensureConversationNamed(win.webContents, SHARED_GEMINI_CONVERSATION_NAME).catch(() => undefined);
  console.log(
    `[Gemini] 開場注入完成 ${Date.now() - startedAt}ms`
    + ` | personaChars=${personaPrompt.length} 丟棄回話 ${seen.length} 字`,
  );
  return url;
}

/**
 * 昔漣聊天介面的核心橋接函式：把一段完整 prompt 送去背景 Gemini 網頁，
 * 等待生成完成後回傳完整文字；支援串流回呼、取消、逾時。
 * 絕不會無限期停住——要嘛 resolve 完整文字，要嘛在 timeoutMs 內以明確錯誤 reject。
 */
async function runGeminiPromptUnlocked(
  promptText: string,
  onChunk?: (delta: string) => void,
  options: GeminiPromptOptions = {}
): Promise<string> {
  const { signal } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  if (signal?.aborted) throw makeGeminiCancelledError();

  // 分段計時。實測整段「等 Gemini 吐第一個字」佔一輪通話等待的 74%（8985/12089ms），
  // 但那是黑盒——喚醒視窗、等 DOM、送訊息、輪詢，看不出是哪一步。攤開來。
  const promptStartedAt = Date.now();
  const marks: Array<[string, number]> = [];
  let lastMarkAt = promptStartedAt;
  const mark = (name: string): void => {
    const now = Date.now();
    marks.push([name, now - lastMarkAt]);
    lastMarkAt = now;
  };

  let win;
  try {
    win = await getOrCreateBackgroundWindow(options.conversationKey);
  } catch (err) {
    throw new GeminiNetworkError(`無法開啟 Gemini 背景視窗：${String(err)}`);
  }
  mark("window");

  // 重新載入已綁定的長對話時，loadURL 完成不代表 Gemini 的 composer 已經渲染好。
  // 等到 DOM 就緒再送出，避免 App 重開後第一句偶發誤判為介面改版。
  const state = await waitForGeminiPageState(win.webContents, Math.min(deadline, Date.now() + 12_000), signal);
  if (state === "login") {
    openGeminiLoginWindow();
    throw new GeminiLoginRequiredError();
  }
  if (state === "captcha") {
    openGeminiLoginWindow();
    throw new GeminiCaptchaError();
  }
  if (state === "unknown") {
    throw new GeminiDomChangedError();
  }
  mark("page_state");

  if (options.attachments?.length) {
    const attachmentResult = await attachFiles(win.webContents, options.attachments);
    if ("error" in attachmentResult) {
      throw new GeminiDomChangedError(attachmentResult.error);
    }
  }

  // 記住送出前的最後一則回覆，避免新一輪誤讀到上一輪的舊訊息。
  // 這兩次讀取互不相干，卻都卡在「使用者話講完、訊息還沒送出去」的空窗裡，
  // 串著跑等於白賠一趟 DOM 往返。
  const [baseline, binding] = await Promise.all([
    getLatestReplySnapshot(win.webContents),
    readGeminiConversationBinding(win.webContents, options.conversationKey),
  ]);
  mark("snapshot");
  const currentUrl = win.webContents.getURL();
  // 比對話 ID，不比整串網址——見 isSameGeminiConversation 的說明。
  const sharedConversationReady = isSameGeminiConversation(binding?.url, currentUrl)
    && binding?.promptVersion === SHARED_GEMINI_PROMPT_VERSION
    && baseline.count > 0;
  const outgoingPrompt = sharedConversationReady
    ? compactSharedConversationPrompt(promptText)
    : promptText;
  const sendResult = await sendMessage(win.webContents, outgoingPrompt);
  if ("error" in sendResult) {
    throw new GeminiDomChangedError(sendResult.error);
  }
  mark("send");
  const promptChars = outgoingPrompt.length;
  // reuse=no 代表整份人設（一萬多字）每輪重貼一次，send 和 Gemini 的閱讀時間都會
  // 被拉長。條件有三個，這裡把每個都印出來才知道是哪一個沒滿足：
  //   - URL 是否相符（Gemini 的 SPA 可能正規化網址）
  //   - 頁面上已渲染的回覆數（載入未完成時會是 0，那是競態）
  const reuseDetail = `url_match=${isSameGeminiConversation(binding?.url, currentUrl) ? "y" : "n"}`
    + ` replies=${baseline.count}`
    + ` ver=${binding?.promptVersion === SHARED_GEMINI_PROMPT_VERSION ? "y" : "n"}`;

  let accumulated = "";
  let stableTicks = 0;
  // 等首字期間的診斷。以前輪詢失敗只是 continue，連續失敗到 90 秒逾時為止都沒有
  // 任何訊息——畫面上「Gemini 在思考」和「我們的 DOM 讀取壞了」長得一模一樣。
  let pollErrors = 0;
  let lastHeartbeatAt = 0;
  let loggedFirstToken = false;
  const logFirstToken = (): void => {
    if (loggedFirstToken) return;
    loggedFirstToken = true;
    mark("wait_first");
    const detail = marks.map(([name, ms]) => `${name}=${ms}`).join(" ");
    console.log(
      `[Gemini] [Perf] 首字 total=${Date.now() - promptStartedAt}ms | ${detail}`
      + ` | promptChars=${promptChars} reuse=${sharedConversationReady ? "yes" : "no"} ${reuseDetail}`,
    );
  };
  /** 上一次輪詢有沒有真的抓到新字——有的話代表正在串流，值得貼著抓。 */
  let streaming = false;
  const sentAtMs = Date.now();

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await clickStopGenerating(win.webContents);
      throw makeGeminiCancelledError();
    }

    // 下游還有東西沒消化完時，抓字抓再快也沒有意義：下一段語音卡在合成，不是
    // 卡在取字。而貼著輪詢是對一個很重的網頁反覆跑 executeJavaScript，那份 CPU
    // 正好是本機 TTS 在搶的（實測：同一段文字，機器閒置 1.0s、負載滿時 6.0s）。
    // 所以這裡不是省電，是不要跟自己打架。
    const watchingForFirstToken = !accumulated && Date.now() - sentAtMs < FIRST_TOKEN_FAST_WINDOW_MS;
    const downstreamBusy = options.isDownstreamBusy?.() ?? false;
    const pollIntervalMs = (!downstreamBusy && (streaming || watchingForFirstToken))
      ? FAST_POLL_INTERVAL_MS
      : IDLE_POLL_INTERVAL_MS;

    try {
      await abortableDelay(pollIntervalMs, signal);
    } catch {
      await clickStopGenerating(win.webContents);
      throw makeGeminiCancelledError();
    }

    const poll = await pollLatestReply(win.webContents, baseline);
    if (poll.error) {
      // 單次輪詢失敗不代表整體失敗（可能正好在切換頁面渲染），繼續嘗試直到逾時。
      pollErrors += 1;
      if (pollErrors === 1 || pollErrors % 25 === 0) {
        console.warn(`[Gemini] 輪詢失敗 ×${pollErrors}: ${poll.error}`);
      }
      continue;
    }

    // 還沒抓到第一個字時，每 5 秒回報一次現場狀態。這三個值就足以分辨：
    //   isGenerating=true          → Gemini 真的在寫，只是慢
    //   兩者皆 false、pollErrors=0 → 訊息多半根本沒送進去
    //   pollErrors 一直漲          → 是我們的 DOM 讀取壞了，不是 Gemini
    if (!accumulated) {
      const waitedMs = Date.now() - sentAtMs;
      if (waitedMs - lastHeartbeatAt >= 5_000) {
        lastHeartbeatAt = waitedMs;
        console.log(
          `[Gemini] 等首字 ${(waitedMs / 1000).toFixed(1)}s`
          + ` | isGenerating=${poll.isGenerating} hasNewResponse=${poll.hasNewResponse}`
          + ` pollErrors=${pollErrors} textLen=${poll.text.length}`,
        );
      }
    }
    if (poll.quotaLimited) {
      throw new GeminiRateLimitError();
    }

    if (poll.text && poll.text !== accumulated) {
      // 這裡以前直接 `poll.text.slice(accumulated.length)`，等於假設每次抓到的
      // 文字一定是上一次的延長。Gemini 的 DOM 是邊產生邊重繪的，輪詢剛好落在
      // 重繪中途時這個假設就不成立，算出來的 delta 是從中間截斷的亂碼——它會
      // 一路流到 TTS 被唸出來（日誌裡抓到過「今天起happy]早安呀夥伴！」這種，
      // 半截 mood 標籤直接變成台詞）。
      if (poll.text.startsWith(accumulated)) {
        const delta = poll.text.slice(accumulated.length);
        accumulated = poll.text;
        if (delta) logFirstToken();
        if (delta && onChunk) onChunk(delta);
        stableTicks = 0;
        streaming = true;
      } else if (accumulated.startsWith(poll.text)) {
        // 重繪到一半，文字暫時變短。當作沒看到，等下一次輪詢。
        continue;
      } else {
        // 文字被改寫了。已經送出去的收不回來，但至少不要把對不上的那段當成新
        // 內容再吐一次——寧可這一小段沒唸到，也不要唸出亂碼。後續輪詢會從新的
        // 基準繼續接。
        console.warn("[Gemini] 輪詢到的回覆不是上一次的延長，重新對齊以免唸出亂碼");
        accumulated = poll.text;
        stableTicks = 0;
        streaming = true;
      }
    } else if (accumulated && poll.hasNewResponse && !poll.isGenerating) {
      // 收尾判定退回慢節奏：連續兩次都沒動靜才算講完，這裡不該被加速影響。
      streaming = false;
      stableTicks++;
      if (stableTicks >= STABLE_TICKS_TO_FINISH) {
        await (options.conversationKey
          ? rememberGeminiConversation(win.webContents, SHARED_GEMINI_PROMPT_VERSION, options.conversationKey)
          : rememberGeminiConversation(win.webContents, SHARED_GEMINI_PROMPT_VERSION));
        await ensureConversationNamed(
          win.webContents,
          options.conversationName ? `昔漣 · ${options.conversationName}` : SHARED_GEMINI_CONVERSATION_NAME,
        );
        return accumulated;
      }
    }
  }

  if (accumulated) {
    // 已經拿到部分內容但一直没稳定收尾，仍然把已经生成的內容視為結果，避免白白丟棄。
    await (options.conversationKey
      ? rememberGeminiConversation(win.webContents, SHARED_GEMINI_PROMPT_VERSION, options.conversationKey)
      : rememberGeminiConversation(win.webContents, SHARED_GEMINI_PROMPT_VERSION));
    await ensureConversationNamed(
      win.webContents,
      options.conversationName ? `昔漣 · ${options.conversationName}` : SHARED_GEMINI_CONVERSATION_NAME,
    );
    return accumulated;
  }
  console.warn(
    `[Gemini] 逾時：等了 ${Date.now() - promptStartedAt}ms 一個字都沒拿到`
    + ` | pollErrors=${pollErrors} promptChars=${promptChars} reuse=${sharedConversationReady ? "yes" : "no"}`,
  );
  throw new GeminiTimeoutError();
}

// Gemini 網頁只有一個隱藏 BrowserWindow。不同角色同時發話時必須排隊，否則其中
// 一個 Conversation 切換網址會讓另一個把訊息送錯角色的歷史。
let geminiPromptQueue: Promise<void> = Promise.resolve();

export function runGeminiPrompt(
  promptText: string,
  onChunk?: (delta: string) => void,
  options: GeminiPromptOptions = {},
): Promise<string> {
  const task = geminiPromptQueue.then(() => runGeminiPromptUnlocked(promptText, onChunk, options));
  geminiPromptQueue = task.then(() => undefined, () => undefined);
  return task;
}
