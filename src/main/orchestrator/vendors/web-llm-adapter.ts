import type {
  ChatVendorAdapter,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  StreamEvent,
  StreamChunk,
  TestConnectionResult,
  HttpRequest,
  ProviderCapability,
  VendorConfig,
  ToolExecutionResult,
  Transport,
  WebPromptAttachment,
} from "./types";
import { runChatGPTWebPrompt } from "../../web-llm/chatgpt-web-driver";
import { runGeminiPrompt, primeGeminiConversation } from "../../web-llm/gemini/gemini-bridge";

export class WebLlmAdapter implements ChatVendorAdapter {
  readonly id: string;
  readonly transport: Transport = "openai";
  readonly capability: ProviderCapability;
  private readonly providerType: "chatgpt_web" | "gemini_web";

  constructor(id: string, capability: ProviderCapability, providerType?: "chatgpt_web" | "gemini_web") {
    this.id = id;
    this.capability = capability;
    this.providerType = providerType ?? (id as "chatgpt_web" | "gemini_web");
  }

  buildRequest(_req: ChatRequest, _cfg: VendorConfig): HttpRequest {
    return {
      url: this.capability.baseUrl,
      method: "POST",
      headers: {},
      body: "",
    };
  }

  buildStreamRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    return this.buildRequest(req, cfg);
  }

  parseResponse(_raw: unknown): ChatResponse {
    return {
      assistantMessage: { role: "assistant", content: "" },
      text: "",
      toolCalls: [],
      finishReason: "stop",
      raw: {},
    };
  }

  parseStreamEvent(_event: StreamEvent): StreamChunk | null {
    return null;
  }

  appendToolResults(messages: ChatMessage[], _results: ToolExecutionResult[]): ChatMessage[] {
    return messages;
  }

  async testConnection(): Promise<TestConnectionResult> {
    return { ok: true, latency: 10 };
  }

  async executeWebPrompt(
    promptText: string,
    onChunk?: (text: string) => void,
    options?: {
      signal?: AbortSignal;
      attachments?: WebPromptAttachment[];
      isDownstreamBusy?: () => boolean;
      conversationKey?: string;
      conversationName?: string;
    }
  ): Promise<string> {
    if (this.providerType === "chatgpt_web") {
      return await runChatGPTWebPrompt(promptText, onChunk, { signal: options?.signal });
    } else {
      return await runGeminiPrompt(promptText, onChunk, options);
    }
  }

  /** 通話接通時先開一個乾淨對話並把人設餵進去，讓第一句話不必扛那一萬多字。
   * 只有 gemini_web 支援；其他回 null 代表沒有這個機制。 */
  async primeWebSession(personaPrompt: string, options?: { signal?: AbortSignal }): Promise<string | null> {
    if (this.providerType !== "gemini_web") return null;
    return await primeGeminiConversation(personaPrompt, { signal: options?.signal });
  }

  buildPromptText(req: ChatRequest): string {
    const contentText = (content: ChatMessage["content"]): string => {
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      return content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    };
    const systemMsg = contentText(req.messages.find((m) => m.role === "system")?.content);
    const conversation = req.messages
      .filter((m) => m.role !== "system" && m.content)
      .map((m) => `${m.role === "user" ? "夥伴" : (req.webCharacterName || "昔漣")}: ${contentText(m.content)}`)
      .filter((line) => !/^[^:]+:\s*$/.test(line))
      .slice(-6)
      .join("\n");

    return `${systemMsg ? `[系統背景指示]\n${systemMsg}\n\n` : ""}${conversation}`;
  }

  getWebPromptAttachments(req: ChatRequest): WebPromptAttachment[] {
    if (this.providerType !== "gemini_web") return [];
    const attachments: WebPromptAttachment[] = [];
    for (const message of req.messages) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block.type !== "image_url" || !block.image_url.url.startsWith("data:image/")) continue;
        const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(block.image_url.url);
        if (!match) continue;
        const mime = match[1];
        const extension = mime.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
        attachments.push({
          name: `discord-image-${attachments.length + 1}.${extension}`,
          mime,
          dataUrl: block.image_url.url,
        });
      }
    }
    return attachments.slice(-4);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const fullPrompt = this.buildPromptText(req);
    const text = await this.executeWebPrompt(fullPrompt, undefined, {
      conversationKey: req.webConversationKey,
      conversationName: req.webCharacterName,
    });

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: text,
    };

    return {
      assistantMessage,
      text,
      toolCalls: [],
      finishReason: "stop",
      raw: { text },
    };
  }
}
