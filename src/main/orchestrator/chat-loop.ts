import { stripLeakedChatTimeContext } from "../chat-time-context";
import { ChatTimeStreamPrefixFilter } from "../chat-time-stream-filter";
import { recordUsage } from "../token-usage-store";
import { AgentRuntimeError } from "./agent-runtime-error";
import type {
  AgentLoopSettings,
  TwoPhaseEvent,
  TwoPhaseFcResult,
} from "./two-phase-fc-loop";
import type {
  ChatMessage,
  ChatRequest,
  ChatVendorAdapter,
  ChatResponse,
  VendorConfig,
} from "./vendors/types";
import { createSseReader } from "./vendors";
import type { ApprovedStyleSampling } from "./vendors/style-sampling";
import { getTimeoutSettings } from "../timeout-manager";
import { compressConversation } from "./context-manager";

export interface ChatLoopOptions {
  settings: AgentLoopSettings;
  adapter: ChatVendorAdapter;
  messages: ChatMessage[];
  soulSystemBaseContent: string;
  soulSampling?: ApprovedStyleSampling;
  timeoutMs: number;
  imageCaptionFallback?: () => Promise<ChatMessage[]>;
  onEvent?: (event: TwoPhaseEvent) => void;
  recordUsage?: (input: number, output: number, calls: number) => void;
  signal?: AbortSignal;
  /** 非流式降级时的展示节奏；测试可设为 0，生产默认 20ms。 */
  fallbackRevealIntervalMs?: number;
  /** 当前对话模式，用于上下文压缩保留的最近轮数。 */
  mode?: string;
  webConversationKey?: string;
  webCharacterName?: string;
  webParticipants?: Array<{ id: string; name: string; personaPrompt: string }>;
}

class StreamUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StreamUnavailableError";
  }
}

function explicitlyRejectsStreaming(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /(?:stream(?:ing)?[^\r\n]{0,40}(?:not supported|unsupported|must be false|disabled|unavailable)|(?:not supported|unsupported)[^\r\n]{0,40}stream(?:ing)?|only non[- ]?stream|不支持.{0,12}流式|流式.{0,12}不支持)/i.test(body);
}

function waitForReveal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error("E_SOUL_ONLY_CANCELLED"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("E_SOUL_ONLY_CANCELLED"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function emitFallbackText(
  onEvent: ChatLoopOptions["onEvent"],
  messageId: string,
  text: string,
  intervalMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const chars = Array.from(text);
  // 最长约 1.2 秒；短回复保持逐字感，长回复按小块展示。
  const targetFrames = Math.max(1, Math.min(60, Math.ceil(chars.length / 2)));
  const chunkSize = Math.max(1, Math.ceil(chars.length / targetFrames));
  for (let index = 0; index < chars.length; index += chunkSize) {
    onEvent?.({
      type: "text_message_content",
      messageId,
      delta: chars.slice(index, index + chunkSize).join(""),
    });
    if (index + chunkSize < chars.length) await waitForReveal(intervalMs, signal);
  }
}

function stripToolProtocol(text: string): string {
  return text
    .split("]<]minimax[>[").join("")
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/\[tool_call\][\s\S]*?\[\/tool_call\]/gi, "")
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, "")
    .trim();
}

function withSoulSystem(messages: ChatMessage[], system: string): ChatMessage[] {
  if (messages[0]?.role === "system") return messages;
  return [{ role: "system", content: system }, ...messages];
}

