// TTS 設置面板交互：配置加載/保存、引擎切換、語速/音量滑塊、開場白橋接、音色快速復刻
// 從 settings.ts 抽離。

/* ============================================================
   🎙️ TTS 設置面板交互
   - 配置加載/保存（存 general settings，跟其他設置一起）
   - 引擎選擇卡片切換：選中哪個展開哪個配置表單
   - 語速/音量滑塊實時顯示數值 + 自動保存
   - MiniMax 測試發音：調 synthesize 合成固定文本並播放
   - 音色快速復刻：選文件→上傳→訓練→自動填入 voice_id
   ============================================================ */

interface TtsApi {
  upload: (
    apiKey: string,
    filePath: string,
    purpose: "voice_clone" | "prompt_audio",
  ) => Promise<{ file_id: string }>;
  pickAudio: () => Promise<string | null>;
  clone: (payload: {
    apiKey: string;
    fileId: string;
    voiceId: string;
    promptAudioId?: string;
    promptText?: string;
    text: string;
    model?: string;
  }) => Promise<{ voiceId: string; audioDemo?: string }>;
  synthesize: (payload: {
    apiKey: string;
    voiceId: string;
    text: string;
    speed?: number;
    volume?: number;
    pitch?: number;
    model?: string;
    format?: "mp3" | "wav" | "pcm";
  }) => Promise<string>; // base64 音頻
  // GPT-SoVITS（返回 base64 + cacheKey + cached + format）
  synthesizeGptsovits: (payload: {
    baseUrl: string;
    refAudioPath: string;
    promptText: string;
    text: string;
    speed?: number;
    format?: "wav" | "mp3";
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  synthesizeCachedGptsovits: (payload: {
    baseUrl: string;
    refAudioPath: string;
    promptText: string;
    text: string;
    speed?: number;
    format?: "wav" | "mp3";
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  // 自定義雲端（返回 base64 + cacheKey + cached + format）
  synthesizeCustomCloud: (payload: {
    endpointUrl: string;
    apiKey?: string;
    voiceId?: string;
    text: string;
    speed?: number;
    volume?: number;
    format?: "wav" | "mp3";
    timeoutMs?: number;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  synthesizeCachedCustomCloud: (payload: {
    endpointUrl: string;
    apiKey?: string;
    voiceId?: string;
    text: string;
    speed?: number;
    volume?: number;
    format?: "wav" | "mp3";
    timeoutMs?: number;
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  // 小米 MiMo（返回 base64 + cacheKey + cached + format）
  synthesizeMimo: (payload: {
    apiKey: string;
    voiceAudioPath?: string;
    text: string;
    stylePrompt?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" }>;
  synthesizeCachedMimo: (payload: {
    apiKey: string;
    voiceAudioPath?: string;
    text: string;
    stylePrompt?: string;
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" }>;
  // Mossland（api.mosi.cn；返回 base64 + cacheKey + cached + format）
  synthesizeMossland: (payload: {
    apiKey: string;
    voiceId: string;
    text: string;
    speed?: number;
    volume?: number;
    model?: string;
    format?: "mp3" | "wav" | "pcm";
  }) => Promise<string>;
  synthesizeCachedMossland: (payload: {
    apiKey: string;
    voiceId: string;
    text: string;
    speed?: number;
    volume?: number;
    model?: string;
    format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => Promise<{
    base64: string;
    cacheKey: string;
    cached: boolean;
    format: "mp3" | "wav" | "pcm";
  }>;
  cloneMossland: (payload: {
    apiKey: string;
    filePath: string;
    name?: string;
    description?: string;
  }) => Promise<{ voiceId: string; name?: string; createdAt?: number }>;
  listMosslandVoices: (payload: {
    apiKey: string;
    limit?: number;
  }) => Promise<{ voices: Array<{ id: string; name: string; createdAt: number }> }>;
  pickAudioFile: () => Promise<string | null>;
  saveSettings: (tts: Record<string, unknown>) => Promise<unknown>;
  loadSettings: () => Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    tts?: TtsApi;
  }
}

const TTS_TEST_TEXT = "你好，我是昔漣，很高興見到你。";

// 獲取 DOM 元素的輔助函數
function ttsEl(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

// 當前加載的 TTS 配置（內存緩存，改一個字段就存一次）
let ttsConfig: Record<string, unknown> = {};

// 加載配置並填充表單
async function loadTtsConfig(): Promise<void> {
  if (!window.tts) return;
  try {
    ttsConfig = (await window.tts.loadSettings()) as Record<string, unknown>;
  } catch (err) {
    console.warn("[TTS] 加載配置失敗:", err);
    return;
  }

  // 引擎選擇
  const engine = String(ttsConfig.ttsEngine || "off");
  document.querySelectorAll<HTMLButtonElement>(".tts-engine").forEach((btn) => {
    const isActive = btn.dataset.engine === engine;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-checked", isActive ? "true" : "false");
  });
  document.querySelectorAll<HTMLElement>(".tts-config").forEach((el) => {
    el.hidden = true;
  });
  if (engine !== "off") {
    const config = document.getElementById("tts-config-" + engine);
    if (config) config.hidden = false;
  }

  // 播放交互
  ttsEl("tts-auto-read").checked = Boolean(ttsConfig.ttsAutoRead);
  ttsEl("tts-speed").value = String(ttsConfig.ttsSpeed ?? 1);
  ttsEl("tts-volume").value = String(ttsConfig.ttsVolume ?? 1);
  updateTtsSliderLabels();

  // MiniMax
  ttsEl("tts-minimax-key").value = String(ttsConfig.ttsMinimaxKey ?? "");
  ttsEl("tts-minimax-voice").value = String(ttsConfig.ttsMinimaxVoiceId ?? "");
  (ttsEl("tts-minimax-model") as HTMLSelectElement).value =
    ttsConfig.ttsMinimaxModel === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo";
  ttsEl("tts-streaming").checked = ttsConfig.ttsStreaming !== false;

  // GPT-SoVITS
  ttsEl("tts-gptsovits-url").value = String(
    ttsConfig.ttsGptsovitsBaseUrl ?? "http://localhost:9880",
  );
  ttsEl("tts-gptsovits-ref-audio").value = String(ttsConfig.ttsGptsovitsRefAudioPath ?? "");
  ttsEl("tts-gptsovits-prompt-text").value = String(ttsConfig.ttsGptsovitsPromptText ?? "");
  (ttsEl("tts-gptsovits-format") as HTMLSelectElement).value =
    ttsConfig.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav";

  // 自定義雲端
  ttsEl("tts-custom-cloud-url").value = String(ttsConfig.ttsCustomCloudEndpointUrl ?? "");
  ttsEl("tts-custom-cloud-key").value = String(ttsConfig.ttsCustomCloudApiKey ?? "");
  ttsEl("tts-custom-cloud-voice").value = String(ttsConfig.ttsCustomCloudVoiceId ?? "");
  (ttsEl("tts-custom-cloud-format") as HTMLSelectElement).value =
    ttsConfig.ttsCustomCloudFormat === "wav" ? "wav" : "mp3";
  ttsEl("tts-custom-cloud-timeout").value = String(ttsConfig.ttsCustomCloudTimeoutMs ?? 30000);

  // 小米 MiMo
  ttsEl("tts-mimo-key").value = String(ttsConfig.ttsMimoKey ?? "");
  ttsEl("tts-mimo-voice-audio").value = String(ttsConfig.ttsMimoVoiceAudioPath ?? "");
  ttsEl("tts-mimo-style").value = String(
    ttsConfig.ttsMimoStylePrompt ?? "溫柔、自然、略帶親近感，像在輕聲陪用戶聊天。",
  );
  // Mossland
  ttsEl("tts-mossland-key").value = String(ttsConfig.ttsMosslandKey ?? "");
  ttsEl("tts-mossland-voice").value = String(ttsConfig.ttsMosslandVoiceId ?? "");
  ttsEl("tts-mossland-text").value = String(ttsConfig.ttsMosslandTestText ?? TTS_TEST_TEXT);
  (ttsEl("tts-mossland-format") as HTMLSelectElement).value =
    ttsConfig.ttsMosslandFormat === "wav"
      ? "wav"
      : ttsConfig.ttsMosslandFormat === "pcm"
        ? "pcm"
        : "mp3";

  // Opener 主動開口檔位
  const openerMode = String(ttsConfig.openerMode ?? "off");
  document.querySelectorAll<HTMLButtonElement>(".opener-mode").forEach((btn) => {
    const isActive = btn.dataset.mode === openerMode;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-checked", isActive ? "true" : "false");
  });
  openerEl("opener-quiet-start").value = String(ttsConfig.openerQuietStart ?? "23:00");
  openerEl("opener-quiet-end").value = String(ttsConfig.openerQuietEnd ?? "07:00");
  openerEl("opener-daily-limit").value = String(ttsConfig.openerDailyLimit ?? 4);
  openerEl("opener-routine-enabled").checked = ttsConfig.openerRoutineEnabled !== false;
  openerEl("opener-breaks-enabled").checked = ttsConfig.openerBreaksEnabled !== false;
  openerEl("opener-weather-enabled").checked = ttsConfig.openerWeatherEnabled !== false;
  updateOpenerUi();
  void refreshOpenerStatus();
}

function updateTtsSliderLabels(): void {
  const speedVal = document.getElementById("tts-speed-val");
  const volVal = document.getElementById("tts-volume-val");
  if (speedVal) speedVal.textContent = Number(ttsEl("tts-speed").value).toFixed(1) + "x";
  if (volVal) volVal.textContent = Math.round(Number(ttsEl("tts-volume").value) * 100) + "%";
}

interface OpenerUiStatus {
  running: boolean;
  packSource: "voice-pack" | "built-in-text";
  sceneCount: number;
  audioItemCount: number;
  textItemCount: number;
  dailyFireCount: number;
  dailyLimit: number;
  desire: number;
  lastScene: string | null;
  lastTriggeredAt: number | null;
  city: string;
}

interface OpenerBridgeApi {
  testFire: (sceneId?: string) => Promise<{ ok: boolean; message: string }>;
  getStatus: () => Promise<OpenerUiStatus>;
  openPackFolder: () => Promise<{ ok: boolean; error?: string }>;
}

function openerBridge(): OpenerBridgeApi | undefined {
  return (window as unknown as { openerBridge?: OpenerBridgeApi }).openerBridge;
}

function openerEl(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function updateOpenerUi(): void {
  const mode = String(ttsConfig.openerMode ?? "off");
  document.querySelector(".opener-console")?.classList.toggle("is-off", mode === "off");
  const limit = Number(openerEl("opener-daily-limit").value || 4);
  const label = document.getElementById("opener-daily-limit-value");
  if (label) label.textContent = `${limit} 次`;
}

function setOpenerTestStatus(text: string): void {
  const status = document.getElementById("opener-test-status");
  if (status) status.textContent = text;
}

async function refreshOpenerStatus(): Promise<void> {
  const api = openerBridge();
  if (!api) return;
  try {
    const status = await api.getStatus();
    const health = document.getElementById("opener-health");
    health?.classList.toggle("is-running", status.running);
    if (health)
      health.title = status.city
        ? `天氣位置：${status.city}`
        : "尚未設定默認城市，天氣場景不會觸發";
    const title = document.getElementById("opener-health-title");
    const detail = document.getElementById("opener-health-detail");
    if (title) title.textContent = status.running ? "感知中" : "目前已關閉";
    if (detail) {
      const source =
        status.packSource === "voice-pack"
          ? `語音包 · ${status.audioItemCount} 句`
          : `內建文字 · ${status.textItemCount} 句`;
      detail.textContent = `${source} · 今日 ${status.dailyFireCount}/${status.dailyLimit}`;
    }
  } catch (err) {
    const title = document.getElementById("opener-health-title");
    const detail = document.getElementById("opener-health-detail");
    if (title) title.textContent = "狀態讀取失敗";
    if (detail) detail.textContent = err instanceof Error ? err.message : String(err);
  }
}

function bindOpenerControls(): void {
  for (const [id, field] of [
    ["opener-quiet-start", "openerQuietStart"],
    ["opener-quiet-end", "openerQuietEnd"],
  ] as const) {
    openerEl(id).addEventListener(
      "change",
      () => void saveTtsField(field, openerEl(id).value).then(refreshOpenerStatus),
    );
  }
  const limit = openerEl("opener-daily-limit");
  limit.addEventListener("input", updateOpenerUi);
  limit.addEventListener(
    "change",
    () => void saveTtsField("openerDailyLimit", Number(limit.value)).then(refreshOpenerStatus),
  );
  for (const [id, field] of [
    ["opener-routine-enabled", "openerRoutineEnabled"],
    ["opener-breaks-enabled", "openerBreaksEnabled"],
    ["opener-weather-enabled", "openerWeatherEnabled"],
  ] as const) {
    openerEl(id).addEventListener(
      "change",
      () => void saveTtsField(field, openerEl(id).checked).then(refreshOpenerStatus),
    );
  }

  document.getElementById("opener-open-pack-folder")?.addEventListener("click", async () => {
    const result = await openerBridge()?.openPackFolder();
    setOpenerTestStatus(
      result?.ok
        ? "已打開語音包資料夾；放入 manifest.json 與 wav 後重新讀取即可。"
        : result?.error || "無法打開資料夾",
    );
  });
}

// 保存單個 TTS 配置字段
async function saveTtsField(field: string, value: unknown): Promise<void> {
  if (!window.tts) return;
  ttsConfig[field] = value;
  try {
    await window.tts.saveSettings({ [field]: value });
  } catch (err) {
    console.warn("[TTS] 保存配置失敗:", field, err);
  }
}

// 播放 base64 音頻。format 決定 Blob MIME（minimax 默認 mp3，gptsovits 默認 wav）
function playTtsAudio(base64: string, format: "wav" | "mp3" = "mp3"): void {
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const mime = format === "wav" ? "audio/wav" : "audio/mp3";
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch((err) => console.warn("[TTS] 播放失敗:", err));
    audio.onended = () => URL.revokeObjectURL(url);
  } catch (err) {
    console.warn("[TTS] 音頻解碼失敗:", err);
  }
}

// 引擎選擇切換
// 只匹配帶 data-engine 的按鈕（即 TTS 廠商按鈕）——主動開口檔位按鈕雖然
// 共用 .tts-engine 視覺 class，但只有 data-mode 沒有 data-engine，
// 用屬性選擇器避免誤觸把它們當作 TTS 廠商處理。
document.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const engine = btn.dataset.engine || "off";
    document.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-checked", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-checked", "true");
    document.querySelectorAll<HTMLElement>(".tts-config").forEach((el) => {
      el.hidden = true;
    });
    if (engine !== "off") {
      const config = document.getElementById("tts-config-" + engine);
      if (config) config.hidden = false;
    }
    void saveTtsField("ttsEngine", engine);
  });
});

// Opener 主動開口檔位切換
document.querySelectorAll<HTMLButtonElement>(".opener-mode").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode || "off";
    document.querySelectorAll<HTMLButtonElement>(".opener-mode").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-checked", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-checked", "true");
    ttsConfig.openerMode = mode;
    updateOpenerUi();
    void saveTtsField("openerMode", mode).then(refreshOpenerStatus);
  });
});

// Opener 測試氣泡：可選場景，並把缺少桌寵/語音包等原因直接顯示給使用者。
document.getElementById("opener-test-fire")?.addEventListener("click", async () => {
  const button = document.getElementById("opener-test-fire") as HTMLButtonElement;
  const scene = (document.getElementById("opener-test-scene") as HTMLSelectElement | null)?.value;
  button.disabled = true;
  setOpenerTestStatus("正在送出測試氣泡…");
  try {
    const result = await openerBridge()?.testFire(scene);
    setOpenerTestStatus(result?.message ?? "主動開口橋接尚未就緒。");
    await refreshOpenerStatus();
  } catch (err) {
    setOpenerTestStatus(err instanceof Error ? err.message : String(err));
  } finally {
    button.disabled = false;
  }
});

// 自動朗讀開關
ttsEl("tts-auto-read").addEventListener("change", () => {
  void saveTtsField("ttsAutoRead", ttsEl("tts-auto-read").checked);
});

// 語速/音量滑塊（change 時保存，input 時實時顯示）
ttsEl("tts-speed").addEventListener("input", updateTtsSliderLabels);
ttsEl("tts-speed").addEventListener("change", () =>
  saveTtsField("ttsSpeed", Number(ttsEl("tts-speed").value)),
);
ttsEl("tts-volume").addEventListener("input", updateTtsSliderLabels);
ttsEl("tts-volume").addEventListener("change", () =>
  saveTtsField("ttsVolume", Number(ttsEl("tts-volume").value)),
);

// 配置輸入框 change 時保存 + input 時防抖保存（防粘貼後未失焦就丟失）
const ttsSaveFields: Array<[string, string]> = [
  ["tts-minimax-key", "ttsMinimaxKey"],
  ["tts-minimax-voice", "ttsMinimaxVoiceId"],
  ["tts-minimax-model", "ttsMinimaxModel"],
  ["tts-gptsovits-url", "ttsGptsovitsBaseUrl"],
  ["tts-gptsovits-ref-audio", "ttsGptsovitsRefAudioPath"],
  ["tts-gptsovits-prompt-text", "ttsGptsovitsPromptText"],
  ["tts-custom-cloud-url", "ttsCustomCloudEndpointUrl"],
  ["tts-custom-cloud-key", "ttsCustomCloudApiKey"],
  ["tts-custom-cloud-voice", "ttsCustomCloudVoiceId"],
  ["tts-custom-cloud-timeout", "ttsCustomCloudTimeoutMs"],
  ["tts-mimo-key", "ttsMimoKey"],
  ["tts-mimo-voice-audio", "ttsMimoVoiceAudioPath"],
  ["tts-mimo-style", "ttsMimoStylePrompt"],
  ["tts-mossland-key", "ttsMosslandKey"],
  ["tts-mossland-voice", "ttsMosslandVoiceId"],
  ["tts-mossland-text", "ttsMosslandTestText"],
];
const ttsDebounceTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
for (const [elId, field] of ttsSaveFields) {
  ttsEl(elId).addEventListener("change", () => saveTtsField(field, ttsEl(elId).value));
  // 防抖保存：輸入或粘貼後 800ms 自動保存，不依賴失焦
  ttsEl(elId).addEventListener("input", () => {
    clearTimeout(ttsDebounceTimers[field]);
    ttsDebounceTimers[field] = setTimeout(() => {
      void saveTtsField(field, ttsEl(elId).value);
    }, 800);
  });
}

// GPT-SoVITS 格式選擇（select，change 時直接保存）
(ttsEl("tts-gptsovits-format") as HTMLSelectElement).addEventListener("change", () => {
  void saveTtsField(
    "ttsGptsovitsFormat",
    (ttsEl("tts-gptsovits-format") as HTMLSelectElement).value as "wav" | "mp3",
  );
});

// 自定義雲端格式選擇
(ttsEl("tts-custom-cloud-format") as HTMLSelectElement).addEventListener("change", () => {
  void saveTtsField(
    "ttsCustomCloudFormat",
    (ttsEl("tts-custom-cloud-format") as HTMLSelectElement).value as "wav" | "mp3",
  );
});

// Mossland 格式／模型選擇
(ttsEl("tts-mossland-format") as HTMLSelectElement).addEventListener("change", () => {
  void saveTtsField(
    "ttsMosslandFormat",
    (ttsEl("tts-mossland-format") as HTMLSelectElement).value as "mp3" | "wav" | "pcm",
  );
});
(ttsEl("tts-mossland-model") as HTMLSelectElement).addEventListener("change", () => {
  void saveTtsField("ttsMosslandModel", (ttsEl("tts-mossland-model") as HTMLSelectElement).value);
});

// MiniMax 流式播放開關
ttsEl("tts-streaming").addEventListener("change", () => {
  void saveTtsField("ttsStreaming", ttsEl("tts-streaming").checked);
});

// GPT-SoVITS 選擇參考音頻
document.getElementById("tts-gptsovits-ref-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudioFile();
  if (filePath) {
    ttsEl("tts-gptsovits-ref-audio").value = filePath;
    void saveTtsField("ttsGptsovitsRefAudioPath", filePath);
  }
});

// GPT-SoVITS 測試發音
document.getElementById("tts-gptsovits-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const baseUrl = ttsEl("tts-gptsovits-url").value.trim();
  const refAudioPath = ttsEl("tts-gptsovits-ref-audio").value.trim();
  const promptText = ttsEl("tts-gptsovits-prompt-text").value.trim();
  const format = (ttsEl("tts-gptsovits-format") as HTMLSelectElement).value as "wav" | "mp3";
  if (!baseUrl) {
    window.alert("請先填寫 GPT-SoVITS API 地址");
    return;
  }
  if (!refAudioPath) {
    window.alert("請先選擇參考音頻文件");
    return;
  }
  if (!promptText) {
    window.alert("請先填寫參考音頻對應的文本");
    return;
  }

  const btn = document.getElementById("tts-gptsovits-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "合成中…";
  try {
    const result = await window.tts.synthesizeGptsovits({
      baseUrl,
      refAudioPath,
      promptText,
      text: TTS_TEST_TEXT,
      format,
    });
    playTtsAudio(result.base64, result.format);
  } catch (err) {
    window.alert("測試失敗: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "🔊 測試發音";
  }
});

// 小米 MiMo 選擇昔漣克隆參考音頻
document.getElementById("tts-mimo-voice-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudioFile();
  if (filePath) {
    ttsEl("tts-mimo-voice-audio").value = filePath;
    void saveTtsField("ttsMimoVoiceAudioPath", filePath);
  }
});

// Mossland 選擇音頻並克隆新音色
document.getElementById("tts-mossland-clone-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-mossland-key").value.trim();
  if (!apiKey) {
    window.alert("請先填寫 Mossland API Key");
    return;
  }
  const filePath = await window.tts.pickAudioFile();
  if (!filePath) return;

  const statusEl = document.getElementById("tts-mossland-clone-status");
  if (statusEl) statusEl.textContent = "克隆中…";
  try {
    const result = await window.tts.cloneMossland({ apiKey, filePath, name: "昔漣" });
    ttsEl("tts-mossland-voice").value = result.voiceId;
    void saveTtsField("ttsMosslandVoiceId", result.voiceId);
    if (statusEl) statusEl.textContent = `已克隆音色：${result.voiceId}`;
  } catch (err) {
    if (statusEl)
      statusEl.textContent = "克隆失敗：" + (err instanceof Error ? err.message : String(err));
  }
});

// Mossland 拉取已克隆音色列表
document.getElementById("tts-mossland-list-voices")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-mossland-key").value.trim();
  if (!apiKey) {
    window.alert("請先填寫 Mossland API Key");
    return;
  }

