// 通话轮次协调器 —— 编排 ASR → agent → TTS 的轮次循环。
//
// 状态机：
//   IDLE → LISTENING → (VAD 静默) → THINKING → (agent+TTS) → SPEAKING → (播完) → LISTENING
//
// 配置通过 setCallSettings 注入 getter（避免 import index.ts 循环依赖）。

import { BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { AliyunAsrStream, getAsrConfig } from "../asr/aliyun-asr-engine";
import { VolcanoAsrStream } from "../asr/volcano-asr-engine";
import { synthesizeByEngine } from "../tts/tts-dispatcher";
import type { TtsEngine } from "../../shared/tts-types";
import { runFunctionCallingLoop } from "../orchestrator";
import { getAdapter, getAdapterForConfig, buildVendorUrlByProvider, createSseReader } from "../orchestrator/vendors";
import { resolveTimeoutPolicy } from "../runtime-policy";
import type { ChatMessage } from "../orchestrator/vendors/types";
import {
  hasSpeechSignal,
  isWhisperHallucination,
  prewarmOfflineWhisper,
  transcribeOfflineWhisper,
} from "../asr/offline-whisper-engine";
import { IncrementalTranscriber, trimSilentPreroll } from "../asr/incremental-transcriber";
import { normalizeAsrText } from "../asr/asr-text-normalizer";
import { startCallUsage, stopCallUsage } from "../call-usage-store";
import { captionImage } from "../orchestrator/vision-captioner";
import { toTraditionalTaiwan } from "../utils/opencc";
import { parseSharedScreenFrame, shouldUseSharedScreen, type SharedScreenFrame } from "./screen-context";
import { splitForEarlySpeech, StreamingSentenceSplitter } from "./tts-segmentation";
import { createTurnPerf, type TurnPerf } from "./turn-perf";

const LOG_PREFIX = "[CallManager]";

export type CallState = "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "ERROR" | "ENDED";

let callWindow: BrowserWindow | null = null;
let asrStream: AliyunAsrStream | VolcanoAsrStream | null = null;
let currentState: CallState = "IDLE";
let finalText = "";
let active = false;
/** 本機辨識用的錄音。以前是每來一幀就 `Buffer.concat` 一次——20ms 一幀、講十幾
 * 秒就是幾百次重新配置＋整段複製，聆聽期間主行程一直在做這件白工。改成攢
 * chunk，真的要用時才併起來。 */
let localAudioChunks: Buffer[] = [];
let localAudioBytes = 0;
let latestScreenFrame: SharedScreenFrame | null = null;
const MAX_LOCAL_AUDIO_BYTES = 10 * 1024 * 1024;

function materializeLocalAudio(): Buffer {
  if (localAudioChunks.length > 1) {
    localAudioChunks = [Buffer.concat(localAudioChunks, localAudioBytes)];
  }
  return localAudioChunks[0] ?? Buffer.alloc(0);
}

/** 邊講邊辨識。雲端 ASR 的中間結果是白拿的，本機 Whisper 得自己排程重跑。
 * 產出的 partial 有兩個用途：畫面上即時顯示，以及餵給 system prompt 預熱——
 * 後者以前在本機路徑上從來沒生效過。 */
const localTranscriber = new IncrementalTranscriber({
  transcribe: async (pcm) => {
    const language = getAsrConfig()?.language === "en" ? "en" : "zh";
    const text = await transcribeOfflineWhisper(pcm, language);
    // 半句話的音訊特別容易誘發 Whisper 的字幕署名幻覺，這裡就先擋掉，
    // 免得畫面上冒出使用者沒說過的字、又拿去預熱錯的 prompt。
    return isWhisperHallucination(text) ? "" : text;
  },
  hasSpeech: (pcm) => hasSpeechSignal(pcm),
  onPartial: ({ text }) => {
    if (!active || currentState !== "LISTENING") return;
    sendAsrResult(text, undefined);
    schedulePrewarmPrompt(text);
  },
});

/** 還沒有人聲時最多留這麼久的錄音（3 秒）。通話開著沒人講話時音訊照樣往
 * buffer 堆——實測看過累積 69 秒卻只辨識出 16 個字，而 Whisper 的切塊上限是
 * 30 秒，超過就被迫切成多塊，辨識從 700ms 漲到 2000ms。開口前留 3 秒餘裕就夠。 */
const MAX_SILENT_PREROLL_BYTES = 16_000 * 2 * 3;
/** 裁切要掃整段音訊判斷有沒有人聲，是 O(n)，不能每幀都做。 */
const PREROLL_CHECK_INTERVAL_MS = 1_000;
let lastPrerollCheckAtMs = 0;

/** 丟掉開口前多餘的靜音。裁掉之後 byte 位移全變了，增量辨識的進度要一併作廢
 * ——反正那段本來就沒有人聲，沒有結果可以丟。 */
function dropSilentPreroll(): void {
  if (localAudioBytes <= MAX_SILENT_PREROLL_BYTES) return;
  const now = Date.now();
  if (now - lastPrerollCheckAtMs < PREROLL_CHECK_INTERVAL_MS) return;
  lastPrerollCheckAtMs = now;

  const pcm = materializeLocalAudio();
  const trimmed = trimSilentPreroll(pcm, MAX_SILENT_PREROLL_BYTES, hasSpeechSignal);
  if (trimmed.length === pcm.length) return;
  console.log(LOG_PREFIX, `丟掉開口前的靜音 ${Math.round((pcm.length - trimmed.length) / 32)}ms`);
  localAudioChunks = [Buffer.from(trimmed)];
  localAudioBytes = trimmed.length;
  localTranscriber.reset();
}

function resetLocalAudio(): void {
  localAudioChunks = [];
  localAudioBytes = 0;
  lastPrerollCheckAtMs = 0;
  localTranscriber.reset();
}

/** 通话上下文：保留最近 N 轮对话历史（每轮 = user + assistant 一对）。
 * 通话场景對即時首字延遲（TTFT）與 Token 消耗極端敏感。
 * 設定為 6 輪（12 條訊息），既能維持近期語境連貫性，又能避免長對話導致
 * Context 暴增拖慢推論速度並消耗過多 Token。長期記憶由向量庫（RAG/LanceDB）召回。 */
const MAX_CALL_CONTEXT_TURNS = 6;
const callHistory: ChatMessage[] = [];

/** 滑动窗口截断：每次 push 两轮后调用，保留最近 MAX_CALL_CONTEXT_TURNS 轮。
 * 这样 callHistory 数组本身有界（12 条），不会被长通话撑爆内存与 Token。 */
function trimCallHistory(): void {
  if (callHistory.length > MAX_CALL_CONTEXT_TURNS * 2) {
    callHistory.splice(0, callHistory.length - MAX_CALL_CONTEXT_TURNS * 2);
  }
}

// 注入的配置 getter（由 index.ts 启动时设置，避免循环依赖）
let modelSettingsGetter: (() => {
  provider: string; baseUrl: string; model: string; apiKey: string;
}) | null = null;
export interface CallTtsSettings {
  ttsEngine: TtsEngine;
  ttsMinimaxKey: string;
  ttsMinimaxVoiceId: string;
  ttsMinimaxModel: "speech-2.8-hd" | "speech-2.8-turbo";
  ttsSpeed: number;
  ttsVolume: number;
  // MiniMax
  ttsMinimaxVocalEnhance: boolean;
  ttsGptsovitsBaseUrl: string;
  ttsGptsovitsRefAudioPath: string;
  ttsGptsovitsPromptText: string;
  ttsGptsovitsFormat: "wav" | "mp3";
  ttsGptsovitsTimeoutMs: number;
  ttsCustomCloudEndpointUrl: string;
  ttsCustomCloudApiKey: string;
  ttsCustomCloudVoiceId: string;
  ttsCustomCloudFormat: "wav" | "mp3";
  ttsCustomCloudTimeoutMs: number;
  ttsMimoKey: string;
  ttsMimoVoiceAudioPath: string;
  ttsMimoStylePrompt: string;
}

let ttsSettingsGetter: (() => CallTtsSettings) | null = null;

/** index.ts 启动时注入模型配置、TTS 配置和 system prompt 构建器。 */
let systemPromptBuilder: ((userText: string) => Promise<string>) | null = null;
let weatherHandler: ((userText: string) => Promise<string | null>) | null = null;
const WEATHER_REGEX = /(天气|天氣|氣溫|下雨|温度|溫度|冷不冷|熱不熱|晴天|陰天|氣象|weather)/i;

export function setCallSettings(
  modelGetter: () => { provider: string; baseUrl: string; model: string; apiKey: string },
  ttsGetter: () => CallTtsSettings,
  systemPromptFn: (userText: string) => Promise<string>,
  weatherFn: (userText: string) => Promise<string | null>,
): void {
  modelSettingsGetter = modelGetter;
  ttsSettingsGetter = ttsGetter;
  systemPromptBuilder = systemPromptFn;
  weatherHandler = weatherFn;
}

/** 绑定通话窗口（createCallWindow 调一次）。 */
export function setCallWindow(win: BrowserWindow | null): void {
  callWindow = win;
}

/** 是否正在通话中。 */
export function isCallActive(): boolean {
  return active;
}

function sendState(state: CallState): void {
  currentState = state;
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_STATE, { state });
  }
  console.log(LOG_PREFIX, "状态 →", state);
}

