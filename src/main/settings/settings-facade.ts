import * as fs from "fs";
import { app } from "electron";
import {
  DEFAULT_WINDOW_CORNER_RADIUS,
  normalizeWindowCornerRadius,
} from "../../shared/window-corner-radius";
import { DEFAULT_UI_FONT, normalizeUiFont } from "../../shared/ui-font";
import {
  DEFAULT_CUSTOM_STYLE,
  normalizeCustomStyleConfig,
  normalizeStyleId,
} from "../../shared/style-sampling";
import { normalizeUiTheme } from "../../shared/ui-theme";
import { normalizeUiIcon } from "../../shared/ui-icon";
import { normalizeChatAppearance } from "../../shared/chat-appearance";
import {
  normalizeChatSocialContextEnabled,
  normalizeDefaultChatMode,
  normalizeMobileMessageSegmentationMode,
  normalizeProactiveChatMode,
  normalizeProactiveDeliveryTarget,
  normalizeSegmentedOutputMode,
} from "../../shared/preferences";
import { normalizeWindowVisibilitySettings } from "../window-visibility-settings";
import { normalizeCitaSettings } from "../cita/settings";
import { getGeneralSettingsPath } from "../settings-store";
import type { GeneralSettings } from "./general-settings";
import type { ConversationMode } from "../../shared/chat-types";
import type { ToolModeOverrides } from "../orchestrator/tool-registry";
import type { SkillModeOverrides } from "../skills/types";
import type { LspServerOverride } from "../lsp/types";
import {
  isSecretVaultAvailable,
  isProtectedSecret,
  preserveLockedSecrets,
  protectSecrets,
  revealSecret,
  revealSecrets,
} from "../security/secret-vault";

const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  maxParallelToolCalls: 4,
  citaEnabled: false,
  citaSemanticEngine: "remote",
  chatSocialContextEnabled: false,
  musicEnabled: false,
  musicVolume: 60,
  soundEnabled: true,
  soundVolume: 70,
  petAlwaysOnTop: true,
  petVisible: true,
  petChatInputEnabled: false,
  petZoom: 1,
  sidebarVisible: true,
  tasksVisible: true,
  launchAtLogin: false,
  language: "zh-TW",
  uiTheme: "cyrene-night",
  windowCornerRadius: DEFAULT_WINDOW_CORNER_RADIUS,
  uiThemeRadius: false,
  uiFont: DEFAULT_UI_FONT,
  uiIcon: "cyrene-sun",
  defaultChatMode: "chat",
  currentStyleId: "default",
  customStyle: DEFAULT_CUSTOM_STYLE,
  segmentedOutputMode: "off",
  mobileMessageSegmentation: "off",
  proactiveChatMode: "off",
  proactiveDeliveryTarget: "local",
  ttsEngine: "off",
  ttsAutoRead: true,
  ttsSpeed: 1,
  ttsVolume: 1,
  ttsMinimaxKey: "",
  ttsMinimaxVoiceId: "",
  ttsMinimaxModel: "speech-2.8-turbo",
  ttsStreaming: true,
  ttsMinimaxVocalEnhance: true,
  ttsGptsovitsBaseUrl: "http://localhost:9880",
  ttsGptsovitsRefAudioPath: "",
  ttsGptsovitsPromptText: "",
  ttsGptsovitsFormat: "wav",
  ttsGptsovitsTimeoutMs: 180_000,
  ttsCustomCloudEndpointUrl: "",
  ttsCustomCloudApiKey: "",
  ttsCustomCloudVoiceId: "",
  ttsCustomCloudFormat: "mp3",
  ttsCustomCloudTimeoutMs: 30000,
  ttsMimoKey: "",
  ttsMimoVoiceAudioPath: "",
  ttsMimoStylePrompt: "温柔、自然、略带亲近感，像在轻声陪用户聊天。",
  ttsMosslandKey: "",
  ttsMosslandVoiceId: "",
  ttsMosslandModel: "moss-tts",
  ttsMosslandTestText: "你好呀，我是昔涟。今天也请多多关照♪",
  ttsMosslandFormat: "mp3",
  weatherSource: "open-meteo",
  weatherEnabled: false,
  amapKey: "",
  travelEnabled: false,
  playwrightMcpEnabled: false,
  searchEngine: "off",
  searchBochaKey: "",
  searchTavilyKey: "",
  searchMinimaxKey: "",
  searchAnySearchKey: "",
  emailEnabled: false,
  emailSmtpHost: "",
  emailSmtpPort: 465,
  emailSmtpSecure: true,
  emailSmtpUser: "",
  emailSmtpPass: "",
  emailFromName: "",
  asrEngine: "off",
  asrAliyunAppKey: "",
  asrAliyunAccessKeyId: "",
  asrAliyunAccessKeySecret: "",
  asrLanguage: "zh",
  // 換手基準值。1000ms 在通話裡明顯偏慢——使用者話音落下後要乾等一整秒昔漣才
  // 開始想。600ms 仍足以吃掉一般說話的換氣停頓，語尾偵測到「還沒講完」時
  // calculateDynamicVadSilenceMs 還會自己往上加。
  asrVadSilenceMs: 600,
  asrVadThreshold: 0.01,
  asrShowTranscript: false,
  asrFallbackToLocal: true,
  asrPushToTalk: false,
  openerMode: "off",
  openerQuietStart: "23:00",
  openerQuietEnd: "07:00",
  openerDailyLimit: 4,
  openerRoutineEnabled: true,
  openerBreaksEnabled: true,
  openerWeatherEnabled: true,
  screenshotHotkey: "Alt+Shift+S",
  chatLineHeight: 1.75,
  toolModeOverrides: {},
  skillModeOverrides: {},
  lspServerOverrides: [],
  assistantBubbleEnabled: true,
};