  const statusEl = document.getElementById("tts-mossland-clone-status");
  if (statusEl) statusEl.textContent = "讀取中…";
  try {
    const result = await window.tts.listMosslandVoices({ apiKey });
    if (result.voices.length === 0) {
      if (statusEl) statusEl.textContent = "目前沒有已克隆的音色";
      return;
    }
    if (statusEl) {
      statusEl.textContent =
        "已克隆音色：" + result.voices.map((v) => `${v.name || "（未命名）"} (${v.id})`).join("、");
    }
  } catch (err) {
    if (statusEl)
      statusEl.textContent = "讀取失敗：" + (err instanceof Error ? err.message : String(err));
  }
});

// Mossland 測試發音
document.getElementById("tts-mossland-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-mossland-key").value.trim();
  const voiceId = ttsEl("tts-mossland-voice").value.trim();
  const model = (ttsEl("tts-mossland-model") as HTMLSelectElement).value;
  const text = ttsEl("tts-mossland-text").value.trim() || TTS_TEST_TEXT;
  if (!apiKey) {
    window.alert("請先填寫 Mossland API Key");
    return;
  }
  if (!voiceId) {
    window.alert("請先克隆或填寫音色 ID");
    return;
  }

  const btn = document.getElementById("tts-mossland-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "合成中…";
  try {
    const result = await window.tts.synthesizeCachedMossland({
      apiKey,
      voiceId,
      text,
      model,
      speed: Number(ttsEl("tts-speed").value),
      volume: Number(ttsEl("tts-volume").value),
      format: "mp3",
    });
    playTtsAudio(result.base64, "mp3");
  } catch (err) {
    window.alert("測試失敗: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "🔊 測試發音";
  }
});

