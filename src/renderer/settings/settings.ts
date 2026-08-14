import "../ui/base.css";
import "./settings.css";
import "../ui/theme";
import {
  CHAT_DEFAULT_IDENTITY_LABEL,
  formatChatRelativeTime,
  type ChatSessionMetaUI,
} from "../../shared/chat-ui";
import { showModal } from "./shared/modal";
import { setSaveStatus, setCyreneSaveStatus, setGeneralSaveStatus } from "./shared/save-status";
import "./email/panel";
import { renderSkills } from "./skills/panel";
import "./plugins/permission";
import "./gamebot/panel";
import "./plugins/panel";
import "./asr/panel";
import { asrLanguageSelect } from "./asr/dom";
import "./search/panel";
import "./mcp/panel";
import "./preferences/panel";
import "./user/panel";
import "./memory/panel";
import "./rag/panel";
import { loadChannelsPanel, setChannelsPolling } from "./channels/panel";
import { tokenRangeDays, refreshTokenPanel, refreshAgentActivity } from "./tokens/panel";
import "./tts/panel";
import type { SchedulerApi } from "./scheduler/types";
import * as schedulerDom from "./scheduler/dom";
import {
  loadSchedulerPanel,
  openSchedulerEditor,
  closeSchedulerEditor,
  updateSchedulerConditionalFields,
  saveSchedulerTask,
} from "./scheduler/panel";
const {
  schedulerNewBtn,
  schedulerEditorClose,
  schedulerCancelBtn,
  schedulerSaveBtn,
  schedulerKindInput,
  schedulerToolLimitInput,
} = schedulerDom;

interface ProviderProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
  displayName?: string;
  /**
   * 用戶在 settings 顯式指定的 transport；"auto" = 按 baseUrl 啟發式 + capabilities fallback。
   * main 進程的 resolveTransport() 負責把 "auto" 解析為具體 transport。
   */
  explicitTransport?: "openai" | "anthropic" | "auto";
}

interface ModelSettings {
  mode: "auto" | "manual";
  provider: string;
  // 用戶給模型起的自定義暱稱，留空時用廠商 shortName。狀態欄"正在餵養"顯示它。
  displayName?: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   * 當前廠商的 explicitTransport 鏡像（頂層字段是 main 進程 perProvider[currentProvider] 的視圖）。
   * UI 改動 transport-select 時，saveConfig 把這個值帶給 main 進程摺疊回 perProvider。
   */
  explicitTransport?: "openai" | "anthropic" | "auto";
  // 按廠商緩存：切回該廠商時，從這裡恢復 baseUrl / model / apiKey
  perProvider?: Record<string, ProviderProfile>;
  runtimeSync: "off" | "local" | "llm";
  stickerEnabled: boolean;
  stickerSize: "small" | "standard" | "large";
  stickerSimilarityThreshold: number;
  vision?: {
    enabled?: boolean;
    autoAnalyze?: boolean;
    maxImages?: number;
    maxImageMb?: number;
    syncWithMain: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    screenCompanionEnabled?: boolean;
    observeIntervalSeconds?: number;
    talkativeness?: "quiet" | "normal" | "active" | "chatty";
    minTalkIntervalSeconds?: number;
    proactiveTarget?: "desktop" | "discord" | "wechat";
    discordSubTarget?: "dm" | "channel";
    discordChannelId?: string;
  };
}

interface ModelPreset {
  providerName: string;
  // 下拉選單顯示名；保留 providerName 可兼容既有配置鍵（例如 Custom）。
  selectLabel?: string;
  // 廠商短名（去括號後綴），用於狀態欄"正在餵養"顯示和暱稱默認值。
  // 如 "MiniMax（稀宇科技）" → shortName "MiniMax"。
  shortName: string;
  baseUrl: string;
  mainModels: string[];
  iconUrl: string;
  // 不需要真實密鑰的本機 OpenAI 兼容服務可提供一個佔位值。
  defaultApiKey?: string;
  // 廠商官網鏈接，顯示在預設下拉框旁邊，方便用戶直接跳轉註冊/查看文檔。
  websiteUrl?: string;
  // 視覺模型的 OpenAI 兼容 baseUrl。僅當主配走 Anthropic 入口、視覺要走 OpenAI 入口時才標
  // （如 MiniMax 主配 /anthropic，視覺走 /v1）。勾選"同步主模型"時 UI 用它填視覺框。
  visionBaseUrl?: string;
  // 該廠商默認主模型是否支持視覺。true 時設置頁加載默認勾選"同步主模型"，
  // 多模態用戶開箱即用。與 capabilities.ts 的 supportsVision 鏡像，需手動同步。
  supportsVision?: boolean;
  // 標記為 true 時，該項在 <select> 裡顯示但不可選；
  // 用於"已列出但 vendor adapter 還沒接好"的情況，避免用戶選到後調用直接報錯。
  disabled?: boolean;
}

interface GeneralSettings {
  musicEnabled: boolean;
  musicVolume: number;
  soundEnabled: boolean;
  soundVolume: number;
  petAlwaysOnTop: boolean;
  petVisible: boolean;
  petChatInputEnabled: boolean;
  petZoom: number;
  sidebarVisible: boolean;
  tasksVisible: boolean;
  launchAtLogin: boolean;
  language: "zh-CN";
  uiTheme: "cyrene-night" | "pearl-white";
  uiIcon?: "cyrene-pink" | "cyrene-sun";
  windowCornerRadius?: number;
  assistantBubbleEnabled?: boolean;
  chatSocialContextEnabled?: boolean;
  chatLineHeight?: number;
}

interface UserApi {
  getProfile: () => Promise<{
    nickname: string;
    callPreference: string;
    birthday: string;
    timezone: string;
    avatarPath: string;
    defaultCity: string;
  }>;
  saveProfile: (profile: Record<string, unknown>) => Promise<unknown>;
  uploadAvatar: () => Promise<{ avatarPath: string } | null>;
  getAvatar: () => Promise<string | null>;
}

interface MemoryPanelPayload {
  l0: {
    preferredName: string;
    occupation: string;
    longTermInterests: string;
    language: string;
    permanentNote: string;
  };
  l1: {
    recentGoals: string;
    recentPreferences: string;
    currentProject: string;
  };
  l2: Array<{
    id: string;
    content: string;
    triggerText: string;
    status: "active" | "aging" | "archived" | "superseded" | "merged";
    weight: number;
    createdAt: number;
    lastAccessedAt: number;
    accessCount: number;
    isPinned: boolean;
    sourceConversationId: string;
    isSummary: boolean;
    conflictCount: number;
    supersededBy?: string;
    mergedInto?: string;
    evidence: Array<{
      id: string;
      quoteSnippet: string;
      contextBeforeSnippet?: string;
      contextAfterSnippet?: string;
      conversationId?: string;
      createdAt: number;
      sourceStatus: "active" | "archived" | "deleted";
    }>;
  }>;
  graph: {
    nodes: Array<{
      id: string;
      name: string;
      type: "user" | "person" | "place" | "concept" | "preference" | "organization";
      mentionCount: number;
      firstMentionedAt: number;
      lastMentionedAt: number;
    }>;
    edges: Array<{
      id: string;
      sourceId: string;
      targetId: string;
      relation: string;
      strength: number;
      confidence: number;
      inferred: boolean;
    }>;
  };
  importedDocs: Array<{
    importId: string | null;
    fileName: string;
    chunkCount: number;
    lastImportedAt: number;
  }>;
  reflections: Array<{
    id: string;
    title: string;
    body: string;
    meta: string;
  }>;
}