const listeners = new Set<(before: GeneralSettings, after: GeneralSettings) => void>();

let generalSettingsCache: GeneralSettings | null = null;

export function onGeneralSettingsChanged(
  listener: (before: GeneralSettings, after: GeneralSettings) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyGeneralSettingsChanged(before: GeneralSettings, after: GeneralSettings): void {
  for (const listener of listeners) {
    listener(before, after);
  }
}

/** ASR 引擎值正規化。
 * "local" 走的是本機離線 Whisper（見 call-manager.endTurn），不需要金鑰。
 * 舊版設定介面曾提供 "web-speech" 這個選項值，但它從來不在允許清單裡，
 * 選了會被靜默打回 "off"——使用者以為開了離線辨識，實際上通話永遠不會回話。
 * 這裡把它遷移到它本來就該對應的 "local"，而不是繼續吞掉。 */
function normalizeAsrEngine(input: unknown): "off" | "aliyun" | "volcano" | "local" {
  const value = String(input);
  if (value === "web-speech") return "local";
  if (value === "off" || value === "aliyun" || value === "volcano" || value === "local") return value;
  return "off";
}

export function normalizeGeneralSettings(
  input: Partial<GeneralSettings> | null | undefined,
): GeneralSettings {
  const windowVisibility = normalizeWindowVisibilitySettings(input);
  const cita = normalizeCitaSettings({
    enabled: input?.citaEnabled,
    semanticEngine: input?.citaSemanticEngine,
  });
  const clamp = (value: unknown, fallback: number) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : fallback;
  };
  const clampPort = (value: unknown, fallback: number) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.max(1, Math.min(65535, Math.round(num))) : fallback;
  };
  const clampMs = (value: unknown, fallback: number) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.max(1000, Math.min(120000, Math.round(num))) : fallback;
  };
  const normalizeTime = (value: unknown, fallback: string) =>
    typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
  const compatibleInput = { ...(input ?? {}) } as Partial<GeneralSettings> & Record<string, unknown>;
  for (const field of [
    "dailyRitualEnabled",
    "dailyRitualVoice",
    "dailyRitualMorningEnabled",
    "dailyRitualMorningTime",
    "dailyRitualAfternoonEnabled",
    "dailyRitualAfternoonTime",
    "dailyRitualEveningEnabled",
    "dailyRitualEveningTime",
  ]) {
    delete compatibleInput[field];
  }
  // Keep fields written by older/custom builds even when this version does not
  // expose them yet.  Without this compatibility layer, opening Settings and
  // saving a single value would silently erase user-added configuration.
  return {
    maxParallelToolCalls: typeof input?.maxParallelToolCalls === "number"
      ? Math.max(1, Math.min(12, Math.round(input.maxParallelToolCalls)))
      : DEFAULT_GENERAL_SETTINGS.maxParallelToolCalls,
    ...compatibleInput,
    citaEnabled: cita.enabled,
    citaSemanticEngine: cita.semanticEngine,
    chatSocialContextEnabled: normalizeChatSocialContextEnabled(input?.chatSocialContextEnabled),
    musicEnabled: Boolean(input?.musicEnabled),
    musicVolume: clamp(input?.musicVolume, DEFAULT_GENERAL_SETTINGS.musicVolume),
    soundEnabled: input?.soundEnabled === undefined ? true : Boolean(input.soundEnabled),
    soundVolume: clamp(input?.soundVolume, DEFAULT_GENERAL_SETTINGS.soundVolume),
    petAlwaysOnTop: input?.petAlwaysOnTop === undefined
      ? DEFAULT_GENERAL_SETTINGS.petAlwaysOnTop
      : Boolean(input.petAlwaysOnTop),
    petVisible: input?.petVisible === undefined
      ? DEFAULT_GENERAL_SETTINGS.petVisible
      : Boolean(input.petVisible),
    petChatInputEnabled: input?.petChatInputEnabled === undefined
      ? DEFAULT_GENERAL_SETTINGS.petChatInputEnabled
      : Boolean(input.petChatInputEnabled),
    petZoom: typeof input?.petZoom === "number"
      ? Math.max(0.5, Math.min(2, input.petZoom))
      : DEFAULT_GENERAL_SETTINGS.petZoom,
    petWindowX: typeof input?.petWindowX === "number" && isFinite(input.petWindowX)
      ? Math.round(input.petWindowX)
      : undefined,
    petWindowY: typeof input?.petWindowY === "number" && isFinite(input.petWindowY)
      ? Math.round(input.petWindowY)
      : undefined,
    disableGpuElectron: input?.disableGpuElectron,
    sidebarVisible: windowVisibility.sidebarVisible,
    tasksVisible: windowVisibility.tasksVisible,
    launchAtLogin: Boolean(input?.launchAtLogin),
    language: "zh-TW",
    uiTheme: normalizeUiTheme(input?.uiTheme),
    windowCornerRadius: normalizeWindowCornerRadius(input?.windowCornerRadius),
    uiThemeRadius: input?.uiThemeRadius ?? true,
    uiFont: normalizeUiFont(input?.uiFont),
    uiIcon: normalizeUiIcon(input?.uiIcon),
    defaultChatMode: normalizeDefaultChatMode(input?.defaultChatMode),
    currentStyleId: normalizeStyleId(input?.currentStyleId),
    customStyle: normalizeCustomStyleConfig(input?.customStyle),
    segmentedOutputMode: normalizeSegmentedOutputMode(input?.segmentedOutputMode),
    mobileMessageSegmentation: normalizeMobileMessageSegmentationMode(input?.mobileMessageSegmentation),
    proactiveChatMode: normalizeProactiveChatMode(input?.proactiveChatMode),
    proactiveDeliveryTarget: normalizeProactiveDeliveryTarget(input?.proactiveDeliveryTarget),
    ttsEngine: (["off", "minimax", "gptsovits", "custom-cloud", "mimo", "mossland"].includes(input?.ttsEngine as string)
      ? input?.ttsEngine
      : "off") as GeneralSettings["ttsEngine"],
    ttsAutoRead: input?.ttsAutoRead === undefined
      ? DEFAULT_GENERAL_SETTINGS.ttsAutoRead
      : Boolean(input.ttsAutoRead),
    ttsSpeed: typeof input?.ttsSpeed === "number"
      ? Math.max(0.5, Math.min(2, input.ttsSpeed))
      : DEFAULT_GENERAL_SETTINGS.ttsSpeed,
    ttsVolume: typeof input?.ttsVolume === "number"
      ? Math.max(0, Math.min(1, input.ttsVolume))
      : DEFAULT_GENERAL_SETTINGS.ttsVolume,
    ttsMinimaxKey: typeof input?.ttsMinimaxKey === "string" ? input.ttsMinimaxKey : "",
    ttsMinimaxVoiceId: typeof input?.ttsMinimaxVoiceId === "string" ? input.ttsMinimaxVoiceId : "",
    ttsMinimaxModel: input?.ttsMinimaxModel === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo",
    ttsStreaming: input?.ttsStreaming === undefined ? true : Boolean(input.ttsStreaming),
    ttsMinimaxVocalEnhance: input?.ttsMinimaxVocalEnhance === undefined
      ? DEFAULT_GENERAL_SETTINGS.ttsMinimaxVocalEnhance
      : Boolean(input.ttsMinimaxVocalEnhance),
    weatherSource: ["open-meteo", "amap"].includes(String(input?.weatherSource))
      ? (input!.weatherSource as "open-meteo" | "amap")
      : "open-meteo",
    weatherEnabled: Boolean(input?.weatherEnabled),
    amapKey: typeof input?.amapKey === "string" ? input.amapKey : "",
    travelEnabled: Boolean(input?.travelEnabled),
    playwrightMcpEnabled: Boolean(input?.playwrightMcpEnabled),
    searchEngine: ["off", "bocha", "tavily", "minimax", "anySearch"].includes(String(input?.searchEngine))
      ? (input!.searchEngine as "off" | "bocha" | "tavily" | "minimax" | "anySearch")
      : "off",
    searchBochaKey: typeof input?.searchBochaKey === "string" ? input.searchBochaKey : "",
    searchTavilyKey: typeof input?.searchTavilyKey === "string" ? input.searchTavilyKey : "",
    searchMinimaxKey: typeof input?.searchMinimaxKey === "string" ? input.searchMinimaxKey : "",
    searchAnySearchKey: typeof input?.searchAnySearchKey === "string" ? input.searchAnySearchKey : "",
    emailEnabled: Boolean(input?.emailEnabled),
    emailSmtpHost: typeof input?.emailSmtpHost === "string" ? input.emailSmtpHost : "",
    emailSmtpPort: clampPort(input?.emailSmtpPort, DEFAULT_GENERAL_SETTINGS.emailSmtpPort),
    emailSmtpSecure: input?.emailSmtpSecure === undefined
      ? (clampPort(input?.emailSmtpPort, DEFAULT_GENERAL_SETTINGS.emailSmtpPort) === 465)
      : Boolean(input.emailSmtpSecure),
    emailSmtpUser: typeof input?.emailSmtpUser === "string" ? input.emailSmtpUser : "",
    emailSmtpPass: typeof input?.emailSmtpPass === "string" ? input.emailSmtpPass : "",
    emailFromName: typeof input?.emailFromName === "string" ? input.emailFromName : "",
    asrEngine: normalizeAsrEngine(input?.asrEngine),
    asrAliyunAppKey: typeof input?.asrAliyunAppKey === "string" ? input.asrAliyunAppKey : "",
    asrAliyunAccessKeyId: typeof input?.asrAliyunAccessKeyId === "string" ? input.asrAliyunAccessKeyId : "",
    asrAliyunAccessKeySecret: typeof input?.asrAliyunAccessKeySecret === "string" ? input.asrAliyunAccessKeySecret : "",
    asrLanguage: ["zh", "en", "auto"].includes(String(input?.asrLanguage))
      ? (input!.asrLanguage as "zh" | "en" | "auto")
      : "zh",
    asrVadSilenceMs: typeof input?.asrVadSilenceMs === "number"
      ? Math.max(300, Math.min(30000, Math.round(input.asrVadSilenceMs)))
      : DEFAULT_GENERAL_SETTINGS.asrVadSilenceMs,
    asrVadThreshold: typeof input?.asrVadThreshold === "number"
      ? Math.max(0.001, Math.min(0.5, Number(input.asrVadThreshold)))
      : DEFAULT_GENERAL_SETTINGS.asrVadThreshold,
    asrShowTranscript: Boolean(input?.asrShowTranscript),
    asrFallbackToLocal: input?.asrFallbackToLocal === undefined ? true : Boolean(input.asrFallbackToLocal),
    asrPushToTalk: Boolean(input?.asrPushToTalk),
    openerMode: ["off", "quiet", "normal", "lively"].includes(String(input?.openerMode))
      ? input!.openerMode as GeneralSettings["openerMode"]
      : DEFAULT_GENERAL_SETTINGS.openerMode,
    openerQuietStart: normalizeTime(input?.openerQuietStart, DEFAULT_GENERAL_SETTINGS.openerQuietStart),
    openerQuietEnd: normalizeTime(input?.openerQuietEnd, DEFAULT_GENERAL_SETTINGS.openerQuietEnd),
    openerDailyLimit: typeof input?.openerDailyLimit === "number"
      ? Math.max(1, Math.min(12, Math.round(input.openerDailyLimit)))
      : DEFAULT_GENERAL_SETTINGS.openerDailyLimit,
    openerRoutineEnabled: input?.openerRoutineEnabled === undefined ? true : Boolean(input.openerRoutineEnabled),
    openerBreaksEnabled: input?.openerBreaksEnabled === undefined ? true : Boolean(input.openerBreaksEnabled),
    openerWeatherEnabled: input?.openerWeatherEnabled === undefined ? true : Boolean(input.openerWeatherEnabled),
    screenshotHotkey: typeof input?.screenshotHotkey === "string" && input.screenshotHotkey.trim()
      ? input.screenshotHotkey.trim()
      : DEFAULT_GENERAL_SETTINGS.screenshotHotkey,
    ttsGptsovitsBaseUrl: typeof input?.ttsGptsovitsBaseUrl === "string"
      ? input.ttsGptsovitsBaseUrl
      : DEFAULT_GENERAL_SETTINGS.ttsGptsovitsBaseUrl,
    ttsGptsovitsRefAudioPath: typeof input?.ttsGptsovitsRefAudioPath === "string" ? input.ttsGptsovitsRefAudioPath : "",
    ttsGptsovitsPromptText: typeof input?.ttsGptsovitsPromptText === "string" ? input.ttsGptsovitsPromptText : "",
    ttsGptsovitsFormat: input?.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav",
    ttsGptsovitsTimeoutMs: typeof input?.ttsGptsovitsTimeoutMs === "number" && Number.isFinite(input.ttsGptsovitsTimeoutMs)
      ? Math.max(10_000, Math.min(3_600_000, Math.round(input.ttsGptsovitsTimeoutMs)))
      : DEFAULT_GENERAL_SETTINGS.ttsGptsovitsTimeoutMs,
    ttsCustomCloudEndpointUrl: typeof input?.ttsCustomCloudEndpointUrl === "string" ? input.ttsCustomCloudEndpointUrl : "",
    ttsCustomCloudApiKey: typeof input?.ttsCustomCloudApiKey === "string" ? input.ttsCustomCloudApiKey : "",
    ttsCustomCloudVoiceId: typeof input?.ttsCustomCloudVoiceId === "string" ? input.ttsCustomCloudVoiceId : "",
    ttsCustomCloudFormat: input?.ttsCustomCloudFormat === "wav" ? "wav" : "mp3",
    ttsCustomCloudTimeoutMs: clampMs(input?.ttsCustomCloudTimeoutMs, DEFAULT_GENERAL_SETTINGS.ttsCustomCloudTimeoutMs),
    ttsMimoKey: typeof input?.ttsMimoKey === "string" ? input.ttsMimoKey : "",
    ttsMimoVoiceAudioPath: typeof input?.ttsMimoVoiceAudioPath === "string" ? input.ttsMimoVoiceAudioPath : "",
    ttsMimoStylePrompt: typeof input?.ttsMimoStylePrompt === "string"
      ? input.ttsMimoStylePrompt
      : DEFAULT_GENERAL_SETTINGS.ttsMimoStylePrompt,
    ttsMosslandKey: typeof input?.ttsMosslandKey === "string" ? input.ttsMosslandKey : "",
    ttsMosslandVoiceId: typeof input?.ttsMosslandVoiceId === "string" ? input.ttsMosslandVoiceId : "",
    ttsMosslandModel: typeof input?.ttsMosslandModel === "string" ? input.ttsMosslandModel : DEFAULT_GENERAL_SETTINGS.ttsMosslandModel,
    ttsMosslandTestText: typeof input?.ttsMosslandTestText === "string" ? input.ttsMosslandTestText : DEFAULT_GENERAL_SETTINGS.ttsMosslandTestText,
    ttsMosslandFormat: input?.ttsMosslandFormat === "wav" || input?.ttsMosslandFormat === "pcm"
      ? input.ttsMosslandFormat
      : "mp3",
    ...normalizeChatAppearance(input),
    toolModeOverrides: normalizeToolModeOverrides(input?.toolModeOverrides),
    skillModeOverrides: normalizeSkillModeOverrides(input?.skillModeOverrides),
    lspServerOverrides: normalizeLspServerOverrides(input?.lspServerOverrides),
  };
}