function sendError(message: string): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_ERROR, { message });
  }
  console.error(LOG_PREFIX, "错误:", message);
}

function sendAsrResult(partial: string | undefined, final: string | undefined): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_ASR_RESULT, { partial, final });
  }
}

let currentTurnId = 0;
/** 一次只跑一輪：擋掉打斷／重複 VAD 結算造成的重入。 */
let turnInFlight = false;
/** ASR 串流世代：每次重啟就 +1，舊串流遲到的回呼一律忽略。 */
let asrGeneration = 0;
/** 網頁版通話的開場注入。接通後立即在背景建立乾淨對話、先餵人設；第一句真正
 * 送出前會等它完成，避免 Gemini 還在讀 prompt 時把使用者的話吞掉。 */
let webCallPrimePromise: Promise<void> | null = null;
let webCallPrimeAbortController: AbortController | null = null;
let webCallDayKey = "";

/** 使用本機日曆日，午夜 00:00 就換新對話，不是每隔 24 小時。 */
export function localCallDayKey(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function beginWebCallPrime(personaPrompt?: string, reason = "通話接通"): Promise<void> | null {
  const ms = modelSettingsGetter?.();
  if (!ms || !systemPromptBuilder) return null;
  const adapter = getAdapterForConfig({
    provider: ms.provider,
    baseUrl: ms.baseUrl,
    model: ms.model,
    apiKey: ms.apiKey,
  });
  if (typeof adapter.primeWebSession !== "function") return null;

  webCallPrimeAbortController?.abort();
  const controller = new AbortController();
  webCallPrimeAbortController = controller;
  webCallDayKey = localCallDayKey();

  const promise = (async () => {
    const prompt = personaPrompt ?? await systemPromptBuilder!("");
    if (!active || controller.signal.aborted) return;
    console.log(LOG_PREFIX, `[WebCall] ${reason}：建立新對話並優先注入 Prompt`);
    const conversationUrl = await adapter.primeWebSession!(prompt, { signal: controller.signal });
    if (!active || controller.signal.aborted) return;
    if (conversationUrl) {
      console.log(LOG_PREFIX, `[WebCall] ${reason}：Prompt 已讀完，回覆已丟棄`);
    } else {
      console.warn(LOG_PREFIX, `[WebCall] ${reason}：Prompt 注入未完成，首輪改走完整 Prompt 備援`);
    }
  })().catch((err) => {
    if (!controller.signal.aborted) {
      console.warn(LOG_PREFIX, `[WebCall] ${reason}失敗，首輪改走完整 Prompt 備援：`, err);
    }
  });

  webCallPrimePromise = promise;
  void promise.finally(() => {
    if (webCallPrimePromise === promise) webCallPrimePromise = null;
    if (webCallPrimeAbortController === controller) webCallPrimeAbortController = null;
  });
  return promise;
}

const MOOD_TAG_REGEX = /\[mood:([a-z0-9_]+)\]/i;
const GESTURE_TAG_REGEX = /\[gesture:([a-z0-9_]+)\]/i;
const ALL_TAGS_REGEX = /\[(mood:[a-z0-9_]+|gesture:[a-z0-9_]+|sticker:[a-zA-Z0-9_-]+)\]/gi;

export interface CleanedTtsSegment {
  text: string;
  mood?: string;
  gesture?: string;
}

export function extractMoodAndCleanSegment(
  segment: string,
  previousMood?: string,
  previousGesture?: string
): CleanedTtsSegment {
  const moodMatch = segment.match(MOOD_TAG_REGEX);
  const gestureMatch = segment.match(GESTURE_TAG_REGEX);
  const mood = moodMatch ? moodMatch[1].toLowerCase() : previousMood;
  const gesture = gestureMatch ? gestureMatch[1] : previousGesture;
  const cleanText = segment.replace(ALL_TAGS_REGEX, "").trim();
  return { text: cleanText, mood, gesture };
}

/** 送出一段合成好的語音。
 * 一輪回覆會切成多段陸續送出，`isFinal` 標記最後一段——渲染端要等最後一段
 * 播完才回 CALL_TTS_DONE，中途的段落只是接著播下去。
 * 支援傳入 Buffer 走二進位零拷貝 IPC 傳輸，同時相容 Base64 字串。
 * 空內容代表「後面沒有了」（合成中途失敗時用來收尾）。 */
function sendTtsAudio(
  audio: Buffer | string,
  isFinal: boolean,
  mood?: string,
  gesture?: string,
  text?: string,
  format?: CallTtsAudioFormat,
): void {
  const isBuffer = Buffer.isBuffer(audio);
  const audioBuffer = isBuffer ? (audio as Buffer) : undefined;
  const base64 = isBuffer ? (audio as Buffer).toString("base64") : (audio as string);
  const byteCount = isBuffer ? (audio as Buffer).byteLength : (audio as string).length;
  console.log(LOG_PREFIX, `sendTtsAudio bytes=${byteCount} isFinal=${isFinal} mood=${mood} gesture=${gesture} format=${format}`);
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_TTS_AUDIO, {
      audioBuffer,
      base64,
      isFinal,
      mood,
      gesture,
      text,
      format,
    });
  }
}