interface MemoryPanelApi {
  getData: () => Promise<MemoryPanelPayload>;
  deleteImportedDoc: (
    importId: string,
    fileName?: string,
  ) => Promise<{ ok: boolean; deleted: number }>;
  saveL0: (patch: Record<string, unknown>) => Promise<{ ok: boolean }>;
  saveL1: (patch: Record<string, unknown>) => Promise<{ ok: boolean }>;
  pinL2: (id: string, pinned: boolean) => Promise<{ ok: boolean; error?: string }>;
  deleteL2: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

interface SettingsApi {
  minimize: () => void;
  close: () => void;
  getConfig: () => Promise<ModelSettings>;
  saveConfig: (config: Partial<ModelSettings>) => Promise<ModelSettings>;
  getGeneral: () => Promise<GeneralSettings>;
  saveGeneral: (config: Partial<GeneralSettings>) => Promise<GeneralSettings>;
  openSidebar: () => void;
  closeSidebar: () => void;
  openTasks: () => void;
  closeTasks: () => void;
  setPetAlwaysOnTop: (value: boolean) => void;
  setPetVisible: (value: boolean) => void;
  setPetZoom: (value: number) => void;
  previewRuntimeSync: (value: "off" | "local" | "llm") => void;
  openStickerManager: () => Promise<{ ok: boolean; error?: string }>;
  securityGetStatus: () => Promise<{
    available: boolean;
    backend: string;
    protectedCount: number;
    plaintextCount: number;
    lockedCount: number;
  }>;
  securityMigrate: () => Promise<{
    available: boolean;
    backend: string;
    protectedCount: number;
    plaintextCount: number;
    lockedCount: number;
  }>;
  securityRestartApp: () => void;
  backupGetConfig: () => Promise<{
    autoEnabled: boolean;
    retentionDays: 7 | 30;
    lastAutoBackupAt?: string;
  }>;
  backupSaveConfig: (patch: {
    autoEnabled?: boolean;
    retentionDays?: 7 | 30;
  }) => Promise<{ autoEnabled: boolean; retentionDays: 7 | 30; lastAutoBackupAt?: string }>;
  backupCreate: (categories: string[]) => Promise<BackupSummary | null>;
  backupPickInspect: () => Promise<BackupSummary | null>;
  backupRestore: (payload: {
    filePath: string;
    categories: string[];
  }) => Promise<{ restoredFiles: number; safetyBackupPath: string }>;
  stickerPickFile?: () => Promise<string | null>;
  stickerAdd?: (payload: {
    sourcePath: string;
    id: string;
    description: string;
    phrases: string[];
  }) => Promise<unknown>;
  getEmbeddingStatus?: () => Promise<Record<string, { installed: boolean; sizeBytes: number }>>;
  downloadEmbeddingModel?: (
    model: string,
    mirror: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteEmbeddingModel?: (model: string) => Promise<{ ok: boolean; error?: string }>;
  embeddingSetModel?: (
    model: string,
  ) => Promise<{ ok: boolean; clearedEntries?: number; error?: string }>;
  rerankerSetMode?: (mode: string) => Promise<boolean>;
  setToolEnabled?: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  getToolEnabled?: () => Promise<Record<string, boolean>>;
  listSkills?: () => Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      tools: string[];
      enabled: boolean;
      source: string;
      version?: string;
      references: string[];
    }>
  >;
  setSkillEnabled?: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  addMcpServer?: (config: unknown) => Promise<{ ok: boolean; toolIds?: string[]; error?: string }>;
  removeMcpServer?: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
  listMcpServers?: () => Promise<
    Array<{ id: string; name: string; connected: boolean; toolCount: number; toolIds: string[] }>
  >;
  getPermissionLevel?: () => Promise<{ level: "read-only" | "scoped" | "per-action" | "full" }>;
  setPermissionLevel?: (level: string) => Promise<{ ok: boolean; level?: string; error?: string }>;
  testConnection?: (config: {
    provider: string;
    baseUrl: string;
    model: string;
    apiKey: string;
  }) => Promise<{ ok: boolean; latency: number; sample?: string; error?: string }>;
  testVision?: (config: {
    baseUrl: string;
    apiKey: string;
    model: string;
  }) => Promise<{ ok: boolean; latency: number; sample?: string; error?: string }>;
  channelsDiscordGetProfile: () => Promise<DiscordBotProfile>;
  channelsDiscordGetMusicState: () => Promise<DiscordMusicState>;
  channelsDiscordGetMusicHistory: () => Promise<DiscordMusicHistoryEntry[]>;
  channelsDiscordGetMusicFavorites: () => Promise<DiscordMusicFavoriteEntry[]>;
  channelsDiscordControlMusic: (
    input: DiscordMusicControlInput,
  ) => Promise<{ ok: boolean; message: string; state?: DiscordMusicState }>;
  channelsDiscordUpdateProfile: (profile: {
    username: string;
    activityText: string;
    status: string;
    avatarPath?: string;
    bannerPath?: string;
  }) => Promise<{ ok: boolean; profile?: DiscordBotProfile; error?: string }>;
  channelsDiscordPickAvatar: () => Promise<string | null>;
  channelsDiscordPickBanner: () => Promise<string | null>;
  channelsDiscordCloudStatus: () => Promise<DiscordCloudControlStatus>;
  channelsDiscordCloudControl: (
    action: "local" | "cloud" | "restart-cloud",
  ) => Promise<DiscordCloudControlStatus>;
  channelsSpotifyAuthorize: (input: {
    clientId?: string;
    clientSecret?: string;
  }) => Promise<ChannelConnectionResult>;
  channelsSpotifyGetStatus: () => Promise<SpotifyPlaybackStatus>;
  channelsSpotifyControl: (input: {
    command: string;
    value?: number;
    deviceId?: string;
    query?: string;
  }) => Promise<{ ok: boolean; message: string }>;
  channelsSpotifyDisconnect: () => Promise<ChannelConnectionResult>;
  channelsBilibiliConnect: () => Promise<
    ChannelConnectionResult & { profilePath?: string; title?: string }
  >;
  channelsBilibiliGetStatus: () => Promise<BilibiliConnectionStatus>;
  channelsBilibiliDisconnect: () => Promise<ChannelConnectionResult>;
  channelsGetConfig: () => Promise<ChannelsPreviewConfig>;
  channelsSaveConfig: (patch: unknown) => Promise<unknown>;
  channelsList: () => Promise<unknown[]>;
  channelsGetStatus: () => Promise<Record<string, { phase: string; message?: string }>>;
  channelsRestart: () => Promise<ChannelConnectionResult>;
  channelsWechatInstall: () => Promise<ChannelConnectionResult>;
  channelsWechatLoginStart: () => Promise<ChannelConnectionResult>;
  channelsWechatLoginCancel: () => Promise<ChannelConnectionResult>;
  channelsWechatPairingList: () => Promise<unknown[]>;
  channelsWechatPairingApprove: (code: string) => Promise<ChannelConnectionResult>;
  channelsWechatLogout: () => Promise<ChannelConnectionResult>;
  channelsWechatRuntimeDetect: () => Promise<unknown>;
  channelsWechatRuntimeInstall: () => Promise<ChannelConnectionResult>;
  channelsWechatRuntimeUpdate: () => Promise<ChannelConnectionResult>;
  channelsFeishuTestConnection: () => Promise<ChannelConnectionResult>;
  channelsFeishuTestWebhookReachable: () => Promise<ChannelConnectionResult>;
  channelsDiscordTestConnection: () => Promise<ChannelConnectionResult>;
  channelsLogGet: (limit?: number) => Promise<unknown[]>;
  channelsLogClear: () => Promise<unknown>;
  onChannelsInstallProgress: (
    callback: (progress: { channel: string; phase: string; pct: number }) => void,
  ) => (() => void) | void;
  onChannelsStatusChanged: (callback: (status: unknown) => void) => (() => void) | void;
  onChannelsWechatQrcode: (callback: (dataUrl: string) => void) => (() => void) | void;
  onChannelsWechatLoginDone: (
    callback: (payload: { ok: boolean; botId?: string; error?: string }) => void,
  ) => (() => void) | void;
  // main → settings：要求切到指定標籤（窗口已打開時由 main 發這個事件）
  onSwitchSection?: (callback: (section: string) => void) => (() => void) | void;
}

interface BackupSummary {
  filePath: string;
  createdAt: string;
  appVersion: string;
  categories: Array<{ id: string; label: string; fileCount: number; sizeBytes: number }>;
  fileCount: number;
  sizeBytes: number;
}

declare global {
  interface Window {
    settings?: SettingsApi;
    cyreneScheduler?: SchedulerApi;
    user?: UserApi;
    memoryPanel?: MemoryPanelApi;
  }
}

const MODEL_PRESETS: ModelPreset[] = [
  {
    // 沿用既有的 Custom profile key，讓已保存的 OpenRouter API Key 無需遷移即可復用。
    providerName: "Custom",
    selectLabel: "OpenRouter（免費路由）",
    shortName: "OpenRouter Free",
    baseUrl: "https://openrouter.ai/api/v1",
    mainModels: ["openrouter/free"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openrouter.svg",
    websiteUrl: "https://openrouter.ai/",
  },
  {
    providerName: "Gemini（Google）",
    shortName: "Gemini 3.5 Flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    mainModels: ["gemini-3.5-flash"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg",
    websiteUrl: "https://aistudio.google.com/apikey",
    supportsVision: true,
  },
  {
    providerName: "Ollama（本機）",
    shortName: "Llama Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    mainModels: ["llama3.1:8b"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/ollama.svg",
    websiteUrl: "https://ollama.com/library/llama3.1",
    defaultApiKey: "ollama",
  },
  // 當前 v1 計劃適配的 7 家：MiniMax / 火山 Agent-Plan / 智譜 GLM / Kimi / Qwen / ChatGPT / Claude
  // 順序按使用頻率 + 適配優先級；未在此清單內的廠商已硬刪，需要時再補回。
  {
    providerName: "MiniMax（稀宇科技）",
    shortName: "MiniMax",
    baseUrl: "https://api.minimaxi.com/anthropic",
    mainModels: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/minimax.svg",
    websiteUrl: "https://platform.minimaxi.com/",
    // 主配走 /anthropic，但視覺要走 OpenAI 入口 /v1。勾"同步"時 UI 自動用這個，用戶不用手改。
    visionBaseUrl: "https://api.minimaxi.com/v1",
    supportsVision: true,
  },
  {
    // DeepSeek：v1 vendor adapter 不為它做協議層強制，僅作為 OpenAI 兼容廠商列出。
    // 已確認（來自官方定價文檔）：支持 Tool Calls / JSON Output；後端原生緩存（命中後輸入價跌至 1/50~1/120）。
    // 緩存能力等 v2 vendor adapter 接入時再利用，v1 不動。
    providerName: "DeepSeek（深度求索）",
    shortName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    mainModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/deepseek.svg",
    websiteUrl: "https://platform.deepseek.com/",
  },
  {
    providerName: "火山 AgentPlan（火山引擎）",
    shortName: "火山",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    mainModels: ["ark-code-latest"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/doubao.svg",
    websiteUrl: "https://www.volcengine.com/product/agent-plan",
    // 火山方舟是聚合平臺，路由到 doubao-seed 等多模態子模型時支持視覺
    supportsVision: true,
  },
  {
    providerName: "GLM（智譜）",
    shortName: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    mainModels: ["glm-5.1", "glm-5-turbo", "glm-4.7"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/zhipu.svg",
    websiteUrl: "https://open.bigmodel.cn/",
  },
  {
    providerName: "Kimi（月之暗面）",
    shortName: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    mainModels: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/moonshot.svg",
    websiteUrl: "https://platform.moonshot.cn/",
    // k2.6 / k2.7-code 支持 image_url 多模態
    supportsVision: true,
  },
  {
    providerName: "Qwen（通義千問）",
    shortName: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    mainModels: ["qwen-max", "qwen-plus", "qwen-turbo"],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/qwen.svg",
    websiteUrl: "https://bailian.console.aliyun.com/",
  },
  {
    providerName: "ChatGPT（OpenAI）",
    shortName: "ChatGPT",
    baseUrl: "https://api.openai.com/v1",
    // 國內多數用戶走中轉站，型號命名各家不一；預設留空，由用戶在型號輸入框裡自行填寫。
    mainModels: [],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg",
    websiteUrl: "https://platform.openai.com/",
  },
  {
    providerName: "Claude（Anthropic）",
    shortName: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    // 同上，且 Anthropic 協議尚未接入，暫禁選。
    mainModels: [],
    iconUrl: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg",
    websiteUrl: "https://console.anthropic.com/",
    // Anthropic 的請求體不是 OpenAI 兼容格式（messages / system / 流式都不一樣），
    // 在專屬 vendor adapter 接好之前先 disabled，避免用戶選到後調用直接報 4xx。
    disabled: true,
  },
];

if (!window.settings) {
  (window as unknown as { settings: SettingsApi }).settings = {
    minimize: () => {},
    close: () => {},
    getConfig: () =>
      Promise.resolve({
        mode: "manual",
        provider: "Custom",
        displayName: "OpenRouter Free",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openrouter/free",
        apiKey: "",
        runtimeSync: "off",
        stickerEnabled: true,
        stickerSize: "standard",
      }),
    saveConfig: (c) => Promise.resolve(c as ModelSettings),
    getGeneral: () =>
      Promise.resolve({
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
        language: "zh-CN",
        uiTheme: "classic",
      }),
    saveGeneral: (c) => Promise.resolve(c as GeneralSettings),
    openSidebar: () => {},
    closeSidebar: () => {},
    openTasks: () => {},
    closeTasks: () => {},
    setPetAlwaysOnTop: () => {},
    setPetVisible: () => {},
    setPetZoom: () => {},
    openStickerManager: async () => ({ ok: false, error: "settings api unavailable" }),
    securityGetStatus: async () => ({
      available: false,
      backend: "不可用",
      protectedCount: 0,
      plaintextCount: 0,
      lockedCount: 0,
    }),
    securityMigrate: async () => ({
      available: false,
      backend: "不可用",
      protectedCount: 0,
      plaintextCount: 0,
      lockedCount: 0,
    }),
    securityRestartApp: () => {},
    backupGetConfig: async () => ({ autoEnabled: false, retentionDays: 7 }),
    backupSaveConfig: async (patch) => ({
      autoEnabled: patch.autoEnabled ?? false,
      retentionDays: patch.retentionDays ?? 7,
    }),
    backupCreate: async () => null,
    backupPickInspect: async () => null,
    backupRestore: async () => ({ restoredFiles: 0, safetyBackupPath: "" }),
    stickerPickFile: async () => null,
    stickerAdd: async () => {
      throw new Error("settings api unavailable");
    },
    setToolEnabled: async () => ({ ok: false, error: "settings api unavailable" }),
    getToolEnabled: async () => ({}),
    listSkills: async () => [],
    setSkillEnabled: async () => ({ ok: false, error: "settings api unavailable" }),
    addMcpServer: async () => ({ ok: false, error: "settings api unavailable" }),
    removeMcpServer: async () => ({ ok: false, error: "settings api unavailable" }),
    listMcpServers: async () => [],
    channelsDiscordGetProfile: async () => ({
      connected: false,
      guildCount: 0,
      guilds: [],
      voiceActive: false,
    }),
    channelsDiscordGetMusicState: async () => ({
      active: false,
      paused: false,
      current: null,
      queue: [],
      volume: 100,
      repeat: "off",
      shuffle: false,
      autoplay: false,
      elapsed: 0,
    }),
    channelsDiscordGetMusicHistory: async () => [],
    channelsDiscordGetMusicFavorites: async () => [],
    channelsDiscordControlMusic: async () => ({ ok: false, message: "settings api unavailable" }),
    channelsDiscordUpdateProfile: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsDiscordPickAvatar: async () => null,
    channelsDiscordPickBanner: async () => null,
    channelsDiscordCloudStatus: async () => ({
      reachable: false,
      cloudService: "unknown",
      watchdog: "unknown",
      heartbeatAge: null,
      localConnected: false,
      mode: "transition",
    }),
    channelsDiscordCloudControl: async () => ({
      reachable: false,
      cloudService: "unknown",
      watchdog: "unknown",
      heartbeatAge: null,
      localConnected: false,
      mode: "transition",
    }),
    channelsSpotifyAuthorize: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsSpotifyGetStatus: async () => ({ configured: false, connected: false, devices: [] }),
    channelsSpotifyControl: async () => ({ ok: false, message: "settings api unavailable" }),
    channelsSpotifyDisconnect: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsBilibiliConnect: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsBilibiliGetStatus: async () => ({
      connected: false,
      browser: "Opera GX",
      profilePath: "",
    }),
    channelsBilibiliDisconnect: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsGetConfig: async () => ({
      wechat: { enabled: false },
      feishu: { enabled: false },
      discord: { enabled: false, requireMention: true, voiceEnabled: true },
      spotify: { enabled: false },
      bilibili: { enabled: false, browser: "opera-gx" },
      rateLimitPerUser: 10,
      rateLimitPerChannel: 100,
      ttsEnabled: true,
      stickerEnabled: true,
      mirrorToDesktop: true,
      toolSandbox: "safe-only",
    }),
    channelsSaveConfig: async () => ({}),
    channelsList: async () => [],
    channelsGetStatus: async () => ({
      wechat: { phase: "offline", message: "預覽模式" },
      feishu: { phase: "offline", message: "預覽模式" },
      discord: { phase: "offline", message: "預覽模式" },
    }),
    channelsRestart: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsWechatInstall: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsWechatLoginStart: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsWechatLoginCancel: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsWechatPairingList: async () => [],
    channelsWechatPairingApprove: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsWechatLogout: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsWechatRuntimeDetect: async () => ({ available: false }),
    channelsWechatRuntimeInstall: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsWechatRuntimeUpdate: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsFeishuTestConnection: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsFeishuTestWebhookReachable: async () => ({
      ok: false,
      error: "settings api unavailable",
    }),
    channelsDiscordTestConnection: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsLogGet: async () => [],
    channelsLogClear: async () => ({}),
    onChannelsInstallProgress: () => () => {},
    onChannelsStatusChanged: () => () => {},
    onChannelsWechatQrcode: () => () => {},
    onChannelsWechatLoginDone: () => () => {},
  };
}

if (!window.cyreneScheduler) {
  (window as unknown as { cyreneScheduler: SchedulerApi }).cyreneScheduler = {
    list: async () => ({ ok: true, value: [] }),
    add: async () => ({ ok: false, error: "scheduler api unavailable" }),
    update: async () => ({ ok: false, error: "scheduler api unavailable" }),
    delete: async () => ({ ok: false, error: "scheduler api unavailable" }),
    toggle: async () => ({ ok: false, error: "scheduler api unavailable" }),
    fireNow: async () => ({ ok: false, reason: "scheduler api unavailable" }),
    getHistory: async () => ({ ok: true, value: [] }),
    getTools: async () => ({ ok: true, value: [] }),
  };
}

const minBtn = document.getElementById("min-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const clickSound = new Audio("/audio/click.mp3");
clickSound.preload = "auto";

const bgmAudio = new Audio("/audio/bgm.mp3");
bgmAudio.preload = "auto";
bgmAudio.loop = true;
const apiForm = document.getElementById("api-form") as HTMLFormElement;
const generalForm = document.getElementById("general-form") as HTMLFormElement;
const sectionTitle = document.getElementById("section-title") as HTMLElement;
const sectionHint = document.getElementById("section-hint") as HTMLElement;
const placeholderPanel = document.getElementById("placeholder-panel") as HTMLElement;
const cyrenePanel = document.getElementById("cyrene-panel") as HTMLFormElement;
const disclaimerPanel = document.getElementById("disclaimer-panel") as HTMLElement;
const pluginsPanel = document.getElementById("plugins-panel") as HTMLElement;
const placeholderIcon = document.getElementById("placeholder-icon") as HTMLElement;
const placeholderTitle = document.getElementById("placeholder-title") as HTMLElement;
const placeholderCopy = document.getElementById("placeholder-copy") as HTMLElement;

const presetSelect = document.getElementById("preset-select") as HTMLSelectElement;
const presetWebsiteLink = document.getElementById("preset-website-link") as HTMLAnchorElement;
// 模式按鈕已刪除——baseUrl 永遠可改、模型名永遠可手填（datalist 出預設建議）
// provider 不再暴露給用戶（從預設內部拿，保證 capabilities 匹配不出錯）。
// 用戶看到的是"暱稱"框——給模型起自定義名字，狀態欄"正在餵養"顯示它。
const displayNameInput = document.getElementById("display-name") as HTMLInputElement;
const apiModeEnabledInput = document.getElementById("api-mode-enabled") as HTMLInputElement;
const baseUrlInput = document.getElementById("base-url") as HTMLInputElement;
const baseUrlResetBtn = document.getElementById("base-url-reset-btn") as HTMLButtonElement;
const modelInput = document.getElementById("model-input") as HTMLInputElement;
const modelInputSuggestions = document.getElementById(
  "model-input-suggestions",
) as HTMLDataListElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const loginChatGPTBtn = document.getElementById("login-chatgpt-btn") as HTMLButtonElement | null;
const loginGeminiBtn = document.getElementById("login-gemini-btn") as HTMLButtonElement | null;
const loginGeminiBtnLabel = document.getElementById(
  "login-gemini-btn-label",
) as HTMLSpanElement | null;
const geminiStatusText = document.getElementById("gemini-status-text") as HTMLSpanElement | null;
const geminiTestConnectionBtn = document.getElementById(
  "gemini-test-connection-btn",
) as HTMLButtonElement | null;
const geminiLogoutBtn = document.getElementById("gemini-logout-btn") as HTMLButtonElement | null;
const testConnectionBtn = document.getElementById(
  "test-connection-btn",
) as HTMLButtonElement | null;
const quickApiButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-api-source]"),
);
// API 協議下拉（auto / openai / anthropic）—— 用戶顯式 override transport
const transportSelect = document.getElementById("transport-select") as HTMLSelectElement;

// 視覺模型配置區元素
// 同步主模型改為膠囊按鈕組：[與主聊天模型相同] / [獨立配置]
const visionSyncBlocks = document.getElementById("vision-sync-blocks") as HTMLElement;
const visionSyncMainBtn = visionSyncBlocks.querySelector(
  '[data-vision-sync="main"]',
) as HTMLButtonElement;
const visionSyncIndepBtn = visionSyncBlocks.querySelector(
  '[data-vision-sync="independent"]',
) as HTMLButtonElement;
const visionBaseUrlInput = document.getElementById("vision-base-url") as HTMLInputElement;
const visionApiKeyInput = document.getElementById("vision-api-key") as HTMLInputElement;
const visionModelInput = document.getElementById("vision-model") as HTMLInputElement;
const visionFieldsWrap = document.querySelector(".vision-fields") as HTMLElement;
const testVisionBtn = document.getElementById("test-vision-btn") as HTMLButtonElement;
const visionTestStatus = document.getElementById("vision-test-status") as HTMLElement;
const visionEnabledInput = document.getElementById("vision-enabled") as HTMLInputElement;
const visionAutoAnalyzeInput = document.getElementById("vision-auto-analyze") as HTMLInputElement;
const visionMaxImagesSelect = document.getElementById("vision-max-images") as HTMLSelectElement;
const visionMaxImageMbSelect = document.getElementById("vision-max-image-mb") as HTMLSelectElement;
const screenCompanionEnabledInput = document.getElementById(
  "screen-companion-enabled",
) as HTMLInputElement | null;
const companionObserveIntervalBlocks = document.getElementById(
  "companion-observe-interval",
) as HTMLElement | null;
const companionTalkativenessBlocks = document.getElementById(
  "companion-talkativeness",
) as HTMLElement | null;
const companionMinIntervalBlocks = document.getElementById(
  "companion-min-interval",
) as HTMLElement | null;
const companionProactiveTargetBlocks = document.getElementById(
  "companion-proactive-target",
) as HTMLElement | null;
const companionDiscordSubgroup = document.getElementById(
  "companion-discord-subgroup",
) as HTMLElement | null;
const companionDiscordSubtargetBlocks = document.getElementById(
  "companion-discord-subtarget",
) as HTMLElement | null;
const companionDiscordChannelWrap = document.getElementById(
  "companion-discord-channel-wrap",
) as HTMLElement | null;
const companionDiscordChannelIdInput = document.getElementById(
  "companion-discord-channel-id",
) as HTMLInputElement | null;

// 渲染端內存緩存：保存每個廠商上一次填寫的 baseUrl / model / apiKey
// 切廠商時從這裡讀，保存時同步進去；持久化由 main 進程的 saveModelSettings 負責（perProvider 字段）。
const providerProfileCache: Record<string, ProviderProfile> = {};

// 當前激活的廠商：每次 applyPreset 後更新；用於"切到下一家廠商前先把當前那家的輸入框值緩存住"
let activeProvider: string = "";
const runtimeSyncSelect = document.getElementById("runtime-sync") as HTMLElement;
const runtimeSyncNote = document.getElementById("runtime-sync-note") as HTMLElement;
const stickerEnabledInput = document.getElementById("sticker-enabled") as HTMLInputElement;
const stickerSizeSelect = document.getElementById("sticker-size") as HTMLElement;
const musicEnabledInput = document.getElementById("music-enabled") as HTMLInputElement;
const musicVolumeInput = document.getElementById("music-volume") as HTMLInputElement;
const soundEnabledInput = document.getElementById("sound-enabled") as HTMLInputElement;
const soundVolumeInput = document.getElementById("sound-volume") as HTMLInputElement;
const petAlwaysOnTopInput = document.getElementById("pet-always-on-top") as HTMLInputElement;
const petVisibleInput = document.getElementById("pet-visible") as HTMLInputElement;
const petChatInputEnabledInput = document.getElementById(
  "pet-chat-input-enabled",
) as HTMLInputElement;
const petZoomInput = document.getElementById("pet-zoom") as HTMLInputElement;
const petZoomVal = document.getElementById("pet-zoom-val") as HTMLElement;
const launchAtLoginInput = document.getElementById("launch-at-login") as HTMLInputElement;
const uiThemeSelect = document.getElementById("ui-theme-select") as HTMLElement;
const uiIconSelect = document.getElementById("ui-icon-select") as HTMLElement;
const windowCornerRadiusInput = document.getElementById("window-corner-radius") as HTMLInputElement;
const windowCornerRadiusVal = document.getElementById("window-corner-radius-val") as HTMLElement;
const assistantBubbleEnabledInput = document.getElementById(
  "assistant-bubble-enabled",
) as HTMLInputElement;
const chatSocialContextEnabledInput = document.getElementById(
  "chat-social-context-enabled",
) as HTMLInputElement;
const chatLineHeightInput = document.getElementById("chat-line-height") as HTMLInputElement;
const chatLineHeightVal = document.getElementById("chat-line-height-val") as HTMLElement;
const languageSelect = document.getElementById("language-select") as HTMLElement;
const sidebarVisibleInput = document.getElementById("sidebar-visible") as HTMLInputElement;
const tasksVisibleInput = document.getElementById("tasks-visible") as HTMLInputElement;
const clearChatHistoryBtn = document.getElementById("clear-chat-history-btn") as HTMLButtonElement;
const stickerThresholdInput = document.getElementById("sticker-threshold") as HTMLInputElement;
const stickerThresholdVal = document.getElementById("sticker-threshold-val") as HTMLElement;

const NAV_LABELS: Record<string, { emoji: string; title: string; hint: string }> = {
  memory: { emoji: "🧠", title: "記憶", hint: "管理長期記憶與畫像" },
  chat: { emoji: "💬", title: "聊天", hint: "管理聊天窗口與會話" },
  user: { emoji: "👤", title: "用戶信息", hint: "編輯你的個人資料" },
  tasks: { emoji: "⏰", title: "定時任務", hint: "管理定時提醒與日程" },
  identity: { emoji: "💼", title: "職位", hint: "自定義昔漣的身份定位與工作職責" },
  skills: { emoji: "✨", title: "Skill", hint: "管理 agent 的 skill 指令（約束如何用工具）" },
  plugins: { emoji: "🔌", title: "插件", hint: "擴展功能與第三方集成" },
  general: { emoji: "⚙️", title: "設置", hint: "通用偏好與外觀" },
  api: { emoji: "🔑", title: "API 設置", hint: "選擇預設後只需要填寫 API Key。" },
  cyrene: { emoji: "🌸", title: "昔漣設置", hint: "管理 Agent 行為、記憶、RAG 與權限" },
  channels: { emoji: "📱", title: "連接手機", hint: "管理 Discord、Spotify、飛書與微信連線" },
  tts: { emoji: "🎙️", title: "TTS 設置", hint: "語音合成與朗讀偏好" },
  asr: { emoji: "🎧", title: "ASR 設置", hint: "語音識別與通話配置" },
  tokens: { emoji: "📊", title: "Token 用量", hint: "查看 API 調用統計與消耗" },
  security: { emoji: "🛡️", title: "資料安全", hint: "備份回憶並保護本機密鑰" },
  disclaimer: { emoji: "📜", title: "免責聲明", hint: "使用條款與隱私說明" },
  "channels-discord": { emoji: "💬", title: "Discord", hint: "管理 Bot 身分、連線與回覆規則" },
};

minBtn.addEventListener("click", () => window.settings?.minimize());
closeBtn.addEventListener("click", () => window.settings?.close());

document.addEventListener(
  "click",
  (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (
      target.closest("button, input, select, .switch, .option-block, .language-option, .nav-item")
    ) {
      playSettingsClickSound();
    }
  },
  true,
);

function playSettingsClickSound(): void {
  if (!soundEnabledInput.checked) return;
  clickSound.pause();
  clickSound.currentTime = 0;
  clickSound.volume = Math.max(0, Math.min(1, Number(soundVolumeInput.value) / 100));
  void clickSound.play().catch(() => {});
}

function syncMusicPlayback(): void {
  bgmAudio.volume = Math.max(0, Math.min(1, Number(musicVolumeInput.value) / 100));
  if (musicEnabledInput.checked) {
    void bgmAudio.play().catch(() => {});
  } else {
    bgmAudio.pause();
  }
}

function getRuntimeSyncValue(): "off" | "local" | "llm" {
  const v =
    runtimeSyncSelect.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.value;
  return v === "llm" ? "llm" : v === "local" ? "local" : "off";
}

function applyRuntimeSyncSelection(value: "off" | "local" | "llm"): void {
  runtimeSyncSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  syncRuntimeNote();
}

function syncRuntimeNote(): void {
  runtimeSyncNote.classList.toggle("is-hidden", getRuntimeSyncValue() !== "llm");
}

function getStickerSizeValue(): "small" | "standard" | "large" {
  const value =
    stickerSizeSelect.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.value;
  return value === "small" || value === "large" ? value : "standard";
}

function applyStickerSizeSelection(value: "small" | "standard" | "large"): void {
  stickerSizeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function applyLanguageSelection(language: "zh-CN"): void {
  languageSelect.querySelectorAll<HTMLButtonElement>(".language-option").forEach((button) => {
    const active = button.dataset.lang === language;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function normalizeUiTheme(theme: unknown): GeneralSettings["uiTheme"] {
  return theme === "pearl-white" ? "pearl-white" : "cyrene-night";
}

function getUiThemeValue(): GeneralSettings["uiTheme"] {
  const value =
    uiThemeSelect.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.theme;
  return normalizeUiTheme(value);
}

function applyUiThemeSelection(theme: GeneralSettings["uiTheme"]): void {
  uiThemeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.theme === theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.documentElement.dataset.uiTheme = theme;
}

function normalizeUiIcon(icon: unknown): NonNullable<GeneralSettings["uiIcon"]> {
  return icon === "cyrene-pink" ? "cyrene-pink" : "cyrene-sun";
}

function applyUiIconSelection(icon: GeneralSettings["uiIcon"]): void {
  const value = normalizeUiIcon(icon);
  uiIconSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.icon === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function fillPresetOptions(): void {
  presetSelect.replaceChildren();
  for (const preset of MODEL_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.providerName;
    if (preset.disabled) {
      option.textContent = (preset.selectLabel ?? preset.providerName) + "（暫未適配）";
      option.disabled = true;
    } else {
      option.textContent = preset.selectLabel ?? preset.providerName;
    }
    presetSelect.appendChild(option);
  }
}

function findPreset(providerName: string): ModelPreset {
  // fallback：找不到匹配的預設時，回退到列表第一個可用項（當前是 OpenRouter）。
  // 不直接返回 MODEL_PRESETS[0] 是為了未來若把首項改成 disabled 也仍然合法。
  const fallback = MODEL_PRESETS.find((preset) => !preset.disabled) ?? MODEL_PRESETS[0];
  return MODEL_PRESETS.find((preset) => preset.providerName === providerName) ?? fallback;
}

/**
 * 填充模型名輸入框 + datalist 聯想建議。
 * 模式按鈕已刪除——只有一個輸入框，可手填，按方向鍵也能從廠商預設裡選。
 */
function fillModelOptions(preset: ModelPreset, preferredModel?: string): void {
  // datalist 聯想建議
  modelInputSuggestions.replaceChildren();
  for (const model of preset.mainModels) {
    const option = document.createElement("option");
    option.value = model;
    modelInputSuggestions.appendChild(option);
  }

  // 選中值：preferredModel 命中預設則用之；否則用預設首項；
  // preferredModel 不在預設裡（用戶自填型號）也保留顯示，不強行清空。
  const fallback = preset.mainModels[0] ?? "";
  modelInput.value = preferredModel ?? fallback;
}

/**
 * 把"當前輸入框裡的值"快照到內存緩存裡（perProvider）。
 * 切廠商前調用一次，避免覆蓋丟失。
 */
function captureActiveProviderProfile(): void {
  if (!activeProvider) return;
  providerProfileCache[activeProvider] = {
    baseUrl: baseUrlInput.value.trim(),
    model: getCurrentModelValue().trim(),
    apiKey: apiKeyInput.value.trim(),
    displayName: displayNameInput.value.trim(),
    explicitTransport: transportSelect.value as ProviderProfile["explicitTransport"],
  };
}

function syncQuickApiSelection(): void {
  for (const button of quickApiButtons) {
    const active = button.dataset.apiSource === activeProvider;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    const state = button.querySelector<HTMLElement>(".api-source-card__state");
    if (state) state.textContent = active ? "使用中" : "選擇";
  }
}

/** 模式按鈕已刪除——模型名永遠從 input 讀取。保留函數名供舊調用點用，語義不變。 */
function getCurrentModelValue(): string {
  return modelInput.value;
}

/**
 * 視覺同步 UI（膠囊按鈕組）：
 * - 選"與主聊天模型相同"：三框變只讀 + 值隨主配置
 * - 選"獨立配置"：三框可編輯
 * baseUrl 特殊處理：若當前廠商標了 visionBaseUrl（主配走 Anthropic 入口、視覺要走 OpenAI 入口），
 * 用 visionBaseUrl 填視覺框，讓用戶看到的就是正確的視覺入口，不用手動改。
 */
function applyVisionSyncUI(): void {
  const enabled = visionEnabledInput.checked;
  const synced = visionSyncMainBtn.classList.contains("is-active");
  visionSyncMainBtn.disabled = !enabled;
  visionSyncIndepBtn.disabled = !enabled;
  visionAutoAnalyzeInput.disabled = !enabled;
  visionMaxImagesSelect.disabled = !enabled;
  visionMaxImageMbSelect.disabled = !enabled;
  testVisionBtn.disabled = !enabled;
  visionFieldsWrap.closest(".vision-config-section")?.classList.toggle("is-disabled", !enabled);
  if (synced) {
    visionFieldsWrap.classList.add("is-locked");
    // 找當前廠商 preset，看有沒有 visionBaseUrl
    const preset = findPreset(activeProvider);
    const visionBaseUrl = preset?.visionBaseUrl || baseUrlInput.value;
    visionBaseUrlInput.value = visionBaseUrl;
    visionApiKeyInput.value = apiKeyInput.value;
    visionModelInput.value = getCurrentModelValue();
  } else {
    visionFieldsWrap.classList.remove("is-locked");
  }
  for (const input of [visionBaseUrlInput, visionApiKeyInput, visionModelInput]) {
    input.disabled = !enabled;
  }
}

/** 切換視覺同步膠囊按鈕的激活態。synced=true 激活"與主相同"，false 激活"獨立配置"。 */
function setVisionSyncState(synced: boolean): void {
  visionSyncMainBtn.classList.toggle("is-active", synced);
  visionSyncMainBtn.setAttribute("aria-pressed", String(synced));
  visionSyncIndepBtn.classList.toggle("is-active", !synced);
  visionSyncIndepBtn.setAttribute("aria-pressed", String(!synced));
}

function getOptionBlockValue(container: HTMLElement | null, fallback: string): string {
  if (!container) return fallback;
  const activeBtn = container.querySelector(".option-block.is-active") as HTMLButtonElement | null;
  return activeBtn?.dataset.value ?? fallback;
}

function setOptionBlockValue(container: HTMLElement | null, value: string): void {
  if (!container) return;
  const buttons = container.querySelectorAll<HTMLButtonElement>(".option-block");
  for (const btn of buttons) {
    const isActive = btn.dataset.value === value;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  }
}

function bindOptionBlocksClick(container: HTMLElement | null, onChange?: () => void): void {
  if (!container) return;
  container.querySelectorAll<HTMLButtonElement>(".option-block").forEach((btn) => {
    btn.addEventListener("click", () => {
      setOptionBlockValue(container, btn.dataset.value ?? "");
      onChange?.();
    });
  });
}

function syncCompanionDiscordUI(): void {
  const target = getOptionBlockValue(companionProactiveTargetBlocks, "desktop");
  if (companionDiscordSubgroup) {
    companionDiscordSubgroup.style.display = target === "discord" ? "" : "none";
  }
  const subtarget = getOptionBlockValue(companionDiscordSubtargetBlocks, "dm");
  if (companionDiscordChannelWrap) {
    companionDiscordChannelWrap.style.display =
      target === "discord" && subtarget === "channel" ? "" : "none";
  }
}

function applyPreset(
  providerName: string,
  preferredModel?: string,
  preferredApiKey?: string,
  preferredBaseUrl?: string,
  preferredDisplayName?: string,
  preferredExplicitTransport?: "openai" | "anthropic" | "auto",
): void {
  const preset = findPreset(providerName);

  // 模式按鈕已刪除——ChatGPT / Claude 這種沒預設型號的廠商，input 框空著讓用戶手填，
  // datalist 沒建議也不影響（用戶知道自己型號）。

  presetSelect.value = preset.providerName;

  // 暱稱：優先用傳入的（用戶自定義過）；否則用廠商 shortName 作默認。
  // 留空顯示廠商短名——但這裡主動填 shortName 讓用戶看到默認值，可改可清。
  displayNameInput.value = preferredDisplayName ?? preset.shortName;

  // baseUrl：優先用緩存（用戶自定義過），其次用 preset 默認
  baseUrlInput.value = preferredBaseUrl ?? preset.baseUrl;

  fillModelOptions(preset, preferredModel);

  // apiKey：優先用緩存；否則**顯式清空**——避免上一家廠商的 key 殘留在輸入框裡被用戶誤點保存。
  // 這是 v1 切廠商行為裡的關鍵不變量：apiKey 永遠只跟當前廠商綁定。
  apiKeyInput.value = preferredApiKey ?? preset.defaultApiKey ?? "";

  // explicitTransport：優先用緩存（用戶自定義過），其次默認 "auto"
  // （切廠商時上一家的 explicitTransport 不應該延續，preset 自帶 capabilities transport 兜底）
  transportSelect.value = preferredExplicitTransport ?? "auto";

  // 官網鏈接：有 websiteUrl 就顯示並指向，沒有就隱藏。
  if (preset.websiteUrl) {
    presetWebsiteLink.href = preset.websiteUrl;
    presetWebsiteLink.title = `前往 ${preset.shortName} 官網`;
    presetWebsiteLink.style.display = "";
  } else {
    presetWebsiteLink.style.display = "none";
  }

  activeProvider = preset.providerName;
  syncQuickApiSelection();
}

async function loadConfig(): Promise<void> {
  try {
    fillPresetOptions();
    const cfg = await window.settings!.getConfig();
    // 模式按鈕已刪除——mode 字段不再用 UI 控制，直接忽略 cfg.mode
    // 把 main 進程返回的 perProvider 灌進渲染端內存緩存，切廠商時用到
    if (cfg.perProvider && typeof cfg.perProvider === "object") {
      for (const [key, value] of Object.entries(cfg.perProvider)) {
        if (value && typeof value === "object") {
          providerProfileCache[key] = {
            baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
            model: typeof value.model === "string" ? value.model : "",
            apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
            displayName:
              typeof (value as { displayName?: unknown }).displayName === "string"
                ? (value as { displayName: string }).displayName
                : undefined,
            explicitTransport: (value as { explicitTransport?: "openai" | "anthropic" | "auto" })
              .explicitTransport,
          };
        }
      }
    }
    // 舊版把 Google Gemini 存在 ChatGPT profile 下。保留原資料並映射到新的專屬 Gemini 卡，
    // 讓用戶無需重新輸入已加密保存的 API Key。
    const legacyGemini = providerProfileCache["ChatGPT（OpenAI）"];
    if (
      !providerProfileCache["Gemini（Google）"] &&
      legacyGemini?.baseUrl.includes("generativelanguage.googleapis.com")
    ) {
      providerProfileCache["Gemini（Google）"] = {
        ...legacyGemini,
        displayName: legacyGemini.displayName || "Gemini 3.5 Flash",
      };
    }
    const loadedProvider =
      cfg.provider === "ChatGPT（OpenAI）" &&
      cfg.baseUrl.includes("generativelanguage.googleapis.com")
        ? "Gemini（Google）"
        : cfg.provider;
    if (apiModeEnabledInput) {
      const isWebLlm =
        loadedProvider === "chatgpt_web" ||
        loadedProvider === "gemini_web" ||
        (cfg as any).apiModeEnabled === false;
      apiModeEnabledInput.checked = !isWebLlm;
    }
    applyPreset(
      loadedProvider,
      cfg.model,
      cfg.apiKey,
      cfg.baseUrl,
      cfg.displayName,
      cfg.explicitTransport,
    );
    applyRuntimeSyncSelection(cfg.runtimeSync);
    stickerEnabledInput.checked = cfg.stickerEnabled !== false;
    applyStickerSizeSelection(cfg.stickerSize);
    const threshold = cfg.stickerSimilarityThreshold ?? 0.55;
    stickerThresholdInput.value = String(threshold);
    stickerThresholdVal.textContent = threshold.toFixed(2);

    // 視覺模型配置
    const vision = cfg.vision;
    if (vision) {
      visionEnabledInput.checked = vision.enabled !== false;
      visionAutoAnalyzeInput.checked = vision.autoAnalyze !== false;
      visionMaxImagesSelect.value = String(Math.max(1, Math.min(4, vision.maxImages ?? 4)));
      visionMaxImageMbSelect.value = String(
        [1, 5, 10].includes(vision.maxImageMb ?? 10) ? (vision.maxImageMb ?? 10) : 10,
      );
      setVisionSyncState(vision.syncWithMain);
      visionBaseUrlInput.value = vision.baseUrl || "";
      visionApiKeyInput.value = vision.apiKey || "";
      visionModelInput.value = vision.model || "";
      if (screenCompanionEnabledInput)
        screenCompanionEnabledInput.checked = vision.screenCompanionEnabled === true;
      setOptionBlockValue(
        companionObserveIntervalBlocks,
        String(vision.observeIntervalSeconds ?? 300),
      );
      setOptionBlockValue(companionTalkativenessBlocks, vision.talkativeness ?? "normal");
      setOptionBlockValue(companionMinIntervalBlocks, String(vision.minTalkIntervalSeconds ?? 30));
      setOptionBlockValue(companionProactiveTargetBlocks, vision.proactiveTarget ?? "desktop");
      setOptionBlockValue(companionDiscordSubtargetBlocks, vision.discordSubTarget ?? "dm");
      if (companionDiscordChannelIdInput)
        companionDiscordChannelIdInput.value = vision.discordChannelId || "";
      syncCompanionDiscordUI();
      syncScreenCompanionUI();
    } else {
      // 用戶從未配過視覺。按當前主模型 supportsVision 決定默認——
      // 多模態主模型用戶開箱即用（默認"與主相同"），非視覺主模型則默認"獨立配置"。
      const preset = findPreset(cfg.provider);
      visionEnabledInput.checked = preset?.supportsVision === true;
      visionAutoAnalyzeInput.checked = true;
      visionMaxImagesSelect.value = "4";
      visionMaxImageMbSelect.value = "10";
      setVisionSyncState(preset?.supportsVision === true);
      visionBaseUrlInput.value = "";
      visionApiKeyInput.value = "";
      visionModelInput.value = "";
      if (screenCompanionEnabledInput) screenCompanionEnabledInput.checked = false;
      setOptionBlockValue(companionObserveIntervalBlocks, "300");
      setOptionBlockValue(companionTalkativenessBlocks, "normal");
      setOptionBlockValue(companionMinIntervalBlocks, "30");
      setOptionBlockValue(companionProactiveTargetBlocks, "desktop");
      setOptionBlockValue(companionDiscordSubtargetBlocks, "dm");
      if (companionDiscordChannelIdInput) companionDiscordChannelIdInput.value = "";
      syncCompanionDiscordUI();
      syncScreenCompanionUI();
    }
    applyVisionSyncUI();

    setSaveStatus("等待保存");
    setCyreneSaveStatus("等待保存");
  } catch {
    fillPresetOptions();
    applyPreset("Custom");
    setSaveStatus("讀取配置失敗", "is-error");
    setCyreneSaveStatus("讀取配置失敗", "is-error");
  }
}

async function loadGeneralSettings(): Promise<void> {
  try {
    const cfg = await window.settings!.getGeneral();
    musicEnabledInput.checked = cfg.musicEnabled;
    musicVolumeInput.value = String(cfg.musicVolume);
    syncMusicPlayback();
    soundEnabledInput.checked = cfg.soundEnabled;
    soundVolumeInput.value = String(cfg.soundVolume);
    petAlwaysOnTopInput.checked = cfg.petAlwaysOnTop;
    petVisibleInput.checked = cfg.petVisible;
    petChatInputEnabledInput.checked = cfg.petChatInputEnabled ?? false;
    petZoomInput.value = String(cfg.petZoom ?? 1);
    petZoomVal.textContent = Math.round((cfg.petZoom ?? 1) * 100) + "%";
    sidebarVisibleInput.checked = cfg.sidebarVisible ?? true;
    tasksVisibleInput.checked = cfg.tasksVisible ?? true;
    launchAtLoginInput.checked = cfg.launchAtLogin;
    applyUiThemeSelection(normalizeUiTheme(cfg.uiTheme));
    applyUiIconSelection(cfg.uiIcon);
    windowCornerRadiusInput.value = String(cfg.windowCornerRadius ?? 16);
    windowCornerRadiusVal.textContent = String(cfg.windowCornerRadius ?? 16) + "px";
    assistantBubbleEnabledInput.checked = cfg.assistantBubbleEnabled !== false;
    chatSocialContextEnabledInput.checked = cfg.chatSocialContextEnabled !== false;
    chatLineHeightInput.value = String(cfg.chatLineHeight ?? 1.75);
    chatLineHeightVal.textContent = Number(chatLineHeightInput.value).toFixed(2);
    applyLanguageSelection("zh-CN");
    setGeneralSaveStatus("等待保存");
  } catch {
    setGeneralSaveStatus("讀取設置失敗", "is-error");
  }
}

runtimeSyncSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.value as "off" | "local" | "llm";
    applyRuntimeSyncSelection(value);
    window.settings?.previewRuntimeSync(value);
    setCyreneSaveStatus("有未保存的更改");
  });
});

stickerEnabledInput.addEventListener("change", () => {
  setCyreneSaveStatus("有未保存的更改");
});

stickerSizeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.value;
    applyStickerSizeSelection(value === "small" || value === "large" ? value : "standard");
    setCyreneSaveStatus("有未保存的更改");
  });
});

