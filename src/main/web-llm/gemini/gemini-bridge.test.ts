import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectPageState: vi.fn(),
  sendMessage: vi.fn(),
  pollLatestReply: vi.fn(),
  clickStopGenerating: vi.fn(),
  getLatestReplySnapshot: vi.fn(),
  attachFiles: vi.fn(),
  ensureConversationNamed: vi.fn(),
  getOrCreateBackgroundWindow: vi.fn(),
  readGeminiConversationBinding: vi.fn(),
  rememberGeminiConversation: vi.fn(),
}));

vi.mock("./gemini-window", () => ({
  GEMINI_NEW_CHAT_URL: "https://gemini.google.com/u/2/app",
  getOrCreateBackgroundWindow: mocks.getOrCreateBackgroundWindow,
  openGeminiLoginWindow: vi.fn(),
  readGeminiConversationBinding: mocks.readGeminiConversationBinding,
  rememberGeminiConversation: mocks.rememberGeminiConversation,
  SHARED_GEMINI_CONVERSATION_NAME: "Cyrene-Agent",
  SHARED_GEMINI_PROMPT_VERSION: "cyrene-shared-v1",
  // 真的比對話 ID，不要 mock 成常數——否則「沿用對話」那條路等於沒被測到。
  isSameGeminiConversation: (a?: string, b?: string) => {
    const id = (u?: string) => {
      try {
        const parsed = new URL(u ?? "");
        const m = /^(?:\/u\/\d+)?\/app\/([^/?#]+)\/?$/.exec(parsed.pathname);
        return parsed.origin === "https://gemini.google.com" && m ? m[1] : null;
      } catch { return null; }
    };
    const idA = id(a);
    return idA !== null && idA === id(b);
  },
}));

vi.mock("./gemini-dom-adapter", () => ({
  detectPageState: mocks.detectPageState,
  sendMessage: mocks.sendMessage,
  pollLatestReply: mocks.pollLatestReply,
  clickStopGenerating: mocks.clickStopGenerating,
  getLatestReplySnapshot: mocks.getLatestReplySnapshot,
  attachFiles: mocks.attachFiles,
  ensureConversationNamed: mocks.ensureConversationNamed,
}));

vi.mock("./gemini-session", () => ({ hasGoogleLoginCookies: vi.fn() }));

describe("runGeminiPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.getOrCreateBackgroundWindow.mockResolvedValue({
      webContents: {
        getURL: () => "https://gemini.google.com/app/new-chat",
        loadURL: vi.fn().mockResolvedValue(undefined),
      },
    });
    mocks.detectPageState.mockResolvedValue("app");
    mocks.getLatestReplySnapshot.mockResolvedValue({ count: 4, lastText: "previous" });
    mocks.sendMessage.mockResolvedValue({ ok: true });
    mocks.clickStopGenerating.mockResolvedValue(undefined);
    mocks.attachFiles.mockResolvedValue({ ok: true });
    mocks.ensureConversationNamed.mockResolvedValue(true);
    mocks.readGeminiConversationBinding.mockResolvedValue(null);
    mocks.rememberGeminiConversation.mockResolvedValue({ url: "https://gemini.google.com/app/new-chat" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores the old reply and completes after the new reply stabilizes", async () => {
    mocks.pollLatestReply
      .mockResolvedValueOnce({ text: "WEB_OK", isGenerating: false, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValueOnce({ text: "WEB_OK", isGenerating: false, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValueOnce({ text: "WEB_OK", isGenerating: false, hasNewResponse: true, quotaLimited: false });
    const { runGeminiPrompt } = await import("./gemini-bridge");
    const chunks: string[] = [];
    const resultPromise = runGeminiPrompt("test", (delta) => chunks.push(delta));

    await vi.advanceTimersByTimeAsync(3_100);

    await expect(resultPromise).resolves.toBe("WEB_OK");
    expect(chunks).toEqual(["WEB_OK"]);
    expect(mocks.pollLatestReply).toHaveBeenCalledWith(
      expect.objectContaining({ getURL: expect.any(Function) }),
      { count: 4, lastText: "previous" },
    );
  });

  // 輪詢間隔就是通話裡「昔漣多久才開口」的硬下限：抓到字才餵得了斷句器和 TTS。
  it("polls fast enough to surface the first token well inside one idle tick", async () => {
    mocks.pollLatestReply
      .mockResolvedValueOnce({ text: "嗯", isGenerating: true, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValue({ text: "嗯", isGenerating: false, hasNewResponse: true, quotaLimited: false });
    const { runGeminiPrompt } = await import("./gemini-bridge");
    const chunks: string[] = [];
    const resultPromise = runGeminiPrompt("test", (delta) => chunks.push(delta));

    await vi.advanceTimersByTimeAsync(150);
    expect(chunks).toEqual(["嗯"]);

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(resultPromise).resolves.toBe("嗯");
  });

  // 貼著輪詢是對一個很重的網頁反覆跑 executeJavaScript，而那份 CPU 正好是本機
  // TTS 在搶的（實測：同一段文字，機器閒置 1.0s、負載滿時 6.0s）。下游還沒消化完
  // 時抓字抓再快也不會讓她早一秒開口，所以該退回慢節奏。
  it("stops polling fast while the downstream queue still has work", async () => {
    mocks.pollLatestReply
      .mockResolvedValueOnce({ text: "嗯", isGenerating: true, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValue({ text: "嗯", isGenerating: false, hasNewResponse: true, quotaLimited: false });

    const { runGeminiPrompt } = await import("./gemini-bridge");
    const chunks: string[] = [];
    const resultPromise = runGeminiPrompt("test", (delta) => chunks.push(delta), {
      isDownstreamBusy: () => true,
    });

    // 快輪詢是 120ms；下游忙的時候不該在這個時間點就抓到字。
    await vi.advanceTimersByTimeAsync(150);
    expect(chunks).toEqual([]);

    // 慢輪詢 350ms 才該抓到。
    await vi.advanceTimersByTimeAsync(250);
    expect(chunks).toEqual(["嗯"]);

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(resultPromise).resolves.toBe("嗯");
  });

  // Gemini 的 DOM 是邊產生邊重繪的。以前無條件把 `poll.text.slice(已收長度)`
  // 當成增量，輪詢落在重繪中途時就會切出從中間截斷的亂碼——那會一路流到 TTS
  // 被唸出來（正式環境的合成日誌裡抓到過「今天起happy]早安呀夥伴！」，半截
  // mood 標籤直接變成台詞）。
  it("never emits a delta when the polled text is not an extension of what we already have", async () => {
    mocks.pollLatestReply
      .mockResolvedValueOnce({ text: "今天起得挺早", isGenerating: true, hasNewResponse: true, quotaLimited: false })
      // 重繪後文字整個換了一批。舊寫法會 slice(6)，剛好切在 `[mood:` 中間，
      // 吐出 `happy]早安呀夥伴！` 當作增量。
      .mockResolvedValueOnce({ text: "[mood:happy]早安呀夥伴！", isGenerating: true, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValue({ text: "[mood:happy]早安呀夥伴！今天好嗎？", isGenerating: false, hasNewResponse: true, quotaLimited: false });

    const { runGeminiPrompt } = await import("./gemini-bridge");
    const chunks: string[] = [];
    const resultPromise = runGeminiPrompt("早安", (delta) => chunks.push(delta));
    await vi.advanceTimersByTimeAsync(3_100);
    await resultPromise;

    // 把完整標籤拿掉之後不該再剩下任何方括號碎片——那正是會被唸出來的東西。
    const debris = chunks.join("").replace(/\[(?:mood:[a-z]+|sticker:[a-zA-Z0-9_-]+)\]/gi, "");
    expect(debris).not.toMatch(/[[\]]/);
    expect(chunks.join("")).toBe("今天起得挺早今天好嗎？");
  });

  it("ignores a poll that came back shorter, instead of treating it as new text", async () => {
    mocks.pollLatestReply
      .mockResolvedValueOnce({ text: "早安呀夥伴！", isGenerating: true, hasNewResponse: true, quotaLimited: false })
      // 重繪到一半，文字暫時縮短。
      .mockResolvedValueOnce({ text: "早安", isGenerating: true, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValue({ text: "早安呀夥伴！今天好嗎？", isGenerating: false, hasNewResponse: true, quotaLimited: false });

    const { runGeminiPrompt } = await import("./gemini-bridge");
    const chunks: string[] = [];
    const resultPromise = runGeminiPrompt("早安", (delta) => chunks.push(delta));
    await vi.advanceTimersByTimeAsync(3_100);
    await resultPromise;

    expect(chunks.join("")).toBe("早安呀夥伴！今天好嗎？");
  });

  it("uploads image attachments before sending the prompt", async () => {
    mocks.pollLatestReply
      .mockResolvedValueOnce({ text: "看到了", isGenerating: false, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValueOnce({ text: "看到了", isGenerating: false, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValueOnce({ text: "看到了", isGenerating: false, hasNewResponse: true, quotaLimited: false });
    const { runGeminiPrompt } = await import("./gemini-bridge");
    const attachment = { name: "discord-image.png", mime: "image/png", dataUrl: "data:image/png;base64,aA==" };
    const resultPromise = runGeminiPrompt("這是什麼？", undefined, { attachments: [attachment] });
    await vi.advanceTimersByTimeAsync(3_100);

    await expect(resultPromise).resolves.toBe("看到了");
    expect(mocks.attachFiles).toHaveBeenCalledWith(
      expect.objectContaining({ getURL: expect.any(Function) }),
      [attachment],
    );
    expect((await mocks.getOrCreateBackgroundWindow.mock.results[0].value).webContents.loadURL)
      .not.toHaveBeenCalled();
    expect(mocks.attachFiles.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendMessage.mock.invocationCallOrder[0]);
  });

  it("reuses the bound Gemini conversation and sends only the newest user turn", async () => {
    mocks.readGeminiConversationBinding.mockResolvedValue({
      url: "https://gemini.google.com/app/new-chat",
      promptVersion: "cyrene-shared-v1",
    });
    mocks.pollLatestReply
      .mockResolvedValueOnce({ text: "還在呀", isGenerating: false, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValueOnce({ text: "還在呀", isGenerating: false, hasNewResponse: true, quotaLimited: false })
      .mockResolvedValueOnce({ text: "還在呀", isGenerating: false, hasNewResponse: true, quotaLimited: false });
    const { runGeminiPrompt } = await import("./gemini-bridge");
    const resultPromise = runGeminiPrompt(
      "[系統背景指示]\n完整昔漣人設\n\n夥伴: 上一輪\n昔漣: 上一輪回覆\n夥伴: 這一輪",
    );
    await vi.advanceTimersByTimeAsync(3_100);

    await expect(resultPromise).resolves.toBe("還在呀");
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ getURL: expect.any(Function) }),
      "這一輪",
    );
    expect(mocks.rememberGeminiConversation).toHaveBeenCalledWith(
      expect.anything(),
      "cyrene-shared-v1",
    );
    expect(mocks.ensureConversationNamed).toHaveBeenCalledWith(expect.anything(), "Cyrene-Agent");
  });
});

describe("primeGeminiConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.getOrCreateBackgroundWindow.mockResolvedValue({
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        getURL: () => "https://gemini.google.com/app/fresh-call",
      },
    });
    mocks.detectPageState.mockResolvedValue("app");
    mocks.getLatestReplySnapshot.mockResolvedValue({ count: 0, lastText: "" });
    mocks.sendMessage.mockResolvedValue({ ok: true });
    mocks.ensureConversationNamed.mockResolvedValue(true);
    mocks.rememberGeminiConversation.mockResolvedValue({ url: "https://gemini.google.com/app/fresh-call" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a fresh chat, waits for the persona reply, and discards it", async () => {
    mocks.pollLatestReply.mockResolvedValue({
      text: "我已讀完設定",
      isGenerating: false,
      hasNewResponse: true,
      quotaLimited: false,
    });
    const { primeGeminiConversation } = await import("./gemini-bridge");
    const promise = primeGeminiConversation("完整昔漣人設");
    await vi.advanceTimersByTimeAsync(1_200);

    await expect(promise).resolves.toBe("https://gemini.google.com/app/fresh-call");
    const win = await mocks.getOrCreateBackgroundWindow.mock.results[0].value;
    expect(win.loadURL).toHaveBeenCalledWith("https://gemini.google.com/u/2/app");
    expect(mocks.sendMessage).toHaveBeenCalledWith(win.webContents, "完整昔漣人設");
    expect(mocks.rememberGeminiConversation).toHaveBeenCalledWith(win.webContents, "cyrene-shared-v1");
  });

  it("does not bind an unfinished prompt when initialization times out", async () => {
    mocks.pollLatestReply.mockResolvedValue({
      text: "",
      isGenerating: true,
      hasNewResponse: false,
      quotaLimited: false,
    });
    const { primeGeminiConversation } = await import("./gemini-bridge");
    const promise = primeGeminiConversation("完整昔漣人設", { timeoutMs: 700 });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toBeNull();
    expect(mocks.rememberGeminiConversation).not.toHaveBeenCalled();
    expect(mocks.clickStopGenerating).toHaveBeenCalled();
  });
});
