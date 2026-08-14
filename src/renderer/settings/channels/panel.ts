// Channels 面板業務邏輯：Discord / Spotify / Bilibili / 微信 / 飛書 / X / AniList 通知 / GCP 雲端控制
// 從 settings.ts 抽離。

import { showModal } from "../shared/modal";
import type {
  DiscordBotProfile,
  DiscordMusicState,
  DiscordCloudControlStatus,
  DiscordMusicControlInput,
  SpotifyPlaybackStatus,
  BilibiliConnectionStatus,
  LogEntry,
} from "./types";

// ===== channels panel (連接手機) =====
const channelsWechatEnabledEl = document.getElementById(
  "channels-wechat-enabled",
) as HTMLInputElement | null;
const channelsFeishuEnabledEl = document.getElementById(
  "channels-feishu-enabled",
) as HTMLInputElement | null;
const channelsDiscordEnabledEl = document.getElementById(
  "channels-discord-enabled",
) as HTMLInputElement | null;
const channelsWechatStatusEl = document.getElementById("channels-wechat-status");
const channelsFeishuStatusEl = document.getElementById("channels-feishu-status");
const channelsDiscordStatusEl = document.getElementById("channels-discord-status");
const channelsRateUserEl = document.getElementById("channels-rate-user") as HTMLInputElement | null;
const channelsRateChannelEl = document.getElementById(
  "channels-rate-channel",
) as HTMLInputElement | null;
const channelsTtsEl = document.getElementById("channels-tts-enabled") as HTMLInputElement | null;
const channelsStickerEl = document.getElementById(
  "channels-sticker-enabled",
) as HTMLInputElement | null;
const channelsMirrorEl = document.getElementById(
  "channels-mirror-desktop",
) as HTMLInputElement | null;
const channelsSandboxEl = document.getElementById(
  "channels-tool-sandbox",
) as HTMLInputElement | null;
// 飛書配置輸入框（Phase 2 長連接版：只需 App ID + App Secret）
const channelsFeishuAppIdEl = document.getElementById(
  "channels-feishu-app-id",
) as HTMLInputElement | null;
const channelsFeishuAppSecretEl = document.getElementById(
  "channels-feishu-app-secret",
) as HTMLInputElement | null;
const channelsFeishuAppSecretRevealBtn = document.getElementById(
  "channels-feishu-app-secret-reveal",
);
const channelsFeishuSaveBtn = document.getElementById("channels-feishu-save");
const channelsDiscordTokenEl = document.getElementById(
  "channels-discord-token",
) as HTMLInputElement | null;
const channelsDiscordTokenRevealBtn = document.getElementById("channels-discord-token-reveal");
const channelsDiscordGuildIdsEl = document.getElementById(
  "channels-discord-guild-ids",
) as HTMLInputElement | null;
const channelsDiscordChannelIdsEl = document.getElementById(
  "channels-discord-channel-ids",
) as HTMLInputElement | null;
const channelsDiscordUserIdsEl = document.getElementById(
  "channels-discord-user-ids",
) as HTMLInputElement | null;
const channelsDiscordCodexOwnerIdEl = document.getElementById(
  "channels-discord-codex-owner-id",
) as HTMLInputElement | null;
const channelsDiscordRequireMentionEl = document.getElementById(
  "channels-discord-require-mention",
) as HTMLInputElement | null;
const channelsDiscordVoiceEnabledEl = document.getElementById(
  "channels-discord-voice-enabled",
) as HTMLInputElement | null;
const channelsDiscordSaveBtn = document.getElementById("channels-discord-save");
const channelsDiscordAvatarEl = document.getElementById(
  "channels-discord-avatar",
) as HTMLImageElement | null;
const channelsDiscordAvatarFallbackEl = document.getElementById("channels-discord-avatar-fallback");
const channelsDiscordAvatarPresenceEl = document.getElementById("channels-discord-avatar-presence");
const channelsDiscordDisplayNameEl = document.getElementById("channels-discord-display-name");
const channelsDiscordTagEl = document.getElementById("channels-discord-tag");
const channelsDiscordApplicationIdEl = document.getElementById("channels-discord-application-id");
const channelsDiscordGuildCountEl = document.getElementById("channels-discord-guild-count");
const channelsDiscordVoiceStatusEl = document.getElementById("channels-discord-voice-status");
const channelsDiscordGuildsEl = document.getElementById("channels-discord-guilds");
const channelsDiscordUsernameEl = document.getElementById(
  "channels-discord-username",
) as HTMLInputElement | null;
const channelsDiscordActivityEl = document.getElementById(
  "channels-discord-activity",
) as HTMLInputElement | null;
const channelsDiscordPresenceEl = document.getElementById(
  "channels-discord-presence",
) as HTMLSelectElement | null;
const channelsDiscordAvatarPickBtn = document.getElementById(
  "channels-discord-avatar-pick",
) as HTMLButtonElement | null;
const channelsDiscordMediaMenuEl = document.getElementById("channels-discord-media-menu");
const channelsDiscordAvatarOptionBtn = document.getElementById(
  "channels-discord-avatar-option",
) as HTMLButtonElement | null;
const channelsDiscordBannerOptionBtn = document.getElementById(
  "channels-discord-banner-option",
) as HTMLButtonElement | null;
const channelsDiscordProfileSaveBtn = document.getElementById(
  "channels-discord-profile-save",
) as HTMLButtonElement | null;
const channelsDiscordProfileFeedbackEl = document.getElementById(
  "channels-discord-profile-feedback",
);
const channelsDiscordEmojiPickerEl = document.getElementById("channels-discord-emoji-picker");
const channelsDiscordMusicStatusEl = document.getElementById("channels-discord-music-status");
const channelsDiscordMusicRecordEl = document.getElementById("channels-discord-music-record");
const channelsDiscordMusicCoverEl = document.getElementById(
  "channels-discord-music-cover",
) as HTMLImageElement | null;
const channelsDiscordMusicTitleEl = document.getElementById("channels-discord-music-title");
const channelsDiscordMusicProgressEl = document.getElementById(
  "channels-discord-music-progress",
) as HTMLElement | null;
const channelsDiscordMusicElapsedEl = document.getElementById("channels-discord-music-elapsed");
const channelsDiscordMusicDurationEl = document.getElementById("channels-discord-music-duration");
const channelsDiscordMusicToggleBtn = document.getElementById(
  "channels-discord-music-toggle",
) as HTMLButtonElement | null;
const channelsDiscordMusicPreviousBtn = document.getElementById(
  "channels-discord-music-previous",
) as HTMLButtonElement | null;
const channelsDiscordMusicNextBtn = document.getElementById(
  "channels-discord-music-next",
) as HTMLButtonElement | null;
const channelsDiscordMusicStopBtn = document.getElementById(
  "channels-discord-music-stop",
) as HTMLButtonElement | null;
const channelsDiscordMusicRepeatBtn = document.getElementById(
  "channels-discord-music-repeat",
) as HTMLButtonElement | null;
const channelsDiscordMusicShuffleBtn = document.getElementById(
  "channels-discord-music-shuffle",
) as HTMLButtonElement | null;
const channelsDiscordMusicAutoplayBtn = document.getElementById(
  "channels-discord-music-autoplay",
) as HTMLButtonElement | null;
const channelsDiscordMusicClearBtn = document.getElementById(
  "channels-discord-music-clear",
) as HTMLButtonElement | null;
const channelsDiscordMusicVolumeEl = document.getElementById(
  "channels-discord-music-volume",
) as HTMLInputElement | null;
const channelsDiscordMusicVolumeValueEl = document.getElementById(
  "channels-discord-music-volume-value",
) as HTMLOutputElement | null;
const channelsDiscordMusicQueueEl = document.getElementById("channels-discord-music-queue");
const channelsDiscordMusicPlaylistTitleEl = document.getElementById(
  "channels-discord-music-playlist-title",
);
const channelsDiscordMusicLibraryKindEl = document.getElementById(
  "channels-discord-music-library-kind",
);
const channelsDiscordMusicQueueToggleBtn = document.getElementById(
  "channels-discord-music-queue-toggle",
) as HTMLButtonElement | null;
const channelsDiscordMusicFavoritesToggleBtn = document.getElementById(
  "channels-discord-music-favorites-toggle",
) as HTMLButtonElement | null;
const channelsDiscordMusicHistoryToggleBtn = document.getElementById(
  "channels-discord-music-history-toggle",
) as HTMLButtonElement | null;
const channelsDiscordMusicFavoritesEl = document.getElementById("channels-discord-music-favorites");
const channelsDiscordMusicHistoryEl = document.getElementById("channels-discord-music-history");
const channelsDiscordMusicFeedbackEl = document.getElementById("channels-discord-music-feedback");
const channelsSpotifyPlanEl = document.getElementById("channels-spotify-plan");
const channelsSpotifyCoverEl = document.getElementById(
  "channels-spotify-cover",
) as HTMLImageElement | null;
const channelsSpotifyDeviceEl = document.getElementById("channels-spotify-device");
const channelsSpotifyTitleEl = document.getElementById("channels-spotify-title");
const channelsSpotifyArtistEl = document.getElementById("channels-spotify-artist");
const channelsSpotifyProgressEl = document.getElementById(
  "channels-spotify-progress",
) as HTMLElement | null;
const channelsSpotifyPreviousBtn = document.getElementById(
  "channels-spotify-previous",
) as HTMLButtonElement | null;
const channelsSpotifyToggleBtn = document.getElementById(
  "channels-spotify-toggle",
) as HTMLButtonElement | null;
const channelsSpotifyNextBtn = document.getElementById(
  "channels-spotify-next",
) as HTMLButtonElement | null;
const channelsSpotifyDeviceSelectEl = document.getElementById(
  "channels-spotify-device-select",
) as HTMLSelectElement | null;
const channelsSpotifyVolumeEl = document.getElementById(
  "channels-spotify-volume",
) as HTMLInputElement | null;
const channelsSpotifyVolumeValueEl = document.getElementById(
  "channels-spotify-volume-value",
) as HTMLOutputElement | null;
const channelsSpotifyQueryEl = document.getElementById(
  "channels-spotify-query",
) as HTMLInputElement | null;
const channelsSpotifyPlayQueryBtn = document.getElementById(
  "channels-spotify-play-query",
) as HTMLButtonElement | null;
const channelsSpotifyClientIdEl = document.getElementById(
  "channels-spotify-client-id",
) as HTMLInputElement | null;
const channelsSpotifyClientSecretEl = document.getElementById(
  "channels-spotify-client-secret",
) as HTMLInputElement | null;
const channelsSpotifySecretRevealBtn = document.getElementById(
  "channels-spotify-secret-reveal",
) as HTMLButtonElement | null;
const channelsSpotifyConnectBtn = document.getElementById(
  "channels-spotify-connect",
) as HTMLButtonElement | null;
const channelsSpotifyDisconnectBtn = document.getElementById(
  "channels-spotify-disconnect",
) as HTMLButtonElement | null;
const channelsSpotifyFeedbackEl = document.getElementById("channels-spotify-feedback");
const channelsBilibiliCardEl = document.getElementById("channels-bilibili-card");
const channelsBilibiliStatusEl = document.getElementById("channels-bilibili-status");
const channelsBilibiliSessionTitleEl = document.getElementById("channels-bilibili-session-title");
const channelsBilibiliSessionDetailEl = document.getElementById("channels-bilibili-session-detail");
const channelsBilibiliConnectBtn = document.getElementById(
  "channels-bilibili-connect",
) as HTMLButtonElement | null;
const channelsBilibiliDisconnectBtn = document.getElementById(
  "channels-bilibili-disconnect",
) as HTMLButtonElement | null;
const channelsBilibiliFeedbackEl = document.getElementById("channels-bilibili-feedback");
// 微信按鈕
const channelsWechatLoginBtn = document.getElementById("channels-wechat-login");
const channelsWechatRestartBtn = document.getElementById("channels-wechat-restart");
const channelsWechatFeedbackEl = document.getElementById("channels-wechat-feedback");
const channelsFeishuFeedbackEl = document.getElementById("channels-feishu-feedback");
const channelsDiscordFeedbackEl = document.getElementById("channels-discord-feedback");