stickerThresholdInput.addEventListener("input", () => {
  stickerThresholdVal.textContent = parseFloat(stickerThresholdInput.value).toFixed(2);
  setCyreneSaveStatus("有未保存的更改");
});

sidebarVisibleInput.addEventListener("change", () => {
  if (sidebarVisibleInput.checked) window.settings?.openSidebar();
  else window.settings?.closeSidebar();
  void window.settings?.saveGeneral({ sidebarVisible: sidebarVisibleInput.checked });
});

bindOptionBlocksClick(companionObserveIntervalBlocks, () => setSaveStatus("有未保存的更改"));
bindOptionBlocksClick(companionTalkativenessBlocks, () => setSaveStatus("有未保存的更改"));
bindOptionBlocksClick(companionMinIntervalBlocks, () => setSaveStatus("有未保存的更改"));
bindOptionBlocksClick(companionProactiveTargetBlocks, () => {
  syncCompanionDiscordUI();
  setSaveStatus("有未保存的更改");
});
bindOptionBlocksClick(companionDiscordSubtargetBlocks, () => {
  syncCompanionDiscordUI();
  setSaveStatus("有未保存的更改");
});
function syncScreenCompanionUI(): void {
  const enabled = screenCompanionEnabledInput?.checked === true;
  const section = screenCompanionEnabledInput?.closest(".screen-companion-section");
  if (!section) return;
  section.classList.toggle("is-disabled", !enabled);
  syncCompanionDiscordUI();
}

