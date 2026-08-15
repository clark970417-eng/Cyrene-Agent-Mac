// channels/history-log —— 渠道侧每个 sender 的对话历史 (滑窗用).
//
// 每个 sessionId 对应 userData/channels/history/<sessionId>.jsonl
// 每次按需讀取, append 時只追加. 文件按 MAX_LINES 截断防膨胀.
//
// 数据流:
//   dispatcher.handleIncoming 入站/出站 → appendHistory(senderSessionId, role, content)
//   dispatcher.handleIncoming 下一轮进 → loadRecentHistory(senderSessionId, 16) 拉最近 16 条
//
// 跟 message-log 的区别:
//   message-log 是"运营可见"的人类可读日志 (UI 显示给人看)
//   history-log 是 agent 喂的"对话上下文", LLM 需要, 机器格式
//
// 跟 RAG 索引 (indexConversationTurn) 的区别:
//   RAG 是语义检索 (cosine similarity), 长期持久
//   history-log 是精确窗口 (sliding window), 短期明确
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const LOG = "[ChannelHistory]";

/** 一条消息: 谁说的 + 内容 + 时间戳 ISO */
export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  at: string;
}

// 5,000 則約等於 2,500 輪對話；短期上下文仍只讀 16 則，
// 較舊內容只在相關時被長期檢索召回，不會每輪全部塞給模型。
const MAX_FILE_LINES = 5_000;

function dir(): string {
  return path.join(app.getPath("userData"), "channels", "history");
}

/** sessionId 可能不安全做文件名, 用 sha256 hex 兜底. dispatcher 给的已是 hash+prefix 形式也 OK. */
function safeName(sessionId: string): string {
  // dispatcher 的 sessionId 形如 "channel:feishu:e72a9d...", 替换 : 为 _ 即可
  return sessionId.replace(/[:/\\<>:"|?*]/g, "_");
}

function filePath(sessionId: string): string {
  return path.join(dir(), `${safeName(sessionId)}.jsonl`);
}

/** 追加一条. role 只能是 user/assistant (dispatcher 内部强制). */
export function appendHistory(sessionId: string, role: "user" | "assistant", content: string): void {
  if (!sessionId || !content) return;
  const entry: HistoryEntry = { role, content, at: new Date().toISOString() };
  const fp = filePath(sessionId);
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(fp, JSON.stringify(entry) + "\n", "utf8");
    // 文件过大时截断 (只留最后 MAX_FILE_LINES 行)
    const buf = fs.readFileSync(fp, "utf8");
    const lines = buf.split("\n");
    if (lines.length > MAX_FILE_LINES + 1) {
      const trimmed = lines.slice(lines.length - MAX_FILE_LINES).join("\n");
      fs.writeFileSync(fp, trimmed.endsWith("\n") ? trimmed : trimmed + "\n", "utf8");
    }
  } catch (err) {
    console.warn(LOG, "appendHistory 失败:", sessionId, err instanceof Error ? err.message : err);
  }
}

/** 读最近 N 条历史, 按时间顺序 (旧 → 新). */
export function loadRecentHistory(sessionId: string, limit: number): HistoryEntry[] {
  if (!sessionId || limit <= 0) return [];
  const fp = filePath(sessionId);
  if (!fs.existsSync(fp)) return [];
  try {
    const buf = fs.readFileSync(fp, "utf8");
    const lines = buf.split("\n").filter((l) => l.length > 0);
    const parsed: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (e && (e.role === "user" || e.role === "assistant") && typeof e.content === "string") {
          parsed.push(e);
        }
      } catch {
        /* skip bad line */
      }
    }
    // 取尾部 limit 条
    const sliced = parsed.slice(-limit);
    return sliced;
  } catch (err) {
    console.warn(LOG, "loadRecentHistory 失败:", sessionId, err instanceof Error ? err.message : err);
    return [];
  }
}

export interface RecalledHistoryTurn {
  entries: HistoryEntry[];
  score: number;
}

/**
 * 從同一 session 的較舊對話找回相關輪次。
 * 這是不依賴 embedding 模型的本機後援，中文用單字/雙字片段，
 * 英數字用詞彙比對。回傳完整 user/assistant 輪次，避免只記得半句。
 */
export function searchOlderHistory(
  sessionId: string,
  query: string,
  options: { topK?: number; excludeRecent?: number } = {},
): RecalledHistoryTurn[] {
  const topK = Math.max(1, options.topK ?? 4);
  const excludeRecent = Math.max(0, options.excludeRecent ?? 16);
  const all = loadRecentHistory(sessionId, MAX_FILE_LINES);
  const searchable = excludeRecent > 0 ? all.slice(0, -excludeRecent) : all;
  if (!query.trim() || searchable.length === 0) return [];

  const turns: HistoryEntry[][] = [];
  for (const entry of searchable) {
    if (entry.role === "user" || turns.length === 0) turns.push([entry]);
    else turns[turns.length - 1].push(entry);
  }

  const queryTokens = recallTokens(query);
  if (queryTokens.size === 0) return [];
  const now = Date.now();
  return turns
    .map((entries) => {
      const textTokens = recallTokens(entries.map((entry) => entry.content).join("\n"));
      let overlap = 0;
      for (const token of queryTokens) if (textTokens.has(token)) overlap += token.length > 1 ? 2 : 1;
      if (overlap === 0) return { entries, score: 0 };
      const age = Math.max(0, now - Date.parse(entries[entries.length - 1].at));
      const recency = 1 / (1 + age / (90 * 24 * 60 * 60 * 1000));
      return { entries, score: overlap / Math.sqrt(Math.max(1, queryTokens.size * textTokens.size)) + recency * 0.05 };
    })
    .filter((turn) => turn.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

const RECALL_STOP_CHARS = new Set(" 　\n\r\t，。！？、；：,.!?;:~～的了是在我你他她它有不也就都這那還要嗎呢吧啊喔嗯");

function recallTokens(text: string): Set<string> {
  const normalized = text.normalize("NFKC").toLowerCase();
  const out = new Set<string>();
  for (const word of normalized.match(/[a-z0-9_]{2,}/g) ?? []) out.add(word);
  const chars = [...normalized].filter((char) => /[\u3400-\u9fff]/u.test(char) && !RECALL_STOP_CHARS.has(char));
  for (const char of chars) out.add(char);
  for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
  return out;
}

/** 启动时所有 session 文件预读 (可选, dispatcher 用不到, 给将来 Phase 4 调试 UI 留接口). */
export function reloadAllHistory(): Map<string, HistoryEntry[]> {
  const out = new Map<string, HistoryEntry[]>();
  try {
    fs.mkdirSync(dir(), { recursive: true });
    for (const name of fs.readdirSync(dir())) {
      if (!name.endsWith(".jsonl")) continue;
      const sid = name.replace(/\.jsonl$/, "").replace(/_/g, ":");
      // 不尝试反推回原 sessionId, 这里只是占位接口, Phase 4 可优化
      out.set(sid, loadRecentHistory(sid, MAX_FILE_LINES));
    }
  } catch {
    /* ignore */
  }
  return out;
}
