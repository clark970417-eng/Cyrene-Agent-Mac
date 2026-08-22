const musicEnabled = document.getElementById("music-enabled") as HTMLInputElement | null;
const musicVolume = document.getElementById("music-volume") as HTMLInputElement | null;
const soundEnabled = document.getElementById("sound-enabled") as HTMLInputElement | null;
const soundVolume = document.getElementById("sound-volume") as HTMLInputElement | null;

const bgm = new Audio("/audio/bgm.mp3");
bgm.loop = true;
const click = new Audio("/audio/click.mp3");

async function save(field: string, value: unknown): Promise<void> {
  await window.settings?.saveGeneral({ [field]: value });
}

// 嵌在工作台的 iframe 裡時，播放交給外殼（workspace/background-music.ts）。
// 設定頁會隨著切換分頁被銷毀，在這裡播放的話一離開就會斷。
const isEmbedded = window.parent !== window;

function notifyShell(): void {
  if (!isEmbedded) return;
  window.parent.postMessage({
    type: "cyrene:music-settings",
    musicEnabled: musicEnabled?.checked === true,
    musicVolume: Number(musicVolume?.value ?? 60),
  }, "*");
}

async function syncMusic(): Promise<void> {
  notifyShell();
  if (isEmbedded) {
    // 由外殼播放，這裡必須靜音，否則會有兩份音軌疊在一起。
    bgm.pause();
    return;
  }
  bgm.volume = Math.max(0, Math.min(1, Number(musicVolume?.value ?? 60) / 100));
  if (musicEnabled?.checked) {
    try { await bgm.play(); } catch { /* macOS 會在使用者首次互動前阻擋自動播放 */ }
  } else {
    bgm.pause();
  }
}

void window.settings?.getGeneral().then((config) => {
  if (musicEnabled) musicEnabled.checked = config.musicEnabled === true;
  if (musicVolume) musicVolume.value = String(config.musicVolume ?? 60);
  if (soundEnabled) soundEnabled.checked = config.soundEnabled !== false;
  if (soundVolume) soundVolume.value = String(config.soundVolume ?? 70);
  void syncMusic();
});

musicEnabled?.addEventListener("change", () => {
  void save("musicEnabled", musicEnabled.checked);
  void syncMusic();
});
musicVolume?.addEventListener("input", () => {
  void save("musicVolume", Number(musicVolume.value));
  void syncMusic();
});
soundEnabled?.addEventListener("change", () => void save("soundEnabled", soundEnabled.checked));
soundVolume?.addEventListener("input", () => void save("soundVolume", Number(soundVolume.value)));

document.addEventListener("click", (event) => {
  if (!soundEnabled?.checked || !(event.target as Element | null)?.closest("button")) return;
  click.currentTime = 0;
  click.volume = Math.max(0, Math.min(1, Number(soundVolume?.value ?? 70) / 100));
  void click.play().catch(() => undefined);
});