screenCompanionEnabledInput?.addEventListener("change", async () => {
  syncScreenCompanionUI();
  try {
    await persistApiSettings();
    setSaveStatus("已保存", "is-ok");
  } catch {
    setSaveStatus("保存失敗", "is-error");
  }
});

tasksVisibleInput.addEventListener("change", () => {
  if (tasksVisibleInput.checked) window.settings?.openTasks();
  else window.settings?.closeTasks();
  void window.settings?.saveGeneral({ tasksVisible: tasksVisibleInput.checked });
});

musicEnabledInput.addEventListener("change", () => {
  syncMusicPlayback();
  setGeneralSaveStatus("有未保存的更改");
});

musicVolumeInput.addEventListener("input", () => {
  syncMusicPlayback();
  setGeneralSaveStatus("有未保存的更改");
});

soundEnabledInput.addEventListener("change", () => setGeneralSaveStatus("有未保存的更改"));
soundVolumeInput.addEventListener("input", () => setGeneralSaveStatus("有未保存的更改"));

petAlwaysOnTopInput.addEventListener("change", () =>
  window.settings?.setPetAlwaysOnTop(petAlwaysOnTopInput.checked),
);
petVisibleInput.addEventListener("change", () =>
  window.settings?.setPetVisible(petVisibleInput.checked),
);
petChatInputEnabledInput.addEventListener("change", () => {
  void window.settings?.saveGeneral({ petChatInputEnabled: petChatInputEnabledInput.checked });
});
petZoomInput.addEventListener("input", () => {
  petZoomVal.textContent = Math.round(Number(petZoomInput.value) * 100) + "%";
});
petZoomInput.addEventListener("change", () => {
  window.settings?.setPetZoom(Number(petZoomInput.value));
});

uiIconSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", async () => {
    const icon = normalizeUiIcon(button.dataset.icon);
    applyUiIconSelection(icon);
    setGeneralSaveStatus("正在套用圖示…");
    try {
      await window.settings!.saveGeneral({ uiIcon: icon });
      setGeneralSaveStatus("圖示已套用", "is-ok");
    } catch {
      setGeneralSaveStatus("套用失敗", "is-error");
    }
  });
});

windowCornerRadiusInput.addEventListener("input", () => {
  windowCornerRadiusVal.textContent = windowCornerRadiusInput.value + "px";
});
windowCornerRadiusInput.addEventListener("change", async () => {
  const radius = Number(windowCornerRadiusInput.value);
  setGeneralSaveStatus("正在套用圓角…");
  try {
    await window.settings!.saveGeneral({ windowCornerRadius: radius });
    setGeneralSaveStatus("圓角已套用", "is-ok");
  } catch {
    setGeneralSaveStatus("套用失敗", "is-error");
  }
});

uiThemeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", async () => {
    const theme = normalizeUiTheme(button.dataset.theme);
    applyUiThemeSelection(theme);
    setGeneralSaveStatus("正在套用主題…");
    try {
      await window.settings!.saveGeneral({ uiTheme: theme });
      setGeneralSaveStatus("主題已套用", "is-ok");
    } catch {
      setGeneralSaveStatus("主題套用失敗", "is-error");
    }
  });
});

assistantBubbleEnabledInput.addEventListener("change", () => {
  void window.settings!.saveGeneral({
    assistantBubbleEnabled: assistantBubbleEnabledInput.checked,
  });
});

chatSocialContextEnabledInput.addEventListener("change", () => {
  void window.settings!.saveGeneral({
    chatSocialContextEnabled: chatSocialContextEnabledInput.checked,
  });
});

chatLineHeightInput.addEventListener("input", () => {
  chatLineHeightVal.textContent = Number(chatLineHeightInput.value).toFixed(2);
});
chatLineHeightInput.addEventListener("change", () => {
  void window.settings!.saveGeneral({ chatLineHeight: Number(chatLineHeightInput.value) });
});

// ── 插件開關事件 ──────────────────────────────────────────
// 文檔檢索/用戶記憶/世界書/聯網搜索為常駐工具，無開關，顯示綠燈。
// 天氣查詢/聯網搜索有獨立配置卡片（下方）。

function downsampleToPcm16(chunks: Float32Array[], sourceRate: number): Uint8Array {
  const samples = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0;
  chunks.forEach((chunk) => {
    samples.set(chunk, cursor);
    cursor += chunk.length;
  });
  const ratio = sourceRate / 16000;
  const output = new Int16Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let source = start; source < end && source < samples.length; source += 1)
      sum += samples[source];
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    output[index] = value < 0 ? value * 32768 : value * 32767;
  }
  return new Uint8Array(output.buffer);
}

document.getElementById("asr-test-btn")?.addEventListener("click", async () => {
  const button = document.getElementById("asr-test-btn") as HTMLButtonElement;
  const status = document.getElementById("asr-test-status");
  const meter = document.getElementById("asr-test-meter");
  const fill = document.getElementById("asr-meter-fill") as HTMLElement | null;
  const transcript = document.getElementById("asr-test-transcript");
  button.disabled = true;
  setSecurityStatus(status, "準備麥克風…");
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const processor = context.createScriptProcessor(4096, 1, 1);
    const sink = context.createGain();
    sink.gain.value = 0;
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(data));
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      const rms = Math.sqrt(sum / data.length);
      const db = Math.max(-60, 20 * Math.log10(rms || 0.001));
      if (meter) meter.textContent = `${Math.round(db)} dB`;
      if (fill) fill.style.width = `${Math.max(2, Math.min(100, ((db + 60) / 60) * 100))}%`;
    };
    source.connect(analyser);
    analyser.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);
    setSecurityStatus(status, "正在錄音，請說一句話…");
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    processor.disconnect();
    const pcm = downsampleToPcm16(chunks, context.sampleRate);
    let binary = "";
    for (let offset = 0; offset < pcm.length; offset += 0x8000)
      binary += String.fromCharCode(...pcm.subarray(offset, offset + 0x8000));
    setSecurityStatus(status, "本機 Whisper 辨識中…");
    const result = await window.agentActivity?.testLocalAsr({
      pcmBase64: btoa(binary),
      language: asrLanguageSelect?.value ?? "zh",
    });
    if (!result) throw new Error("本機辨識服務未載入");
    setSecurityStatus(status, `完成，延遲 ${(result.latencyMs / 1000).toFixed(1)} 秒`, "is-ok");
    if (transcript) {
      transcript.textContent = result.text || "（沒有辨識到文字）";
      transcript.classList.remove("is-hidden");
    }
  } catch (error) {
    setSecurityStatus(status, error instanceof Error ? error.message : String(error), "is-error");
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    await context?.close().catch(() => {});
    button.disabled = false;
  }
});

clearChatHistoryBtn.addEventListener("click", async () => {
  if (!window.confirm("清空所有聊天會話？\n此操作會刪除全部歷史對話，無法恢復。")) return;
  try {
    const sessions = await window.chatStore?.list();
    if (sessions && sessions.length > 0) {
      // 串行刪除（store 不支持批量刪除；會話數量不會大，可接受）
      for (const s of sessions) {
        await window.chatStore?.delete(s.id);
      }
    }
    setGeneralSaveStatus("所有聊天會話已清空", "is-ok");
  } catch (err) {
    console.warn("[settings] 清空聊天會話失敗:", err);
    setGeneralSaveStatus("清空失敗，請查看終端日誌", "is-error");
  }
});