/** 各引擎能回什麼容器不一樣，渲染端要靠它決定 Blob 的 MIME。 */
export type CallTtsAudioFormat = "wav" | "mp3";

/** 這一輪該用什麼音訊格式。以前不分引擎一律送 `ttsGptsovitsFormat`，
 * 於是把 GPT-SoVITS 的設定套到了 MiniMax 頭上。 */
export function resolveTtsFormat(tts: CallTtsSettings): CallTtsAudioFormat {
  if (tts.ttsEngine === "gptsovits") return tts.ttsGptsovitsFormat;
  if (tts.ttsEngine === "custom-cloud") return tts.ttsCustomCloudFormat;
  return "mp3";
}

/** 組出送給 tts-dispatcher 的參數。整輪回覆會切成多段、每段呼叫一次，
 * 所以只有 text 會變，其餘設定固定。 */
function buildTtsPayload(tts: CallTtsSettings, text: string) {
  return {
    text,
    speed: tts.ttsSpeed,
    volume: tts.ttsVolume,
    // minimax
    apiKey: tts.ttsEngine === "mimo"
      ? tts.ttsMimoKey
      : tts.ttsEngine === "custom-cloud"
        ? tts.ttsCustomCloudApiKey
        : tts.ttsMinimaxKey,
    voiceId: tts.ttsEngine === "mimo"
      ? ""
      : tts.ttsEngine === "custom-cloud"
        ? tts.ttsCustomCloudVoiceId
        : tts.ttsMinimaxVoiceId,
    model: tts.ttsMinimaxModel,
    // gptsovits
    baseUrl: tts.ttsGptsovitsBaseUrl,
    refAudioPath: tts.ttsGptsovitsRefAudioPath,
    promptText: tts.ttsGptsovitsPromptText,
    format: resolveTtsFormat(tts),
    // custom-cloud
    endpointUrl: tts.ttsCustomCloudEndpointUrl,
    timeoutMs: tts.ttsEngine === "gptsovits" ? tts.ttsGptsovitsTimeoutMs : tts.ttsCustomCloudTimeoutMs,
    vocalEnhance: tts.ttsEngine === "minimax" ? { enabled: tts.ttsMinimaxVocalEnhance } : undefined,
    voiceAudioPath: tts.ttsMimoVoiceAudioPath,
    stylePrompt: tts.ttsMimoStylePrompt,
  };
}

/** 开始通话：初始化 ASR 流，进入 LISTENING。 */
export function startCall(): void {
  if (active) return;
  const rawCfg = getAsrConfig();
  const cfg = rawCfg ?? { engine: "local" as const, language: "zh", fallbackToLocal: true };
  const hasAliyun = (cfg.engine === "aliyun" || cfg.engine === "volcano") && Boolean(cfg.appKey && cfg.accessKeyId && cfg.accessKeySecret);
  if (cfg.engine === "aliyun" && !hasAliyun && !cfg.fallbackToLocal) {
    console.warn(LOG_PREFIX, "阿里雲金鑰未配置，自動啟用本機 Whisper 備援");
  }

  active = true;
  startCallUsage("desktop");
  finalText = "";
  resetLocalAudio();
  callHistory.length = 0;
  latestScreenFrame = null;
  turnInFlight = false;
  webCallPrimeAbortController?.abort();
  webCallPrimeAbortController = null;
  webCallPrimePromise = null;
  webCallDayKey = "";
  asrStreamPrewarmed = false;
  lastPrewarmAtMs = 0;
  console.log(LOG_PREFIX, "startCall 重置: finalText 清空, history 清空");
  // 會用到本機 Whisper 的組態，趁使用者還在講第一句話時先把模型載起來。
  if (cfg.engine === "local" || cfg.fallbackToLocal) prewarmOfflineWhisper();
  if (hasAliyun) startAsrStream(cfg);
  // 不阻塞通話畫面；使用者戴耳機、開口的時間正好拿來讓 Gemini 讀人設。
  beginWebCallPrime();
  sendState("LISTENING");
}

