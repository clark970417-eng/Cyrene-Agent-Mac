import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  getOrCreateSessionByPurpose,
  appendMessage,
  broadcastChatsChanged,
  sendProactiveChannelMessage,
} = vi.hoisted(() => ({
  getOrCreateSessionByPurpose: vi.fn(() => ({ id: "session-1" })),
  appendMessage: vi.fn(() => ({ id: "msg-1" })),
  broadcastChatsChanged: vi.fn(),
  sendProactiveChannelMessage: vi.fn(),
}));

vi.mock("../chats/chats-store", () => ({
  getOrCreateSessionByPurpose,
  appendMessage,
}));
vi.mock("../chats/chats-ipc", () => ({
  broadcastChatsChanged,
}));
vi.mock("../channels/proactive-delivery", () => ({
  sendProactiveChannelMessage,
}));

import { deliverScreenCompanionMessage } from "./screen-companion-delivery";
import type { VisionModelConfig } from "../settings/model-settings";
import type { GeneralSettings } from "../settings/general-settings";

const baseVision: VisionModelConfig = {
  enabled: true,
  autoAnalyze: true,
  maxImages: 2,
  maxImageMb: 5,
  syncWithMain: false,
  baseUrl: "https://vision.example",
  apiKey: "key",
  model: "vision-model",
  screenCompanionEnabled: true,
  observeIntervalSeconds: 1800,
  talkativeness: "normal",
  minTalkIntervalSeconds: 120,
  proactiveTarget: "desktop",
  discordSubTarget: "dm",
  discordChannelId: "",
};

const generalSettings = { mobileMessageSegmentation: "off" } as unknown as GeneralSettings;

describe("deliverScreenCompanionMessage", () => {
  beforeEach(() => {
    getOrCreateSessionByPurpose.mockClear();
    appendMessage.mockClear();
    broadcastChatsChanged.mockClear();
    sendProactiveChannelMessage.mockClear();
  });

  it("desktop target appends to the proactive-chat session and broadcasts", async () => {
    const ok = await deliverScreenCompanionMessage(
      "哈囉",
      { ...baseVision, proactiveTarget: "desktop" },
      generalSettings,
      { manager: { getAdapter: vi.fn() } },
    );
    expect(ok).toBe(true);
    expect(getOrCreateSessionByPurpose).toHaveBeenCalledWith("proactive-chat", expect.any(Object));
    expect(appendMessage).toHaveBeenCalledWith("session-1", expect.objectContaining({ content: "哈囉", role: "model" }));
    expect(broadcastChatsChanged).toHaveBeenCalledOnce();
  });

  it("desktop target returns false when the write fails", async () => {
    appendMessage.mockReturnValueOnce(null as unknown as { id: string });
    const ok = await deliverScreenCompanionMessage(
      "哈囉",
      { ...baseVision, proactiveTarget: "desktop" },
      generalSettings,
      { manager: { getAdapter: vi.fn() } },
    );
    expect(ok).toBe(false);
    expect(broadcastChatsChanged).not.toHaveBeenCalled();
  });

  it("discord dm target calls sendOwnerDM on a running adapter", async () => {
    const sendOwnerDM = vi.fn(async () => ({ ok: true }));
    const adapter = { getStatus: () => ({ phase: "running" }), sendOwnerDM };
    const ok = await deliverScreenCompanionMessage(
      "哈囉",
      { ...baseVision, proactiveTarget: "discord", discordSubTarget: "dm" },
      generalSettings,
      { manager: { getAdapter: () => adapter as never } },
    );
    expect(ok).toBe(true);
    expect(sendOwnerDM).toHaveBeenCalledWith("哈囉");
  });

  it("discord channel target mentions the owner and sends to the configured channel", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const adapter = {
      getStatus: () => ({ phase: "running" }),
      getOwnerUserId: () => "12345",
      send,
    };
    const ok = await deliverScreenCompanionMessage(
      "哈囉",
      { ...baseVision, proactiveTarget: "discord", discordSubTarget: "channel", discordChannelId: "999" },
      generalSettings,
      { manager: { getAdapter: () => adapter as never } },
    );
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith({
      channel: "discord",
      targetId: "999",
      parts: [{ kind: "text", text: "<@12345> 哈囉" }],
    });
  });

  it("discord channel target skips when no channel id is configured", async () => {
    const send = vi.fn();
    const adapter = { getStatus: () => ({ phase: "running" }), getOwnerUserId: () => "1", send };
    const ok = await deliverScreenCompanionMessage(
      "哈囉",
      { ...baseVision, proactiveTarget: "discord", discordSubTarget: "channel", discordChannelId: "" },
      generalSettings,
      { manager: { getAdapter: () => adapter as never } },
    );
    expect(ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("discord target skips when the adapter is not running", async () => {
    const adapter = { getStatus: () => ({ phase: "offline" }) };
    const ok = await deliverScreenCompanionMessage(
      "哈囉",
      { ...baseVision, proactiveTarget: "discord" },
      generalSettings,
      { manager: { getAdapter: () => adapter as never } },
    );
    expect(ok).toBe(false);
  });

  it("wechat target delegates to sendProactiveChannelMessage", async () => {
    sendProactiveChannelMessage.mockResolvedValueOnce({ kind: "committed", deliveredParts: 1, totalParts: 1 });
    const ok = await deliverScreenCompanionMessage(
      "哈囉",
      { ...baseVision, proactiveTarget: "wechat" },
      generalSettings,
      { manager: { getAdapter: vi.fn() } },
    );
    expect(ok).toBe(true);
    expect(sendProactiveChannelMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: "wechat", text: "哈囉" }));
  });

  it("wechat target returns false when delivery is cancelled", async () => {
    sendProactiveChannelMessage.mockResolvedValueOnce({ kind: "cancelled", reason: "recipient_unavailable" });
    const ok = await deliverScreenCompanionMessage(
      "哈囉",
      { ...baseVision, proactiveTarget: "wechat" },
      generalSettings,
      { manager: { getAdapter: vi.fn() } },
    );
    expect(ok).toBe(false);
  });
});