// 自定義雲端測試發音
document.getElementById("tts-custom-cloud-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const endpointUrl = ttsEl("tts-custom-cloud-url").value.trim();
  const apiKey = ttsEl("tts-custom-cloud-key").value.trim();
  const voiceId = ttsEl("tts-custom-cloud-voice").value.trim();
  const format = (ttsEl("tts-custom-cloud-format") as HTMLSelectElement).value as "wav" | "mp3";
  const timeoutMs = Number(ttsEl("tts-custom-cloud-timeout").value) || 30000;
  if (!endpointUrl) {
    window.alert("請先填寫自定義雲端 Endpoint URL");
    return;
  }

  const btn = document.getElementById("tts-custom-cloud-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "合成中…";
  try {
    const result = await window.tts.synthesizeCustomCloud({
      endpointUrl,
      apiKey,
      voiceId,
      text: TTS_TEST_TEXT,
      speed: Number(ttsEl("tts-speed").value),
      volume: Number(ttsEl("tts-volume").value),
      format,
      timeoutMs,
    });
    playTtsAudio(result.base64, result.format);
  } catch (err) {
    window.alert("測試失敗: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "🔊 測試發音";
  }
});

// 小米 MiMo 測試發音
document.getElementById("tts-mimo-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-mimo-key").value.trim();
  const voiceAudioPath = ttsEl("tts-mimo-voice-audio").value.trim();
  const stylePrompt = ttsEl("tts-mimo-style").value.trim();
  if (!apiKey) {
    window.alert("請先填寫小米 MiMo API Key");
    return;
  }
  if (!voiceAudioPath) {
    window.alert("請先選擇昔漣克隆參考音頻");
    return;
  }

  const btn = document.getElementById("tts-mimo-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "合成中…";
  try {
    const result = await window.tts.synthesizeMimo({
      apiKey,
      voiceAudioPath,
      stylePrompt,
      text: TTS_TEST_TEXT,
    });
    playTtsAudio(result.base64, result.format);
  } catch (err) {
    window.alert("測試失敗: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "🔊 測試發音";
  }
});

// MiniMax 測試發音
document.getElementById("tts-minimax-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-minimax-key").value.trim();
  const voiceId = ttsEl("tts-minimax-voice").value.trim();
  const modelSelect = ttsEl("tts-minimax-model") as HTMLSelectElement;
  const model = modelSelect.value === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo";
  if (!apiKey) {
    window.alert("請先填寫 MiniMax API Key");
    return;
  }
  if (!voiceId) {
    window.alert("請先填寫音色 ID（或下方復刻訓練）");
    return;
  }

  const btn = document.getElementById("tts-minimax-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "合成中…";
  try {
    const base64 = await window.tts.synthesize({ apiKey, voiceId, text: TTS_TEST_TEXT, model });
    playTtsAudio(base64);
  } catch (err) {
    window.alert("測試失敗: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "🔊 測試發音";
  }
});

// ── 音色快速復刻 ──
// 選擇配音文件
document.getElementById("tts-clone-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudio();
  if (filePath) ttsEl("tts-clone-file").value = filePath;
});