presetSelect.addEventListener("change", () => {
  // 切廠商前先把當前廠商的輸入值快照進緩存，避免覆蓋丟失
  captureActiveProviderProfile();

  // 從緩存裡取目標廠商的舊配置；沒有緩存就用 preset 默認值
  const cached = providerProfileCache[presetSelect.value];
  applyPreset(
    presetSelect.value,
    cached?.model,
    cached?.apiKey,
    cached?.baseUrl,
    cached?.displayName,
    cached?.explicitTransport,
  );
  setSaveStatus(cached ? "已切回上次配置" : "已應用預設，填寫 API Key 後保存");
});

transportSelect.addEventListener("change", () => {
  captureActiveProviderProfile();
});

for (const button of quickApiButtons) {
  button.addEventListener("click", async () => {
    const providerName = button.dataset.apiSource;
    if (!providerName) return;
    if (providerName === activeProvider) {
      setSaveStatus("目前已在使用這個 API", "is-ok");
      return;
    }

    captureActiveProviderProfile();
    const cached = providerProfileCache[providerName];
    applyPreset(
      providerName,
      cached?.model,
      cached?.apiKey,
      cached?.baseUrl,
      cached?.displayName,
      cached?.explicitTransport,
    );
    applyVisionSyncUI();

    quickApiButtons.forEach((item) => {
      item.disabled = true;
    });
    button.classList.add("is-switching");
    setSaveStatus(`正在切換至 ${findPreset(providerName).shortName}…`);
    try {
      await persistApiSettings();
      setSaveStatus(`已切換至 ${findPreset(providerName).shortName}`, "is-ok");
    } catch {
      setSaveStatus("切換失敗，請檢查配置後再試", "is-error");
    } finally {
      button.classList.remove("is-switching");
      quickApiButtons.forEach((item) => {
        item.disabled = false;
      });
    }
  });
}

// 測試連接按鈕：調用廠商 adapter 的真實連接測試
if (testConnectionBtn) {
  testConnectionBtn.addEventListener("click", async () => {
    const provider = activeProvider;
    const baseUrl = baseUrlInput.value;
    const model = getCurrentModelValue().trim();
    const apiKey = apiKeyInput.value;
    if (!apiKey) {
      setSaveStatus("請先填寫 API Key 再測試", "is-error");
      return;
    }
    if (!model) {
      setSaveStatus("請先選擇/填寫模型再測試", "is-error");
      return;
    }
    setSaveStatus("測試連接中…");
    testConnectionBtn.disabled = true;
    try {
      const result = await window.settings!.testConnection({ provider, baseUrl, model, apiKey });
      if (result.ok)
        setSaveStatus("連接成功 " + result.latency + "ms · " + (result.sample ?? ""), "is-ok");
      else setSaveStatus("連接失敗：" + (result.error ?? "未知錯誤"), "is-error");
    } catch (e) {
      setSaveStatus("連接失敗：" + (e instanceof Error ? e.message : String(e)), "is-error");
    } finally {
      testConnectionBtn.disabled = false;
    }
  });
}

// ── 視覺模型配置事件 ──────────────────────────────────────
// 膠囊按鈕組：[與主聊天模型相同] / [獨立配置]
function isVisionSynced(): boolean {
  return visionSyncMainBtn.classList.contains("is-active");
}

visionSyncMainBtn.addEventListener("click", () => {
  setVisionSyncState(true);
  applyVisionSyncUI();
  setSaveStatus("有未保存的更改");
});
visionSyncIndepBtn.addEventListener("click", () => {
  setVisionSyncState(false);
  applyVisionSyncUI();
  setSaveStatus("有未保存的更改");
});
visionEnabledInput.addEventListener("change", async () => {
  applyVisionSyncUI();
  try {
    await persistApiSettings();
    setSaveStatus("已保存", "is-ok");
  } catch {
    setSaveStatus("保存失敗", "is-error");
  }
});
for (const control of [visionAutoAnalyzeInput, visionMaxImagesSelect, visionMaxImageMbSelect]) {
  control.addEventListener("change", () => setSaveStatus("有未保存的更改"));
}

// 主配置變化時，若處於"與主相同"，聯動更新視覺三框。
// baseUrl 用 visionBaseUrl（若有），其他直接複製。
baseUrlInput.addEventListener("input", () => {
  if (!isVisionSynced()) return;
  const preset = findPreset(presetSelect.value);
  visionBaseUrlInput.value = preset?.visionBaseUrl || baseUrlInput.value;
});
apiKeyInput.addEventListener("input", () => {
  if (isVisionSynced()) visionApiKeyInput.value = apiKeyInput.value;
});
modelInput.addEventListener("input", () => {
  if (isVisionSynced()) visionModelInput.value = modelInput.value;
});

// Base URL 重置按鈕：一鍵復原廠商默認 baseUrl
baseUrlResetBtn.addEventListener("click", () => {
  const preset = findPreset(presetSelect.value);
  if (preset) {
    baseUrlInput.value = preset.baseUrl;
    setSaveStatus("已重置為廠商默認 URL");
  }
});

// 測試視覺模型按鈕
testVisionBtn.addEventListener("click", async () => {
  const synced = isVisionSynced();
  const baseUrl = synced ? baseUrlInput.value : visionBaseUrlInput.value;
  const apiKey = synced ? apiKeyInput.value : visionApiKeyInput.value;
  const model = synced ? getCurrentModelValue() : visionModelInput.value;
  if (!apiKey) {
    visionTestStatus.textContent = "請先填寫 API Key";
    return;
  }
  if (!model) {
    visionTestStatus.textContent = "請先填寫視覺型號";
    return;
  }
  visionTestStatus.textContent = "測試中…";
  testVisionBtn.disabled = true;
  try {
    const result = await window.settings!.testVision?.({ baseUrl, apiKey, model });
    if (result?.ok)
      visionTestStatus.textContent =
        "✅ 連接成功 " + result.latency + "ms · " + (result.sample ?? "");
    else visionTestStatus.textContent = "❌ " + (result?.error ?? "未知錯誤");
  } catch (e) {
    visionTestStatus.textContent = "❌ " + (e instanceof Error ? e.message : String(e));
  } finally {
    testVisionBtn.disabled = false;
  }
});

generalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setGeneralSaveStatus("保存中…");
  try {
    await window.settings!.saveGeneral({
      musicEnabled: musicEnabledInput.checked,
      musicVolume: Number(musicVolumeInput.value),
      soundEnabled: soundEnabledInput.checked,
      soundVolume: Number(soundVolumeInput.value),
      petAlwaysOnTop: petAlwaysOnTopInput.checked,
      petVisible: petVisibleInput.checked,
      petChatInputEnabled: petChatInputEnabledInput.checked,
      petZoom: Number(petZoomInput.value),
      sidebarVisible: sidebarVisibleInput.checked,
      tasksVisible: tasksVisibleInput.checked,
      launchAtLogin: launchAtLoginInput.checked,
      language: "zh-CN",
      uiTheme: getUiThemeValue(),
      assistantBubbleEnabled: assistantBubbleEnabledInput.checked,
      chatSocialContextEnabled: chatSocialContextEnabledInput.checked,
      chatLineHeight: Number(chatLineHeightInput.value),
    });
    setGeneralSaveStatus("已保存", "is-ok");
  } catch {
    setGeneralSaveStatus("保存失敗", "is-error");
  }
});

cyrenePanel.addEventListener("submit", async (e) => {
  e.preventDefault();
  setCyreneSaveStatus("保存中…");
  try {
    await window.settings!.saveConfig({
      runtimeSync: getRuntimeSyncValue(),
      stickerEnabled: stickerEnabledInput.checked,
      stickerSize: getStickerSizeValue(),
      stickerSimilarityThreshold: parseFloat(stickerThresholdInput.value),
    });
    setCyreneSaveStatus("已保存", "is-ok");
  } catch {
    setCyreneSaveStatus("保存失敗", "is-error");
  }
});

async function persistApiSettings(): Promise<void> {
  // 保存前把當前輸入快照進 perProvider 緩存（main 進程也會做一次，但渲染端先做一遍，
  // 是為了下一次切廠商再切回來不依賴磁盤往返）
  captureActiveProviderProfile();
  // mode 字段在 UI 層已刪除，但仍傳給 main 進程保留向後兼容（舊配置文件可能有該字段）。
  // 默認 "manual"（baseUrl 永遠可改、模型名永遠可填，行為等同原 Manual）。
  await window.settings!.saveConfig({
    mode: "manual",
    apiModeEnabled: apiModeEnabledInput ? apiModeEnabledInput.checked : true,
    provider: activeProvider,
    displayName: displayNameInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    model: getCurrentModelValue().trim(),
    apiKey: apiKeyInput.value.trim(),
    explicitTransport: transportSelect.value as "openai" | "anthropic" | "auto",
    perProvider: { ...providerProfileCache },
    vision: {
      enabled: visionEnabledInput.checked,
      autoAnalyze: visionAutoAnalyzeInput.checked,
      maxImages: Number(visionMaxImagesSelect.value),
      maxImageMb: Number(visionMaxImageMbSelect.value),
      syncWithMain: isVisionSynced(),
      // syncWithMain=true 時三字段傳空（main 進程不落盤，運行時從主配置讀）
      baseUrl: isVisionSynced() ? "" : visionBaseUrlInput.value.trim(),
      apiKey: isVisionSynced() ? "" : visionApiKeyInput.value.trim(),
      model: isVisionSynced() ? "" : visionModelInput.value.trim(),
      screenCompanionEnabled: screenCompanionEnabledInput?.checked === true,
      observeIntervalSeconds: Number(getOptionBlockValue(companionObserveIntervalBlocks, "300")),
      talkativeness: getOptionBlockValue(companionTalkativenessBlocks, "normal") as
        "quiet" | "normal" | "active" | "chatty",
      minTalkIntervalSeconds: Number(getOptionBlockValue(companionMinIntervalBlocks, "30")),
      proactiveTarget: getOptionBlockValue(companionProactiveTargetBlocks, "desktop") as
        "desktop" | "discord" | "wechat",
      discordSubTarget: getOptionBlockValue(companionDiscordSubtargetBlocks, "dm") as
        "dm" | "channel",
      discordChannelId: companionDiscordChannelIdInput
        ? companionDiscordChannelIdInput.value.trim()
        : "",
    },
  });
}

apiForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setSaveStatus("保存中…");
  try {
    await persistApiSettings();
    setSaveStatus("已保存", "is-ok");
  } catch {
    setSaveStatus("保存失敗", "is-error");
  }
});

apiModeEnabledInput?.addEventListener("change", async () => {
  setSaveStatus("切換模式中…");
  try {
    if (!apiModeEnabledInput.checked) {
      // 關閉 API 模式 ➔ 自動切換至免 API 網頁版 (ChatGPT Plus)
      applyPreset(
        "chatgpt_web",
        "GPT-4o",
        "",
        "https://chatgpt.com",
        "ChatGPT Plus (網頁版 · GPT-4o)",
        "auto",
      );
    } else {
      // 開啟 API 模式 ➔ 切換至 OpenRouter 免費 API 模式
      applyPreset(
        "Custom",
        "openrouter/free",
        "",
        "https://openrouter.ai/api/v1",
        "OpenRouter Free",
        "auto",
      );
    }
    await persistApiSettings();
    setSaveStatus("已保存", "is-ok");
  } catch {
    setSaveStatus("切換失敗", "is-error");
  }
});

loginChatGPTBtn?.addEventListener("click", () => {
  void (window as any).webLlm?.openLogin("chatgpt_web");
});

interface GeminiWebLlmApi {
  openLogin: () => Promise<{ ok: boolean }>;
  getStatus: () => Promise<{ isLoggedIn: boolean; state: "login" | "captcha" | "app" | "unknown" }>;
  testConnection: () => Promise<{ ok: boolean; message: string }>;
  logout: () => Promise<{ ok: boolean }>;
}
function geminiApi(): GeminiWebLlmApi | undefined {
  return (window as any).geminiWebLlm as GeminiWebLlmApi | undefined;
}

async function refreshGeminiStatus(): Promise<void> {
  if (!geminiStatusText) return;
  try {
    const status = await geminiApi()?.getStatus();
    if (!status) {
      geminiStatusText.textContent = "無法取得狀態";
      return;
    }
    if (status.isLoggedIn) {
      geminiStatusText.textContent = "✅ 已登入";
      if (loginGeminiBtnLabel) loginGeminiBtnLabel.textContent = "🔵 重新登入 Gemini";
    } else if (status.state === "captcha") {
      geminiStatusText.textContent = "⚠️ 需要完成驗證（CAPTCHA），請重新登入";
      if (loginGeminiBtnLabel) loginGeminiBtnLabel.textContent = "🔵 重新登入 Gemini";
    } else {
      geminiStatusText.textContent = "尚未登入";
      if (loginGeminiBtnLabel) loginGeminiBtnLabel.textContent = "🔵 登入 Gemini 帳號";
    }
  } catch {
    geminiStatusText.textContent = "狀態檢查失敗";
  }
}

loginGeminiBtn?.addEventListener("click", () => {
  void geminiApi()
    ?.openLogin()
    .then(() => {
      // 登入視窗開啟後過幾秒再刷新一次狀態（使用者仍在視窗內操作時先不打擾）。
      setTimeout(() => void refreshGeminiStatus(), 5000);
    });
});