export async function runChatLoop(options: ChatLoopOptions): Promise<TwoPhaseFcResult> {
  const startedAt = Date.now();
  const usageRecorder = options.recordUsage ?? ((input, output, calls) => recordUsage(input, output, calls));
  let usedImageCaptionFallback = false;

  const messages = await compressConversation({
    messages: options.messages,
    adapter: options.adapter,
    settings: options.settings,
    systemContent: options.soulSystemBaseContent,
    mode: options.mode,
    onEvent: options.onEvent,
    signal: options.signal,
  });

  const timeout = getTimeoutSettings().chatRequestTimeout;

  const remainingBudget = (): number => {
    if (options.signal?.aborted) throw new Error("E_SOUL_ONLY_CANCELLED");
    const remaining = options.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error("E_SOUL_ONLY_TIMEOUT");
    return Math.max(1, Math.min(timeout, remaining));
  };

  const vendorConfig: VendorConfig = {
    provider: options.settings.provider,
    baseUrl: options.settings.baseUrl,
    model: options.settings.model,
    apiKey: options.settings.apiKey,
    explicitTransport: options.settings.explicitTransport,
    reasoning: options.settings.reasoning,
  };

  const buildRequest = (reqMessages: ChatMessage[], stream: boolean): ChatRequest => ({
    model: options.settings.model,
    messages: withSoulSystem(reqMessages, options.soulSystemBaseContent),
    stream,
    ...(options.soulSampling ?? {}),
    webConversationKey: options.webConversationKey,
    webCharacterName: options.webCharacterName,
  });

  const invokeNonStreaming = async (messages: ChatMessage[]): Promise<ChatResponse> => {
    const request: ChatRequest = {
      ...buildRequest(messages, false),
    };
    const effectiveRequest = options.adapter.applyCacheHints?.(request, vendorConfig) ?? request;
    const http = options.adapter.buildRequest(effectiveRequest, options.settings);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, remainingBudget());
    try {
      const response = await fetch(http.url, {
        method: "POST",
        headers: http.headers,
        body: http.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AgentRuntimeError(
          "E_MODEL_REQUEST_FAILED",
          `模型请求失败：HTTP ${response.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
        );
      }
      return options.adapter.parseResponse(await response.json());
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  };

  const messageId = `msg-${Date.now()}`;
  const reasoningMessageId = `${messageId}-reasoning`;
  let emittedStreamContent = false;
  let reasoningStarted = false;
  let reasoningEnded = false;
  let textStarted = false;
  let textEnded = false;

  const startReasoning = () => {
    if (reasoningStarted) return;
    reasoningStarted = true;
    options.onEvent?.({ type: "reasoning_message_start", messageId: reasoningMessageId, role: "reasoning" });
  };
  const endReasoning = () => {
    if (!reasoningStarted || reasoningEnded) return;
    reasoningEnded = true;
    options.onEvent?.({ type: "reasoning_message_end", messageId: reasoningMessageId });
  };
  const startText = () => {
    if (textStarted) return;
    endReasoning();
    textStarted = true;
    options.onEvent?.({ type: "text_message_start", messageId, role: "assistant" });
  };
  const endText = () => {
    if (!textStarted || textEnded) return;
    textEnded = true;
    options.onEvent?.({ type: "text_message_end", messageId });
  };

  /**
   * 網頁自動化型 adapter（gemini_web／chatgpt_web）：不打 HTTP，而是直接操作背景網頁視窗。
   * 沿用跟一般 API provider 完全相同的 signal／逾時／串流呈現機制，
   * 讓「取消」「逾時」「終態」對所有 provider 行為一致，不需要另外特殊處理。
   */
  const invokeWebPrompt = async (messages: ChatMessage[]): Promise<{
    text: string;
    usage?: { input: number; output: number };
  }> => {
    const request = buildRequest(messages, true);
    const effectiveRequest = options.adapter.applyCacheHints?.(request, vendorConfig) ?? request;
    const attachments = options.adapter.getWebPromptAttachments?.(effectiveRequest) ?? [];
    const basePromptText = options.adapter.buildPromptText!(effectiveRequest);
    const promptText = attachments.length > 0
      ? `${basePromptText}\n\n【本輪圖片辨識規則】\n你現在收到 ${attachments.length} 張本輪新上傳的圖片。只分析這些新附件，不要把先前對話中的圖片、附件或介面文字當成本輪圖片。先直接觀察圖片的主要人物、物件與場景，再回答夥伴的問題；若無法確認角色姓名，可以描述外觀並明確說明不確定，但不可聲稱圖片沒有人物，除非本輪附件確實如此。`
      : basePromptText;

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, remainingBudget());

    let text = "";
    const emitWebText = (delta: string) => {
      if (!delta) return;
      text += delta;
      emittedStreamContent = true;
      startText();
      options.onEvent?.({ type: "text_message_content", messageId, delta });
    };
    try {
      const runParticipant = async (participant: {
        id?: string;
        name?: string;
        personaPrompt?: string;
      }, priorReplies: string): Promise<string> => {
        const timePrefixFilter = new ChatTimeStreamPrefixFilter();
        let participantText = "";
        const participantPrompt = [
          promptText,
          participant.personaPrompt
            ? [
                "[目前發言者的人格鎖定]",
                participant.personaPrompt,
                `你現在只能以「${participant.name ?? "目前角色"}」的身份發言；不要改成昔漣，也不要模仿房間內其他角色。`,
                "基礎助理提示只提供能力、安全與背景資料，不得覆蓋目前角色的人格、語氣與立場。",
              ].join("\n")
            : "",
          priorReplies
            ? `[本輪其他角色已說過]\n${priorReplies}\n請接續討論、提出不同觀點，不要重複相同內容。`
            : "",
        ].filter(Boolean).join("\n\n---\n\n");
        const full = await options.adapter.executeWebPrompt!(
          participantPrompt,
          (delta) => {
            const filtered = timePrefixFilter.push(delta);
            participantText += filtered;
            emitWebText(filtered);
          },
          {
            signal: controller.signal,
            attachments,
            conversationKey: participant.id
              ? `${options.webConversationKey ?? "default"}::${participant.id}`
              : options.webConversationKey,
            conversationName: participant.name ?? options.webCharacterName,
          },
        );
        const tail = timePrefixFilter.finish();
        participantText += tail;
        emitWebText(tail);
        if (full && full.length > participantText.length) {
          const missing = full.startsWith(participantText) ? full.slice(participantText.length) : "";
          if (missing) {
            participantText = full;
            emitWebText(missing);
          } else if (!participantText) {
            participantText = full;
            emitWebText(full);
          }
        }
        if (!participantText.trim()) {
          throw new AgentRuntimeError("E_MODEL_RESPONSE_PARSE_FAILED", "Gemini 網頁沒有返回可見文本");
        }
        return participantText;
      };

      const participants = options.webParticipants?.length
        ? options.webParticipants
        : [{ name: options.webCharacterName }];
      const completedReplies: string[] = [];
      for (const participant of participants) {
        if (participants.length > 1) {
          emitWebText(`${completedReplies.length > 0 ? "\n\n" : ""}### ${participant.name ?? "角色"}\n`);
        }
        const reply = await runParticipant(participant, completedReplies.join("\n\n"));
        completedReplies.push(`${participant.name ?? "角色"}：${reply}`);
      }
      return { text };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  };

  const invokeStreaming = async (messages: ChatMessage[]): Promise<{
    text: string;
    usage?: { input: number; output: number };
    nonStreamingResponse?: ChatResponse;
  }> => {
    if (options.adapter.executeWebPrompt) {
      return invokeWebPrompt(messages);
    }
    const request = buildRequest(messages, true);
    const effectiveRequest = options.adapter.applyCacheHints?.(request, vendorConfig) ?? request;
    const http = options.adapter.buildStreamRequest(effectiveRequest, vendorConfig);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, remainingBudget());
    try {
      const response = await fetch(http.url, {
        method: "POST",
        headers: http.headers,
        body: http.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const detail = `HTTP ${response.status}${body ? ` - ${body.slice(0, 200)}` : ""}`;
        if (explicitlyRejectsStreaming(response.status, body)) {
          throw new StreamUnavailableError(`流式请求不受支持：${detail}`);
        }
        throw new AgentRuntimeError("E_MODEL_REQUEST_FAILED", `模型请求失败：${detail}`);
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes("application/json")) {
        return { text: "", nonStreamingResponse: options.adapter.parseResponse(await response.json()) };
      }
      if (!response.body) throw new AgentRuntimeError("E_MODEL_RESPONSE_PARSE_FAILED", "模型流式响应体为空");

      let text = "";
      const timePrefixFilter = new ChatTimeStreamPrefixFilter();
      const emitTextDelta = (delta: string) => {
        if (!delta) return;
        text += delta;
        emittedStreamContent = true;
        startText();
        options.onEvent?.({
          type: "text_message_content",
          messageId,
          delta,
        });
      };
      let usage: { input: number; output: number } | undefined;
      for await (const event of createSseReader(options.adapter, response.body)) {
        const chunk = options.adapter.parseStreamEvent(event);
        if (!chunk) continue;
        if (chunk.error) {
          throw new AgentRuntimeError("E_MODEL_REQUEST_FAILED", `模型流式响应错误：${chunk.error}`);
        }
        if (chunk.deltaThinking) {
          emittedStreamContent = true;
          startReasoning();
          options.onEvent?.({
            type: "reasoning_message_content",
            messageId: reasoningMessageId,
            delta: chunk.deltaThinking,
          });
        }
        if (chunk.deltaText) {
          emitTextDelta(timePrefixFilter.push(chunk.deltaText));
        }
        if (chunk.usage) {
          usage = {
            input: Math.max(usage?.input ?? 0, chunk.usage.input),
            output: Math.max(usage?.output ?? 0, chunk.usage.output),
          };
        }
        if (chunk.done) break;
      }
      emitTextDelta(timePrefixFilter.finish());
      if (!text.trim()) {
        throw new AgentRuntimeError("E_MODEL_RESPONSE_PARSE_FAILED", "模型流式响应没有返回可见文本");
      }
      return { text, usage };
    } catch (error) {
      if (emittedStreamContent) throw error;
      if (error instanceof StreamUnavailableError) throw error;
      if (options.signal?.aborted) throw error;
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  };

  const invokeWithStreamFallback = async (messages: ChatMessage[]) => {
    try {
      const streamed = await invokeStreaming(messages);
      if (streamed.nonStreamingResponse) {
        return { response: streamed.nonStreamingResponse, needsReveal: true };
      }
      return {
        response: {
          assistantMessage: { role: "assistant" as const, content: streamed.text },
          text: streamed.text,
          toolCalls: [],
          finishReason: "stop",
          raw: null,
          usage: streamed.usage,
          thinking: undefined,
        } satisfies ChatResponse,
        needsReveal: false,
      };
    } catch (error) {
      if (!(error instanceof StreamUnavailableError) || emittedStreamContent) throw error;
      return { response: await invokeNonStreaming(messages), needsReveal: true };
    }
  };

  options.onEvent?.({ type: "step_started", stepName: "chat" });
  try {
    let result;
    try {
      result = await invokeWithStreamFallback(options.messages);
    } catch (error) {
      if (emittedStreamContent || options.signal?.aborted || !options.imageCaptionFallback || usedImageCaptionFallback) {
        throw error;
      }
      usedImageCaptionFallback = true;
      result = await invokeWithStreamFallback(await options.imageCaptionFallback());
    }

    const response = result.response;

    if (result.needsReveal && response.thinking) {
      startReasoning();
      options.onEvent?.({
        type: "reasoning_message_content",
        messageId: reasoningMessageId,
        delta: response.thinking,
      });
      endReasoning();
    }

    if (response.usage) {
      usageRecorder(response.usage.input, response.usage.output, 1);
    }
    const reply = stripLeakedChatTimeContext(stripToolProtocol(response.text))
      || "刚才没有生成正常回复，请再试一次。";
    if (result.needsReveal) {
      startText();
      await emitFallbackText(
        options.onEvent,
        messageId,
        reply,
        options.fallbackRevealIntervalMs ?? 20,
        options.signal,
      );
    }
    endText();
    return {
      reply,
      toolResults: [],
      totalUsage: response.usage,
      soulPhaseReason: "no_tool",
    };
  } finally {
    endReasoning();
    endText();
    options.onEvent?.({ type: "step_finished", stepName: "chat" });
  }
}
