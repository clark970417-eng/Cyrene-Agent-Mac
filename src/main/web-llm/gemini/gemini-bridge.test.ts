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
  getOrCreateBackgroundWindow: mocks.getOrCreateBackgroundWindow,
  openGeminiLoginWindow: vi.fn(),
  readGeminiConversationBinding: mocks.readGeminiConversationBinding,
  rememberGeminiConversation: mocks.rememberGeminiConversation,
  SHARED_GEMINI_CONVERSATION_NAME: "Cyrene-Agent",
  SHARED_GEMINI_PROMPT_VERSION: "cyrene-shared-v1",
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