geminiTestConnectionBtn?.addEventListener("click", async () => {
  if (!geminiStatusText) return;
  geminiStatusText.textContent = "測試連線中…";
  const result = await geminiApi()?.testConnection();
  geminiStatusText.textContent = result
    ? result.ok
      ? `✅ ${result.message}`
      : `⚠️ ${result.message}`
    : "測試失敗";
});

geminiLogoutBtn?.addEventListener("click", async () => {
  if (!geminiStatusText) return;
  await geminiApi()?.logout();
  geminiStatusText.textContent = "已登出";
  if (loginGeminiBtnLabel) loginGeminiBtnLabel.textContent = "🔵 登入 Gemini 帳號";
});

void refreshGeminiStatus();

function switchSection(section: string): void {
  const label = NAV_LABELS[section] ?? NAV_LABELS.api;
  sectionTitle.textContent = label.title;
  sectionHint.textContent = label.hint;

  const isApi = section === "api";
  const isGeneral = section === "general";
  const isCyrene = section === "cyrene";
  const isDisclaimer = section === "disclaimer";
  const isMemory = section === "memory";
  const isUser = section === "user";
  const isChat = section === "chat";
  const isTasks = section === "tasks";
  const isIdentity = section === "identity";
  const isPlugins = section === "plugins";
  const isSkills = section === "skills";
  const isTokens = section === "tokens";
  const isSecurity = section === "security";
  const isDiscordChannel = section === "channels-discord";
  const isChannels = section === "channels" || isDiscordChannel;
  const isTts = section === "tts";
  const isAsr = section === "asr";
  apiForm.classList.toggle("is-hidden", !isApi);
  generalForm.classList.toggle("is-hidden", !isGeneral);
  cyrenePanel.classList.toggle("is-hidden", !isCyrene);
  disclaimerPanel.classList.toggle("is-hidden", !isDisclaimer);
  const memoryPanel = document.getElementById("memory-panel");
  if (memoryPanel) memoryPanel.classList.toggle("is-hidden", !isMemory);
  const userPanel = document.getElementById("user-panel");
  if (userPanel) userPanel.classList.toggle("is-hidden", !isUser);
  const chatPanel = document.getElementById("chat-panel");
  if (chatPanel) chatPanel.classList.toggle("is-hidden", !isChat);
  // 切到 💬 聊天面板時拉一次列表（cross-window 變化由 onChanged 監聽器自己刷新）
  if (isChat) void renderChatSessions();
  const tasksPanel = document.getElementById("tasks-panel");
  if (tasksPanel) tasksPanel.classList.toggle("is-hidden", !isTasks);
  if (isTasks) void loadSchedulerPanel();
  const identityPanel = document.getElementById("identity-panel");
  if (identityPanel) identityPanel.classList.toggle("is-hidden", !isIdentity);
  pluginsPanel.classList.toggle("is-hidden", !isPlugins);
  const skillsPanel = document.getElementById("skills-panel");
  if (skillsPanel) skillsPanel.classList.toggle("is-hidden", !isSkills);
  if (isSkills) void renderSkills();
  const tokenPanel = document.getElementById("token-panel");
  if (tokenPanel) tokenPanel.classList.toggle("is-hidden", !isTokens);
  if (isTokens) {
    void refreshTokenPanel(tokenRangeDays);
    void refreshAgentActivity(tokenRangeDays);
  }
  const securityPanel = document.getElementById("security-panel");
  if (securityPanel) securityPanel.classList.toggle("is-hidden", !isSecurity);
  if (isSecurity) void loadSecurityPanel();
  const channelsPanel = document.getElementById("channels-panel");
  if (channelsPanel) channelsPanel.classList.toggle("is-hidden", !isChannels);
  setChannelsPolling(isChannels);
  if (isChannels) {
    void loadChannelsPanel().then(() => {
      if (!isDiscordChannel) return;
      window.setTimeout(
        () =>
          document
            .getElementById("channels-discord-card")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    });
  }
  const ttsPanel = document.getElementById("tts-panel");
  if (ttsPanel) ttsPanel.classList.toggle("is-hidden", !isTts);
  const asrPanel = document.getElementById("asr-panel");
  if (asrPanel) asrPanel.classList.toggle("is-hidden", !isAsr);
  placeholderPanel.classList.toggle(
    "is-hidden",
    isApi ||
      isGeneral ||
      isCyrene ||
      isDisclaimer ||
      isMemory ||
      isUser ||
      isChat ||
      isTasks ||
      isIdentity ||
      isPlugins ||
      isSkills ||
      isTokens ||
      isSecurity ||
      isChannels ||
      isTts ||
      isAsr,
  );

  if (
    !isApi &&
    !isGeneral &&
    !isCyrene &&
    !isDisclaimer &&
    !isMemory &&
    !isUser &&
    !isChat &&
    !isTasks &&
    !isIdentity &&
    !isPlugins &&
    !isSkills &&
    !isTokens &&
    !isSecurity &&
    !isChannels &&
    !isTts &&
    !isAsr
  ) {
    placeholderIcon.textContent = label.emoji;
    placeholderTitle.textContent = label.title;
    placeholderCopy.textContent = "這個模塊先佔位，等核心聊天與 API 接通後再繼續擴展。";
  }

  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("is-active", (el as HTMLElement).dataset.section === section);
  });
}

document.querySelectorAll(".nav-item").forEach((el) => {
  el.addEventListener("click", () => {
    const section = (el as HTMLElement).dataset.section;
    if (section) switchSection(section);
  });
});

// 側邊欄在極窄寬度下（外層視窗/嵌入 iframe 被壓縮時）不能讓文字斷成單字——
// 把圖示後面的文字包成獨立 span，讓 CSS 在窄寬度時直接整段隱藏文字、只留圖示 +
// title tooltip，而不是留下讀不出來的殘字。
document.querySelectorAll<HTMLElement>(".nav-item").forEach((el) => {
  const iconEl = el.querySelector("span");
  const labelText = Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
  if (!labelText) return;
  el.title = labelText;
  const label = document.createElement("span");
  label.className = "nav-item__label";
  label.textContent = labelText;
  el.replaceChildren(...(iconEl ? [iconEl] : []), label);
});

schedulerNewBtn?.addEventListener("click", () => void openSchedulerEditor());
schedulerEditorClose?.addEventListener("click", closeSchedulerEditor);
schedulerCancelBtn?.addEventListener("click", closeSchedulerEditor);
schedulerSaveBtn?.addEventListener("click", () => void saveSchedulerTask());
schedulerKindInput?.addEventListener("change", updateSchedulerConditionalFields);
schedulerToolLimitInput?.addEventListener("change", updateSchedulerConditionalFields);
updateSchedulerConditionalFields();

// ===== 資料安全：時間膠囊與系統保管庫 =====
let selectedBackup: BackupSummary | null = null;

function formatBackupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function selectedCategories(containerId: string): string[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(`#${containerId} input[type="checkbox"]:checked`),
  ).map((input) => input.value);
}

function setSecurityStatus(
  element: HTMLElement | null,
  text: string,
  kind?: "is-ok" | "is-error",
): void {
  if (!element) return;
  element.textContent = text;
  element.className = "security-status";
  if (kind) element.classList.add(kind);
}