/** 一輪之內講了好幾句時，`SentenceEnd` 會分次送回來。
 * 中日文直接相接，英數之間補一個空格，才不會黏成一團。 */
export function appendSentence(previous: string, next: string): string {
  const head = previous.trim();
  const tail = next.trim();
  if (!head) return tail;
  if (!tail) return head;
  const needsSpace = /[A-Za-z0-9]$/.test(head) && /^[A-Za-z0-9]/.test(tail);
  return needsSpace ? `${head} ${tail}` : `${head}${tail}`;
}

let prewarmedPromptPromise: Promise<string> | null = null;
let prewarmedPromptText = "";
let lastPrewarmAtMs = 0;

/** 中間結果大約每 200~300ms 就來一次，而 systemPromptBuilder 一跑就是向量檢索
 * ＋記憶召回＋L2 活化更新。以前每個中間結果都無條件重跑一次，講一句五秒的話
 * 就有十幾份 prompt 在主行程裡搶 CPU——預熱本身反而成了這一輪最大的拖累。
 * 節流成最多每 700ms 一次；最終結果 (`force`) 一律放行，確保 runTurn 拿得到
 * 逐字相符的快取。 */
const PREWARM_MIN_INTERVAL_MS = 700;
/** 才剛聽到一兩個字，猜出來的 prompt 幾乎一定會被下一版蓋掉，不值得跑。 */
const PREWARM_MIN_CHARS = 4;

function schedulePrewarmPrompt(text: string, force = false): void {
  if (!systemPromptBuilder || !text.trim()) return;
  const clean = text.trim();
  if (clean === prewarmedPromptText && prewarmedPromptPromise) return;
  if (!force) {
    if (clean.length < PREWARM_MIN_CHARS) return;
    if (Date.now() - lastPrewarmAtMs < PREWARM_MIN_INTERVAL_MS) return;
  }
  lastPrewarmAtMs = Date.now();
  prewarmedPromptText = clean;
  prewarmedPromptPromise = systemPromptBuilder(clean).catch(() => "");
}

/** 创建并启动一个 ASR 流。 */
function startAsrStream(cfg: { appKey: string; accessKeyId: string; accessKeySecret: string; language: string; engine?: string }): void {
  // 舊的 socket 要 2 秒後才真的關閉，這期間仍可能送回 SentenceEnd。沒有這個
  // 世代編號的話，那句遲到的結果會蓋掉下一輪的 finalText。
  const generation = asrGeneration;
  const Stream = cfg.engine === "volcano" ? VolcanoAsrStream : AliyunAsrStream;
  const stream = new Stream(
    (text) => {
      if (generation !== asrGeneration) return;
      // 部分結果只是預覽，接在已確定的句子後面顯示才不會看起來像倒退。
      const formatted = normalizeAsrText(text);
      const combined = appendSentence(finalText, formatted);
      sendAsrResult(combined, undefined);
      schedulePrewarmPrompt(combined);
    },
    (text) => {
      if (generation !== asrGeneration) return;
      const formatted = normalizeAsrText(text);
      finalText = appendSentence(finalText, formatted);
      sendAsrResult(undefined, finalText);
      schedulePrewarmPrompt(finalText, true);
    },
    ...((Stream === AliyunAsrStream ? [(message: string) => {
      if (generation !== asrGeneration) return;
      // 有本機備援就不打擾使用者，endTurn 會自動接手；沒有的話這通電話已經
      // 聾了，必須讓畫面上看得出來。
      if (getAsrConfig()?.fallbackToLocal) {
        console.warn(LOG_PREFIX, "雲端 ASR 不可用，將改用本機 Whisper：", message);
        return;
      }
      sendError(message);
    }] : []) as [(message: string) => void] | []),
  );
  asrStream = stream;
  void stream.start(cfg.appKey, cfg.accessKeyId, cfg.accessKeySecret, cfg.language);
}

let turnAbortController: AbortController | null = null;

/** 结束本轮（VAD 静默或手動送出）：停 ASR → 跑 agent → TTS → 播放。 */
export async function endTurn(overrideText?: string): Promise<void> {
  console.log(LOG_PREFIX, "endTurn 入口: active=", active, "state=", currentState, "overrideText=", overrideText);
  if (!active || (currentState !== "LISTENING" && !overrideText)) return;
  // 打斷會把狀態打回 LISTENING，但上一輪可能還卡在 runTurn／TTS 合成裡。
  // 沒有這道鎖的話第二輪會平行進來，跑到 `++currentTurnId` 時把還在合成的
  // 第一輪整段作廢。
  if (turnInFlight) {
    console.log(LOG_PREFIX, "上一輪尚未結束，忽略這次 endTurn");
    return;
  }
  turnInFlight = true;
  try {
    await runTurn(overrideText);
  } finally {
    turnInFlight = false;
  }
}

