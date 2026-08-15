// 历史对话召回工具 —— 让昔涟能"回忆"滚出上下文窗口的对话。
//
// 设计（见 docs/history-and-skill-architecture.md）：
// - 不切分、不压缩、不启发式。全部历史无损存入向量库，模型主动召回。
// - 存：每轮 user + assistant 消息用 addMemory 存入 source="chat_history"
// - 取：recall_history 工具语义检索，按时间排序返回
//
// 复用现有 RAG 引擎（addMemory / searchHistoryEntries），不另建存储层。

import { addMemory, isUserMemoryVectorStoreReady, searchHistoryEntries } from "../rag";
import { toolRegistry } from "./tool-registry";
import { currentUserTimezone } from "./built-in-tools";
import { getDateLocale } from "../locale-context";
import { searchOlderHistory } from "../channels/history-log";

const LOG_PREFIX = "[History]";

/**
 * 把一轮对话存入向量库。在 agui-bridge 的 complete 回调里调用。
 * user 和 assistant 各存一条，方便按角色召回。
 * 失败不抛错（历史存储是副作用，不能影响主流程）。
 */
export async function indexConversationTurn(
  sessionId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  // 沒有 embedding provider 時，Discord 對話仍會由 channels/history 長期保存與檢索。
  // 這裡靜默略過向量副本，避免每輪都輸出「RAG not initialized」。
  if (!isUserMemoryVectorStoreReady()) return;
  const ts = Date.now();
  try {
    if (userText) {
      await addMemory(userText, "chat_history", { sessionId, role: "user", ts });
    }
    if (assistantText) {
      await addMemory(assistantText, "chat_history", { sessionId, role: "assistant", ts });
    }
  } catch (e) {
    console.warn(LOG_PREFIX, "索引对话失败:", e);
  }
}

/**
 * 頻道模式（包含不支援 tools 的 Gemini 網頁版）在每輪回覆前主動召回相關舊對話。
 * 只搜尋同一 sessionId，也會排除已在短期視窗的文字。
 */
export async function buildChannelLongTermMemoryContext(
  sessionId: string,
  query: string,
  recentContents: string[] = [],
): Promise<string> {
  const recent = new Set(recentContents.map(normalizeHistoryText).filter(Boolean));
  const candidates: Array<{ text: string; createdAt: number; score: number }> = [];

  // 先查舊 RAG 索引。沒有 embedding provider 時仍會使用 BM25。
  try {
    const hits = await searchHistoryEntries(query, 10, { sessionId });
    for (const hit of hits) {
      if (hit.score <= 0 || recent.has(normalizeHistoryText(hit.text))) continue;
      candidates.push({ text: formatHistoryLine(hit.text, hit.metadata?.role), createdAt: hit.createdAt, score: hit.score });
    }
  } catch (error) {
    console.warn(LOG_PREFIX, "長期 RAG 召回失敗，改用頻道歷史:", error);
  }

  // 再查持久化的頻道歷史，補上沒有 embedding 後新增的對話。
  for (const turn of searchOlderHistory(sessionId, query, { topK: 5, excludeRecent: 16 })) {
    const lines = turn.entries
      .filter((entry) => !recent.has(normalizeHistoryText(entry.content)))
      .map((entry) => formatHistoryLine(entry.content, entry.role));
    if (lines.length === 0) continue;
    candidates.push({
      text: lines.join("\n"),
      createdAt: Date.parse(turn.entries[0].at) || 0,
      score: turn.score,
    });
  }

  const seen = new Set<string>();
  const selected = candidates
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    .filter((item) => {
      const key = normalizeHistoryText(item.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (selected.length === 0) return "";

  return [
    "【長期對話記憶】",
    "以下是從同一使用者的較舊對話中找到的相關片段。只在與本輪有關時自然運用；片段可能不完整，不要臆測沒有寫出的細節。",
    ...selected.map((item) => `- ${new Date(item.createdAt).toLocaleDateString(getDateLocale())}\n${item.text}`),
  ].join("\n");
}

function formatHistoryLine(text: string, role: unknown): string {
  const clipped = text.length > 500 ? text.slice(0, 500) + "…" : text;
  return `${role === "user" ? "使用者" : "昔漣"}：${clipped}`;
}

function normalizeHistoryText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** 注册 recall_history 工具。在 startup 调一次。 */
export function registerRecallHistoryTool(): void {
  toolRegistry.register({
    id: "recall_history",
    name: "回忆历史",
    description:
      "从所有历史对话中语义检索相关内容。返回按时间排序的相关片段（最多 5 条），每条带角色和时间戳。\n\n" +
      "何时用：\n" +
      "- 用户说「还记得」「上次」「之前」「那个」「前几天」等指代词\n" +
      "- 用户问的事在最近几轮对话里找不到答案\n" +
      "- 用户接续之前的话题但当前上下文没有细节\n\n" +
      "不要用于：\n" +
      "- 当前对话最近几轮里能直接看到的信息\n" +
      "- 完全无关的闲聊\n" +
      "- 用户从没提过的事（查不到就老实说不知道）\n\n" +
      "参数：query（必填，检索关键词或自然语言问题），days（可选，限制最近 N 天，默认 30）。",
    enabled: true,
    risk: "safe",
    effectKind: "read" as const,
    verificationPolicy: "none" as const,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词或自然语言问题" },
        days: { type: "number", description: "可选，限制最近 N 天，默认 30" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = String(args.query || "").trim();
      if (!query) return "[错误] query 不能为空";

      const days = Number(args.days) || 30;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

      let hits;
      try {
        hits = await searchHistoryEntries(query, 5);
      } catch (e) {
        return "[recall_history] 检索失败：" + (e instanceof Error ? e.message : String(e));
      }

      const filtered = hits.filter(h => h.createdAt >= cutoff);

      if (filtered.length === 0) {
        return `[recall_history] 没有找到关于 "${query}" 的历史记录`;
      }

      // 按时间正序（最早的在前），让对话脉络自然
      const sorted = [...filtered].sort((a, b) => a.createdAt - b.createdAt);

      const lines = sorted.map(h => {
        const date = new Date(h.createdAt).toLocaleString(getDateLocale(), { timeZone: currentUserTimezone() });
        const role = h.metadata?.role === "user" ? "用户" : "昔涟";
        // 截断过长内容，避免吃太多 token
        const text = h.text.length > 300 ? h.text.slice(0, 300) + "..." : h.text;
        return `[${date}] ${role}：${text}`;
      });

      return `[recall_history] 找到 ${sorted.length} 条相关历史：\n\n${lines.join("\n\n")}`;
    },
  });
}
