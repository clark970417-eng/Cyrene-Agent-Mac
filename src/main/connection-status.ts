import { app, net } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ConnectionStatusItem, ConnectionState } from "../shared/connection-status";
import { channelManager } from "./channels/manager";
import { loadChannelsSettings } from "./channels/settings-store";
import type { ChannelId, ChannelStatus } from "./channels/types";
import { loadPaintLocalConfig } from "./paint/paint-local-config";
import { getHuggingFaceStatus } from "./paint/huggingface";
import { loadGeneralSettings } from "./settings/settings-facade";
import { getPublicModelConfig, loadModelSettings } from "./settings/model-settings";
import { checkWebLlmStatus } from "./web-llm/web-llm-manager";
import { hasGoogleLoginCookies } from "./web-llm/gemini/gemini-session";

const CHANNEL_META: Record<ChannelId, { name: string; icon: string }> = {
  wechat: { name: "微信", icon: "💬" },
  feishu: { name: "飛書", icon: "🪽" },
  discord: { name: "Discord", icon: "🎮" },
};

function item(
  id: string,
  name: string,
  detail: string,
  icon: string,
  state: ConnectionState,
  label: string,
): ConnectionStatusItem {
  return { id, name, detail, icon, state, label };
}

export function mapChannelStatus(id: ChannelId, status: ChannelStatus): ConnectionStatusItem {
  const meta = CHANNEL_META[id];
  const state: ConnectionState = status.phase === "running"
    ? "connected"
    : status.phase === "starting"
      ? "pending"
      : "error";
  const label = status.phase === "running"
    ? "已連線"
    : status.phase === "starting"
      ? "連線中"
      : status.phase === "config_missing"
        ? "設定不完整"
        : "連線異常";
  return item(
    `channel:${id}`,
    meta.name,
    status.message?.trim() || (state === "connected" ? "即時通訊服務正常" : "請到連接設定檢查"),
    meta.icon,
    state,
    label,
  );
}

export function hasKaggleCredentials(
  homePath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.KAGGLE_API_TOKEN?.trim()) return true;
  if (env.KAGGLE_USERNAME?.trim() && env.KAGGLE_KEY?.trim()) return true;
  const credentialPath = path.join(homePath, ".kaggle", "kaggle.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(credentialPath, "utf8")) as Record<string, unknown>;
    return Boolean(
      (typeof parsed.token === "string" && parsed.token.trim())
      || (typeof parsed.username === "string" && parsed.username.trim()
        && typeof parsed.key === "string" && parsed.key.trim()),
    );
  } catch {
    return false;
  }
}

function configuredModelItems(): ConnectionStatusItem[] {
  const settings = loadModelSettings();
  const current = getPublicModelConfig(settings);
  const results: ConnectionStatusItem[] = [];
  const seen = new Set<string>();

  for (const [provider, profile] of Object.entries(settings.perProvider ?? {})) {
    if (!profile.apiKey?.trim()) continue;
    seen.add(provider);
    const isCurrent = provider === settings.provider;
    results.push(item(
      `model-api:${provider}`,
      provider,
      [profile.model || "模型未指定", isCurrent ? "目前使用中" : "已儲存"].join(" · "),
      "✨",
      isCurrent ? "connected" : "pending",
      isCurrent ? "API 使用中" : "API 已設定",
    ));
  }

  if (settings.apiKey?.trim() && !seen.has(settings.provider)) {
    results.unshift(item(
      `model-api:${settings.provider}`,
      current.shortName || current.provider,
      `${settings.model || "模型未指定"} · 目前使用中`,
      "✨",
      "connected",
      "API 使用中",
    ));
  }
  return results;
}

function searchConnectionItem(): ConnectionStatusItem | null {
  const settings = loadGeneralSettings();
  if (settings.searchEngine === "off") return null;
  const keys = {
    bocha: settings.searchBochaKey,
    tavily: settings.searchTavilyKey,
    minimax: settings.searchMinimaxKey,
    anySearch: settings.searchAnySearchKey,
  };
  const names = { bocha: "博查搜尋", tavily: "Tavily", minimax: "MiniMax 搜尋", anySearch: "AnySearch" };
  const configured = Boolean(keys[settings.searchEngine]?.trim());
  return item(
    `search:${settings.searchEngine}`,
    names[settings.searchEngine],
    configured ? "網路搜尋 API 金鑰已儲存" : "已選用，但尚未填寫 API 金鑰",
    "🌐",
    configured ? "pending" : "error",
    configured ? "API 已設定" : "缺少金鑰",
  );
}

function serviceConfigurationItems(): ConnectionStatusItem[] {
  const settings = loadGeneralSettings();
  const results: ConnectionStatusItem[] = [];
  const search = searchConnectionItem();
  if (search) results.push(search);

  if (settings.emailEnabled) {
    const ready = Boolean(settings.emailSmtpHost.trim() && settings.emailSmtpUser.trim() && settings.emailSmtpPass.trim());
    results.push(item("email", "電子郵件", ready ? settings.emailSmtpHost : "SMTP 設定不完整", "✉️", ready ? "pending" : "error", ready ? "已設定" : "需設定"));
  }

  if (settings.ttsEngine !== "off") {
    const names = { minimax: "MiniMax 語音", gptsovits: "GPT-SoVITS", "custom-cloud": "自訂雲端語音", mimo: "MiMo 語音", mossland: "Mossland 語音" };
    const ready = settings.ttsEngine === "gptsovits"
      ? Boolean(settings.ttsGptsovitsBaseUrl.trim())
      : settings.ttsEngine === "minimax"
        ? Boolean(settings.ttsMinimaxKey.trim())
        : settings.ttsEngine === "custom-cloud"
          ? Boolean(settings.ttsCustomCloudEndpointUrl.trim() && settings.ttsCustomCloudApiKey.trim())
          : settings.ttsEngine === "mimo"
            ? Boolean(settings.ttsMimoKey.trim())
            : Boolean(settings.ttsMosslandKey.trim());
    results.push(item("tts", names[settings.ttsEngine], ready ? "語音服務設定已儲存" : "語音服務設定不完整", "🎙️", ready ? "pending" : "error", ready ? "已設定" : "需設定"));
  }

  return results;
}