async function runTurn(overrideText?: string): Promise<void> {
  // 這一輪的分段計時。使用者感受到的等待＝從這裡到第一段音訊送出，
  // 所以摘要在首段音訊那一刻印出來。
  const perf = createTurnPerf();
  const cfg = getAsrConfig();
  if (asrStream) await asrStream.stopAndWaitFinal();

  if (overrideText && overrideText.trim()) {
    finalText = normalizeAsrText(overrideText.trim());
    sendAsrResult(undefined, finalText);
  } else if (cfg && (cfg.engine === "local" || (!finalText.trim() && cfg.fallbackToLocal))) {
    const recorded = materializeLocalAudio();
    if (!recorded.length) {
      restartAsr();
      return;
    }
    // 錄到的只是靜音或雜訊時不要送去辨識：Whisper 遇到沒有人聲的片段不會回
    // 空字串，而是補一句訓練語料裡的字幕署名，使用者就會看到自己沒說過的話。
    if (!hasSpeechSignal(recorded)) {
      console.log(LOG_PREFIX, "本機辨識前判定沒有人聲，略過這一輪");
      restartAsr();
      return;
    }
    sendState("THINKING");
    try {
      if (cfg.engine !== "local") sendAsrResult("雲端沒有回傳結果，已切換本機 Whisper", undefined);
      // 邊講邊辨識的結果不能拿來當最終答案：它涵蓋的是「那一趟開始跑的當下」，
      // 而推論要跑近一秒，這期間使用者還在講——結尾那段永遠是沒涵蓋的。量過
      // 兩種長度的句子都一樣。所以最終還是完整跑一次，增量的價值在別處：
      // 畫面即時有字，以及 system prompt 早就預熱好了。
      const endAsr = perf.stage("asr");
      finalText = await transcribeOfflineWhisper(
        recorded,
        cfg.language === "en" ? "en" : "zh",
      );
      endAsr();
      perf.note("audio", `${Math.round(recorded.length / 32)}ms`);
      if (isWhisperHallucination(finalText)) {
        console.log(LOG_PREFIX, "本機辨識結果疑似幻覺樣板，丟棄:", finalText);
        finalText = "";
      }
      sendAsrResult(undefined, finalText);
    } catch (error) {
      sendError(`本機語音辨識失敗：${error instanceof Error ? error.message : String(error)}`);
      sendState("LISTENING");
      restartAsr();
      return;
    }
  }

  const text = finalText.trim();
  finalText = "";

  if (!text) {
    console.log(LOG_PREFIX, "endTurn 空文本，直接重启 ASR");
    sendState("LISTENING");
    restartAsr();
    return;
  }

  sendState("THINKING");

  // TTS 合成設定檢查
  const tts = ttsSettingsGetter?.();
  if (!tts || tts.ttsEngine === "off") {
    sendError("TTS 未配置：请在设置中启用 TTS 引擎");
    sendState("LISTENING");
    restartAsr();
    return;
  }

  // 引擎配置完整性检查
  if (tts.ttsEngine === "minimax" && (!tts.ttsMinimaxKey || !tts.ttsMinimaxVoiceId)) {
    sendError("TTS 未配置：请在设置中配置 MiniMax API Key 和音色 ID");
    sendState("LISTENING");
    restartAsr();
    return;
  }
  if (tts.ttsEngine === "gptsovits" && (!tts.ttsGptsovitsBaseUrl || !tts.ttsGptsovitsRefAudioPath || !tts.ttsGptsovitsPromptText)) {
    sendError("TTS 未配置：请在设置中配置 GPT-SoVITS baseUrl、参考音频和文本");
    sendState("LISTENING");
    restartAsr();
    return;
  }
  if (tts.ttsEngine === "custom-cloud" && !tts.ttsCustomCloudEndpointUrl) {
    sendError("TTS 未配置：请在设置中配置自定义云端 Endpoint URL");
    sendState("LISTENING");
    restartAsr();
    return;
  }
  if (tts.ttsEngine === "mimo" && (!tts.ttsMimoKey || !tts.ttsMimoVoiceAudioPath)) {
    sendError("TTS 未配置：请在设置中配置小米 MiMo API Key 和昔涟克隆音频");
    sendState("LISTENING");
    restartAsr();
    return;
  }

  const turnId = ++currentTurnId;
  if (turnAbortController) {
    turnAbortController.abort();
  }
  turnAbortController = new AbortController();
  const signal = turnAbortController.signal;

  try {
    // 1. 天氣快捷路徑
    if (WEATHER_REGEX.test(text) && weatherHandler) {
      const weatherReply = await weatherHandler(text);
      if (weatherReply) {
        callHistory.push({ role: "user", content: text });
        callHistory.push({ role: "assistant", content: weatherReply });
        trimCallHistory();
        await synthesizeAndStreamStaticReply(weatherReply, tts, turnId);
        return;
      }
    }

    // 2. 獲取模型配置
    const ms = modelSettingsGetter?.();
    if (!ms) throw new Error("模型配置缺失");

    const vendorConfig = { provider: ms.provider, baseUrl: ms.baseUrl, model: ms.model, apiKey: ms.apiKey };
    const configuredAdapter = getAdapterForConfig(vendorConfig);
    const isWebProvider = typeof configuredAdapter.executeWebPrompt === "function"
      && typeof configuredAdapter.buildPromptText === "function";
    const adapter = isWebProvider ? configuredAdapter : getAdapter(ms.provider);
    if (!adapter) throw new Error(`不支持的模型 provider: ${ms.provider}`);
    if (!isWebProvider && !ms.apiKey) throw new Error("模型配置缺失或未填写 API Key");

    // 3. 螢幕分享快捷路徑
    if (!isWebProvider && latestScreenFrame && shouldUseSharedScreen(text)) {
      const visualReply = await captionImage(latestScreenFrame, text, {
        baseUrl: ms.baseUrl,
        apiKey: ms.apiKey,
        model: ms.model,
      });
      if (visualReply && !visualReply.startsWith("[錯誤·")) {
        const reply = toTraditionalTaiwan(visualReply.trim());
        callHistory.push({ role: "user", content: text });
        callHistory.push({ role: "assistant", content: reply });
        trimCallHistory();
        await synthesizeAndStreamStaticReply(reply, tts, turnId);
        return;
      }
      console.warn(LOG_PREFIX, "分享畫面分析失敗，改以一般語音問題處理");
    }

    // 4. 構建 system prompt（優先使用語音聆聽期間預熱的結果）
    let systemPrompt = "";
    const endPrompt = perf.stage("prompt");
    const prewarmHit = Boolean(prewarmedPromptPromise) && prewarmedPromptText === text.trim();
    if (prewarmHit) {
      console.log(LOG_PREFIX, "[CallPrompt] 命中預熱 SystemPrompt，0ms 極速就緒");
      systemPrompt = await prewarmedPromptPromise!;
    } else {
      systemPrompt = await systemPromptBuilder?.(text) ?? "";
    }
    endPrompt();
    perf.note("prewarm", prewarmHit ? "hit" : "miss");
    perf.note("chars", Array.from(text).length);
    prewarmedPromptPromise = null;
    prewarmedPromptText = "";
    if (!active || currentTurnId !== turnId || signal.aborted) return;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...callHistory.slice(-MAX_CALL_CONTEXT_TURNS * 2),
      { role: "user", content: text },
    ];

    const callTemperature = ms.model.match(/^kimi-k2\.6(?:$|-)/i) ? undefined : 0.8;
    const chatRequest = {
      model: ms.model,
      messages,
      ...(callTemperature !== undefined ? { temperature: callTemperature } : {}),
      maxTokens: 256,
    };

    // 5. 串流生成 + 即時增量斷句 + TTS 搶先流水線
    await runStreamingLlmAndTtsPipeline({
      adapter,
      chatRequest,
      vendorConfig,
      isWebProvider,
      tts,
      turnId,
      signal,
      userText: text,
      perf,
    });
  } catch (err) {
    if (!active || currentTurnId !== turnId || signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    sendError("通话出错：" + msg);
    sendState("LISTENING");
    restartAsr();
  }
}

