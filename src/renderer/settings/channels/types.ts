// Channels 面板類型定義
// 從 settings.ts 抽離的純類型，無運行時依賴。

export interface DiscordBotProfile {
  connected: boolean;
  id?: string;
  username?: string;
  tag?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  applicationId?: string;
  guildCount: number;
  guilds: Array<{ id: string; name: string }>;
  presenceStatus?: string;
  activityText?: string;
  voiceActive: boolean;
}

export interface DiscordMusicTrack {
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  playlistTitle?: string;
  duration?: number;
  index: number;
  total: number;
}

export interface DiscordMusicState {
  active: boolean;
  paused: boolean;
  current: DiscordMusicTrack | null;
  queue: DiscordMusicTrack[];
  volume: number;
  repeat: "off" | "track" | "queue";
  shuffle: boolean;
  autoplay: boolean;
  elapsed: number;
}

export interface DiscordCloudControlStatus {
  reachable: boolean;
  cloudService: "active" | "inactive" | "activating" | "failed" | "unknown";
  watchdog: "active" | "inactive" | "failed" | "unknown";
  heartbeatAge: number | null;
  localConnected: boolean;
  mode: "local" | "cloud" | "transition";
}

export interface DiscordMusicControlInput {
  command:
    | "previous"
    | "pause"
    | "resume"
    | "skip"
    | "stop"
    | "repeat-track"
    | "repeat-queue"
    | "repeat-off"
    | "shuffle"
    | "ordered"
    | "clear"
    | "remove"
    | "volume"
    | "autoplay-on"
    | "autoplay-off";
  value?: number;
}

export interface DiscordMusicHistoryEntry {
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  playlistTitle?: string;
  playedAt: string;
}

export interface DiscordMusicFavoriteEntry {
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  playlistTitle?: string;
  duration?: number;
  savedAt: string;
}

export interface SpotifyPlaybackStatus {
  configured: boolean;
  connected: boolean;
  accountName?: string;
  product?: string;
  error?: string;
  playback?: {
    active: boolean;
    paused: boolean;
    progressMs: number;
    durationMs: number;
    title?: string;
    artists?: string;
    album?: string;
    imageUrl?: string;
    deviceName?: string;
    volume?: number;
  };
  devices: Array<{ id: string; name: string; type: string; active: boolean; volume?: number }>;
}

export interface BilibiliConnectionStatus {
  connected: boolean;
  browser: string;
  profilePath: string;
}

export interface ChannelsPreviewConfig {
  wechat: { enabled: boolean };
  feishu: { enabled: boolean; appId?: string; appSecret?: string };
  discord: {
    enabled: boolean;
    botToken?: string;
    allowedGuildIds?: string[];
    allowedChannelIds?: string[];
    allowedUserIds?: string[];
    codexImageOwnerId?: string;
    requireMention?: boolean;
    voiceEnabled?: boolean;
  };
  spotify: {
    enabled: boolean;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    accountName?: string;
  };
  bilibili: { enabled: boolean; browser?: "opera-gx" };
  rateLimitPerUser: number;
  rateLimitPerChannel: number;
  ttsEnabled: boolean;
  stickerEnabled: boolean;
  mirrorToDesktop: boolean;
  toolSandbox: "safe-only" | "all";
}

export interface ChannelConnectionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface LogEntry {
  at: string;
  dir: "incoming" | "outgoing";
  channel: string;
  senderId: string;
  senderName?: string;
  chatId: string;
  text: string;
  hasAttachments?: boolean;
}