function normalizeToolModeOverrides(input: unknown): ToolModeOverrides {
  if (!input || typeof input !== "object") return {};
  const result: ToolModeOverrides = {};
  for (const [toolId, modeMap] of Object.entries(input as Record<string, unknown>)) {
    if (!modeMap || typeof modeMap !== "object") continue;
    const filtered: Partial<Record<ConversationMode, boolean>> = {};
    for (const [mode, value] of Object.entries(modeMap as Record<string, unknown>)) {
      if (!["chat", "work", "code", "learn"].includes(mode) || typeof value !== "boolean") continue;
      filtered[mode as ConversationMode] = value;
    }
    if (Object.keys(filtered).length) result[toolId] = filtered;
  }
  return result;
}

function normalizeSkillModeOverrides(input: unknown): SkillModeOverrides {
  if (!input || typeof input !== "object") return {};
  const result: SkillModeOverrides = {};
  for (const [skillId, modeMap] of Object.entries(input as Record<string, unknown>)) {
    if (!modeMap || typeof modeMap !== "object") continue;
    const filtered: Partial<Record<"work" | "code" | "learn", boolean>> = {};
    for (const [mode, value] of Object.entries(modeMap as Record<string, unknown>)) {
      if (!["work", "code", "learn"].includes(mode) || typeof value !== "boolean") continue;
      filtered[mode as "work" | "code" | "learn"] = value;
    }
    if (Object.keys(filtered).length) result[skillId] = filtered;
  }
  return result;
}