/** 靜態回覆（天氣、視覺分析）的切段流水線合成 */
async function synthesizeAndStreamStaticReply(
  replyText: string,
  tts: CallTtsSettings,
  turnId: number,
): Promise<void> {
  const segments = splitForEarlySpeech(replyText);
  const rawChunks = segments.length > 0 ? segments : [replyText];

  let lastMood: string | undefined = undefined;
  let lastGesture: string | undefined = undefined;
  const processedChunks: Array<{ text: string; mood?: string; gesture?: string }> = [];
  for (const chunk of rawChunks) {
    const { text, mood, gesture } = extractMoodAndCleanSegment(chunk, lastMood, lastGesture);
    if (text) {
      lastMood = mood;
      lastGesture = gesture;
      processedChunks.push({ text, mood, gesture });
    }
  }

  if (processedChunks.length === 0) {
    sendState("LISTENING");
    restartAsr();
    return;
  }

  sendState("SPEAKING");
  prewarmNextAsrStream();
  let sentAny = false;
  try {
    for (let i = 0; i < processedChunks.length; i += 1) {
      if (!active || currentTurnId !== turnId) return;
      const item = processedChunks[i];
      const result = await synthesizeByEngine(tts.ttsEngine, buildTtsPayload(tts, item.text));
      if (!active || currentTurnId !== turnId) return;
      if (result.format === "pcm") {
        throw new Error(`引擎 ${tts.ttsEngine} 回傳了無容器的 PCM，通話播放器無法播放`);
      }
      sentAny = true;
      sendTtsAudio(
        result.audio,
        i === processedChunks.length - 1,
        item.mood,
        item.gesture,
        item.text,
        result.format as CallTtsAudioFormat,
      );
    }
  } catch (ttsErr) {
    if (!active || currentTurnId !== turnId) return;
    const msg = ttsErr instanceof Error ? ttsErr.message : String(ttsErr);
    sendError("TTS 合成失败：" + msg);
    if (sentAny) {
      sendTtsAudio("", true);
    } else {
      sendState("LISTENING");
      restartAsr();
    }
  }
}

/**
 * 核心串流流水線：
 * 隨 LLM 產生的 token 即時增量斷句，第一句就緒立刻發起 TTS 合成，
 * 首段音訊就緒即時開口，同時並行合成後續段落，達到極致回話速度。
 */