// Google Cloud 備援控制台 DOM 元素
const channelsCloudStatusEl = document.getElementById("channels-cloud-status");
const channelsCloudModeEl = document.getElementById("channels-cloud-mode");
const channelsCloudVmEl = document.getElementById("channels-cloud-vm");
const channelsCloudBotEl = document.getElementById("channels-cloud-bot");
const channelsCloudWatchdogEl = document.getElementById("channels-cloud-watchdog");
const channelsCloudHeartbeatEl = document.getElementById("channels-cloud-heartbeat");
const channelsCloudLocalBtn = document.getElementById(
  "channels-cloud-local",
) as HTMLButtonElement | null;
const channelsCloudRemoteBtn = document.getElementById(
  "channels-cloud-remote",
) as HTMLButtonElement | null;
const channelsCloudRestartBtn = document.getElementById(
  "channels-cloud-restart",
) as HTMLButtonElement | null;
const channelsCloudRefreshBtn = document.getElementById(
  "channels-cloud-refresh",
) as HTMLButtonElement | null;
const channelsCloudFeedbackEl = document.getElementById("channels-cloud-feedback");
const channelsCloudEnabledEl = document.getElementById(
  "channels-cloud-enabled",
) as HTMLInputElement | null;
const channelsCloudHostEl = document.getElementById(
  "channels-cloud-host",
) as HTMLInputElement | null;
const channelsCloudUserEl = document.getElementById(
  "channels-cloud-user",
) as HTMLInputElement | null;
const channelsCloudKeyPathEl = document.getElementById(
  "channels-cloud-key-path",
) as HTMLInputElement | null;
const channelsCloudPickKeyBtn = document.getElementById(
  "channels-cloud-pick-key",
) as HTMLButtonElement | null;
const channelsCloudSaveBtn = document.getElementById(
  "channels-cloud-save",
) as HTMLButtonElement | null;

let channelsInitialized = false;
let channelsSaveTimer: number | null = null;
let pendingDiscordAvatarPath: string | undefined;
let pendingDiscordBannerPath: string | undefined;
let discordMusicState: DiscordMusicState = {
  active: false,
  paused: false,
  current: null,
  queue: [],
  volume: 100,
  repeat: "off",
  shuffle: false,
  autoplay: false,
  elapsed: 0,
};
let discordMusicLibraryView: "queue" | "favorites" | "history" = "queue";
let discordMusicRefreshTimer: number | null = null;
let discordMusicVolumeTimer: number | null = null;
let spotifyStatus: SpotifyPlaybackStatus = { configured: false, connected: false, devices: [] };
let spotifyRefreshTimer: number | null = null;

export function setChannelsPolling(active: boolean): void {
  if (discordMusicRefreshTimer != null) {
    window.clearInterval(discordMusicRefreshTimer);
    discordMusicRefreshTimer = null;
  }
  if (spotifyRefreshTimer != null) {
    window.clearInterval(spotifyRefreshTimer);
    spotifyRefreshTimer = null;
  }
  if (!active || document.visibilityState === "hidden") return;

  // 音樂狀態需要接近即時，但只在使用者真的看著「連接手機」面板時輪詢。
  discordMusicRefreshTimer = window.setInterval(() => void refreshDiscordMusic(), 2_000);
  spotifyRefreshTimer = window.setInterval(() => void refreshSpotify(), 5_000);
}

document.addEventListener("visibilitychange", () => {
  const channelsPanel = document.getElementById("channels-panel");
  setChannelsPolling(!!channelsPanel && !channelsPanel.classList.contains("is-hidden"));
});
let spotifyVolumeTimer: number | null = null;

function setDiscordProfileFeedback(kind: "info" | "ok" | "err", message: string): void {
  if (!channelsDiscordProfileFeedbackEl) return;
  channelsDiscordProfileFeedbackEl.textContent = message;
  channelsDiscordProfileFeedbackEl.className = "channels-feedback";
  channelsDiscordProfileFeedbackEl.classList.add(
    kind === "ok"
      ? "channels-feedback--ok"
      : kind === "err"
        ? "channels-feedback--err"
        : "channels-feedback--info",
  );
}

function renderDiscordProfile(profile: DiscordBotProfile): void {
  const connected = profile.connected;
  if (channelsDiscordDisplayNameEl)
    channelsDiscordDisplayNameEl.textContent = profile.username ?? "尚未連接";
  if (channelsDiscordTagEl)
    channelsDiscordTagEl.textContent = profile.tag ?? "連接 Gateway 後顯示即時資訊";
  if (channelsDiscordApplicationIdEl)
    channelsDiscordApplicationIdEl.textContent = profile.applicationId ?? "—";
  if (channelsDiscordGuildCountEl)
    channelsDiscordGuildCountEl.textContent = String(profile.guildCount ?? 0);
  if (channelsDiscordVoiceStatusEl)
    channelsDiscordVoiceStatusEl.textContent = profile.voiceActive ? "通話中" : "未通話";
  if (channelsDiscordAvatarPresenceEl)
    channelsDiscordAvatarPresenceEl.classList.toggle("is-online", connected);
  if (channelsDiscordAvatarEl) {
    if (profile.avatarUrl) {
      channelsDiscordAvatarEl.src = profile.avatarUrl;
      channelsDiscordAvatarEl.hidden = false;
      if (channelsDiscordAvatarFallbackEl) channelsDiscordAvatarFallbackEl.hidden = true;
    } else {
      channelsDiscordAvatarEl.hidden = true;
      if (channelsDiscordAvatarFallbackEl) channelsDiscordAvatarFallbackEl.hidden = false;
    }
  }
  if (channelsDiscordGuildsEl) {
    channelsDiscordGuildsEl.replaceChildren();
    if (!profile.guilds?.length) {
      const empty = document.createElement("span");
      empty.textContent = connected ? "尚未加入任何伺服器" : "連接後顯示 Bot 所在的伺服器";
      channelsDiscordGuildsEl.appendChild(empty);
    } else {
      for (const guild of profile.guilds) {
        const chip = document.createElement("span");
        chip.className = "discord-guild-chip";
        chip.textContent = guild.name;
        chip.title = `Server ID: ${guild.id}`;
        channelsDiscordGuildsEl.appendChild(chip);
      }
    }
  }
  if (channelsDiscordUsernameEl) {
    channelsDiscordUsernameEl.value = profile.username ?? "";
    channelsDiscordUsernameEl.disabled = !connected;
  }
  if (channelsDiscordActivityEl) {
    channelsDiscordActivityEl.value = profile.activityText ?? "";
    channelsDiscordActivityEl.disabled = !connected;
  }
  if (channelsDiscordPresenceEl) {
    const presence = profile.presenceStatus === "offline" ? "invisible" : profile.presenceStatus;
    channelsDiscordPresenceEl.value = ["online", "idle", "dnd", "invisible"].includes(
      presence ?? "",
    )
      ? presence!
      : "online";
    channelsDiscordPresenceEl.disabled = !connected;
  }
  if (channelsDiscordAvatarPickBtn) channelsDiscordAvatarPickBtn.disabled = !connected;
  if (channelsDiscordAvatarOptionBtn) channelsDiscordAvatarOptionBtn.disabled = !connected;
  if (channelsDiscordBannerOptionBtn) channelsDiscordBannerOptionBtn.disabled = !connected;
  if (channelsDiscordProfileSaveBtn) channelsDiscordProfileSaveBtn.disabled = !connected;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".discord-emoji-button"))
    button.disabled = !connected;
}

async function refreshDiscordProfile(): Promise<void> {
  try {
    renderDiscordProfile(await window.settings.channelsDiscordGetProfile());
  } catch (err) {
    console.warn("[Channels] 讀取 Discord Bot 資訊失敗:", err);
    renderDiscordProfile({ connected: false, guildCount: 0, guilds: [], voiceActive: false });
  }
}

