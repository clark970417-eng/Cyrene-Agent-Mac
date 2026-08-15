// 小愛音箱（xiaogpt custom bot: openai）入口 —— 對外偽裝成標準 OpenAI /v1/chat/completions，
// 內部直接沿用雲端昔漣既有的人設、記憶與 generateReply，讓音箱那頭聽到的就是昔漣本人。
import { randomUUID } from "node:crypto";
import type { HttpRoute } from "./health.js";
import { readRequestBody } from "./health.js";
import { isAuthorizedDevice } from "./xiaoai-auth.js";
import type { CloudBotConfig } from "./config.js";
import type { MemoryStore } from "./memory.js";
import { generateReply } from "./llm.js";

/** 音箱只有一位使用者，session 固定即可，不用像 Discord 那樣按 user/channel 動態算。 */
export const XIAOAI_SESSION_ID = "xiaoai:speaker";

type OpenAiChatMessage = { role?: string; content?: unknown };
type OpenAiChatRequest = { messages?: OpenAiChatMessage[] };

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
      .join("")
      .trim();
  }
  return "";
}

export function extractLatestUserText(body: OpenAiChatRequest): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== "user") continue;
    return flattenContent(messages[i].content);
  }
  return "";
}

export function buildChatCompletionResponse(model: string, replyText: string): Record<string, unknown> {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: replyText },
        finish_reason: "stop",
      },
    ],
  };
}

export function createXiaoAiChatRoute(deps: {
  config: CloudBotConfig;
  memory: MemoryStore;
  systemPrompt: string;
}): HttpRoute {
  return {
    method: "POST",
    path: "/v1/chat/completions",
    async handle(request, response) {
      if (!isAuthorizedDevice(request, deps.config.xiaoaiDeviceToken)) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "unauthorized" } }));
        return;
      }

      let body: OpenAiChatRequest;
      try {
        body = JSON.parse((await readRequestBody(request)).toString("utf8")) as OpenAiChatRequest;
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid_json" } }));
        return;
      }

      const input = extractLatestUserText(body);
      if (!input) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "missing_user_message" } }));
        return;
      }

      let replyText: string;
      try {
        await deps.memory.append(XIAOAI_SESSION_ID, "user", input, { channel: "xiaoai" });
        const proactiveMemory = deps.memory.buildRecallContext(input, XIAOAI_SESSION_ID, 8);
        replyText = await generateReply(deps.config, deps.systemPrompt, deps.memory.get(XIAOAI_SESSION_ID), [], proactiveMemory);
        await deps.memory.append(XIAOAI_SESSION_ID, "assistant", replyText, { channel: "xiaoai" });
      } catch (error) {
        console.error("[XiaoAI] 回覆產生失敗", error);
        replyText = "雲層有點不穩，晚點再跟我說一次好嗎？";
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(buildChatCompletionResponse(deps.config.llmModel, replyText)));
    },
  };
}
