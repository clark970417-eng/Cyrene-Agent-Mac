// Settings 公共类型定义
// 从 settings.ts 抽离的跨面板共享类型。
// 注意路径深度：本文件位于 src/renderer/settings/shared/，
// 到 src/shared/ 需要 ../../../shared/，到 settings/ 下其他模块用 ../

import type { ApiTransport } from "../../../shared/api-endpoint";
import type { ReasoningPreference } from "../../../shared/reasoning";
import type { ChatAppearanceSettings } from "../../../shared/chat-appearance";
import type { UiTheme } from "../../../shared/ui-theme";
import type { UiFont } from "../../../shared/ui-font";
import type { UiIcon } from "../../../shared/ui-icon";
import type {
  DefaultChatMode,
  MobileMessageSegmentationMode,
  ProactiveChatMode,
  ProactiveDeliveryTarget,
  SegmentedOutputMode,
} from "../../../shared/preferences";
import type { CustomStyleConfig } from "../../../shared/style-sampling";
import type { CustomEndpointMode } from "../custom-endpoint-state";
import type { TimeoutSettings } from "../../../shared/timeout-types";

export interface ProviderProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
  displayName?: string;
  /**
   * 用户在 settings 显式选择的协议。旧配置中的 auto 会由 main 进程迁移为具体值。
   */
  explicitTransport?: ApiTransport;
  reasoning?: ReasoningPreference;
}

export interface ModelSettings {
  mode: "auto" | "manual";
  provider: string;
  // 用户给模型起的自定义昵称，留空时用厂商 shortName。状态栏"正在喂养"显示它。
  displayName?: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   * 当前厂商的 explicitTransport 镜像（顶层字段是 main 进程 perProvider[currentProvider] 的视图）。
   * UI 改动 transport-select 时，saveConfig 把这个值带给 main 进程折叠回 perProvider。
   */
  explicitTransport?: ApiTransport;
  /** 当前厂商 reasoning 偏好的顶层镜像。 */
  reasoning?: ReasoningPreference;
  // 按厂商缓存：切回该厂商时，从这里恢复 baseUrl / model / apiKey
  perProvider?: Record<string, ProviderProfile>;
  runtimeSync: "off" | "local" | "llm";
  stickerEnabled: boolean;
  stickerSize: "small" | "standard" | "large";
  stickerSimilarityThreshold: number;
  /** 整个聊天请求的超时（秒）。30-1800，默认 300。 */
  chatRequestTimeoutSec: number;
  /** 总轮数。5-30，默认 12。 */
  maxIterations: number;
  /** Plan 步骤失败后重规划次数。1-5，默认 2。 */
  maxReplans: number;
  /** 引用过期重新决策次数。0-3，默认 1。 */
  maxRefresh: number;
  /** 单次 LLM 调用超时（秒）。30-120，默认 75。 */
  perCallTimeoutSec: number;
  /** CITA 结构化输出重试总预算（秒）。4-30，默认 8。 */
  citaRepairBudgetSec: number;
  /** Action Gate 结构化输出重试总预算（秒）。5-40，默认 10。 */
  actionGateRepairBudgetSec: number;
  vision?: {
    enabled: boolean;
    autoAnalyze: boolean;
    maxImages: number;
    maxImageMb: number;
    syncWithMain: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    screenCompanionEnabled: boolean;
    observeIntervalSeconds: number;
    talkativeness: "quiet" | "normal" | "active" | "chatty";
    minTalkIntervalSeconds: number;
    proactiveTarget: "desktop" | "discord" | "wechat";
    discordSubTarget: "dm" | "channel";
    discordChannelId: string;
  };
  /** Embedding 维度（可选，仅 cloud 模式）。留空 = 自动探测。 */
  embeddingDimensions?: number;
  multimodal: boolean;
  thinkingOverride?: -1 | 0 | 1;
  /** 上下文窗口大小（Token）。默认 256000。 */
  contextWindowTokens?: number;
}