function formatDiscordMusicTime(seconds?: number): string {
  if (!Number.isFinite(seconds) || (seconds ?? 0) < 0) return "—";
  const total = Math.floor(seconds ?? 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function setDiscordMusicFeedback(kind: "info" | "ok" | "err", message: string): void {
  if (!channelsDiscordMusicFeedbackEl) return;
  channelsDiscordMusicFeedbackEl.textContent = message;
  channelsDiscordMusicFeedbackEl.className = "channels-feedback";
  channelsDiscordMusicFeedbackEl.classList.add(
    kind === "ok"
      ? "channels-feedback--ok"
      : kind === "err"
        ? "channels-feedback--err"
        : "channels-feedback--info",
  );
}

function renderDiscordMusic(state: DiscordMusicState): void {
  discordMusicState = state;
  const current = state.current;
  const controls = [
    channelsDiscordMusicPreviousBtn,
    channelsDiscordMusicToggleBtn,
    channelsDiscordMusicNextBtn,
    channelsDiscordMusicStopBtn,
    channelsDiscordMusicRepeatBtn,
    channelsDiscordMusicShuffleBtn,
    channelsDiscordMusicAutoplayBtn,
  ];
  for (const control of controls) if (control) control.disabled = !state.active;
  if (channelsDiscordMusicClearBtn) channelsDiscordMusicClearBtn.disabled = !state.queue.length;
  if (channelsDiscordMusicVolumeEl) {
    if (document.activeElement !== channelsDiscordMusicVolumeEl)
      channelsDiscordMusicVolumeEl.value = String(state.volume);
    channelsDiscordMusicVolumeEl.disabled = !state.active;
  }
  if (channelsDiscordMusicVolumeValueEl && document.activeElement !== channelsDiscordMusicVolumeEl)
    channelsDiscordMusicVolumeValueEl.value = `${state.volume}%`;
  if (channelsDiscordMusicStatusEl) {
    channelsDiscordMusicStatusEl.textContent = state.active
      ? state.paused
        ? "已暫停"
        : "正在播放"
      : "尚未播放";
    channelsDiscordMusicStatusEl.classList.toggle("is-active", state.active);
  }
  if (channelsDiscordMusicRecordEl) {
    channelsDiscordMusicRecordEl.classList.toggle("is-playing", state.active);
    channelsDiscordMusicRecordEl.classList.toggle("is-paused", state.paused);
  }
  if (channelsDiscordMusicCoverEl && channelsDiscordMusicRecordEl) {
    const thumbnail = current?.thumbnail;
    if (thumbnail) {
      if (channelsDiscordMusicCoverEl.src !== thumbnail)
        channelsDiscordMusicCoverEl.src = thumbnail;
      channelsDiscordMusicCoverEl.hidden = false;
      channelsDiscordMusicRecordEl.classList.add("has-cover");
    } else {
      channelsDiscordMusicCoverEl.removeAttribute("src");
      channelsDiscordMusicCoverEl.hidden = true;
      channelsDiscordMusicRecordEl.classList.remove("has-cover");
    }
  }
  if (channelsDiscordMusicTitleEl)
    channelsDiscordMusicTitleEl.textContent = current?.title ?? "等待你在 Discord 使用 /play";
  if (channelsDiscordMusicPlaylistTitleEl) {
    channelsDiscordMusicPlaylistTitleEl.textContent =
      discordMusicLibraryView === "history"
        ? "播放歷史"
        : discordMusicLibraryView === "favorites"
          ? "我喜歡的歌"
          : (current?.playlistTitle ?? state.queue[0]?.playlistTitle ?? "播放清單");
    channelsDiscordMusicPlaylistTitleEl.title = channelsDiscordMusicPlaylistTitleEl.textContent;
  }
  if (channelsDiscordMusicToggleBtn) {
    channelsDiscordMusicToggleBtn.textContent = state.paused ? "▶" : "Ⅱ";
    channelsDiscordMusicToggleBtn.title = state.paused ? "繼續播放" : "暫停播放";
  }
  if (channelsDiscordMusicRepeatBtn) {
    channelsDiscordMusicRepeatBtn.textContent =
      state.repeat === "track" ? "↻¹" : state.repeat === "queue" ? "↻∞" : "↻";
    channelsDiscordMusicRepeatBtn.setAttribute("aria-pressed", String(state.repeat !== "off"));
    channelsDiscordMusicRepeatBtn.title =
      state.repeat === "track"
        ? "單曲循環（點擊切換清單循環）"
        : state.repeat === "queue"
          ? "清單循環（點擊關閉）"
          : "開啟單曲循環";
  }
  if (channelsDiscordMusicShuffleBtn)
    channelsDiscordMusicShuffleBtn.setAttribute("aria-pressed", String(state.shuffle));
  if (channelsDiscordMusicAutoplayBtn) {
    channelsDiscordMusicAutoplayBtn.setAttribute("aria-pressed", String(state.autoplay));
    channelsDiscordMusicAutoplayBtn.title = state.autoplay
      ? "自動推薦已開啟（點擊關閉）"
      : "佇列結束後自動推薦相近歌曲";
  }
  const duration = current?.duration;
  if (channelsDiscordMusicElapsedEl)
    channelsDiscordMusicElapsedEl.textContent = formatDiscordMusicTime(state.elapsed);
  if (channelsDiscordMusicDurationEl)
    channelsDiscordMusicDurationEl.textContent = formatDiscordMusicTime(duration);
  if (channelsDiscordMusicProgressEl)
    channelsDiscordMusicProgressEl.style.width = duration
      ? `${Math.min(100, (state.elapsed / duration) * 100)}%`
      : "0%";

  if (channelsDiscordMusicQueueEl) {
    channelsDiscordMusicQueueEl.replaceChildren();
    const activePlaylist = current?.playlistTitle ?? state.queue[0]?.playlistTitle;
    const categoryQueue = activePlaylist
      ? state.queue.filter((track) => track.playlistTitle === activePlaylist)
      : state.queue;
    const tracks = current ? [current, ...categoryQueue] : categoryQueue;
    if (!tracks.length) {
      const empty = document.createElement("li");
      empty.className = "is-empty";
      empty.textContent = "用 Discord 的 /play 加入歌曲後，播放清單會顯示在這裡";
      channelsDiscordMusicQueueEl.appendChild(empty);
    } else {
      tracks.forEach((track, index) => {
        const item = document.createElement("li");
        if (index === 0 && current) item.className = "is-current";
        const number = document.createElement("span");
        number.textContent = index === 0 && current ? "♪" : String(current ? index : index + 1);
        const title = document.createElement("strong");
        title.textContent = track.title;
        title.title = track.title;
        const time = document.createElement("small");
        time.textContent = formatDiscordMusicTime(track.duration);
        item.append(number, title, time);
        if (!(index === 0 && current)) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "×";
          remove.title = `從播放清單移除 ${track.title}`;
          remove.dataset.queuePosition = String(current ? index : index + 1);
          item.appendChild(remove);
        } else {
          item.appendChild(document.createElement("span"));
        }
        channelsDiscordMusicQueueEl.appendChild(item);
      });
    }
  }
}

async function refreshDiscordMusic(): Promise<void> {
  try {
    renderDiscordMusic(await window.settings.channelsDiscordGetMusicState());
  } catch (err) {
    console.warn("[Channels] 讀取 Discord 音樂狀態失敗:", err);
  }
}

async function renderDiscordMusicHistory(): Promise<void> {
  if (!channelsDiscordMusicHistoryEl) return;
  channelsDiscordMusicHistoryEl.replaceChildren();
  const history = await window.settings.channelsDiscordGetMusicHistory();
  if (!history.length) {
    const empty = document.createElement("li");
    empty.className = "is-empty";
    empty.textContent = "歌曲或影片開始播放後會記錄在這裡";
    channelsDiscordMusicHistoryEl.appendChild(empty);
    return;
  }
  for (const entry of history) {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    icon.textContent = "♪";
    const title = document.createElement("strong");
    title.textContent = entry.title;
    title.title = entry.url;
    const time = document.createElement("small");
    time.textContent = new Intl.DateTimeFormat("zh-TW", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(entry.playedAt));
    item.append(icon, title, time);
    channelsDiscordMusicHistoryEl.appendChild(item);
  }
}

function discordFavoriteSource(url: string): { label: string; className: string } {
  if (/open\.spotify\.com/i.test(url)) return { label: "Spotify", className: "is-spotify" };
  if (/(?:bilibili\.com|b23\.tv)/i.test(url))
    return { label: "Bilibili", className: "is-bilibili" };
  if (/(?:youtube\.com|youtu\.be)/i.test(url)) return { label: "YouTube", className: "is-youtube" };
  return { label: "Music", className: "is-music" };
}

async function renderDiscordMusicFavorites(): Promise<void> {
  if (!channelsDiscordMusicFavoritesEl) return;
  channelsDiscordMusicFavoritesEl.replaceChildren();
  const favorites = await window.settings.channelsDiscordGetMusicFavorites();
  if (!favorites.length) {
    const empty = document.createElement("li");
    empty.className = "is-empty discord-player__favorites-empty";
    empty.textContent = "還沒有收藏歌曲。在 Discord 播放器按 ❤️ Save，或使用 /favorite。";
    channelsDiscordMusicFavoritesEl.appendChild(empty);
    return;
  }
  for (const entry of favorites) {
    const source = discordFavoriteSource(entry.url);
    const item = document.createElement("li");
    item.className = `discord-player__favorite ${source.className}`;

    const cover = document.createElement("div");
    cover.className = "discord-player__favorite-cover";
    cover.textContent = "♪";
    if (entry.thumbnail) {
      const image = document.createElement("img");
      image.src = entry.thumbnail;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove(), { once: true });
      cover.appendChild(image);
    }

    const copy = document.createElement("div");
    copy.className = "discord-player__favorite-copy";
    const meta = document.createElement("div");
    meta.className = "discord-player__favorite-meta";
    const badge = document.createElement("span");
    badge.textContent = source.label;
    const saved = document.createElement("time");
    saved.dateTime = entry.savedAt;
    saved.textContent = new Intl.DateTimeFormat("zh-TW", {
      month: "numeric",
      day: "numeric",
    }).format(new Date(entry.savedAt));
    meta.append(badge, saved);
    const title = document.createElement("a");
    title.href = entry.url;
    title.target = "_blank";
    title.rel = "noopener";
    title.textContent = entry.title;
    title.title = `開啟 ${entry.title}`;
    const detail = document.createElement("small");
    detail.textContent =
      [entry.playlistTitle, entry.duration ? formatDiscordMusicTime(entry.duration) : ""]
        .filter(Boolean)
        .join(" · ") || "單曲收藏";
    copy.append(meta, title, detail);

    const open = document.createElement("a");
    open.className = "discord-player__favorite-open";
    open.href = entry.url;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "↗";
    open.title = "開啟原始連結";
    item.append(cover, copy, open);
    channelsDiscordMusicFavoritesEl.appendChild(item);
  }
}

async function showDiscordMusicLibrary(view: "queue" | "favorites" | "history"): Promise<void> {
  discordMusicLibraryView = view;
  if (channelsDiscordMusicQueueEl) channelsDiscordMusicQueueEl.hidden = view !== "queue";
  if (channelsDiscordMusicFavoritesEl)
    channelsDiscordMusicFavoritesEl.hidden = view !== "favorites";
  if (channelsDiscordMusicHistoryEl) channelsDiscordMusicHistoryEl.hidden = view !== "history";
  const tabs = [
    [channelsDiscordMusicQueueToggleBtn, "queue"],
    [channelsDiscordMusicFavoritesToggleBtn, "favorites"],
    [channelsDiscordMusicHistoryToggleBtn, "history"],
  ] as const;
  for (const [button, name] of tabs) {
    button?.setAttribute("aria-selected", String(name === view));
    button?.setAttribute("aria-pressed", String(name === view));
  }
  if (channelsDiscordMusicClearBtn) channelsDiscordMusicClearBtn.hidden = view !== "queue";
  if (channelsDiscordMusicLibraryKindEl)
    channelsDiscordMusicLibraryKindEl.textContent =
      view === "queue" ? "PLAYLIST" : view === "favorites" ? "FAVORITES" : "HISTORY";
  if (view === "favorites") await renderDiscordMusicFavorites();
  else if (view === "history") await renderDiscordMusicHistory();
  renderDiscordMusic(discordMusicState);
}

async function controlDiscordMusic(input: DiscordMusicControlInput, quiet = false): Promise<void> {
  try {
    const result = await window.settings.channelsDiscordControlMusic(input);
    if (result.state) renderDiscordMusic(result.state);
    if (!quiet || !result.ok) setDiscordMusicFeedback(result.ok ? "ok" : "err", result.message);
  } catch (err) {
    setDiscordMusicFeedback("err", err instanceof Error ? err.message : String(err));
  }
}

function setSpotifyFeedback(kind: "info" | "ok" | "err", message: string): void {
  if (!channelsSpotifyFeedbackEl) return;
  channelsSpotifyFeedbackEl.textContent = message;
  channelsSpotifyFeedbackEl.className = "channels-feedback";
  channelsSpotifyFeedbackEl.classList.add(
    kind === "ok"
      ? "channels-feedback--ok"
      : kind === "err"
        ? "channels-feedback--err"
        : "channels-feedback--info",
  );
}

