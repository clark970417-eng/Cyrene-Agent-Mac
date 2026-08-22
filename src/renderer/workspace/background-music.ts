// background-music —— 由工作台外殼持有的背景音樂播放器。
//
// 為什麼放在這裡而不是設定頁：工作台所有面板共用同一個 iframe，切換分頁是直接
// 改寫 iframe.src，設定頁文件連同它自己建立的 Audio 物件會一起被銷毀。
// 音樂若在設定頁裡播放，使用者一離開「設定」分頁就會斷掉。外殼不會被銷毀，
// 才是唯一能讓音樂持續的位置。

interface MusicSettings {
  musicEnabled?: boolean;
  musicVolume?: number;
}

const MESSAGE_TYPE = "cyrene:music-settings";

const bgm = new Audio("/audio/bgm.mp3");
bgm.loop = true;

const desired = { enabled: false, volume: 60 };
let retryBound = false;

function apply(): void {
  bgm.volume = Math.max(0, Math.min(1, desired.volume / 100));
  if (!desired.enabled || document.hidden) {
    bgm.pause();
    return;
  }
  void bgm.play().catch(() => {
    // Chromium 在使用者首次互動前會擋自動播放；掛一次性監聽，等下次點擊再試。
    if (retryBound) return;
    retryBound = true;
    document.addEventListener("pointerdown", () => {
      retryBound = false;
      if (desired.enabled && !document.hidden) void bgm.play().catch(() => undefined);
    }, { once: true });
  });
}

export function applyMusicSettings(next: MusicSettings): void {
  if (typeof next.musicEnabled === "boolean") desired.enabled = next.musicEnabled;
  const volume = Number(next.musicVolume);
  if (Number.isFinite(volume)) desired.volume = volume;
  apply();
}

export function initBackgroundMusic(): void {
  const api = (window as unknown as {
    settings?: { getGeneral?: () => Promise<MusicSettings | null> };
  }).settings;
  void api?.getGeneral?.()
    .then((cfg) => applyMusicSettings(cfg ?? {}))
    .catch(() => undefined);

  // 視窗最小化、隱藏或縮到 tray 時暫停播放，重新顯示時若啟用則恢復
  document.addEventListener("visibilitychange", () => {
    apply();
  });
  window.addEventListener("pagehide", () => {
    bgm.pause();
  });

  // 設定頁在使用者調整當下就回報，不必等按「儲存設定」。
  window.addEventListener("message", (event) => {
    // 只接受自家 iframe 的訊息，不理會其他來源。
    const frame = document.querySelector("iframe");
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data as (MusicSettings & { type?: string }) | null;
    if (!data || data.type !== MESSAGE_TYPE) return;
    applyMusicSettings(data);
  });
}