async function renderVaultStatus(): Promise<void> {
  const title = document.getElementById("vault-title");
  const detail = document.getElementById("vault-detail");
  if (!title || !detail || !window.settings) return;
  try {
    const status = await window.settings.securityGetStatus();
    if (!status.available) {
      title.textContent = "系統保管庫目前不可用";
      detail.textContent = `密鑰尚未加密；請確認 ${status.backend} 可用後再試。`;
    } else if (status.lockedCount) {
      title.textContent = `${status.lockedCount} 個密鑰暫時無法解鎖`;
      detail.textContent = `由 ${status.backend} 保護，請在原本的系統帳號中開啟。`;
    } else {
      title.textContent = status.protectedCount
        ? `${status.protectedCount} 個密鑰已安全封存`
        : "系統保管庫已就緒";
      detail.textContent = `由 ${status.backend} 加密；${status.plaintextCount ? `另有 ${status.plaintextCount} 個等待保護。` : "備份不會帶走任何密鑰。"}`;
    }
  } catch (error) {
    title.textContent = "無法讀取保管庫狀態";
    detail.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function loadSecurityPanel(): Promise<void> {
  await renderVaultStatus();
  try {
    const config = await window.settings!.backupGetConfig();
    const enabled = document.getElementById("backup-auto-enabled") as HTMLInputElement | null;
    const retention = document.getElementById("backup-retention") as HTMLSelectElement | null;
    const last = document.getElementById("backup-last-auto");
    if (enabled) enabled.checked = config.autoEnabled;
    if (retention) retention.value = String(config.retentionDays);
    if (last)
      last.textContent = config.lastAutoBackupAt
        ? `上次 ${new Date(config.lastAutoBackupAt).toLocaleDateString("zh-TW")}`
        : "尚未執行";
  } catch {
    /* service may still be starting */
  }
}

document.getElementById("vault-protect-btn")?.addEventListener("click", async () => {
  await window.settings?.securityMigrate();
  await renderVaultStatus();
});

document.getElementById("backup-create-btn")?.addEventListener("click", async () => {
  const status = document.getElementById("backup-create-status");
  const categories = selectedCategories("backup-create-categories");
  if (!categories.length) return setSecurityStatus(status, "請至少選擇一種資料", "is-error");
  setSecurityStatus(status, "正在封存…");
  try {
    const summary = await window.settings!.backupCreate(categories);
    if (!summary) return setSecurityStatus(status, "已取消建立備份");
    setSecurityStatus(
      status,
      `完成：${summary.fileCount} 個檔案，${formatBackupBytes(summary.sizeBytes)}`,
      "is-ok",
    );
  } catch (error) {
    setSecurityStatus(status, error instanceof Error ? error.message : String(error), "is-error");
  }
});

for (const id of ["backup-auto-enabled", "backup-retention"]) {
  document.getElementById(id)?.addEventListener("change", async () => {
    const enabled = document.getElementById("backup-auto-enabled") as HTMLInputElement;
    const retention = document.getElementById("backup-retention") as HTMLSelectElement;
    await window.settings?.backupSaveConfig({
      autoEnabled: enabled.checked,
      retentionDays: retention.value === "30" ? 30 : 7,
    });
    await loadSecurityPanel();
  });
}

document.getElementById("backup-pick-btn")?.addEventListener("click", async () => {
  const restoreStatus = document.getElementById("backup-restore-status");
  try {
    selectedBackup = await window.settings!.backupPickInspect();
    if (!selectedBackup) return;
    const preview = document.getElementById("backup-preview");
    const date = document.getElementById("backup-preview-date");
    const summary = document.getElementById("backup-preview-summary");
    const categories = document.getElementById("backup-restore-categories");
    preview?.classList.remove("is-hidden");
    if (date) date.textContent = new Date(selectedBackup.createdAt).toLocaleString("zh-TW");
    if (summary)
      summary.textContent = `${selectedBackup.fileCount} 個檔案 · ${formatBackupBytes(selectedBackup.sizeBytes)} · v${selectedBackup.appVersion}`;
    categories?.replaceChildren(
      ...selectedBackup.categories.map((category) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = category.id;
        input.checked = true;
        label.append(input, `${category.label} · ${category.fileCount}`);
        return label;
      }),
    );
    setSecurityStatus(restoreStatus, "請確認要還原的分類");
  } catch (error) {
    setSecurityStatus(
      restoreStatus,
      error instanceof Error ? error.message : String(error),
      "is-error",
    );
  }
});

document.getElementById("backup-restore-btn")?.addEventListener("click", async () => {
  const status = document.getElementById("backup-restore-status");
  if (!selectedBackup) return;
  const categories = selectedCategories("backup-restore-categories");
  if (!categories.length) return setSecurityStatus(status, "請至少選擇一種資料", "is-error");
  const confirmed = await showModal({
    title: "回到這個時間點？",
    message: "還原前會先自動備份目前資料。完成後需要重新啟動昔漣。",
    icon: "⏳",
    confirmText: "安全還原",
  });
  if (!confirmed) return;
  setSecurityStatus(status, "正在建立安全快照並還原…");
  try {
    const result = await window.settings!.backupRestore({
      filePath: selectedBackup.filePath,
      categories,
    });
    setSecurityStatus(status, `已還原 ${result.restoredFiles} 個檔案`, "is-ok");
    document.getElementById("backup-restart-callout")?.classList.remove("is-hidden");
  } catch (error) {
    setSecurityStatus(status, error instanceof Error ? error.message : String(error), "is-error");
  }
});

document
  .getElementById("security-restart-btn")
  ?.addEventListener("click", () => window.settings?.securityRestartApp());

void loadConfig();
void loadGeneralSettings();

const initialSection = (window.location.hash || "#general").slice(1);
switchSection(initialSection);
window.addEventListener("message", (event) => {
  if (
    event.data &&
    typeof event.data === "object" &&
    event.data.type === "switch-section" &&
    typeof event.data.section === "string"
  ) {
    switchSection(event.data.section);
  }
});
window.settings?.onSwitchSection?.((section) => {
  switchSection(section);
});
// ── 生活工具手風琴 ─────────────────────────────────────────
const lifeToggle = document.getElementById("plugin-life-toggle") as HTMLButtonElement | null;
const lifeCard = document.getElementById("plugin-life-card");
const lifeBody = document.getElementById("plugin-life-body");
lifeToggle?.addEventListener("click", () => {
  const expanded = lifeToggle.getAttribute("aria-expanded") === "true";
  lifeToggle.setAttribute("aria-expanded", String(!expanded));
  lifeCard?.classList.toggle("is-expanded", !expanded);
  lifeBody?.classList.toggle("is-collapsed", expanded);
});

// ── Skill 面板：列 skill 開關 ──────────────────────────────
/* ============================================================
   💬 聊天面板：會話列表
   - 渲染 chatStore.list 返回的會話元數據，按 updatedAt desc 排序（store 已排）
   - 微信式時間：剛剛 / N 分鐘前 / 今天 HH:mm / 昨天 HH:mm / N 天前 / MM-DD
   - 點擊列表項 = 在聊天窗口裡打開（窗口未開則開窗）
   - 雙擊標題 = 改名（contentEditable + Enter/Esc/blur 提交）
   - 點🗑️ = 刪除（活躍會話給出"正在閱讀這個會話"差異化提示）
   - 跨窗口同步：onChanged 觸發重渲；onActiveSessionChanged 更新高亮態
   - HTML/CSS 已在 index.html / settings.css 裡就位（見 chat-sessions__*）
   ============================================================ */

declare global {
  interface Window {
    chatStore?: {
      list: () => Promise<ChatSessionMetaUI[]>;
      get: (id: string) => Promise<unknown>;
      create: (payload?: {
        title?: string;
        identityId?: string | null;
      }) => Promise<{ id: string } | null>;
      delete: (id: string) => Promise<boolean>;
      rename: (id: string, title: string) => Promise<unknown>;
      openFolder: () => Promise<boolean>;
      openInChatWindow: (sessionId: string) => Promise<boolean>;
      getActiveSession: () => Promise<string | null>;
      onChanged: (cb: () => void) => () => void;
      onActiveSessionChanged: (cb: (sessionId: string | null) => void) => () => void;
    };
  }
}

let chatSessionsActiveId: string | null = null;

async function renderChatSessions(): Promise<void> {
  const listEl = document.getElementById("chat-sessions-list");
  const emptyEl = document.getElementById("chat-sessions-empty");
  if (!listEl || !window.chatStore) return;

  // 第一次渲染前如果還不知道活躍 sessionId，主動拉一次
  if (chatSessionsActiveId === null) {
    try {
      chatSessionsActiveId = (await window.chatStore.getActiveSession()) ?? null;
    } catch {
      /* ignore */
    }
  }

  let sessions: ChatSessionMetaUI[] = [];
  try {
    sessions = await window.chatStore.list();
  } catch (err) {
    console.warn("[settings] 加載聊天會話列表失敗:", err);
  }

  listEl.innerHTML = "";
  if (sessions.length === 0) {
    if (emptyEl) emptyEl.classList.remove("is-hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("is-hidden");

  for (const session of sessions) {
    const item = buildChatSessionItem(session);
    listEl.appendChild(item);
  }
}

function buildChatSessionItem(session: ChatSessionMetaUI): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "chat-sessions__item";
  if (session.id === chatSessionsActiveId) li.classList.add("is-active");
  li.dataset.sessionId = session.id;

  const titleEl = document.createElement("div");
  titleEl.className = "chat-sessions__title";
  titleEl.textContent = session.title || "新對話";

  const metaEl = document.createElement("div");
  metaEl.className = "chat-sessions__meta";

  const timeEl = document.createElement("span");
  timeEl.className = "chat-sessions__time";
  timeEl.textContent = formatChatRelativeTime(session.updatedAt);

  const identityEl = document.createElement("span");
  identityEl.className = "chat-sessions__identity";
  // 職位面板未做，所有 identityId == null 的會話先 fallback 到"聊天陪伴"
  // 後續職位面板做好後這裡改成用 identity 註冊表查實際名稱
  identityEl.textContent =
    "💼 " + (session.identityId ? session.identityId : CHAT_DEFAULT_IDENTITY_LABEL);

  metaEl.appendChild(timeEl);
  metaEl.appendChild(identityEl);

  // 左側主區：標題 + meta
  const mainEl = document.createElement("div");
  mainEl.className = "chat-sessions__main";
  mainEl.appendChild(titleEl);
  mainEl.appendChild(metaEl);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "chat-sessions__delete";
  deleteBtn.title = "刪除會話";
  deleteBtn.setAttribute("aria-label", "刪除會話");
  deleteBtn.textContent = "🗑️";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "chat-sessions__rename";
  renameBtn.title = "重命名";
  renameBtn.setAttribute("aria-label", "重命名會話");
  renameBtn.textContent = "✏️";

  // 編輯態確認/取消按鈕（默認隱藏，進入編輯態時顯示，替換 ✏️/🗑️ 的位置）
  const confirmRenameBtn = document.createElement("button");
  confirmRenameBtn.type = "button";
  confirmRenameBtn.className = "chat-sessions__confirm-rename is-hidden";
  confirmRenameBtn.title = "確認（Enter）";
  confirmRenameBtn.setAttribute("aria-label", "確認重命名");
  confirmRenameBtn.textContent = "✓";

  const cancelRenameBtn = document.createElement("button");
  cancelRenameBtn.type = "button";
  cancelRenameBtn.className = "chat-sessions__cancel-rename is-hidden";
  cancelRenameBtn.title = "取消（Esc）";
  cancelRenameBtn.setAttribute("aria-label", "取消重命名");
  cancelRenameBtn.textContent = "✕";

  // 右側操作區：✏️ 🗑️（常規）/ ✓ ✕（編輯態）
  const actionsEl = document.createElement("div");
  actionsEl.className = "chat-sessions__actions";
  actionsEl.appendChild(renameBtn);
  actionsEl.appendChild(confirmRenameBtn);
  actionsEl.appendChild(cancelRenameBtn);
  actionsEl.appendChild(deleteBtn);

  // —— 交互綁定 ——
  // 點列表項 = 在聊天窗口裡打開（編輯態時禁用，避免切走會話）
  li.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".chat-sessions__actions")) return;
    if (titleEl.isContentEditable) return;
    void window.chatStore?.openInChatWindow(session.id);
  });

  // ✏️ 按鈕進入改名態
  renameBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    enterRenameMode(titleEl, session, { renameBtn, deleteBtn, confirmRenameBtn, cancelRenameBtn });
  });

  // 🗑️ 刪除（含活躍會話差異化提示）
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void deleteChatSession(session);
  });

  li.appendChild(mainEl);
  li.appendChild(actionsEl);
  return li;
}

// 進入改名態：把 ✏️/🗑️ 隱藏，顯示 ✓/✕；title 變 contentEditable 並聚焦全選。
// 提交走 ✓ 按鈕 / Enter；取消走 ✕ 按鈕 / Esc / 失焦。失焦=取消（避免點別處誤提交）。
function enterRenameMode(
  titleEl: HTMLElement,
  session: ChatSessionMetaUI,
  btns: {
    renameBtn: HTMLButtonElement;
    deleteBtn: HTMLButtonElement;
    confirmRenameBtn: HTMLButtonElement;
    cancelRenameBtn: HTMLButtonElement;
  },
): void {
  const original = titleEl.textContent || "";

  // 切換按鈕可見性
  btns.renameBtn.classList.add("is-hidden");
  btns.deleteBtn.classList.add("is-hidden");
  btns.confirmRenameBtn.classList.remove("is-hidden");
  btns.cancelRenameBtn.classList.remove("is-hidden");

  titleEl.contentEditable = "true";
  titleEl.classList.add("is-editing");
  // 用 requestAnimationFrame 等按鈕 click 冒泡完再聚焦，避免焦點搶奪導致 blur 誤觸發
  requestAnimationFrame(() => {
    titleEl.focus();
    // 全選當前文本，方便用戶直接覆蓋
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  const cleanup = () => {
    titleEl.contentEditable = "false";
    titleEl.classList.remove("is-editing");
    btns.renameBtn.classList.remove("is-hidden");
    btns.deleteBtn.classList.remove("is-hidden");
    btns.confirmRenameBtn.classList.add("is-hidden");
    btns.cancelRenameBtn.classList.add("is-hidden");
    titleEl.removeEventListener("keydown", onKey);
    titleEl.removeEventListener("blur", onBlur);
    btns.confirmRenameBtn.removeEventListener("mousedown", suppressFocus);
    btns.cancelRenameBtn.removeEventListener("mousedown", suppressFocus);
    btns.confirmRenameBtn.removeEventListener("click", onConfirm);
    btns.cancelRenameBtn.removeEventListener("click", onCancel);
  };

  const commit = () => {
    const newTitle = (titleEl.textContent || "").trim();
    cleanup();
    if (newTitle && newTitle !== original) {
      void window.chatStore?.rename(session.id, newTitle);
      // rename 成功後 main 廣播 chats:changed → 列表重渲，無需手動改 DOM
    } else {
      titleEl.textContent = original; // 空內容或未變：還原
    }
  };

  const cancel = () => {
    cleanup();
    titleEl.textContent = original;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
  // 失焦=取消（點別處想放棄編輯的心智模型）
  const onBlur = () => cancel();
  const onConfirm = (e: MouseEvent) => {
    e.stopPropagation();
    commit();
  };
  const onCancel = (e: MouseEvent) => {
    e.stopPropagation();
    cancel();
  };
  // 關鍵：mousedown 時 preventDefault，阻止 ✓/✕ 按鈕搶焦點，
  // 否則順序是 mousedown→titleEl blur(cancel 還原內容)→click(commit 讀到原值)→改不了名。
  // 阻止焦點轉移後，titleEl 保持聚焦，blur 不觸發，click 正常執行 commit/cancel。
  const suppressFocus = (e: MouseEvent) => e.preventDefault();

  titleEl.addEventListener("keydown", onKey);
  titleEl.addEventListener("blur", onBlur);
  btns.confirmRenameBtn.addEventListener("mousedown", suppressFocus);
  btns.cancelRenameBtn.addEventListener("mousedown", suppressFocus);
  btns.confirmRenameBtn.addEventListener("click", onConfirm);
  btns.cancelRenameBtn.addEventListener("click", onCancel);
}

async function deleteChatSession(session: ChatSessionMetaUI): Promise<void> {
  const isActive = session.id === chatSessionsActiveId;
  const prompt = isActive
    ? `「${session.title || "新對話"}」正在聊天窗口裡打開，確定刪除？\n刪除後聊天窗口會跳到最新一條會話或自動新建。`
    : `確定刪除「${session.title || "新對話"}」？\n刪除後無法恢復。`;
  if (!window.confirm(prompt)) return;
  try {
    await window.chatStore?.delete(session.id);
    // 刪除成功後 main 廣播 chats:changed → 列表重渲；
    // 聊天窗口若在顯示該會話也會通過 onChanged 自動 fallback。
  } catch (err) {
    console.warn("[settings] 刪除會話失敗:", err);
    window.alert("刪除失敗，請查看終端日誌。");
  }
}

// —— 頂部"+新對話"按鈕 ——
const chatNewBtn = document.getElementById("chat-new-btn") as HTMLButtonElement | null;
chatNewBtn?.addEventListener("click", async () => {
  if (!window.chatStore) return;
  try {
    const session = await window.chatStore.create({ identityId: null });
    if (session?.id) await window.chatStore.openInChatWindow(session.id);
  } catch (err) {
    console.warn("[settings] 新建會話失敗:", err);
    window.alert("新建會話失敗，請查看終端日誌。");
  }
});

// —— 底部"打開存儲位置"按鈕 ——
const chatOpenFolderBtn = document.getElementById(
  "chat-open-folder-btn",
) as HTMLButtonElement | null;
chatOpenFolderBtn?.addEventListener("click", () => {
  void window.chatStore?.openFolder();
});

// —— 跨窗口同步 ——
// 任意會話變動（創建/追加/改名/刪除）：重渲列表
// 僅在面板可見時刷新，節省 DOM 寫入；不可見時下次切到面板會重新拉
window.chatStore?.onChanged(() => {
  const panel = document.getElementById("chat-panel");
  if (panel && !panel.classList.contains("is-hidden")) {
    void renderChatSessions();
  }
});

// 活躍 sessionId 變化：僅更新 is-active 高亮，不重新拉列表（輕量）
window.chatStore?.onActiveSessionChanged((sessionId) => {
  chatSessionsActiveId = sessionId;
  const listEl = document.getElementById("chat-sessions-list");
  if (!listEl) return;
  listEl.querySelectorAll<HTMLElement>(".chat-sessions__item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.sessionId === sessionId);
  });
});


if (window.self !== window.top) {
  document.body.classList.add("is-embedded");
}
