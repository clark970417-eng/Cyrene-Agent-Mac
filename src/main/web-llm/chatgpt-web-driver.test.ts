import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  sendMessage: vi.fn(),
  pollReply: vi.fn(),
  stopGeneration: vi.fn(),
  openLogin: vi.fn(),
  webContents: {
    getURL: vi.fn(() => "https://chatgpt.com/"),
    loadURL: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    webContents = mocks.webContents;
    isDestroyed = () => false;
    loadURL = vi.fn(async () => undefined);
  },
}));

vi.mock("./web-llm-manager", () => ({
  openWebLlmLoginWindow: mocks.openLogin,
}));

vi.mock("./chatgpt-dom-adapter", () => ({
  getChatGptReplySnapshot: mocks.getSnapshot,
  sendChatGptMessage: mocks.sendMessage,
  pollChatGptReply: mocks.pollReply,
  stopChatGptGeneration: mocks.stopGeneration,
}));

describe("runChatGPTWebPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.webContents.getURL.mockReturnValue("https://chatgpt.com/");
    mocks.getSnapshot.mockResolvedValue({ count: 2, lastText: "old reply" });
    mocks.sendMessage.mockResolvedValue({ ok: true });
    mocks.stopGeneration.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores the previous reply and streams only the new response", async () => {
    mocks.pollReply
      .mockResolvedValueOnce({ text: "", isGenerating: false, hasNewResponse: false })
      .mockResolvedValueOnce({ text: "new", isGenerating: true, hasNewResponse: true })
      .mockResolvedValueOnce({ text: "new reply", isGenerating: false, hasNewResponse: true })
      .mockResolvedValueOnce({ text: "new reply", isGenerating: false, hasNewResponse: true })
      .mockResolvedValueOnce({ text: "new reply", isGenerating: false, hasNewResponse: true });

    const { runChatGPTWebPrompt } = await import("./chatgpt-web-driver");
    const chunks: string[] = [];
    const resultPromise = runChatGPTWebPrompt("hello", (chunk) => chunks.push(chunk));
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(resultPromise).resolves.toBe("new reply");
    expect(chunks).toEqual(["new", " reply"]);
    expect(mocks.pollReply).toHaveBeenCalledWith(
      mocks.webContents,
      { count: 2, lastText: "old reply" },
    );
  });

  it("stops generation when the caller aborts", async () => {
    mocks.pollReply.mockResolvedValue({ text: "partial", isGenerating: true, hasNewResponse: true });
    const controller = new AbortController();
    const { runChatGPTWebPrompt } = await import("./chatgpt-web-driver");
    const resultPromise = runChatGPTWebPrompt("hello", undefined, { signal: controller.signal });
    const rejection = expect(resultPromise).rejects.toThrow("已取消");
    await vi.advanceTimersByTimeAsync(350);
    controller.abort();
    await vi.advanceTimersByTimeAsync(350);

    await rejection;
    expect(mocks.stopGeneration).toHaveBeenCalledWith(mocks.webContents);
  });
});