export interface ModelPreset {
  providerName: string;
  // 厂商短名（去括号后缀），用于状态栏"正在喂养"显示和昵称默认值。
  // 如 "MiniMax（稀宇科技）" → shortName "MiniMax"。
  shortName: string;
  baseUrl: string;
  /** 已由厂商官方确认的 Anthropic 兼容 Base URL；没有就不猜。 */
  anthropicBaseUrl?: string;
  /** 预设首次使用时选中的明确协议；用户之后可以手动修改。 */
  transport: ApiTransport;
  mainModels: string[];
  iconUrl: string;
  // 厂商官网链接，显示在预设下拉框旁边，方便用户直接跳转注册/查看文档。
  websiteUrl?: string;
  // 视觉模型的 OpenAI 兼容 baseUrl。主模型与视觉模型入口不同时使用。
  visionBaseUrl?: string;
  // 该厂商默认主模型是否支持视觉。true 时设置页加载默认勾选"同步主模型"，
  // 多模态用户开箱即用。与 capabilities.ts 的 supportsVision 镜像，需手动同步。
  supportsVision?: boolean;
  // 标记为 true 时，该项在 <select> 里显示但不可选；
  // 用于"已列出但 vendor adapter 还没接好"的情况，避免用户选到后调用直接报错。
  disabled?: boolean;
  // 视觉模型与主模型本质不同（如 MiMo 主 mimo-v2.5-pro、视觉 mimo-v2.5），
  // 强制独立配置，无法"与主聊天模型相同"。与 supportsVision 正交。
  independentVision?: boolean;
  // 独立视觉模型的默认值（applyPreset 在没有保存值时使用）。
  defaultVisionModel?: string;
  // 独立视觉模型的候选列表（用于视觉模型输入框的 datalist）。
  visionModels?: string[];
  // 自定义端点的云端/本地变体共用一张可见卡片，但分别持久化配置。
  customEndpointMode?: CustomEndpointMode;
  hiddenInPresetList?: boolean;
}

export interface GeneralSettings extends ChatAppearanceSettings {
  citaEnabled: boolean;
  citaSemanticEngine: "remote" | "local";
  chatSocialContextEnabled: boolean;
  musicEnabled: boolean;
  musicVolume: number;
  soundEnabled: boolean;
  soundVolume: number;
  petAlwaysOnTop: boolean;
  petVisible: boolean;
  petChatInputEnabled: boolean;
  petZoom: number;
  disableGpuElectron?: boolean;
  sidebarVisible: boolean;
  tasksVisible: boolean;
  launchAtLogin: boolean;
  language: "zh-TW";
  uiTheme: UiTheme;
  windowCornerRadius: number;
  uiThemeRadius: boolean;
  uiFont: UiFont;
  uiIcon: UiIcon;
  defaultChatMode: DefaultChatMode;
  currentStyleId?: string;
  customStyle: CustomStyleConfig;
  segmentedOutputMode: SegmentedOutputMode;
  mobileMessageSegmentation: MobileMessageSegmentationMode;
  proactiveChatMode: ProactiveChatMode;
  proactiveDeliveryTarget: ProactiveDeliveryTarget;
  openerMode: "off" | "quiet" | "normal" | "lively";
  openerQuietStart: string;
  openerQuietEnd: string;
  openerDailyLimit: number;
  openerRoutineEnabled: boolean;
  openerBreaksEnabled: boolean;
  openerWeatherEnabled: boolean;
  screenshotHotkey?: string;
}

export interface UserApi {
  getProfile: () => Promise<{ nickname: string; callPreference: string; birthday: string; timezone: string; avatarPath: string; defaultCity: string; gender: string }>;
  saveProfile: (profile: Record<string, unknown>) => Promise<unknown>;
  uploadAvatar: () => Promise<{ avatarPath: string } | null>;
  getAvatar: () => Promise<string | null>;
  onAvatarChanged: (callback: () => void) => () => void;
}