function renderSpotify(status: SpotifyPlaybackStatus): void {
  spotifyStatus = status;
  const playback = status.playback;
  const usable = status.connected && status.devices.length > 0;
  if (channelsSpotifyPlanEl) {
    channelsSpotifyPlanEl.textContent = status.connected
      ? `${status.accountName ?? "已連線"}${status.product ? ` · ${status.product}` : ""}`
      : "尚未連線";
    channelsSpotifyPlanEl.classList.toggle("is-connected", status.connected);
  }
  if (channelsSpotifyConnectBtn)
    channelsSpotifyConnectBtn.textContent = status.connected ? "重新授權" : "連接 Spotify";
  if (channelsSpotifyDisconnectBtn) channelsSpotifyDisconnectBtn.disabled = !status.connected;
  if (channelsSpotifyQueryEl)
    channelsSpotifyQueryEl.disabled = !status.connected || !status.devices.length;
  if (channelsSpotifyPlayQueryBtn)
    channelsSpotifyPlayQueryBtn.disabled = !status.connected || !status.devices.length;
  for (const button of [
    channelsSpotifyPreviousBtn,
    channelsSpotifyToggleBtn,
    channelsSpotifyNextBtn,
  ])
    if (button) button.disabled = !usable;
  if (channelsSpotifyVolumeEl) channelsSpotifyVolumeEl.disabled = !usable;
  if (channelsSpotifyDeviceSelectEl) {
    const selected = channelsSpotifyDeviceSelectEl.value;
    channelsSpotifyDeviceSelectEl.replaceChildren();
    if (!status.devices.length)
      channelsSpotifyDeviceSelectEl.add(new Option("請先開啟 Spotify 播放器", ""));
    else
      for (const device of status.devices)
        channelsSpotifyDeviceSelectEl.add(
          new Option(`${device.active ? "● " : ""}${device.name} · ${device.type}`, device.id),
        );
    channelsSpotifyDeviceSelectEl.disabled = !status.connected || !status.devices.length;
    const active = status.devices.find((device) => device.active)?.id;
    channelsSpotifyDeviceSelectEl.value = status.devices.some((device) => device.id === selected)
      ? selected
      : (active ?? status.devices[0]?.id ?? "");
  }
  if (channelsSpotifyTitleEl)
    channelsSpotifyTitleEl.textContent =
      playback?.title ??
      (status.connected
        ? "Spotify 已連線，請先在任一裝置開始播放"
        : "連線後即可控制手機或電腦上的 Spotify");
  if (channelsSpotifyArtistEl)
    channelsSpotifyArtistEl.textContent = playback?.artists
      ? `${playback.artists}${playback.album ? ` · ${playback.album}` : ""}`
      : "Premium 播放控制";
  if (channelsSpotifyDeviceEl)
    channelsSpotifyDeviceEl.textContent =
      playback?.deviceName ?? (status.connected ? "目前沒有作用中的播放器" : "等待 Spotify 裝置");
  if (channelsSpotifyToggleBtn)
    channelsSpotifyToggleBtn.textContent = playback?.active && !playback.paused ? "Ⅱ" : "▶";
  if (channelsSpotifyProgressEl)
    channelsSpotifyProgressEl.style.width = playback?.durationMs
      ? `${Math.min(100, (playback.progressMs / playback.durationMs) * 100)}%`
      : "0%";
  if (channelsSpotifyCoverEl) {
    if (playback?.imageUrl) {
      if (channelsSpotifyCoverEl.src !== playback.imageUrl)
        channelsSpotifyCoverEl.src = playback.imageUrl;
      channelsSpotifyCoverEl.hidden = false;
    } else {
      channelsSpotifyCoverEl.hidden = true;
      channelsSpotifyCoverEl.removeAttribute("src");
    }
  }
  if (
    channelsSpotifyVolumeEl &&
    document.activeElement !== channelsSpotifyVolumeEl &&
    playback?.volume != null
  )
    channelsSpotifyVolumeEl.value = String(playback.volume);
  if (channelsSpotifyVolumeValueEl && document.activeElement !== channelsSpotifyVolumeEl)
    channelsSpotifyVolumeValueEl.value = `${playback?.volume ?? Number(channelsSpotifyVolumeEl?.value ?? 50)}%`;
  if (status.error) setSpotifyFeedback("err", status.error);
}

let spotifyRefreshInFlight = false;
async function refreshSpotify(): Promise<void> {
  if (spotifyRefreshInFlight) return;
  spotifyRefreshInFlight = true;
  try {
    renderSpotify(await window.settings.channelsSpotifyGetStatus());
  } catch (err) {
    setSpotifyFeedback("err", err instanceof Error ? err.message : String(err));
  } finally {
    spotifyRefreshInFlight = false;
  }
}

async function controlSpotifyUi(command: string, value?: number, query?: string): Promise<void> {
  const result = await window.settings.channelsSpotifyControl({
    command,
    value,
    query,
    deviceId: channelsSpotifyDeviceSelectEl?.value || undefined,
  });
  if (!result.ok) setSpotifyFeedback("err", result.message);
  await refreshSpotify();
}

function setBilibiliFeedback(kind: "info" | "ok" | "err", message: string): void {
  if (!channelsBilibiliFeedbackEl) return;
  channelsBilibiliFeedbackEl.textContent = message;
  channelsBilibiliFeedbackEl.className = "channels-feedback";
  channelsBilibiliFeedbackEl.classList.add(
    kind === "ok"
      ? "channels-feedback--ok"
      : kind === "err"
        ? "channels-feedback--err"
        : "channels-feedback--info",
  );
}

function renderBilibili(status: BilibiliConnectionStatus): void {
  channelsBilibiliCardEl?.classList.toggle("is-connected", status.connected);
  if (channelsBilibiliStatusEl) {
    channelsBilibiliStatusEl.textContent = status.connected ? "已連接 · Opera GX" : "尚未連接";
    channelsBilibiliStatusEl.classList.toggle("is-connected", status.connected);
  }
  if (channelsBilibiliSessionTitleEl)
    channelsBilibiliSessionTitleEl.textContent = status.connected
      ? "Opera GX 登入狀態已連接"
      : "連接你的 Opera GX 登入狀態";
  if (channelsBilibiliSessionDetailEl)
    channelsBilibiliSessionDetailEl.textContent = status.connected
      ? "Discord 收到 Bilibili 連結時，會自動使用這台 Mac 的瀏覽器登入狀態。"
      : "連接後，Discord 播放 Bilibili 連結時會自動讀取你的本機登入狀態。";
  if (channelsBilibiliConnectBtn)
    channelsBilibiliConnectBtn.textContent = status.connected ? "重新驗證" : "連接 Bilibili";
  if (channelsBilibiliDisconnectBtn) channelsBilibiliDisconnectBtn.disabled = !status.connected;
}

async function refreshBilibili(): Promise<void> {
  try {
    renderBilibili(await window.settings.channelsBilibiliGetStatus());
  } catch (err) {
    setBilibiliFeedback("err", err instanceof Error ? err.message : String(err));
  }
}

function renderChannelStatus(el: HTMLElement | null, phase: string, message?: string): void {
  if (!el) return;
  const dot = el.querySelector(".channels-status__dot");
  const text = el.querySelector(".channels-status__text");
  if (dot) {
    dot.className = "channels-status__dot";
    if (phase === "running") dot.classList.add("channels-status__dot--running");
    else if (phase === "starting") dot.classList.add("channels-status__dot--starting");
    else if (phase === "error") dot.classList.add("channels-status__dot--error");
    else if (phase === "config_missing") dot.classList.add("channels-status__dot--config_missing");
    else dot.classList.add("channels-status__dot--offline");
  }
  if (text)
    text.textContent =
      message ??
      (phase === "running"
        ? "運行中"
        : phase === "starting"
          ? "啟動中"
          : phase === "config_missing"
            ? "配置缺失"
            : phase === "error"
              ? "錯誤"
              : "未啟用");
}

function renderGoogleCloudControl(state: DiscordCloudControlStatus): void {
  const modeText =
    state.mode === "local"
      ? "這台 Mac 接管中"
      : state.mode === "cloud"
        ? "Google Cloud 接管中"
        : "正在交接";
  if (channelsCloudStatusEl) {
    channelsCloudStatusEl.classList.toggle("is-online", state.reachable);
    channelsCloudStatusEl.classList.toggle("is-transition", state.mode === "transition");
    const text = channelsCloudStatusEl.querySelector(".channels-status__text");
    if (text) text.textContent = state.reachable ? modeText : "VM 無法連線";
  }
  if (channelsCloudModeEl) channelsCloudModeEl.textContent = modeText;
  if (channelsCloudVmEl)
    channelsCloudVmEl.textContent = state.reachable ? "已連線 · us-central1-a" : "無法連線";
  if (channelsCloudBotEl)
    channelsCloudBotEl.textContent = state.localConnected
      ? "本機 Gateway 運行中"
      : state.cloudService === "active"
        ? "雲端 Gateway 運行中"
        : state.cloudService === "inactive"
          ? "雲端待命"
          : `雲端狀態：${state.cloudService}`;
  if (channelsCloudWatchdogEl)
    channelsCloudWatchdogEl.textContent =
      state.watchdog === "active" ? "保護中 · 15 秒檢查" : `狀態：${state.watchdog}`;
  if (channelsCloudHeartbeatEl)
    channelsCloudHeartbeatEl.textContent =
      state.heartbeatAge == null ? "目前沒有本機心跳" : `${state.heartbeatAge} 秒前收到`;
  channelsCloudLocalBtn?.classList.toggle("is-active", state.mode === "local");
  channelsCloudRemoteBtn?.classList.toggle("is-active", state.mode === "cloud");
  channelsCloudLocalBtn?.setAttribute("aria-pressed", String(state.mode === "local"));
  channelsCloudRemoteBtn?.setAttribute("aria-pressed", String(state.mode === "cloud"));
  if (channelsCloudRestartBtn) channelsCloudRestartBtn.disabled = state.mode === "local";
}

async function refreshGoogleCloudControl(): Promise<void> {
  try {
    renderGoogleCloudControl(await window.settings.channelsDiscordCloudStatus());
  } catch (error) {
    renderGoogleCloudControl({
      reachable: false,
      cloudService: "unknown",
      watchdog: "unknown",
      heartbeatAge: null,
      localConnected: false,
      mode: "transition",
    });
    if (channelsCloudFeedbackEl) {
      channelsCloudFeedbackEl.textContent = error instanceof Error ? error.message : String(error);
      channelsCloudFeedbackEl.className = "channels-feedback channels-feedback--err";
    }
  }
}

