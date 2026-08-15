import { randomUUID } from "crypto";
import { broadcastChatsChanged } from "../chats/chats-ipc";
import * as chatsStore from "../chats/chats-store";
import type { ChannelManager } from "../channels/manager";
import { sendProactiveChannelMessage } from "../channels/proactive-delivery";
import type { DiscordAdapter } from "../channels/adapters/discord";
import type { GeneralSettings } from "../settings/general-settings";
import type { VisionModelConfig } from "../settings/model-settings";

export interface ScreenCompanionDeliveryDeps {
  manager: Pick<ChannelManager, "getAdapter">;
}

/** 依 vision.proactiveTarget 把螢幕陪伴的話投遞到桌面／Discord／微信。回傳是否成功送出。 */
export async function deliverScreenCompanionMessage(
  text: string,
  vision: VisionModelConfig,
  generalSettings: GeneralSettings,
  deps: ScreenCompanionDeliveryDeps,
): Promise<boolean> {
  if (vision.proactiveTarget === "desktop") {
    const session = chatsStore.getOrCreateSessionByPurpose("proactive-chat", {
      title: "昔漣的主動訊息",
      identityId: null,
    });
    const appended = chatsStore.appendMessage(session.id, {
      id: randomUUID(),
      role: "model",
      content: text,
      at: Date.now(),
    });
    if (!appended) {
      console.warn("[ScreenCompanion] 桌面投遞失敗：寫入對話會話失敗");
      return false;
    }
    broadcastChatsChanged();
    return true;
  }

  if (vision.proactiveTarget === "discord") {
    const adapter = deps.manager.getAdapter("discord") as DiscordAdapter | undefined;
    if (!adapter || adapter.getStatus().phase !== "running") {
      console.warn("[ScreenCompanion] Discord 投遞失敗：channel 未連線");
      return false;
    }
    if (vision.discordSubTarget === "dm") {
      const result = await adapter.sendOwnerDM(text);
      if (!result.ok) console.warn("[ScreenCompanion] Discord 私訊投遞失敗:", result.error);
      return result.ok;
    }
    const channelId = vision.discordChannelId.trim();
    if (!channelId) {
      console.warn("[ScreenCompanion] Discord 頻道投遞失敗：未設定頻道 ID");
      return false;
    }
    const ownerId = adapter.getOwnerUserId();
    const mention = ownerId ? `<@${ownerId}> ` : "";
    const result = await adapter.send({
      channel: "discord",
      targetId: channelId,
      parts: [{ kind: "text", text: `${mention}${text}` }],
    });
    if (!result.ok) console.warn("[ScreenCompanion] Discord 頻道投遞失敗:", result.error);
    return result.ok;
  }

  // wechat
  const result = await sendProactiveChannelMessage({
    channel: "wechat",
    text,
    mobileMessageSegmentation: generalSettings.mobileMessageSegmentation,
    manager: deps.manager,
    canContinue: () => true,
  });
  if (result.kind !== "committed") {
    console.warn("[ScreenCompanion] 微信投遞失敗:", result.reason);
    return false;
  }
  return true;
}