export interface MemoryPanelPayload {
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

export interface ObsidianVaultConfig {
  vaultPath: string;
  autoSync: boolean;
  lastSyncAt: number;
}

export interface MemoryPanelApi {
  getData: () => Promise<MemoryPanelPayload>;
  deleteImportedDoc: (importId: string, fileName?: string) => Promise<{ ok: boolean; deleted: number }>;
  saveL0: (patch: Record<string, unknown>) => Promise<{ ok: boolean }>;
  saveL1: (patch: Record<string, unknown>) => Promise<{ ok: boolean }>;
  pinL2: (id: string, pinned: boolean) => Promise<{ ok: boolean; error?: string }>;
  deleteL2: (id: string) => Promise<{ ok: boolean; error?: string }>;
  exportToObsidianVault: () => Promise<{
    ok: boolean;
    outputPath?: string;
    fileCount?: number;
    error?: string;
    canceled?: boolean;
  }>;
  bindVault: () => Promise<{
    ok: boolean;
    vaultPath?: string;
    fileCount?: number;
    error?: string;
    canceled?: boolean;
  }>;
  unbindVault: () => Promise<{ ok: boolean }>;
  getVaultConfig: () => Promise<ObsidianVaultConfig>;
  setAutoSync: (autoSync: boolean) => Promise<{ ok: boolean; config: ObsidianVaultConfig }>;
  syncNow: () => Promise<{ ok: boolean; vaultPath?: string; fileCount?: number; error?: string; skipped?: boolean }>;
}

export interface SettingsApi {
  minimize: () => void;
  close: () => void;
  getConfig: () => Promise<ModelSettings>;
  saveConfig: (config: Partial<ModelSettings>) => Promise<ModelSettings>;
  getGeneral: () => Promise<GeneralSettings>;
  saveGeneral: (config: Partial<GeneralSettings>) => Promise<GeneralSettings>;
  openCustomStylePrompt?: () => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  getTimeoutSettings: () => Promise<TimeoutSettings>;
  saveTimeoutSettings: (config: Partial<TimeoutSettings>) => Promise<TimeoutSettings>;
  pickUiFont: () => Promise<string | null>;
  importUiFont: (sourcePath: string) => Promise<UiFont>;
  resetUiFont: () => Promise<UiFont>;
  openSidebar: () => void;
  closeSidebar: () => void;
  openTasks: () => void;
  closeTasks: () => void;
  openChromeGpu: () => void;
  setPetAlwaysOnTop: (value: boolean) => void;
  setPetVisible: (value: boolean) => void;
  setPetZoom: (value: number) => void;
  previewRuntimeSync: (value: "off" | "local" | "llm") => void;
  openStickerManager: () => Promise<{ ok: boolean; error?: string }>;
  stickerPickFile?: () => Promise<string | null>;
  stickerAdd?: (payload: { sourcePath: string; id: string; description: string; phrases: string[] }) => Promise<unknown>;
  getEmbeddingStatus?: () => Promise<Record<string, { installed: boolean; sizeBytes: number }>>;
  downloadEmbeddingModel?: (model: string, mirror: string) => Promise<{ ok: boolean; error?: string }>;
  deleteEmbeddingModel?: (model: string) => Promise<{ ok: boolean; error?: string }>;
  embeddingSetModel?: (model: string) => Promise<{ ok: boolean; clearedEntries?: number; error?: string }>;
  rerankerSetMode?: (mode: string) => Promise<boolean>;
  setToolEnabled?: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  getToolEnabled?: () => Promise<Record<string, boolean>>;
  listSkills?: () => Promise<Array<{ id: string; name: string; description: string; tools: string[]; enabled: boolean; source: string; version?: string; references: string[] }>>;
  setSkillEnabled?: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  addMcpServer?: (config: unknown) => Promise<{ ok: boolean; toolIds?: string[]; error?: string }>;
  removeMcpServer?: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
  listMcpServers?: () => Promise<Array<{ id: string; name: string; connected: boolean; toolCount: number; toolIds: string[] }>>;
  getPermissionLevel?: () => Promise<{ level: "read-only" | "scoped" | "per-action" | "full" }>;
  setPermissionLevel?: (level: string) => Promise<{ ok: boolean; level?: string; error?: string }>;
  testConnection?: (config: { provider: string; baseUrl: string; model: string; apiKey: string; explicitTransport?: ApiTransport; reasoning?: ReasoningPreference }) => Promise<{ ok: boolean; latency: number; sample?: string; error?: string }>;
  testVision?: (config: { baseUrl: string; apiKey: string; model: string }) => Promise<{ ok: boolean; latency: number; sample?: string; error?: string }>;
  // main → settings：要求切到指定标签（窗口已打开时由 main 发这个事件）
  onSwitchSection?: (callback: (section: string) => void) => (() => void) | void;
  channelsGetConfig: () => Promise<{
    wechat: { enabled: boolean };
    feishu: { enabled: boolean; appId?: string; appSecret?: string };
    discord?: { enabled: boolean; botToken?: string; allowedGuildIds?: string[]; allowedChannelIds?: string[]; allowedUserIds?: string[]; codexImageOwnerId?: string; requireMention?: boolean; voiceEnabled?: boolean; cloudPrimary?: boolean; cloudPingUrl?: string; cloudStandbyEnabled?: boolean; cloudStandbyHost?: string; cloudStandbyUser?: string; cloudStandbyKeyPath?: string };
    spotify?: { enabled?: boolean; clientId?: string; clientSecret?: string; clientSecretRecoveryRequired?: boolean; refreshTokenRecoveryRequired?: boolean };
    rateLimitPerUser?: number; rateLimitPerChannel?: number; ttsEnabled?: boolean; stickerEnabled?: boolean; mirrorToDesktop?: boolean; toolSandbox?: "off" | "safe-only" | "all";
  }>;
  channelsSaveConfig: (patch: Record<string, unknown>) => Promise<unknown>;
  channelsRestart: () => Promise<unknown>;
  channelsDiscordTestConnection: () => Promise<{ ok: boolean; message?: string; error?: string }>;
  channelsDiscordGetProfile: () => Promise<{ connected: boolean; username?: string; activityText?: string; presenceStatus?: "online" | "idle" | "dnd" | "invisible" }>;
  channelsDiscordUpdateProfile: (profile: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  channelsDiscordPickAvatar: () => Promise<string | null>;
  channelsDiscordPickBanner: () => Promise<string | null>;
  channelsDiscordPickCloudKey: () => Promise<string | null>;
  channelsDiscordCloudStatus: () => Promise<{ reachable?: boolean; cloudService?: "active" | "inactive" | "activating" | "failed" | "unknown"; watchdog?: "active" | "inactive" | "failed" | "unknown"; heartbeatAge?: number | null; localConnected?: boolean; mode?: "local" | "cloud" | "transition" } | undefined>;
  channelsDiscordCloudControl: (action: "local" | "cloud" | "restart-cloud") => Promise<unknown>;
  channelsDiscordGetMusicState: () => Promise<{ active: boolean; paused: boolean; current?: { title?: string } | null; volume: number }>;
  channelsDiscordGetMusicHistory: () => Promise<Array<{ title?: string; url?: string; playedAt?: string }>>;
  channelsDiscordGetMusicFavorites: () => Promise<{ tracks?: Array<{ title?: string; url?: string }> } | Array<{ title?: string; url?: string }>>;
  channelsDiscordControlMusic: (input: { command: string; value?: number }) => Promise<{ ok: boolean; message?: string }>;
  channelsSpotifyAuthorize: (input: { clientId?: string; clientSecret?: string }) => Promise<{ ok: boolean; message?: string; error?: string }>;
  channelsSpotifyGetStatus: () => Promise<{ configured: boolean; connected: boolean; accountName?: string; product?: string; error?: string; playback?: { active: boolean; paused: boolean } }>;
  channelsSpotifyControl: (input: { command: string; query?: string; value?: number; deviceId?: string }) => Promise<{ ok: boolean; message: string }>;
  channelsSpotifyDisconnect: () => Promise<{ ok: boolean }>;
  channelsBilibiliConnect: () => Promise<{ ok: boolean; message?: string; error?: string }>;
  channelsBilibiliGetStatus: () => Promise<{ connected: boolean; browser: string; profilePath: string }>;
  channelsBilibiliDisconnect: () => Promise<{ ok: boolean; message?: string }>;
  channelsLogGet: (limit?: number) => Promise<unknown[]>;
  channelsLogClear: () => Promise<unknown>;
  xNotificationsGetConfig: () => Promise<{ enabled: boolean; checkIntervalMinutes: number; announcementCategoryName?: string; accounts: Array<{ id: string; username: string; displayName?: string; category: "news" | "anime" | "game" | "leak" | "general"; enabled: boolean; lastTweetId?: string; lastPubDate?: string }> }>;
  xNotificationsSaveConfig: (config: unknown) => Promise<{ ok: boolean }>;
  xNotificationsCheckNow: () => Promise<{ ok: boolean; postedCount?: number; error?: string }>;
  xNotificationsTestAll: () => Promise<{ ok: boolean; message?: string; error?: string }>;
  anilistNotificationsGetConfig: () => Promise<{ enabled: boolean; checkIntervalMinutes: number; username?: string; accessToken?: string; filterMode: "watchlist_only" | "all_airing"; targetCategory: "anime" | "news" | "general" }>;
  anilistNotificationsSaveConfig: (config: unknown) => Promise<{ ok: boolean }>;
  anilistNotificationsVerifyAccount: (username?: string, token?: string) => Promise<{ ok: boolean; error?: string; name?: string }>;
  anilistNotificationsCheckNow: () => Promise<{ ok: boolean; postedCount?: number; error?: string }>;
  anilistNotificationsTestPost: (category?: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
  onChannelsInstallProgress: (callback: (progress: { channel: string; phase: string; pct: number }) => void) => (() => void) | void;
  onChannelsWechatQrcode: (callback: (dataUrl: string) => void) => (() => void) | void;
  onChannelsWechatLoginDone: (callback: (payload: { ok: boolean; botId?: string; error?: string }) => void) => (() => void) | void;
  channelsWechatLoginStart: () => Promise<{ ok: boolean; error?: string }>;
  channelsGetStatus: () => Promise<Record<string, { phase?: string; message?: string }>>;
  onChannelsStatusChanged: (callback: (status: unknown) => void) => (() => void) | void;
  beginScreenshotHotkeyCapture: () => Promise<boolean>;
  endScreenshotHotkeyCapture: () => Promise<boolean>;
  securityGetStatus: () => Promise<{ available: boolean; backend: string; protectedCount: number; plaintextCount: number; lockedCount: number }>;
  backupGetConfig: () => Promise<{ autoEnabled: boolean; retentionDays: 7 | 30; lastAutoBackupAt?: string }>;
  backupSaveConfig: (patch: { autoEnabled?: boolean; retentionDays?: 7 | 30 }) => Promise<{ autoEnabled: boolean; retentionDays: 7 | 30; lastAutoBackupAt?: string }>;
  backupCreate: (categories: string[]) => Promise<BackupSummary | null>;
  backupPickInspect: () => Promise<BackupSummary | null>;
  backupRestore: (payload: { filePath: string; categories: string[] }) => Promise<{ restoredFiles: number; safetyBackupPath: string }>;
  securityRestartApp: () => void;
}

export interface BackupSummary {
  filePath: string;
  createdAt: string;
  appVersion: string;
  categories: Array<{ id: string; label: string; fileCount: number; sizeBytes: number }>;
  fileCount: number;
  sizeBytes: number;
}
