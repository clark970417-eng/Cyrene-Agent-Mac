import { loadPromptFile } from "../prompts/prompt-loader";

/** 组装主动场景（包含螢幕陪伴）共用的人设基底文本。 */
export function buildProactivePersonaPrompt(): string {
  const parts: string[] = [];
  const chatSystem = loadPromptFile("chat_system.md");
  if (chatSystem) parts.push(chatSystem);
  const soul = loadPromptFile("soul.md");
  if (soul) {
    // 主动轮完全不携带工具说明；Soul 尾部的 Live2D/联网章节由正常聊天使用。
    parts.push(soul.split("\n## Live2D 与聊天文字的分工")[0].trim());
  }
  const canon = loadPromptFile("canon_quotes.md");
  if (canon) parts.push(canon);
  const style = loadPromptFile("styles/01_default.md");
  if (style) parts.push(style);
  return parts.join("\n\n---\n\n");
}