async function runStreamingLlmAndTtsPipeline(params: {
  adapter: any;
  chatRequest: any;
  vendorConfig: any;
  isWebProvider: boolean;
  tts: CallTtsSettings;
  turnId: number;
  signal: AbortSignal;
  userText: string;
  perf: TurnPerf;
}): Promise<void> {
  const { adapter, chatRequest, vendorConfig, isWebProvider, tts, turnId, signal, userText, perf } = params;
  // LLM 首字：從送出 prompt 到抓到第一個 delta。網頁版 Gemini 這段包含喚醒背景
  // 視窗、等 DOM 就緒、送訊息、然後輪詢——常常是整輪最大的一塊。
  const endLlmFirst = perf.stage("llm_first");
  let sawFirstDelta = false;
  const markFirstDelta = (): void => {
    if (sawFirstDelta) return;
    sawFirstDelta = true;
    endLlmFirst();
  };
  // TTS 首段：從第一段文字排進佇列到第一段音訊真的送出去。
  let endTtsFirst: (() => void) | null = null;

  const splitter = new StreamingSentenceSplitter(34);
  let lastMood: string | undefined = undefined;

  interface TtsTask {
    text: string;
    mood?: string;
    gesture?: string;
    promise: Promise<{ audio: Buffer; format: string }>;
  }

  const ttsQueue: TtsTask[] = [];
  let isLlmCompleted = false;
  let ttsWorkerRunning = false;
  let hasSentAudio = false;
  let wakeTtsWorker: (() => void) | null = null;
  let fullAccumulatedReply = "";

  const enqueueSegment = (segmentRaw: string) => {
    const { text, mood, gesture } = extractMoodAndCleanSegment(segmentRaw, lastMood);
    if (text) {
      lastMood = mood;
      if (!endTtsFirst) endTtsFirst = perf.stage("tts_first");
      // 立即異步啟動合成（並行 Prefetch）
      console.log(LOG_PREFIX, `[Pipelined TTS] 啟動並行段落合成 (字數=${text.length}, 引擎=${tts.ttsEngine})`);
      const payload = buildTtsPayload(tts, text);
      const promise = synthesizeByEngine(tts.ttsEngine, payload);
      ttsQueue.push({ text, mood, gesture, promise });
      if (wakeTtsWorker) {
        wakeTtsWorker();
        wakeTtsWorker = null;
      }
      if (!ttsWorkerRunning) {
        void startTtsWorker();
      }
    }
  };

  const startTtsWorker = async () => {
    if (ttsWorkerRunning) return;
    ttsWorkerRunning = true;
    try {
      while (active && currentTurnId === turnId && !signal.aborted) {
        if (ttsQueue.length === 0) {
          if (isLlmCompleted) break;
          // 等待 LLM 產生下一句或串流完成
          await new Promise<void>((resolve) => {
            wakeTtsWorker = resolve;
          });
          continue;
        }

        const task = ttsQueue.shift()!;
        const result = await task.promise;
        if (!active || currentTurnId !== turnId || signal.aborted) return;

        if (result.format === "pcm") {
          throw new Error(`引擎 ${tts.ttsEngine} 回傳了無容器的 PCM，通話播放器無法播放`);
        }

        if (!hasSentAudio) {
          hasSentAudio = true;
          endTtsFirst?.();
          // 使用者感受到的等待就到這裡為止（她開始出聲）。摘要印在這一刻，
          // 才對得上「我講完之後等了多久」。
          console.log(LOG_PREFIX, `[Perf] 開口前等待 ${perf.summary()}`);
          sendState("SPEAKING");
          prewarmNextAsrStream();
        }

        const isFinal = isLlmCompleted && ttsQueue.length === 0;
        sendTtsAudio(
          result.audio,
          isFinal,
          task.mood,
          task.gesture,
          task.text,
          result.format as CallTtsAudioFormat,
        );
      }
    } catch (err) {
      if (!active || currentTurnId !== turnId || signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      sendError("TTS 合成失败：" + msg);
      if (hasSentAudio) {
        sendTtsAudio("", true);
      } else {
        sendState("LISTENING");
        restartAsr();
      }
    } finally {
      ttsWorkerRunning = false;
    }
  };

  // 執行 LLM 串流獲取
  if (isWebProvider) {
    // 開場注入完成前不能送第一句，否則 Gemini 仍在生成 prompt 的回覆，訊息會被吞。
    // 若通話跨過本機午夜，也先切一個全新的對話再送當輪內容。
    let pendingPrime = webCallPrimePromise;
    if (webCallDayKey !== localCallDayKey()) {
      const personaPrompt = typeof chatRequest.messages?.[0]?.content === "string"
        ? chatRequest.messages[0].content
        : undefined;
      pendingPrime = beginWebCallPrime(personaPrompt, "跨日輪替");
    }
    if (pendingPrime) await pendingPrime;
    if (!active || currentTurnId !== turnId || signal.aborted) return;

    // 一律交出完整 prompt，由 gemini-bridge 依「這個對話是否已經建立」決定要不要
    // 壓縮成只送最後一句（compactSharedConversationPrompt）。
    //
    // 以前這裡用 webCallInitialized 自己判斷，但那個旗標是每通電話重置的，於是
    // 每通電話都把完整人設＋最近 6 則對話重貼一次進 Gemini 的對話裡——而 Gemini
    // 網頁本身就是有狀態的聊天，那些內容它早就有了。結果是對話裡同樣的東西一再
    // 出現，而且越滾越長：每通電話多一萬多字，Gemini 每輪要重讀的上下文跟著長，
    // 首字從 3 秒漲到 9 秒，最後變成 90 秒零產出的逾時。
    //
    // 判斷「要不要重貼人設」的正確依據是對話本身的狀態（binding 的 promptVersion
    // ＋頁面上已有的回覆數），不是這通電話的輪次。那個判斷在 bridge 裡。
    const promptText = adapter.buildPromptText!(chatRequest);
    const webTimeoutMs = resolveTimeoutPolicy({ stage: "call-web-llm" }).totalMs;
    const fullText = await adapter.executeWebPrompt!(
      promptText,
      (delta: string) => {
        if (!active || currentTurnId !== turnId || signal.aborted) return;
        markFirstDelta();
        fullAccumulatedReply += delta;
        const segments = splitter.push(delta);
        for (const seg of segments) enqueueSegment(seg);
      },
      {
        signal: AbortSignal.timeout(webTimeoutMs),
        // TTS 還有段落沒消化完時，抓字抓再快也不會讓她早一秒開口——下一段語音
        // 卡在合成，不是卡在取字。而貼著輪詢的 CPU 正好是本機 TTS 在搶的。
        isDownstreamBusy: () => ttsQueue.length > 0,
      },
    );
    if (!fullAccumulatedReply && fullText) fullAccumulatedReply = fullText;
  } else {
    const request = { ...chatRequest, stream: true };
    const effectiveRequest = adapter.applyCacheHints?.(request, vendorConfig) ?? request;
    const http = adapter.buildStreamRequest ? adapter.buildStreamRequest(effectiveRequest, vendorConfig) : adapter.buildRequest(effectiveRequest, vendorConfig);

    const httpResp = await fetch(http.url, {
      method: "POST",
      headers: { ...http.headers, "Content-Type": "application/json" },
      body: http.body,
      signal,
    });

    if (!httpResp.ok) {
      const errBody = await httpResp.text().catch(() => "");
      throw new Error(`LLM 请求失败: ${httpResp.status} ${errBody.slice(0, 150)}`);
    }

    const contentType = httpResp.headers.get("content-type")?.toLowerCase() ?? "";
    if (httpResp.body && !contentType.includes("application/json")) {
      for await (const event of createSseReader(adapter, httpResp.body)) {
        if (!active || currentTurnId !== turnId || signal.aborted) break;
        const chunk = adapter.parseStreamEvent(event);
        if (chunk?.error) throw new Error(chunk.error);
        if (chunk?.deltaText) {
          markFirstDelta();
          fullAccumulatedReply += chunk.deltaText;
          const segments = splitter.push(chunk.deltaText);
          for (const seg of segments) enqueueSegment(seg);
        }
      }
    } else {
      const raw = await httpResp.json();
      const nonStreamText = adapter.parseResponse(raw).text || "";
      fullAccumulatedReply = nonStreamText;
      const segments = splitter.push(nonStreamText);
      for (const seg of segments) enqueueSegment(seg);
    }
  }

  // LLM 串流結束，排出末尾剩餘文本
  isLlmCompleted = true;
  const remainingSegments = splitter.finish();
  for (const seg of remainingSegments) {
    enqueueSegment(seg);
  }

  const wake = wakeTtsWorker as (() => void) | null;
  if (wake) {
    wake();
    wakeTtsWorker = null;
  }

  // 記錄上下文
  const cleanReply = fullAccumulatedReply.replace(/\[sticker:[^\]]+\]/g, "").trim();
  if (cleanReply) {
    callHistory.push({ role: "user", content: userText });
    callHistory.push({ role: "assistant", content: cleanReply });
    trimCallHistory();
  }

  // 若整輪都沒有有效朗讀內容且未送出任何音訊
  if (!hasSentAudio && ttsQueue.length === 0 && !ttsWorkerRunning) {
    sendError("這一輪沒有可朗讀的內容（回覆可能只有旁白或標籤）");
    sendState("LISTENING");
    restartAsr();
  }
}