export async function loadChannelsPanel(): Promise<void> {
  if (channelsInitialized) {
    await Promise.all([
      refreshDiscordProfile(),
      refreshDiscordMusic(),
      refreshSpotify(),
      refreshBilibili(),
    ]);
    return;
  }
  channelsInitialized = true;
  try {
    const cfg = await window.settings.channelsGetConfig();
    if (channelsWechatEnabledEl) channelsWechatEnabledEl.checked = !!cfg?.wechat?.enabled;
    if (channelsFeishuEnabledEl) channelsFeishuEnabledEl.checked = !!cfg?.feishu?.enabled;
    if (channelsDiscordEnabledEl) channelsDiscordEnabledEl.checked = !!cfg?.discord?.enabled;
    if (channelsRateUserEl) channelsRateUserEl.value = String(cfg?.rateLimitPerUser ?? 10);
    if (channelsRateChannelEl)
      channelsRateChannelEl.value = String(cfg?.rateLimitPerChannel ?? 100);
    if (channelsTtsEl) channelsTtsEl.checked = cfg?.ttsEnabled !== false;
    if (channelsStickerEl) channelsStickerEl.checked = cfg?.stickerEnabled !== false;
    if (channelsMirrorEl) channelsMirrorEl.checked = cfg?.mirrorToDesktop !== false;
    if (channelsSandboxEl) channelsSandboxEl.checked = cfg?.toolSandbox === "safe-only";

    // 飛書字段填充（長連接模式只需要 App ID；secret 加密存盤，UI 不回填明文）
    if (channelsFeishuAppIdEl) channelsFeishuAppIdEl.value = cfg?.feishu?.appId ?? "";
    if (channelsFeishuAppSecretEl) {
      channelsFeishuAppSecretEl.value = "";
      channelsFeishuAppSecretEl.placeholder = cfg?.feishu?.appSecret
        ? "已保存（輸入新值會覆蓋）"
        : "點擊保存配置時加密保存";
    }
    if (channelsDiscordTokenEl) {
      channelsDiscordTokenEl.value = "";
      channelsDiscordTokenEl.placeholder = cfg?.discord?.botToken
        ? "已保存（輸入新值會覆蓋）"
        : "保存時會加密";
    }
    if (channelsDiscordGuildIdsEl)
      channelsDiscordGuildIdsEl.value = (cfg?.discord?.allowedGuildIds ?? []).join(", ");
    if (channelsDiscordChannelIdsEl)
      channelsDiscordChannelIdsEl.value = (cfg?.discord?.allowedChannelIds ?? []).join(", ");
    if (channelsDiscordUserIdsEl)
      channelsDiscordUserIdsEl.value = (cfg?.discord?.allowedUserIds ?? []).join(", ");
    if (channelsDiscordCodexOwnerIdEl)
      channelsDiscordCodexOwnerIdEl.value = cfg?.discord?.codexImageOwnerId ?? "";
    if (channelsDiscordRequireMentionEl)
      channelsDiscordRequireMentionEl.checked = cfg?.discord?.requireMention !== false;
    if (channelsDiscordVoiceEnabledEl)
      channelsDiscordVoiceEnabledEl.checked = cfg?.discord?.voiceEnabled !== false;
    if (channelsCloudEnabledEl)
      channelsCloudEnabledEl.checked = !!cfg?.discord?.cloudStandbyEnabled;
    if (channelsCloudHostEl) channelsCloudHostEl.value = cfg?.discord?.cloudStandbyHost ?? "";
    if (channelsCloudUserEl) channelsCloudUserEl.value = cfg?.discord?.cloudStandbyUser ?? "";
    if (channelsCloudKeyPathEl)
      channelsCloudKeyPathEl.value = cfg?.discord?.cloudStandbyKeyPath ?? "";
    if (channelsSpotifyClientIdEl) channelsSpotifyClientIdEl.value = cfg?.spotify?.clientId ?? "";
    if (channelsSpotifyClientSecretEl) {
      channelsSpotifyClientSecretEl.value = "";
      channelsSpotifyClientSecretEl.placeholder = cfg?.spotify?.clientSecret
        ? "已加密保存（輸入新值會覆蓋）"
        : "從 Spotify Developer Dashboard 複製";
    }

    // 拉一次渠道狀態
    const status = ((await window.settings?.channelsGetStatus?.()) || {}) as Record<
      string,
      { phase: string; message?: string }
    >;
    renderChannelStatus(
      channelsWechatStatusEl,
      status?.wechat?.phase ?? "offline",
      status?.wechat?.message,
    );
    renderChannelStatus(
      channelsFeishuStatusEl,
      status?.feishu?.phase ?? "offline",
      status?.feishu?.message,
    );
    renderChannelStatus(
      channelsDiscordStatusEl,
      status?.discord?.phase ?? "offline",
      status?.discord?.message,
    );
    await Promise.all([
      refreshDiscordProfile(),
      refreshDiscordMusic(),
      refreshSpotify(),
      refreshBilibili(),
      refreshXNotifications(),
      refreshAniListNotifications(),
    ]);
    // Phase 3.4：拉一次消息日誌
    void refreshChannelsLog();

    await refreshGoogleCloudControl();
  } catch (err) {
    console.warn("[Channels] loadChannelsPanel 失敗:", err);
  }

  // 自動保存（debounce 200ms）
  const scheduleSave = () => {
    if (channelsSaveTimer != null) window.clearTimeout(channelsSaveTimer);
    channelsSaveTimer = window.setTimeout(() => {
      void window.settings.channelsSaveConfig({
        wechat: { enabled: channelsWechatEnabledEl?.checked ?? false },
        feishu: { enabled: channelsFeishuEnabledEl?.checked ?? false },
        rateLimitPerUser: Number(channelsRateUserEl?.value) || 10,
        rateLimitPerChannel: Number(channelsRateChannelEl?.value) || 100,
        ttsEnabled: channelsTtsEl?.checked ?? true,
        stickerEnabled: channelsStickerEl?.checked ?? true,
        mirrorToDesktop: channelsMirrorEl?.checked ?? true,
        toolSandbox: channelsSandboxEl?.checked ? "safe-only" : "all",
      });
    }, 200);
  };
  for (const el of [
    channelsWechatEnabledEl,
    channelsFeishuEnabledEl,
    channelsRateUserEl,
    channelsRateChannelEl,
    channelsTtsEl,
    channelsStickerEl,
    channelsMirrorEl,
    channelsSandboxEl,
  ]) {
    el?.addEventListener("change", scheduleSave);
  }

  // 監聽安裝進度（Phase 1+ 才會收到）
  window.settings.onChannelsInstallProgress((progress) => {
    const target =
      progress.channel === "wechat"
        ? channelsWechatStatusEl
        : progress.channel === "feishu"
          ? channelsFeishuStatusEl
          : progress.channel === "discord"
            ? channelsDiscordStatusEl
            : null;
    if (target) renderChannelStatus(target, "starting", `${progress.phase} ${progress.pct}%`);
  });
  window.settings.onChannelsStatusChanged((status) => {
    const s = status as Record<string, { phase: string; message?: string }>;
    renderChannelStatus(channelsWechatStatusEl, s.wechat?.phase ?? "offline", s.wechat?.message);
    renderChannelStatus(channelsFeishuStatusEl, s.feishu?.phase ?? "offline", s.feishu?.message);
    renderChannelStatus(channelsDiscordStatusEl, s.discord?.phase ?? "offline", s.discord?.message);
    void refreshDiscordProfile();
  });

  // ===== 飛書交互（Phase 2 長連接版） =====

  // 顯示/隱藏 App Secret
  channelsFeishuAppSecretRevealBtn?.addEventListener("click", () => {
    if (!channelsFeishuAppSecretEl) return;
    channelsFeishuAppSecretEl.type =
      channelsFeishuAppSecretEl.type === "password" ? "text" : "password";
  });

  // 保存配置（secret 用 safeStorage 加密後落盤 + 觸發長連接重連）
  channelsFeishuSaveBtn?.addEventListener("click", async () => {
    setFeishuFeedback("info", "保存並連接中...");
    const patch: Record<string, unknown> = {
      feishu: {
        enabled: channelsFeishuEnabledEl?.checked ?? false,
        appId: channelsFeishuAppIdEl?.value.trim() || undefined,
      },
    };
    // 僅在用戶輸入了新值時才覆蓋 secret（避免誤清空）
    if (channelsFeishuAppSecretEl?.value) {
      (patch.feishu as Record<string, unknown>).appSecret = channelsFeishuAppSecretEl.value;
    }
    try {
      await window.settings.channelsSaveConfig(patch);
      // 保存後立即觸發飛書 adapter 重建 + 重連長連接
      await window.settings.channelsRestart();
      setFeishuFeedback("ok", "已保存，飛書長連接正在建立…");
      // 清空輸入框（已落盤），並把 placeholder 切到"已保存"
      if (channelsFeishuAppSecretEl) {
        channelsFeishuAppSecretEl.value = "";
        channelsFeishuAppSecretEl.placeholder = "已保存（輸入新值會覆蓋）";
      }
    } catch (err) {
      setFeishuFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  // ===== Spotify Premium / Connect =====
  channelsSpotifySecretRevealBtn?.addEventListener("click", () => {
    if (channelsSpotifyClientSecretEl)
      channelsSpotifyClientSecretEl.type =
        channelsSpotifyClientSecretEl.type === "password" ? "text" : "password";
  });
  channelsSpotifyConnectBtn?.addEventListener("click", async () => {
    const clientId = channelsSpotifyClientIdEl?.value.trim() ?? "";
    if (!clientId) return setSpotifyFeedback("err", "請輸入 Spotify Client ID");
    channelsSpotifyConnectBtn.disabled = true;
    setSpotifyFeedback("info", "正在開啟 Spotify 授權頁…");
    try {
      const result = await window.settings.channelsSpotifyAuthorize({
        clientId,
        clientSecret: channelsSpotifyClientSecretEl?.value || undefined,
      });
      if (!result.ok) throw new Error(result.error || "Spotify 授權無法啟動");
      if (channelsSpotifyClientSecretEl?.value) {
        channelsSpotifyClientSecretEl.value = "";
        channelsSpotifyClientSecretEl.placeholder = "已加密保存（輸入新值會覆蓋）";
      }
      setSpotifyFeedback("info", result.message || "請在瀏覽器完成 Spotify 授權");
    } catch (err) {
      setSpotifyFeedback("err", err instanceof Error ? err.message : String(err));
    } finally {
      channelsSpotifyConnectBtn.disabled = false;
    }
  });
  channelsSpotifyDisconnectBtn?.addEventListener("click", async () => {
    const confirmed = await showModal({
      title: "解除 Spotify 連線？",
      message: "Cyrene 會刪除本機保存的 Spotify 授權；之後可隨時重新連線。",
      icon: "🎧",
      confirmText: "解除連線",
    });
    if (!confirmed) return;
    const result = await window.settings.channelsSpotifyDisconnect();
    setSpotifyFeedback(
      result.ok ? "ok" : "err",
      result.message || result.error || "Spotify 已解除連線",
    );
    await refreshSpotify();
  });
  channelsSpotifyPreviousBtn?.addEventListener("click", () => void controlSpotifyUi("previous"));
  channelsSpotifyNextBtn?.addEventListener("click", () => void controlSpotifyUi("next"));
  channelsSpotifyToggleBtn?.addEventListener(
    "click",
    () =>
      void controlSpotifyUi(
        spotifyStatus.playback?.active && !spotifyStatus.playback.paused ? "pause" : "resume",
      ),
  );
  channelsSpotifyDeviceSelectEl?.addEventListener(
    "change",
    () => void controlSpotifyUi("transfer"),
  );
  const playSpotifyQuery = async () => {
    const query = channelsSpotifyQueryEl?.value.trim() ?? "";
    if (!query) {
      setSpotifyFeedback("err", "請輸入歌曲名稱或 Spotify 連結");
      return;
    }
    if (channelsSpotifyPlayQueryBtn) channelsSpotifyPlayQueryBtn.disabled = true;
    try {
      await controlSpotifyUi("play", undefined, query);
      if (channelsSpotifyQueryEl) channelsSpotifyQueryEl.value = "";
    } finally {
      if (channelsSpotifyPlayQueryBtn) channelsSpotifyPlayQueryBtn.disabled = false;
    }
  };
  channelsSpotifyPlayQueryBtn?.addEventListener("click", () => void playSpotifyQuery());
  channelsSpotifyQueryEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void playSpotifyQuery();
    }
  });
  channelsSpotifyVolumeEl?.addEventListener("input", () => {
    const volume = Number(channelsSpotifyVolumeEl.value);
    if (channelsSpotifyVolumeValueEl) channelsSpotifyVolumeValueEl.value = `${volume}%`;
    if (spotifyVolumeTimer != null) window.clearTimeout(spotifyVolumeTimer);
    spotifyVolumeTimer = window.setTimeout(() => void controlSpotifyUi("volume", volume), 160);
  });

  // ===== Bilibili / Opera GX browser session =====
  channelsBilibiliConnectBtn?.addEventListener("click", async () => {
    channelsBilibiliConnectBtn.disabled = true;
    setBilibiliFeedback("info", "正在驗證 Opera GX 的 Bilibili 登入狀態…");
    try {
      const result = await window.settings.channelsBilibiliConnect();
      if (!result.ok) throw new Error(result.error || "Bilibili 連接失敗");
      setBilibiliFeedback("ok", result.message || "Bilibili 已連接");
      await refreshBilibili();
    } catch (err) {
      setBilibiliFeedback("err", err instanceof Error ? err.message : String(err));
    } finally {
      channelsBilibiliConnectBtn.disabled = false;
    }
  });
  channelsBilibiliDisconnectBtn?.addEventListener("click", async () => {
    const result = await window.settings.channelsBilibiliDisconnect();
    setBilibiliFeedback(
      result.ok ? "ok" : "err",
      result.message || result.error || "Bilibili 已解除連接",
    );
    await refreshBilibili();
  });

  // ===== Discord Gateway =====
  const parseIds = (value: string | undefined): string[] => [
    ...new Set(
      (value ?? "")
        .split(/[\s,]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  const setDiscordFeedback = (kind: "info" | "ok" | "err", msg: string): void => {
    if (!channelsDiscordFeedbackEl) return;
    channelsDiscordFeedbackEl.textContent = msg;
    channelsDiscordFeedbackEl.className = "channels-feedback";
    channelsDiscordFeedbackEl.classList.add(
      kind === "ok"
        ? "channels-feedback--ok"
        : kind === "err"
          ? "channels-feedback--err"
          : "channels-feedback--info",
    );
  };
  channelsDiscordTokenRevealBtn?.addEventListener("click", () => {
    if (channelsDiscordTokenEl)
      channelsDiscordTokenEl.type =
        channelsDiscordTokenEl.type === "password" ? "text" : "password";
  });
  channelsDiscordEnabledEl?.addEventListener("change", async () => {
    const enabled = channelsDiscordEnabledEl.checked;
    channelsDiscordEnabledEl.disabled = true;
    setDiscordFeedback("info", enabled ? "正在連接 Discord…" : "正在停止 Discord 連線…");
    const discord: Record<string, unknown> = { enabled };
    if (channelsDiscordTokenEl?.value.trim())
      discord.botToken = channelsDiscordTokenEl.value.trim();
    try {
      await window.settings.channelsSaveConfig({ discord });
      const result = await window.settings.channelsDiscordTestConnection();
      if (!result.ok)
        throw new Error(result.error || (enabled ? "Discord 連接失敗" : "停止連線失敗"));
      setDiscordFeedback(
        "ok",
        result.message || (enabled ? "Discord Gateway 已連接" : "Discord 已停止連線"),
      );
      if (channelsDiscordTokenEl?.value.trim()) {
        channelsDiscordTokenEl.value = "";
        channelsDiscordTokenEl.placeholder = "已保存（輸入新值會覆蓋）";
      }
      const status = (await window.settings.channelsGetStatus()) as Record<
        string,
        { phase: string; message?: string }
      >;
      renderChannelStatus(
        channelsDiscordStatusEl,
        status.discord?.phase ?? "offline",
        status.discord?.message,
      );
      await refreshDiscordProfile();
    } catch (err) {
      setDiscordFeedback("err", err instanceof Error ? err.message : String(err));
      const status = (await window.settings.channelsGetStatus().catch(() => null)) as Record<
        string,
        { phase: string; message?: string }
      > | null;
      if (status)
        renderChannelStatus(
          channelsDiscordStatusEl,
          status.discord?.phase ?? "offline",
          status.discord?.message,
        );
      await refreshDiscordProfile();
    } finally {
      channelsDiscordEnabledEl.disabled = false;
    }
  });
  const closeDiscordMediaMenu = (): void => {
    channelsDiscordMediaMenuEl?.setAttribute("hidden", "");
    channelsDiscordAvatarPickBtn?.setAttribute("aria-expanded", "false");
  };
  channelsDiscordAvatarPickBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!channelsDiscordMediaMenuEl) return;
    const willOpen = channelsDiscordMediaMenuEl.hasAttribute("hidden");
    if (willOpen) channelsDiscordMediaMenuEl.removeAttribute("hidden");
    else channelsDiscordMediaMenuEl.setAttribute("hidden", "");
    channelsDiscordAvatarPickBtn.setAttribute("aria-expanded", String(willOpen));
  });
  channelsDiscordMediaMenuEl?.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", closeDiscordMediaMenu);
  channelsDiscordAvatarOptionBtn?.addEventListener("click", async () => {
    closeDiscordMediaMenu();
    const avatarPath = await window.settings.channelsDiscordPickAvatar();
    if (!avatarPath) return;
    pendingDiscordAvatarPath = avatarPath;
    setDiscordProfileFeedback(
      "info",
      `已選擇 ${avatarPath.split(/[\\/]/).pop() ?? "新頭像"}，按「更新 Discord 身分」套用。`,
    );
  });
  channelsDiscordBannerOptionBtn?.addEventListener("click", async () => {
    closeDiscordMediaMenu();
    const bannerPath = await window.settings.channelsDiscordPickBanner();
    if (!bannerPath) return;
    pendingDiscordBannerPath = bannerPath;
    setDiscordProfileFeedback(
      "info",
      `已選擇 ${bannerPath.split(/[\\/]/).pop() ?? "新 Banner"}，按「更新 Discord 身分」套用。`,
    );
  });

  const discordEmojis = [
    "😀",
    "😊",
    "🥰",
    "😍",
    "😌",
    "😉",
    "🥺",
    "✨",
    "💫",
    "🌸",
    "🌙",
    "⭐",
    "💜",
    "🩷",
    "🎀",
    "🪽",
    "🦋",
    "🌷",
    "🍀",
    "🍓",
    "🍰",
    "🎵",
    "🎧",
    "🎮",
    "📖",
    "💬",
    "🤍",
    "🔥",
  ];
  if (channelsDiscordEmojiPickerEl) {
    channelsDiscordEmojiPickerEl.replaceChildren(
      ...discordEmojis.map((emoji) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = emoji;
        button.title = emoji;
        button.setAttribute("aria-label", `插入 ${emoji}`);
        return button;
      }),
    );
  }
  let discordEmojiTarget: HTMLInputElement | null = null;
  const closeDiscordEmojiPicker = (): void => {
    channelsDiscordEmojiPickerEl?.setAttribute("hidden", "");
    discordEmojiTarget = null;
  };
  for (const trigger of document.querySelectorAll<HTMLButtonElement>(".discord-emoji-button")) {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const input = document.getElementById(
        trigger.dataset.emojiTarget ?? "",
      ) as HTMLInputElement | null;
      if (!input || !channelsDiscordEmojiPickerEl) return;
      if (!channelsDiscordEmojiPickerEl.hasAttribute("hidden") && discordEmojiTarget === input) {
        closeDiscordEmojiPicker();
        return;
      }
      discordEmojiTarget = input;
      const rect = trigger.getBoundingClientRect();
      const pickerWidth = 270;
      channelsDiscordEmojiPickerEl.style.left = `${Math.max(10, Math.min(rect.right - pickerWidth, window.innerWidth - pickerWidth - 10))}px`;
      channelsDiscordEmojiPickerEl.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 190)}px`;
      channelsDiscordEmojiPickerEl.removeAttribute("hidden");
    });
  }
  channelsDiscordEmojiPickerEl?.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest("button");
    if (!button || !discordEmojiTarget) return;
    const start = discordEmojiTarget.selectionStart ?? discordEmojiTarget.value.length;
    const end = discordEmojiTarget.selectionEnd ?? start;
    discordEmojiTarget.setRangeText(button.textContent ?? "", start, end, "end");
    discordEmojiTarget.focus();
    closeDiscordEmojiPicker();
  });
  document.addEventListener("click", closeDiscordEmojiPicker);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDiscordEmojiPicker();
      closeDiscordMediaMenu();
    }
  });
  channelsDiscordProfileSaveBtn?.addEventListener("click", async () => {
    if (!channelsDiscordUsernameEl?.value.trim()) {
      setDiscordProfileFeedback("err", "請輸入 Bot 顯示名稱。");
      return;
    }
    channelsDiscordProfileSaveBtn.disabled = true;
    setDiscordProfileFeedback("info", "正在更新 Discord 身分…");
    try {
      const result = await window.settings.channelsDiscordUpdateProfile({
        username: channelsDiscordUsernameEl.value.trim(),
        activityText: channelsDiscordActivityEl?.value ?? "",
        status: channelsDiscordPresenceEl?.value ?? "online",
        avatarPath: pendingDiscordAvatarPath,
        bannerPath: pendingDiscordBannerPath,
      });
      if (!result.ok || !result.profile) throw new Error(result.error || "更新失敗");
      pendingDiscordAvatarPath = undefined;
      pendingDiscordBannerPath = undefined;
      renderDiscordProfile(result.profile);
      setDiscordProfileFeedback(
        "ok",
        "Discord 身分已更新。名稱修改受到 Discord 頻率限制，短時間內請勿重複變更。 ",
      );
    } catch (err) {
      setDiscordProfileFeedback("err", err instanceof Error ? err.message : String(err));
    } finally {
      channelsDiscordProfileSaveBtn.disabled = false;
    }
  });
  channelsDiscordMusicToggleBtn?.addEventListener("click", () => {
    void controlDiscordMusic({ command: discordMusicState.paused ? "resume" : "pause" }, true);
  });
  channelsDiscordMusicPreviousBtn?.addEventListener(
    "click",
    () => void controlDiscordMusic({ command: "previous" }, true),
  );
  channelsDiscordMusicCoverEl?.addEventListener("error", () => {
    channelsDiscordMusicCoverEl.hidden = true;
    channelsDiscordMusicRecordEl?.classList.remove("has-cover");
  });
  channelsDiscordMusicNextBtn?.addEventListener(
    "click",
    () => void controlDiscordMusic({ command: "skip" }, true),
  );
  channelsDiscordMusicStopBtn?.addEventListener(
    "click",
    () => void controlDiscordMusic({ command: "stop" }, true),
  );
  channelsDiscordMusicRepeatBtn?.addEventListener("click", () => {
    const command =
      discordMusicState.repeat === "off"
        ? "repeat-track"
        : discordMusicState.repeat === "track"
          ? "repeat-queue"
          : "repeat-off";
    void controlDiscordMusic({ command }, true);
  });
  channelsDiscordMusicShuffleBtn?.addEventListener("click", () => {
    void controlDiscordMusic({ command: discordMusicState.shuffle ? "ordered" : "shuffle" }, true);
  });
  channelsDiscordMusicAutoplayBtn?.addEventListener("click", () => {
    void controlDiscordMusic(
      { command: discordMusicState.autoplay ? "autoplay-off" : "autoplay-on" },
      true,
    );
  });
  channelsDiscordMusicClearBtn?.addEventListener(
    "click",
    () => void controlDiscordMusic({ command: "clear" }),
  );
  channelsDiscordMusicQueueToggleBtn?.addEventListener(
    "click",
    () => void showDiscordMusicLibrary("queue"),
  );
  channelsDiscordMusicFavoritesToggleBtn?.addEventListener(
    "click",
    () => void showDiscordMusicLibrary("favorites"),
  );
  channelsDiscordMusicHistoryToggleBtn?.addEventListener(
    "click",
    () => void showDiscordMusicLibrary("history"),
  );
  channelsDiscordMusicQueueEl?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-queue-position]",
    );
    const position = Number(button?.dataset.queuePosition);
    if (Number.isInteger(position) && position > 0)
      void controlDiscordMusic({ command: "remove", value: position }, true);
  });
  channelsDiscordMusicVolumeEl?.addEventListener("input", () => {
    const value = Number(channelsDiscordMusicVolumeEl.value);
    if (channelsDiscordMusicVolumeValueEl) channelsDiscordMusicVolumeValueEl.value = `${value}%`;
    if (discordMusicVolumeTimer != null) window.clearTimeout(discordMusicVolumeTimer);
    discordMusicVolumeTimer = window.setTimeout(
      () => void controlDiscordMusic({ command: "volume", value }, true),
      120,
    );
  });
  channelsDiscordSaveBtn?.addEventListener("click", async () => {
    setDiscordFeedback("info", "保存並連接中…");
    const discord: Record<string, unknown> = {
      enabled: channelsDiscordEnabledEl?.checked ?? false,
      allowedGuildIds: parseIds(channelsDiscordGuildIdsEl?.value),
      allowedChannelIds: parseIds(channelsDiscordChannelIdsEl?.value),
      allowedUserIds: parseIds(channelsDiscordUserIdsEl?.value),
      codexImageOwnerId: channelsDiscordCodexOwnerIdEl?.value.trim() || undefined,
      requireMention: channelsDiscordRequireMentionEl?.checked ?? true,
      voiceEnabled: channelsDiscordVoiceEnabledEl?.checked ?? true,
    };
    if (channelsDiscordTokenEl?.value.trim())
      discord.botToken = channelsDiscordTokenEl.value.trim();
    try {
      await window.settings.channelsSaveConfig({ discord });
      const result = await window.settings.channelsDiscordTestConnection();
      if (!result.ok) throw new Error(result.error || "Discord 連接失敗");
      setDiscordFeedback("ok", result.message || "Discord Gateway 已連接");
      if (channelsDiscordTokenEl) {
        channelsDiscordTokenEl.value = "";
        channelsDiscordTokenEl.placeholder = "已保存（輸入新值會覆蓋）";
      }
      await refreshDiscordProfile();
    } catch (err) {
      setDiscordFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  channelsCloudPickKeyBtn?.addEventListener("click", async () => {
    const picked = await window.settings.channelsDiscordPickCloudKey();
    if (picked && channelsCloudKeyPathEl) channelsCloudKeyPathEl.value = picked;
  });

  channelsCloudSaveBtn?.addEventListener("click", async () => {
    if (channelsCloudFeedbackEl) {
      channelsCloudFeedbackEl.textContent = "保存中…";
      channelsCloudFeedbackEl.className = "channels-feedback channels-feedback--info";
    }
    try {
      await window.settings.channelsSaveConfig({
        discord: {
          cloudStandbyEnabled: channelsCloudEnabledEl?.checked ?? false,
          cloudStandbyHost: channelsCloudHostEl?.value.trim() || undefined,
          cloudStandbyUser: channelsCloudUserEl?.value.trim() || undefined,
          cloudStandbyKeyPath: channelsCloudKeyPathEl?.value.trim() || undefined,
        },
      });
      if (channelsCloudFeedbackEl) {
        channelsCloudFeedbackEl.textContent = "連線設定已保存";
        channelsCloudFeedbackEl.className = "channels-feedback channels-feedback--ok";
      }
      await refreshGoogleCloudControl();
    } catch (err) {
      if (channelsCloudFeedbackEl) {
        channelsCloudFeedbackEl.textContent = err instanceof Error ? err.message : String(err);
        channelsCloudFeedbackEl.className = "channels-feedback channels-feedback--err";
      }
    }
  });

  // ===== X (Twitter) 動態推播 =====
  async function refreshXNotifications(): Promise<void> {
    const enabledEl = document.getElementById("x-notifications-enabled") as HTMLInputElement | null;
    const intervalEl = document.getElementById(
      "x-notifications-interval",
    ) as HTMLInputElement | null;
    const listEl = document.getElementById("x-notifications-account-list");
    if (!listEl) return;

    try {
      const config = await (window.settings as any).xNotificationsGetConfig();
      if (enabledEl) enabledEl.checked = !!config?.enabled;
      if (intervalEl) intervalEl.value = String(config?.checkIntervalMinutes ?? 5);
      const catNameEl = document.getElementById(
        "x-notifications-category-name",
      ) as HTMLInputElement | null;
      if (catNameEl) catNameEl.value = config?.announcementCategoryName || "announcements";

      listEl.innerHTML = "";
      const accounts = Array.isArray(config?.accounts) ? config.accounts : [];
      if (accounts.length === 0) {
        listEl.innerHTML =
          '<div style="color: var(--text-muted, #888); font-size: 13px;">尚無追蹤帳號，請使用下方輸入框新增。</div>';
        return;
      }

      const categoryLabels: Record<string, string> = {
        game: "🎮 遊戲",
        anime: "📺 動漫",
        news: "📰 新聞",
        leak: "🤫 爆料",
        general: "💬 一般",
      };

      accounts.forEach((acc: any) => {
        const item = document.createElement("div");
        item.className = "x-account-item";
        item.style.cssText =
          "display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 8px; font-size: 14px;";

        const categoryLabel = categoryLabels[acc.category] || categoryLabels.general;

        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px;">
            <strong style="color: var(--text-primary, #fff);">@${acc.username}</strong>
            ${acc.displayName ? `<span style="color: var(--text-secondary, #aaa); font-size: 12px;">(${acc.displayName})</span>` : ""}
            <span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 12px; font-size: 11px;">${categoryLabel}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn-secondary btn-x-toggle" data-username="${acc.username}" style="padding: 2px 10px; font-size: 12px;">${acc.enabled ? "已啟用" : "已停用"}</button>
            <button type="button" class="btn-secondary btn-x-delete" data-username="${acc.username}" style="padding: 2px 8px; font-size: 12px; color: #ff6b6b;">🗑 刪除</button>
          </div>
        `;
        listEl.appendChild(item);
      });

      listEl.querySelectorAll(".btn-x-toggle").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const username = (btn as HTMLElement).dataset.username;
          const targetAcc = accounts.find((a: any) => a.username === username);
          if (targetAcc) {
            targetAcc.enabled = !targetAcc.enabled;
            await (window.settings as any).xNotificationsSaveConfig({ accounts });
            await refreshXNotifications();
          }
        });
      });

      listEl.querySelectorAll(".btn-x-delete").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const username = (btn as HTMLElement).dataset.username;
          const newAccounts = accounts.filter((a: any) => a.username !== username);
          await (window.settings as any).xNotificationsSaveConfig({ accounts: newAccounts });
          await refreshXNotifications();
        });
      });
    } catch (err) {
      console.warn("[XNotifications] refreshXNotifications 失敗:", err);
    }
  }

  const xEnabledEl = document.getElementById("x-notifications-enabled") as HTMLInputElement | null;
  const xIntervalEl = document.getElementById(
    "x-notifications-interval",
  ) as HTMLInputElement | null;
  const xCategoryNameEl = document.getElementById(
    "x-notifications-category-name",
  ) as HTMLInputElement | null;
  const xUsernameInput = document.getElementById(
    "x-account-input-username",
  ) as HTMLInputElement | null;
  const xCategorySelect = document.getElementById(
    "x-account-input-category",
  ) as HTMLSelectElement | null;
  const xAddBtn = document.getElementById("x-account-add-btn");
  const xCheckNowBtn = document.getElementById("x-notifications-check-now");
  const xTestPostBtn = document.getElementById("x-notifications-test-post");
  const xFeedbackEl = document.getElementById("x-notifications-feedback");

  const setXFeedback = (kind: "info" | "ok" | "err", msg: string): void => {
    if (!xFeedbackEl) return;
    xFeedbackEl.textContent = msg;
    xFeedbackEl.className = "channels-feedback";
    xFeedbackEl.classList.add(
      kind === "ok"
        ? "channels-feedback--ok"
        : kind === "err"
          ? "channels-feedback--err"
          : "channels-feedback--info",
    );
  };

  xEnabledEl?.addEventListener("change", async () => {
    await (window.settings as any).xNotificationsSaveConfig({ enabled: xEnabledEl.checked });
    setXFeedback("ok", xEnabledEl.checked ? "X 動態推播已開啟" : "X 動態推播已關閉");
  });

  xIntervalEl?.addEventListener("change", async () => {
    const val = Math.max(1, Number(xIntervalEl.value) || 5);
    await (window.settings as any).xNotificationsSaveConfig({ checkIntervalMinutes: val });
    setXFeedback("ok", `檢查頻率已設為每 ${val} 分鐘`);
  });

  xCategoryNameEl?.addEventListener("change", async () => {
    const val = xCategoryNameEl.value.trim() || "announcements";
    await (window.settings as any).xNotificationsSaveConfig({ announcementCategoryName: val });
    setXFeedback("ok", `Discord 公告 Category 已設為「${val}」`);
  });

  xAddBtn?.addEventListener("click", async () => {
    const rawUsername = xUsernameInput?.value.trim() ?? "";
    const username = rawUsername.replace(/^@/, "");
    if (!username) {
      setXFeedback("err", "請輸入 X 帳號名稱 (@Username)");
      return;
    }
    const category = xCategorySelect?.value || "game";
    const config = await (window.settings as any).xNotificationsGetConfig();
    const accounts = Array.isArray(config?.accounts) ? config.accounts : [];
    if (accounts.some((a: any) => a.username.toLowerCase() === username.toLowerCase())) {
      setXFeedback("err", `@${username} 已在追蹤列表中`);
      return;
    }
    accounts.push({
      id: `acc_${Date.now()}`,
      username,
      displayName: username,
      category,
      enabled: true,
    });
    await (window.settings as any).xNotificationsSaveConfig({ accounts });
    if (xUsernameInput) xUsernameInput.value = "";
    setXFeedback("ok", `已新增追蹤 @${username}`);
    await refreshXNotifications();
  });

  xCheckNowBtn?.addEventListener("click", async () => {
    setXFeedback("info", "正在檢查最新 X 動態…");
    try {
      const res = await (window.settings as any).xNotificationsCheckNow();
      setXFeedback(
        "ok",
        `檢查完成！檢查了 ${res.checked} 個帳號，發送了 ${res.newTweets} 條新動態推播。`,
      );
      await refreshXNotifications();
    } catch (err) {
      setXFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  xTestPostBtn?.addEventListener("click", async () => {
    const username = xUsernameInput?.value.trim().replace(/^@/, "") || "Wuthering_Waves";
    const category = xCategorySelect?.value || "game";
    setXFeedback("info", "正在發送測試推播至 Discord…");
    try {
      const res = await (window.settings as any).xNotificationsTestPost(username, category);
      if (res.ok) setXFeedback("ok", res.message);
      else setXFeedback("err", res.error);
    } catch (err) {
      setXFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  const xTestAllBtn = document.getElementById("x-notifications-test-all");
  xTestAllBtn?.addEventListener("click", async () => {
    setXFeedback("info", "正在逐一抓取所有追蹤帳號的最新推文並發送至 Discord，請稍候…");
    xTestAllBtn.setAttribute("disabled", "");
    try {
      const res = await (window.settings as any).xNotificationsTestAll();
      if (res.ok)
        setXFeedback("ok", res.message || `已成功推播 ${res.postedCount}/${res.total} 個帳號！`);
      else setXFeedback("err", res.error || "發送失敗");
    } catch (err) {
      setXFeedback("err", err instanceof Error ? err.message : String(err));
    } finally {
      xTestAllBtn.removeAttribute("disabled");
    }
  });

  // ===== AniList 新番開播推播 =====
  async function refreshAniListNotifications(): Promise<void> {
    const enabledEl = document.getElementById(
      "anilist-notifications-enabled",
    ) as HTMLInputElement | null;
    const usernameEl = document.getElementById(
      "anilist-notifications-username",
    ) as HTMLInputElement | null;
    const tokenEl = document.getElementById(
      "anilist-notifications-token",
    ) as HTMLInputElement | null;
    const filterModeEl = document.getElementById(
      "anilist-notifications-filter-mode",
    ) as HTMLSelectElement | null;
    const intervalEl = document.getElementById(
      "anilist-notifications-interval",
    ) as HTMLInputElement | null;
    const categoryEl = document.getElementById(
      "anilist-notifications-category",
    ) as HTMLSelectElement | null;
    if (!enabledEl) return;

    try {
      const config = await (window.settings as any).anilistNotificationsGetConfig();
      if (enabledEl) enabledEl.checked = !!config?.enabled;
      if (usernameEl) usernameEl.value = config?.username || "";
      if (tokenEl) tokenEl.value = config?.accessToken || "";
      if (filterModeEl) filterModeEl.value = config?.filterMode || "watchlist_only";
      if (intervalEl) intervalEl.value = String(config?.checkIntervalMinutes ?? 10);
      if (categoryEl) categoryEl.value = config?.targetCategory || "anime";
    } catch (err) {
      console.warn("[AniList] Failed to load config:", err);
    }
  }

  const aniEnabledEl = document.getElementById(
    "anilist-notifications-enabled",
  ) as HTMLInputElement | null;
  const aniUsernameEl = document.getElementById(
    "anilist-notifications-username",
  ) as HTMLInputElement | null;
  const aniTokenEl = document.getElementById(
    "anilist-notifications-token",
  ) as HTMLInputElement | null;
  const aniFilterModeEl = document.getElementById(
    "anilist-notifications-filter-mode",
  ) as HTMLSelectElement | null;
  const aniIntervalEl = document.getElementById(
    "anilist-notifications-interval",
  ) as HTMLInputElement | null;
  const aniCategoryEl = document.getElementById(
    "anilist-notifications-category",
  ) as HTMLSelectElement | null;
  const aniCheckNowBtn = document.getElementById("anilist-notifications-check-now");
  const aniTestPostBtn = document.getElementById("anilist-notifications-test-post");
  const aniFeedbackEl = document.getElementById("anilist-notifications-feedback");

  function setAniFeedback(kind: "info" | "ok" | "err", msg: string): void {
    if (!aniFeedbackEl) return;
    aniFeedbackEl.textContent = msg;
    aniFeedbackEl.className = "channels-feedback";
    aniFeedbackEl.classList.add(
      kind === "ok"
        ? "channels-feedback--ok"
        : kind === "err"
          ? "channels-feedback--err"
          : "channels-feedback--info",
    );
  }

  const saveAniConfig = async () => {
    try {
      const username = aniUsernameEl?.value.trim() || undefined;
      const token = aniTokenEl?.value.trim() || undefined;
      await (window.settings as any).anilistNotificationsSaveConfig({
        enabled: aniEnabledEl?.checked ?? true,
        username,
        accessToken: token,
        filterMode: aniFilterModeEl?.value || "watchlist_only",
        checkIntervalMinutes: Number(aniIntervalEl?.value) || 10,
        targetCategory: aniCategoryEl?.value || "anime",
      });

      if (username || token) {
        const verify = await (window.settings as any).anilistNotificationsVerifyAccount(
          username,
          token,
        );
        if (verify.ok) {
          setAniFeedback(
            "ok",
            `已成功連結 AniList 帳號：${verify.name}（有 ${verify.count ?? 0} 部動畫紀錄）。開播通知將優先過濾您的追番清單！`,
          );
        } else {
          setAniFeedback("err", `驗證失敗：${verify.error || "請檢查用戶名稱或 Access Token"}`);
        }
      }
    } catch (err) {
      console.warn("[AniList] Save error:", err);
    }
  };

  aniEnabledEl?.addEventListener("change", saveAniConfig);
  aniUsernameEl?.addEventListener("change", saveAniConfig);
  aniTokenEl?.addEventListener("change", saveAniConfig);
  aniFilterModeEl?.addEventListener("change", saveAniConfig);
  aniIntervalEl?.addEventListener("change", saveAniConfig);
  aniCategoryEl?.addEventListener("change", saveAniConfig);

  aniCheckNowBtn?.addEventListener("click", async () => {
    setAniFeedback("info", "正在連接 AniList 查詢最新開播動畫…");
    try {
      const res = await (window.settings as any).anilistNotificationsCheckNow();
      setAniFeedback(
        "ok",
        `檢查完成！共查詢 ${res.checked} 檔新番，發送了 ${res.newNotified} 檔最新開播通知至 Discord。`,
      );
      await refreshAniListNotifications();
    } catch (err) {
      setAniFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  aniTestPostBtn?.addEventListener("click", async () => {
    const category = aniCategoryEl?.value || "anime";
    setAniFeedback("info", "正在發送測試新番開播卡片至 Discord…");
    try {
      const res = await (window.settings as any).anilistNotificationsTestPost(category);
      if (res.ok) setAniFeedback("ok", res.message);
      else setAniFeedback("err", res.error);
    } catch (err) {
      setAniFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  // ===== 微信交互（掃碼登錄走 iLink HTTP API，詳見 src/main/channels/adapters/wechat/） =====

  function setWechatFeedback(kind: "info" | "ok" | "err", msg: string): void {
    if (!channelsWechatFeedbackEl) return;
    channelsWechatFeedbackEl.textContent = msg;
    channelsWechatFeedbackEl.className = "channels-feedback";
    if (kind === "ok") channelsWechatFeedbackEl.classList.add("channels-feedback--ok");
    else if (kind === "err") channelsWechatFeedbackEl.classList.add("channels-feedback--err");
    else channelsWechatFeedbackEl.classList.add("channels-feedback--info");
  }

  // 掃碼登錄：Main Process 生成 PNG → 推到 Renderer → modal 彈窗
  const channelsWechatQrEl = document.getElementById("channels-wechat-qr");
  const channelsWechatQrImgEl = document.getElementById(
    "channels-wechat-qr-img",
  ) as HTMLImageElement | null;
  const channelsWechatQrCloseBtn = document.getElementById("channels-wechat-qr-close");
  const channelsWechatQrBackdrop = document.getElementById("channels-wechat-qr-backdrop");

  function showWechatQr(dataUrl: string): void {
    if (channelsWechatQrImgEl) {
      channelsWechatQrImgEl.src = dataUrl;
      channelsWechatQrImgEl.classList.remove("is-empty");
    }
    channelsWechatQrEl?.removeAttribute("hidden");
  }
  function hideWechatQr(): void {
    channelsWechatQrEl?.setAttribute("hidden", "");
    if (channelsWechatQrImgEl) {
      channelsWechatQrImgEl.src = "";
      channelsWechatQrImgEl.classList.add("is-empty");
    }
  }

  // 關閉交互：點按鈕 / 點背景 / 按 ESC
  channelsWechatQrCloseBtn?.addEventListener("click", hideWechatQr);
  channelsWechatQrBackdrop?.addEventListener("click", hideWechatQr);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && channelsWechatQrEl && !channelsWechatQrEl.hasAttribute("hidden")) {
      hideWechatQr();
    }
  });

  // 訂閱 Main 推送的二維碼（每次登錄會推一次）
  window.settings.onChannelsWechatQrcode((dataUrl) => {
    showWechatQr(dataUrl);
    setWechatFeedback("info", "請用微信掃描二維碼");
  });
  // 訂閱 Main 推送的登錄結果（成功 / 失敗 / 二維碼過期）
  window.settings.onChannelsWechatLoginDone((payload) => {
    hideWechatQr();
    if (payload.ok) {
      setWechatFeedback("ok", `已登錄（botId=${payload.botId ?? "?"}）`);
    } else {
      setWechatFeedback("err", `登錄失敗：${payload.error ?? "未知錯誤"}`);
    }
  });

  channelsWechatLoginBtn?.addEventListener("click", async () => {
    hideWechatQr();
    setWechatFeedback("info", "正在啟動掃碼…");
    try {
      const result = await window.settings.channelsWechatLoginStart();
      if (result.ok) {
        // 二維碼由 onChannelsWechatQrcode 推過來並顯示；這裡只刷個輕提示
        setWechatFeedback("info", "等待二維碼推送…");
      } else {
        setWechatFeedback("err", result.error ?? "啟動失敗");
      }
    } catch (err) {
      setWechatFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  // 重啟連接
  channelsWechatRestartBtn?.addEventListener("click", async () => {
    setWechatFeedback("info", "重啟連接中…");
    try {
      await window.settings.channelsRestart();
      setWechatFeedback("ok", "已重啟");
    } catch (err) {
      setWechatFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  const runCloudControl = async (action: "local" | "cloud" | "restart-cloud") => {
    const buttons = [
      channelsCloudLocalBtn,
      channelsCloudRemoteBtn,
      channelsCloudRestartBtn,
      channelsCloudRefreshBtn,
    ];
    buttons.forEach((button) => {
      if (button) button.disabled = true;
    });
    if (channelsCloudFeedbackEl) {
      channelsCloudFeedbackEl.textContent =
        action === "local"
          ? "正在切換到這台 Mac…"
          : action === "cloud"
            ? "正在交給 Google Cloud…"
            : "正在重新啟動雲端 Bot…";
      channelsCloudFeedbackEl.className = "channels-feedback channels-feedback--info";
    }
    try {
      const state = await window.settings.channelsDiscordCloudControl(action);
      renderGoogleCloudControl(state);
      if (channelsCloudFeedbackEl) {
        channelsCloudFeedbackEl.textContent =
          action === "local"
            ? "這台 Mac 已接管 Discord。"
            : action === "cloud"
              ? "Google Cloud 已接管 Discord。"
              : "雲端 Bot 已重新啟動。";
        channelsCloudFeedbackEl.className = "channels-feedback channels-feedback--ok";
      }
    } catch (error) {
      if (channelsCloudFeedbackEl) {
        channelsCloudFeedbackEl.textContent =
          error instanceof Error ? error.message : String(error);
        channelsCloudFeedbackEl.className = "channels-feedback channels-feedback--err";
      }
      await refreshGoogleCloudControl();
    } finally {
      buttons.forEach((button) => {
        if (button) button.disabled = false;
      });
    }
  };
  channelsCloudLocalBtn?.addEventListener("click", () => void runCloudControl("local"));
  channelsCloudRemoteBtn?.addEventListener("click", () => void runCloudControl("cloud"));
  channelsCloudRestartBtn?.addEventListener("click", () => void runCloudControl("restart-cloud"));
  channelsCloudRefreshBtn?.addEventListener("click", () => void refreshGoogleCloudControl());
}

function setFeishuFeedback(kind: "info" | "ok" | "err", msg: string): void {
  if (!channelsFeishuFeedbackEl) return;
  channelsFeishuFeedbackEl.textContent = msg;
  channelsFeishuFeedbackEl.className = "channels-feedback";
  if (kind === "ok") channelsFeishuFeedbackEl.classList.add("channels-feedback--ok");
  else if (kind === "err") channelsFeishuFeedbackEl.classList.add("channels-feedback--err");
  else channelsFeishuFeedbackEl.classList.add("channels-feedback--info");
}

// ===== Phase 3.4：消息日誌 =====
const channelsLogListEl = document.getElementById("channels-log-list");
const channelsLogRefreshBtn = document.getElementById("channels-log-refresh");
const channelsLogClearBtn = document.getElementById("channels-log-clear");

function renderChannelsLog(entries: LogEntry[]): void {
  if (!channelsLogListEl) return;
  if (entries.length === 0) {
    channelsLogListEl.innerHTML = '<p class="empty-hint">暫無消息。</p>';
    return;
  }
  const html = entries
    .map((e) => {
      const t = new Date(e.at);
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      const ss = String(t.getSeconds()).padStart(2, "0");
      const dir = e.dir === "incoming" ? "← 收到" : "→ 回覆";
      const who = e.senderName ? `${e.senderName} (${e.senderId})` : e.senderId;
      const safe = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const text = e.text.length > 280 ? safe(e.text.slice(0, 280)) + "…" : safe(e.text);
      return `<div class="channels-log__entry channels-log__entry--${e.dir}">
        <div class="channels-log__meta">${hh}:${mm}:${ss} · ${dir} · ${safe(e.channel)} · ${safe(who)}</div>
        <div class="channels-log__text">${text}</div>
      </div>`;
    })
    .join("");
  channelsLogListEl.innerHTML = html;
}

async function refreshChannelsLog(): Promise<void> {
  try {
    const entries = (await window.settings.channelsLogGet(100)) as LogEntry[];
    renderChannelsLog(entries);
  } catch (err) {
    console.warn("[Channels] refreshChannelsLog 失敗:", err);
  }
}

channelsLogRefreshBtn?.addEventListener("click", () => void refreshChannelsLog());
channelsLogClearBtn?.addEventListener("click", async () => {
  if (!confirm("確認清空所有 bot 消息日誌？")) return;
  await window.settings.channelsLogClear();
  await refreshChannelsLog();
});

// 啟動時讀 URL hash 決定初始標籤（main 通過 loadURL 帶 #api 實現"切換模型按鈕跳 API"）。
// 無 hash 默認 general。