// 選擇示例音頻
document.getElementById("tts-clone-prompt-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudio();
  if (filePath) ttsEl("tts-clone-prompt-file").value = filePath;
});

// 設置復刻狀態文案
function setCloneStatus(text: string, type: "ok" | "error" | "loading"): void {
  const el = document.getElementById("tts-clone-status");
  if (!el) return;
  el.textContent = text;
  el.className = "tts-clone-status" + (type ? " is-" + type : "");
}

// 開始復刻
document.getElementById("tts-clone-start")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-minimax-key").value.trim();
  const cloneFile = ttsEl("tts-clone-file").value.trim();
  const promptFile = ttsEl("tts-clone-prompt-file").value.trim();
  const promptText = ttsEl("tts-clone-prompt-text").value.trim();
  const cloneText = ttsEl("tts-clone-text").value.trim();
  const voiceId = ttsEl("tts-clone-voice-id").value.trim();

  if (!apiKey) {
    window.alert("請先填寫 MiniMax API Key");
    return;
  }
  if (!cloneFile) {
    window.alert("請選擇配音文件");
    return;
  }
  if (!cloneText) {
    window.alert("請填寫復刻文本");
    return;
  }
  if (!voiceId) {
    window.alert("請填寫音色命名");
    return;
  }

  const btn = document.getElementById("tts-clone-start") as HTMLButtonElement;
  btn.disabled = true;
  setCloneStatus("正在上傳配音文件…", "loading");

  try {
    // 步驟1: 上傳配音文件
    const cloneUpload = await window.tts.upload(apiKey, cloneFile, "voice_clone");
    setCloneStatus(
      "配音文件上傳完成 (file_id: " + cloneUpload.file_id + ")，正在上傳示例音頻…",
      "loading",
    );

    // 步驟2: 上傳示例音頻（可選）
    let promptFileId: string | undefined;
    if (promptFile) {
      const promptUpload = await window.tts.upload(apiKey, promptFile, "prompt_audio");
      promptFileId = promptUpload.file_id;
      setCloneStatus("示例音頻上傳完成，正在訓練音色…", "loading");
    } else {
      setCloneStatus("正在訓練音色…", "loading");
    }

    // 步驟3: 音色克隆
    const result = await window.tts.clone({
      apiKey,
      fileId: cloneUpload.file_id,
      voiceId,
      promptAudioId: promptFileId,
      promptText: promptText || undefined,
      text: cloneText,
    });

    // 自動填入音色 ID
    ttsEl("tts-minimax-voice").value = result.voiceId;
    void saveTtsField("ttsMinimaxVoiceId", result.voiceId);

    setCloneStatus("✅ 復刻成功！音色 ID「" + result.voiceId + "」已自動填入。", "ok");

    // 如果有試聽音頻，播放
    if (result.audioDemo) {
      try {
        const resp = await fetch(result.audioDemo);
        const buf = await resp.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        playTtsAudio(base64);
      } catch {
        /* 試聽音頻播放失敗不影響主流程 */
      }
    }
  } catch (err) {
    setCloneStatus("❌ " + (err instanceof Error ? err.message : String(err)), "error");
  } finally {
    btn.disabled = false;
  }
});

// 初始加載配置
bindOpenerControls();
void loadTtsConfig();
