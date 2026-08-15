import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../shared/ipc-channels";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  getAdapterForConfig: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => mocks.handlers.delete(channel)),
  },
}));

vi.mock("./orchestrator/vendors", () => ({
  getAdapterForConfig: mocks.getAdapterForConfig,
}));

function createEvent() {
  return {
    sender: { id: 17, isDestroyed: () => false, send: vi.fn() },
    senderFrame: { detached: false, send: vi.fn() },
  };
}

describe("exam IPC", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.getAdapterForConfig.mockReset();
  });

  it("generates a quiz through the web-model adapter without a chat session", async () => {
    const executeWebPrompt = vi.fn(async (_prompt, onChunk) => {
      onChunk?.("[{\"question\":");
      return "[{\"question\":\"Q\"}]";
    });
    mocks.getAdapterForConfig.mockReturnValue({ executeWebPrompt });
    const chatNonStream = vi.fn();
    const { registerExamIpc } = await import("./exam-ipc");
    registerExamIpc({
      loadModelSettings: () => ({
        provider: "gemini_web",
        baseUrl: "https://gemini.google.com",
        model: "gemini-web",
        apiKey: "",
      } as never),
      llmClient: { chatNonStream } as never,
    });

    const handler = mocks.handlers.get(IPC.EXAM_GENERATE);
    if (!handler) throw new Error("EXAM_GENERATE handler was not registered");
    const event = createEvent();
    const result = await handler(event, { prompt: "Build an English AP quiz" });

    expect(result).toEqual({ success: true, text: "[{\"question\":\"Q\"}]" });
    expect(executeWebPrompt).toHaveBeenCalledOnce();
    expect(chatNonStream).not.toHaveBeenCalled();
    expect(event.senderFrame.send).toHaveBeenCalledWith(
      IPC.EXAM_GENERATE_PROGRESS,
      expect.objectContaining({ phase: "complete" }),
    );
  });

  it("uses the configured API model when no web prompt adapter is present", async () => {
    mocks.getAdapterForConfig.mockReturnValue({});
    const chatNonStream = vi.fn(async () => ({
      text: "[{\"question\":\"API Q\"}]",
      finishReason: "stop",
    }));
    const { registerExamIpc } = await import("./exam-ipc");
    registerExamIpc({
      loadModelSettings: () => ({
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "test-model",
        apiKey: "test-key",
      } as never),
      llmClient: { chatNonStream } as never,
    });

    const handler = mocks.handlers.get(IPC.EXAM_GENERATE);
    if (!handler) throw new Error("EXAM_GENERATE handler was not registered");
    const result = await handler(createEvent(), { prompt: "Build a quiz" });

    expect(result).toEqual({ success: true, text: "[{\"question\":\"API Q\"}]" });
    expect(chatNonStream).toHaveBeenCalledOnce();
  });
});