function normalizeLspServerOverrides(input: unknown): LspServerOverride[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item): LspServerOverride[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id.trim()) return [];
    return [{
      id: value.id.trim(),
      command: typeof value.command === "string" ? value.command.trim() || undefined : undefined,
      args: Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === "string") : undefined,
      extensions: Array.isArray(value.extensions) ? value.extensions.filter((ext): ext is string => typeof ext === "string") : undefined,
      initializationOptions: value.initializationOptions,
    }];
  });
}

function loadGeneralSettings0(): GeneralSettings {
  try {
    const filePath = getGeneralSettingsPath();
    if (!fs.existsSync(filePath)) return { ...DEFAULT_GENERAL_SETTINGS };
    const rawParsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<GeneralSettings>;
    // 舊版誤把 screenshotHotkey 當憑證加密。新規則不再加密它，但首次
    // 載入仍要明確解開歷史值，否則 UI 會顯示 cyvault 密文字串。
    if (isProtectedSecret(rawParsed.screenshotHotkey)) {
      rawParsed.screenshotHotkey = isSecretVaultAvailable()
        ? revealSecret(rawParsed.screenshotHotkey)
        : undefined;
    }
    const parsed = revealSecrets(rawParsed) as Partial<GeneralSettings>;
    if (!parsed.legacySettingsMigrationVersion && isSecretVaultAvailable()) {
      // 舊版的主動陪伴使用 openerMode；新版曾另外寫入預設 off，導致原本的
      // lively/normal/quiet 看似遺失。只遷移一次，之後尊重新版開關。
      if (parsed.openerMode && parsed.openerMode !== "off" && parsed.proactiveChatMode === "off") {
        parsed.proactiveChatMode = "on";
      }
      parsed.legacySettingsMigrationVersion = 1;
      fs.writeFileSync(filePath, JSON.stringify(protectSecrets(parsed), null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
    }
    return normalizeGeneralSettings(parsed);
  } catch (err) {
    console.error("[Cyrene] load general settings failed:", err);
    return { ...DEFAULT_GENERAL_SETTINGS };
  }
}

export function loadGeneralSettings(): GeneralSettings {
  if (generalSettingsCache !== null) return generalSettingsCache;
  const loaded = loadGeneralSettings0();
  // index.ts 會在 app.whenReady() 前讀 disableGpuElectron。此時 macOS
  // Keychain 可能尚不可用；不要把暫時解不開密文的結果快取整個執行期。
  // App ready 後，解密已在 loadGeneralSettings0 完成，不要再為「是否快取」
  // 額外同步探測 Keychain。即使設定沒有秘密，該探測在 macOS 冷啟動時
  // 也可能阻塞主程序，讓第一個視窗遲遲無法建立。
  if (app.isReady()) generalSettingsCache = loaded;
  return loaded;
}

export function saveGeneralSettings(partial: Partial<GeneralSettings>): GeneralSettings {
  const before = loadGeneralSettings();
  const normalized = normalizeGeneralSettings({ ...before, ...partial });
  const filePath = getGeneralSettingsPath();
  let currentRaw: unknown = {};
  try {
    if (fs.existsSync(filePath)) currentRaw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    currentRaw = {};
  }
  const protectedSettings = preserveLockedSecrets(protectSecrets(normalized), currentRaw);
  fs.writeFileSync(filePath, JSON.stringify(protectedSettings, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  generalSettingsCache = normalized;
  notifyGeneralSettingsChanged(before, normalized);
  return normalized;
}