async function webLoginItems(): Promise<ConnectionStatusItem[]> {
  const settings = loadModelSettings();
  const results: ConnectionStatusItem[] = [];
  const [geminiResult, chatGptResult] = await Promise.allSettled([
    hasGoogleLoginCookies(),
    checkWebLlmStatus("chatgpt_web"),
  ]);
  const geminiLoggedIn = geminiResult.status === "fulfilled" && geminiResult.value;
  if (geminiLoggedIn || settings.provider === "gemini_web") {
    results.push(item("login:gemini", "Gemini 網頁版", geminiLoggedIn ? "Google 工作階段仍有效" : "找不到有效的 Google 登入工作階段", "♊️", geminiLoggedIn ? "connected" : "error", geminiLoggedIn ? "已登入" : "需重新登入"));
  }
  const chatGptLoggedIn = chatGptResult.status === "fulfilled" && chatGptResult.value.isLoggedIn;
  if (chatGptLoggedIn || settings.provider === "chatgpt_web") {
    results.push(item("login:chatgpt", "ChatGPT 網頁版", chatGptLoggedIn ? "OpenAI 工作階段仍有效" : "找不到有效的 OpenAI 登入工作階段", "🤖", chatGptLoggedIn ? "connected" : "error", chatGptLoggedIn ? "已登入" : "需重新登入"));
  }
  return results;
}

function channelItems(): ConnectionStatusItem[] {
  const configured = loadChannelsSettings();
  const runtime = channelManager.getAllStatus();
  const results: ConnectionStatusItem[] = [];
  for (const id of Object.keys(CHANNEL_META) as ChannelId[]) {
    if (!configured[id].enabled) continue;
    const status = runtime[id] ?? { enabled: true, phase: "error", message: "服務尚未建立執行狀態" };
    results.push(mapChannelStatus(id, status));
  }

  const spotifyConfigured = configured.spotify.enabled
    || Boolean(configured.spotify.refreshToken || configured.spotify.accountName);
  if (spotifyConfigured) {
    const ready = Boolean(configured.spotify.clientId && configured.spotify.refreshToken);
    results.push(item("spotify", "Spotify", ready ? (configured.spotify.accountName || "OAuth 授權已儲存") : "OAuth 授權資料不完整", "🎵", ready ? "connected" : "error", ready ? "已授權" : "需重新連接"));
  }

  const cloudConfigured = Boolean(
    configured.discord.cloudStandbyEnabled
    || configured.discord.cloudPingUrl
    || configured.discord.cloudStandbyHost,
  );
  if (cloudConfigured) {
    const discordStatus = runtime.discord;
    const detail = discordStatus?.message || (configured.discord.cloudStandbyHost ? "雲端 VM 連接資料已設定" : "雲端模式已啟用");
    const cloudRunning = /已確認|運行中|雲端主 Bot/.test(detail) && !/離線|失敗|異常/.test(detail);
    results.push(item("google-cloud", "Google Cloud", detail, "☁️", cloudRunning ? "connected" : "pending", cloudRunning ? "運行中" : "待確認"));
  }
  return results;
}

async function creativeCloudItems(): Promise<ConnectionStatusItem[]> {
  const results: ConnectionStatusItem[] = [];
  const kaggleReady = hasKaggleCredentials(app.getPath("home"));
  results.push(item(
    "kaggle",
    "Kaggle",
    kaggleReady ? "Kaggle API 憑證已偵測" : "App 無法讀取瀏覽器登入；可設定 Kaggle API 憑證",
    "📊",
    kaggleReady ? "pending" : "pending",
    kaggleReady ? "API 已設定" : "需確認",
  ));

  const paint = await loadPaintLocalConfig();
  if (paint.huggingFaceSpaceUrl?.trim()) {
    const status = await getHuggingFaceStatus(
      paint.huggingFaceSpaceUrl,
      paint.huggingFaceToken,
      (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(4_000) }),
    );
    results.push(item(
      "hugging-face",
      "Hugging Face",
      status.connected ? "Space API 可正常存取" : "Space 已設定，但目前無法連線",
      "🤗",
      status.connected ? "connected" : "error",
      status.connected ? "已連線" : "連線異常",
    ));
  }
  return results;
}

/**
 * Build every connection row independently. A broken optional service must
 * never collapse the whole card into a generic "讀取失敗" state.
 */
export async function getConnectionStatusItems(): Promise<ConnectionStatusItem[]> {
  const online = net.isOnline();
  const results: ConnectionStatusItem[] = [
    item("internet", "網際網路", online ? "macOS 回報網路可用" : "macOS 回報目前離線", "🌐", online ? "connected" : "error", online ? "已連線" : "離線"),
    ...configuredModelItems(),
    ...channelItems(),
    ...serviceConfigurationItems(),
  ];

  const probes = await Promise.allSettled([webLoginItems(), creativeCloudItems()]);
  for (const probe of probes) {
    if (probe.status === "fulfilled") results.push(...probe.value);
  }
  return results;
}
