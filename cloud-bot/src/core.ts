import { createHash } from "node:crypto";
import type { CloudBotConfig } from "./config.js";
import { toTraditionalTaiwan } from "./traditional.js";

export type ChatRole = "user" | "assistant";
export type ChatEntryKind = "message" | "image_memory";
export type ChatEntry = {
  /** 新版永久檔案的穩定事件 ID；舊資料載入時會自動補上。 */
  id?: string;
  sessionId: string;
  channel?: string;
  role: ChatRole;
  kind?: ChatEntryKind;
  content: string;
  at: number;
};

function allowed(allowlist: Set<string>, id: string | null | undefined): boolean {
  return allowlist.size === 0 || (!!id && allowlist.has(id));
}

export function shouldHandleMessage(
  input: { userId: string; guildId?: string | null; channelId: string; isDm: boolean; mentioned: boolean },
  config: Pick<CloudBotConfig, "allowedUserIds" | "allowedGuildIds" | "allowedChannelIds" | "requireMention">,
): boolean {
  if (!allowed(config.allowedUserIds, input.userId)) return false;
  if (!allowed(config.allowedChannelIds, input.channelId)) return false;
  if (input.guildId && !allowed(config.allowedGuildIds, input.guildId)) return false;
  return input.isDm || !config.requireMention || input.mentioned;
}

export function normalizeInvocation(content: string, botUserId: string): string {
  const escapedId = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = content.replace(new RegExp(`<@!?${escapedId}>`, "g"), "").trim();
  return text || "嗨";
}

export function mentionsBot(content: string, botUserId: string): boolean {
  return content.includes(`<@${botUserId}>`) || content.includes(`<@!${botUserId}>`);
}

/** 雲端回覆也強制使用唯一稱呼，避免 Router 輸出人格提示裡的英文別名。 */
export function normalizeCompanionAddress(text: string): string {
  return collapseExactRepeatedReply(toTraditionalTaiwan(text))
    .replace(/\bpartner(?:'s|’s)\s+friend\b/gi, "夥伴的朋友")
    .replace(/\bmy\s+partner\b/gi, "我的夥伴")
    .replace(/\byu[\s_-]*ying\b/gi, "夥伴")
    .replace(/\bpartner\b/gi, "夥伴");
}

/** 只移除模型以空行分隔、完整重複兩次的回覆。 */
export function collapseExactRepeatedReply(text: string): string {
  const trimmed = text.trim();
  for (const match of trimmed.matchAll(/\n\s*\n/gu)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const left = trimmed.slice(0, index).trim();
    const right = trimmed.slice(index + match[0].length).trim();
    if (left && left === right) return left;
  }
  return trimmed;
}

export function sessionIdFor(userId: string, channelId: string): string {
  return createHash("sha256").update(`${userId}:${channelId}`).digest("hex").slice(0, 24);
}

export function splitDiscordText(text: string, limit = 1_900): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit / 2)) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}
