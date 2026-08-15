import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC } from "../shared/ipc-channels";
import type { ModelSettings } from "./settings/model-settings";
import type { LlmClient } from "./services/llm/llm-client";
import { getAdapterForConfig } from "./orchestrator/vendors";
import type { VendorConfig } from "./orchestrator/vendors";

interface ExamIpcDeps {
  loadModelSettings: () => ModelSettings;
  llmClient: LlmClient;
}

interface ExamGenerateInput {
  prompt?: string;
}

const activeRequests = new Map<number, AbortController>();

function emitProgress(event: IpcMainInvokeEvent, phase: string, chars: number): void {
  const payload = { phase, chars };
  const frame = event.senderFrame;
  if (frame && !frame.detached) {
    try {
      frame.send(IPC.EXAM_GENERATE_PROGRESS, payload);
      return;
    } catch {
      // The exam iframe may be navigating away while a request is finishing.
    }
  }
  if (!event.sender.isDestroyed()) {
    try { event.sender.send(IPC.EXAM_GENERATE_PROGRESS, payload); } catch { /* window closed */ }
  }
}

export function registerExamIpc(deps: ExamIpcDeps): () => void {
  ipcMain.removeHandler(IPC.EXAM_GENERATE);
  ipcMain.removeHandler(IPC.EXAM_CANCEL);

  ipcMain.handle(IPC.EXAM_GENERATE, async (event, rawInput: ExamGenerateInput) => {
    const prompt = rawInput?.prompt?.trim() ?? "";
    if (!prompt) return { success: false, error: "考試題目設定是空的，請重新選擇後再試。" };
    if (prompt.length > 30_000) return { success: false, error: "練習範圍內容太長，請縮短後再試。" };

    const senderId = event.sender.id;
    activeRequests.get(senderId)?.abort();
    const controller = new AbortController();
    activeRequests.set(senderId, controller);

    try {
      const settings = deps.loadModelSettings();
      if (!settings.baseUrl) throw new Error("尚未設定模型，請先到設定完成 Gemini 或 API 連線。");

      const config: VendorConfig = {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        explicitTransport: settings.explicitTransport,
        reasoning: settings.reasoning,
      };
      const adapter = getAdapterForConfig(config);
      let receivedChars = 0;
      const onChunk = (delta: string): void => {
        receivedChars += delta.length;
        emitProgress(event, "receiving", receivedChars);
      };

      console.log(`[ExamQuiz] generation started provider=${settings.provider} model=${settings.model}`);
      emitProgress(event, "requesting", 0);

      let text: string;
      if (adapter.executeWebPrompt) {
        text = await adapter.executeWebPrompt(prompt, onChunk, { signal: controller.signal });
      } else {
        const response = await deps.llmClient.chatNonStream(
          settings,
          [{ role: "user", content: prompt }],
          0.25,
          300_000,
          "EXAM_QUIZ",
          undefined,
          { maxTokens: 8_192 },
          controller.signal,
        );
        text = response.text;
      }

      if (!text.trim()) throw new Error("Gemini 沒有回傳題目，請再試一次。");
      emitProgress(event, "complete", text.length);
      console.log(`[ExamQuiz] generation completed chars=${text.length}`);
      return { success: true, text };
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = cancelled
        ? "已取消出題。"
        : error instanceof Error
          ? error.message
          : "出題時發生未知錯誤。";
      console.error(`[ExamQuiz] generation failed: ${message}`);
      return { success: false, error: message };
    } finally {
      if (activeRequests.get(senderId) === controller) activeRequests.delete(senderId);
    }
  });

  ipcMain.handle(IPC.EXAM_CANCEL, (event) => {
    const controller = activeRequests.get(event.sender.id);
    controller?.abort();
    return Boolean(controller);
  });

  return () => {
    for (const controller of activeRequests.values()) controller.abort();
    activeRequests.clear();
    ipcMain.removeHandler(IPC.EXAM_GENERATE);
    ipcMain.removeHandler(IPC.EXAM_CANCEL);
  };
}