/** 收到渲染端打断信号（Barge-in）：中断当前说话，重置 ASR 并进入 LISTENING。 */
export function interruptCall(): void {
  if (!active) return;
  if (currentState !== "SPEAKING" && currentState !== "THINKING") return;
  console.log(LOG_PREFIX, "收到打断信号 (Barge-in Interrupt)");
  currentTurnId += 1;
  if (turnAbortController) {
    turnAbortController.abort();
    turnAbortController = null;
  }
  resumeListening();
}

/** TTS 播完后恢复 LISTENING，重新开始 ASR。 */
export function onTtsDone(): void {
  console.log(LOG_PREFIX, `收到渲染端 CALL_TTS_DONE (state=${currentState})`);
  if (!active) return;
  resumeListening();
}

/** 下一輪的 ASR 連線是否已經接好了。 */
let asrStreamPrewarmed = false;

/** 重新开始一轮 ASR 识别。 */
function restartAsr(): void {
  asrStreamPrewarmed = false;
  lastPrewarmAtMs = 0;
  const cfg = getAsrConfig();
  if (!cfg) return;
  asrGeneration += 1;
  if (asrStream) asrStream.stop();
  finalText = "";
  resetLocalAudio();
  if ((cfg.engine === "aliyun" || cfg.engine === "volcano") && cfg.appKey && cfg.accessKeyId && cfg.accessKeySecret) {
    startAsrStream(cfg);
  }
}

/** 昔漣一開口就先把下一條 ASR 連線接起來。
 * 取 token（有快取）＋ WebSocket 握手 ＋ StartTranscription 要跑一趟上海，
 * 擺在 onTtsDone 之後就正好卡在使用者要接話的那一刻；挪到她講話期間做，這段
 * 握手完全被回覆的播放時間吃掉。期間主行程不會餵任何真實音訊進去
 * （handleAudioFrame 只在 LISTENING 轉發），engine 那邊靠靜音保活撐住連線。 */
function prewarmNextAsrStream(): void {
  if (asrStreamPrewarmed) return;
  const cfg = getAsrConfig();
  if (!cfg || cfg.engine !== "aliyun") return;
  if (!cfg.appKey || !cfg.accessKeyId || !cfg.accessKeySecret) return;
  console.log(LOG_PREFIX, "預熱下一條 ASR 連線");
  restartAsr();
  asrStreamPrewarmed = true;
}

/** 回到 LISTENING。能沿用預熱好的連線就別再握一次手。 */
function resumeListening(): void {
  sendState("LISTENING");
  if (asrStreamPrewarmed) {
    asrStreamPrewarmed = false;
    console.log(LOG_PREFIX, "沿用預熱好的 ASR 連線，省下一次握手");
    return;
  }
  restartAsr();
}

/** 挂断：清理一切。 */
export function stopCall(): void {
  active = false;
  webCallPrimeAbortController?.abort();
  webCallPrimeAbortController = null;
  webCallPrimePromise = null;
  webCallDayKey = "";
  stopCallUsage("desktop");
  currentTurnId += 1;
  if (turnAbortController) {
    turnAbortController.abort();
    turnAbortController = null;
  }
  callHistory.length = 0;
  latestScreenFrame = null;
  resetLocalAudio();
  asrGeneration += 1;
  asrStreamPrewarmed = false;
  if (asrStream) {
    asrStream.stop();
    asrStream = null;
  }
  sendState("ENDED");
}

/** 处理音频帧：转发给 ASR。 */
export function handleAudioFrame(frame: Buffer): void {
  const rawCfg = getAsrConfig();
  const cfg = rawCfg ?? { engine: "local" as const, language: "zh", fallbackToLocal: true };
  if (currentState === "LISTENING" && (cfg.engine === "local" || cfg.fallbackToLocal)) {
    const remaining = MAX_LOCAL_AUDIO_BYTES - localAudioBytes;
    if (remaining > 0) {
      const slice = frame.length <= remaining ? frame : frame.subarray(0, remaining);
      localAudioChunks.push(slice);
      localAudioBytes += slice.length;
    }
    dropSilentPreroll();
    // 使用者還在講的時候就先辨識一段：畫面即時有字，prompt 也能提早預熱。
    localTranscriber.push(localAudioBytes, materializeLocalAudio);
  }
  if (asrStream && currentState === "LISTENING") {
    asrStream.sendAudio(frame);
  }
}

/** 保存 renderer 最近取樣的一幀；null 代表停止分享。 */
export function handleScreenFrame(dataUrl: unknown): void {
  if (dataUrl === null) {
    latestScreenFrame = null;
    return;
  }
  const parsed = parseSharedScreenFrame(dataUrl);
  if (parsed) latestScreenFrame = parsed;
}

/** 注册通话 IPC handlers（main 启动时调一次）。 */
export function registerCallIpc(): void {
  ipcMain.on(IPC.CALL_START, () => startCall());
  ipcMain.on(IPC.CALL_SEND_TEXT, (_event, text: string) => void endTurn(text));
  ipcMain.on(IPC.CALL_AUDIO_FRAME, (_event, frame: ArrayBuffer) => handleAudioFrame(Buffer.from(frame)));
  ipcMain.on(IPC.CALL_SCREEN_FRAME, (_event, dataUrl: string | null) => handleScreenFrame(dataUrl));
  ipcMain.on(IPC.CALL_TURN_END, () => void endTurn());
  ipcMain.on(IPC.CALL_INTERRUPT, () => interruptCall());
  ipcMain.on(IPC.CALL_TTS_DONE, () => onTtsDone());
  ipcMain.on(IPC.CALL_STOP, () => stopCall());
}
