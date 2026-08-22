import type { ConversationMode } from "../../../../../shared/chat-types";

export function shouldRunModelForMode(
  mode: ConversationMode,
  hasDemoResponse: boolean,
  hasDemoSticker: boolean,
): boolean {
  return (mode === "chat" || mode === "work" || mode === "daily" || mode === "code" || mode === "learn")
    && !hasDemoResponse
    && !hasDemoSticker;
}

/** 昔漣的自動 TTS 只能朗讀單人對話；多人房必須按實際發言角色處理。 */
export function shouldUseCyreneAutoTts(participantIdentityIds?: readonly string[]): boolean {
  return !participantIdentityIds?.length;
}
