import { describe, expect, it, vi } from "vitest";
import {
  attachFiles,
  ensureConversationNamed,
  getLatestReplySnapshot,
  pollLatestReply,
  sendMessage,
  stripGeminiAccessibilityPrefix,
} from "./gemini-dom-adapter";

describe("gemini-dom-adapter", () => {
  it("removes Gemini's accessibility speaker label without changing the reply", () => {
    expect(stripGeminiAccessibilityPrefix("Gemini said\n\nCHAT_MODE_OK")).toBe("CHAT_MODE_OK");
    expect(stripGeminiAccessibilityPrefix("Google Gemini says: hello")).toBe("hello");
    expect(stripGeminiAccessibilityPrefix("昔漣一直都在喔。")) .toBe("昔漣一直都在喔。");
  });

  it("falls back to a real Enter key and verifies that Gemini accepted the prompt", async () => {
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ __pending: true })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const sendInputEvent = vi.fn();
    const webContents = { executeJavaScript, sendInputEvent } as any;

    await expect(sendMessage(webContents, "hello")).resolves.toEqual({ ok: true });
    expect(sendInputEvent).toHaveBeenCalledWith({ type: "keyDown", keyCode: "ENTER" });
    expect(sendInputEvent).toHaveBeenCalledWith({ type: "keyUp", keyCode: "ENTER" });
  });

  it("keeps a pre-send snapshot and forwards it when polling", async () => {
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ count: 3, lastText: "old reply" })
      .mockResolvedValueOnce({
        text: "new reply",
        isGenerating: false,
        hasNewResponse: true,
        quotaLimited: false,
      });
    const webContents = { executeJavaScript } as any;

    const baseline = await getLatestReplySnapshot(webContents);
    const result = await pollLatestReply(webContents, baseline);

    expect(baseline).toEqual({ count: 3, lastText: "old reply" });
    expect(result).toMatchObject({ text: "new reply", hasNewResponse: true });
    expect(executeJavaScript.mock.calls[1][0]).toContain('"lastText":"old reply"');
    expect(executeJavaScript.mock.calls[1][0]).not.toContain(".loading-indicator, .sparkle-container");
  });

  it("targets Gemini's conversation-specific options button when renaming", async () => {
    const executeJavaScript = vi.fn().mockResolvedValue(true);
    const webContents = { executeJavaScript } as any;

    await expect(ensureConversationNamed(webContents, "Cyrene-Agent")).resolves.toBe(true);
    const script = executeJavaScript.mock.calls[0][0] as string;
    expect(script).toContain("more options for");
    expect(script).toContain("Cyrene-Agent");
  });

  it("injects image data as browser Files through Gemini's native upload input", async () => {
    vi.useFakeTimers();
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ ready: true })
      .mockResolvedValueOnce({ ok: true, count: 1 })
      .mockResolvedValueOnce({ failed: false, busy: false });
    const webContents = { executeJavaScript } as any;

    const resultPromise = attachFiles(webContents, [{
      name: "discord-image-1.png",
      mime: "image/png",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    }]);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).resolves.toEqual({ ok: true });
    expect(executeJavaScript.mock.calls[1][0]).toContain("new File");
    expect(executeJavaScript.mock.calls[1][0]).toContain("discord-image-1.png");
    vi.useRealTimers();
  });
});
