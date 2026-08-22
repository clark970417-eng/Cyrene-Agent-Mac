// 離線 Whisper 的 worker thread 宿主。
//
// transformers.js 的推論是一段同步佔滿 CPU 的純運算。跑在主行程裡等於把 event
// loop 整個卡住——通話期間那代表 IPC、音訊收框、視窗更新全部一起頓住。以前只在
// 使用者講完後跑一次，頓一下還忍得住；增量辨識要在使用者「還在講」的時候反覆跑，
// 就非搬走不可。
//
// 自宿主寫法沿用 rag/document-index-worker：同一份編譯產物既是 client 也是
// worker（`new Worker(__filename)`），不必分別處理 dev 與 asar 兩種路徑。
// @xenova/transformers 在 worker 裡載入已由 RAG 的 embedding worker 驗證過可行。

import * as os from "node:os";
import * as path from "node:path";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

const LOG_PREFIX = "[WhisperWorker]";
const MODEL_ID = "Xenova/whisper-base";

export type WhisperLanguage = "zh" | "en" | "ja" | "ko" | "de" | "fr" | "es" | "ru" | "auto";
type WhisperTimestampMode = boolean | "word";

/** transformers.js 接受完整語言名稱；auto 則省略 language，交給 Whisper 自己判斷。 */
export function whisperLanguageName(language: WhisperLanguage): string | undefined {
  switch (language) {
    case "zh": return "chinese";
    case "en": return "english";
    case "ja": return "japanese";
    case "ko": return "korean";
    case "de": return "german";
    case "fr": return "french";
    case "es": return "spanish";
    case "ru": return "russian";
    case "auto": return undefined;
  }
}

/** 帶時間戳的一段辨識結果。唱歌對齊要的是「這幾個字什麼時候被唱出來」，
 * 純文字不夠用。 */
export interface WhisperChunk {
  startMs: number;
  endMs: number;
  text: string;
}

interface WhisperDetailedResult {
  text: string;
  chunks: WhisperChunk[];
}

type InboundMessage =
  | { type: "warmup" }
  | {
      type: "transcribe";
      id: number;
      pcm: ArrayBuffer;
      language: WhisperLanguage;
      initialPrompt: string;
      /** 要不要順便回時間戳。只有唱歌對齊會開，通話辨識不需要。 */
      timestamps?: WhisperTimestampMode;
    };

type OutboundMessage =
  | { type: "progress"; message: string }
  | { type: "result"; id: number; text: string; chunks?: WhisperChunk[] }
  /** `fatal` 代表「這條 worker 根本載不動模型」（例如打包後在 asar 裡取不到
   * 原生模組），而不是單次辨識失敗。client 收到就永久改走主行程，寧可卡一下
   * 也不要整個語音辨識啞掉。 */
  | { type: "error"; id: number; reason: string; fatal?: boolean };

// ── 推論本體（worker 與主行程 fallback 共用） ──

const importEsm = new Function("moduleName", "return import(moduleName)") as (moduleName: string) => Promise<any>;
let pipelinePromise: Promise<any> | null = null;

async function getPipeline(onProgress?: (message: string) => void): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await importEsm("@xenova/transformers");
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      env.useBrowserCache = false;
      env.cacheDir = path.join(os.homedir(), ".cache", "huggingface");
      onProgress?.("首次準備離線語音模型，下載完成後會自動快取");
      return pipeline("automatic-speech-recognition", MODEL_ID, {
        quantized: true,
        progress_callback: (progress: any) => {
          if (progress?.status === "ready") onProgress?.("離線語音模型已就緒");
        },
      });
    })().catch((error) => {
      pipelinePromise = null;
      throw error;
    });
  }
  return pipelinePromise;
}

export function pcm16ToFloat32(pcm: Buffer): Float32Array {
  const sampleCount = Math.floor(pcm.length / 2);
  const audio = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = pcm.readInt16LE(i * 2);
    audio[i] = sample < 0 ? sample / 32768 : sample / 32767;
  }
  return audio;
}

/** 推論互斥鎖。
 *
 * 量過：讓兩趟推論同時跑，兩邊都會慢一倍以上（onnxruntime 會把執行緒吃滿，
 * 互相搶）。通話裡這件事會實際發生——使用者話音剛落時，邊講邊辨識的那趟常常
 * 還在跑，最終那趟就進來了，結果最該快的那一趟反而被拖成兩倍。排隊跑總時間
 * 一樣，但先進先出，等的人是背景工作而不是使用者。 */
let inferenceChain: Promise<unknown> = Promise.resolve();

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const started = inferenceChain.then(task, task);
  inferenceChain = started.then(() => undefined, () => undefined);
  return started;
}

/** transformers.js 的時間戳是「秒」，而且結尾偶爾是 null（該段被截在
 * chunk 邊界）。統一換成毫秒，收不到結尾就先留 NaN 交給呼叫端補。 */
function normalizeChunks(raw: unknown): WhisperChunk[] {
  const list = Array.isArray(raw) ? raw : [];
  const chunks: WhisperChunk[] = [];
  for (const item of list) {
    const entry = item as { timestamp?: [number | null, number | null]; text?: string };
    const text = entry.text?.trim() ?? "";
    const start = entry.timestamp?.[0];
    if (!text || typeof start !== "number" || !Number.isFinite(start)) continue;
    const end = entry.timestamp?.[1];
    chunks.push({
      startMs: Math.round(start * 1000),
      endMs: typeof end === "number" && Number.isFinite(end) ? Math.round(end * 1000) : Number.NaN,
      text,
    });
  }
  return chunks;
}

/** 真正跑一次 Whisper。回傳未經正規化的原始文字（與選用的時間戳）。 */
export async function runWhisperInlineDetailed(
  pcm: Buffer,
  language: WhisperLanguage,
  initialPrompt: string,
  timestamps: WhisperTimestampMode,
  onProgress?: (message: string) => void,
): Promise<WhisperDetailedResult> {
  const recognizer = await getPipeline(onProgress);
  return runExclusive(async () => {
    const audio = pcm16ToFloat32(pcm);
    const languageName = whisperLanguageName(language);
    const result = await recognizer(audio, {
      ...(languageName ? { language: languageName } : {}),
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(initialPrompt ? { initial_prompt: initialPrompt } : {}),
      num_beams: 1,
      temperature: 0.0,
      ...(timestamps ? { return_timestamps: timestamps } : {}),
    }) as { text?: string; chunks?: unknown };
    return { text: result.text?.trim() ?? "", chunks: timestamps ? normalizeChunks(result.chunks) : [] };
  });
}

export async function runWhisperInline(
  pcm: Buffer,
  language: WhisperLanguage,
  initialPrompt: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const result = await runWhisperInlineDetailed(pcm, language, initialPrompt, false, onProgress);
  return result.text;
}

// ── worker 端 ──

function runWorkerThread(): void {
  const port = parentPort;
  if (!port) return;
  const report = (message: string) => port.postMessage({ type: "progress", message } satisfies OutboundMessage);

  port.on("message", (message: InboundMessage) => {
    if (message.type === "warmup") {
      void getPipeline(report).catch((error) => {
        // 暖機失敗不必吵——真的要辨識時會再試一次，那時才有對象可以回報。
        console.warn(LOG_PREFIX, "模型預載失敗:", error instanceof Error ? error.message : String(error));
      });
      return;
    }
    void (async () => {
      // 模型載入和推論分開跑，才分得出「這條 worker 廢了」和「這次辨識失敗」。
      let loadFailed = false;
      try {
        await getPipeline(report);
      } catch (error) {
        loadFailed = true;
        throw error;
      }
      try {
        const pcm = Buffer.from(message.pcm);
        const result = await runWhisperInlineDetailed(
          pcm,
          message.language,
          message.initialPrompt,
          message.timestamps ?? false,
          report,
        );
        port.postMessage({
          type: "result",
          id: message.id,
          text: result.text,
          chunks: result.chunks,
        } satisfies OutboundMessage);
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { loadFailed });
      }
    })().catch((error) => {
      port.postMessage({
        type: "error",
        id: message.id,
        reason: error instanceof Error ? error.message : String(error),
        fatal: Boolean((error as { loadFailed?: boolean })?.loadFailed),
      } satisfies OutboundMessage);
    });
  });
}

if (!isMainThread) runWorkerThread();

// ── client 端 ──

interface PendingJob {
  resolve: (result: WhisperDetailedResult) => void;
  reject: (error: Error) => void;
  onProgress?: (message: string) => void;
  timestamps: WhisperTimestampMode;
  /** worker 廢掉時要拿來在主行程重跑一次的原始輸入。送去 worker 的是另一份
   * 複本（那份的 ArrayBuffer 已經轉移出去了），這份始終是完好的。 */
  pcm: Buffer;
  language: WhisperLanguage;
  initialPrompt: string;
}

let worker: Worker | null = null;
/** worker 起不來（打包環境限制、平台不支援）就永久退回主行程跑，別每次都重試一遍。 */
let workerUnavailable = false;
let nextJobId = 1;
const pendingJobs = new Map<number, PendingJob>();

function failAllPending(reason: string): void {
  const jobs = [...pendingJobs.values()];
  pendingJobs.clear();
  for (const job of jobs) job.reject(new Error(reason));
  syncWorkerRef();
}

/** 閒著的 worker 不該擋住行程結束，但手上還有工作時就必須撐住 event loop——
 * 否則宿主一沒有其他待辦事項，整個行程會在結果回來之前安靜地退出。 */
function syncWorkerRef(): void {
  if (!worker) return;
  if (pendingJobs.size > 0) worker.ref();
  else worker.unref();
}

function ensureWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  try {
    const spawned = new Worker(__filename);
    spawned.on("message", (message: OutboundMessage) => {
      if (message.type === "progress") {
        for (const job of pendingJobs.values()) job.onProgress?.(message.message);
        return;
      }
      const job = pendingJobs.get(message.id);
      if (!job) return;
      pendingJobs.delete(message.id);
      syncWorkerRef();
      if (message.type === "result") {
        job.resolve({ text: message.text, chunks: message.chunks ?? [] });
        return;
      }
      if (message.fatal) {
        // 這條 worker 載不動模型（打包環境常見的原生模組取不到）。改走主行程，
        // 並且不要再開新的 worker——每一輪都重試一次載入只會更慢。
        console.warn(LOG_PREFIX, "worker 無法載入模型，改在主行程辨識:", message.reason);
        workerUnavailable = true;
        runWhisperInlineDetailed(job.pcm, job.language, job.initialPrompt, job.timestamps, job.onProgress)
          .then(job.resolve, job.reject);
        return;
      }
      job.reject(new Error(message.reason));
    });
    spawned.on("error", (error: Error) => {
      console.warn(LOG_PREFIX, "worker 錯誤:", error.message);
      if (worker === spawned) worker = null;
      failAllPending(`離線語音辨識 worker 異常：${error.message}`);
    });
    spawned.on("exit", (code: number) => {
      if (worker === spawned) worker = null;
      if (pendingJobs.size) failAllPending(`離線語音辨識 worker 結束（code ${code}）`);
    });
    worker = spawned;
    syncWorkerRef();
    return worker;
  } catch (error) {
    console.warn(LOG_PREFIX, "無法建立 worker，改在主行程辨識:", error instanceof Error ? error.message : String(error));
    workerUnavailable = true;
    return null;
  }
}

/** 先把模型載進記憶體。第一次轉寫要多花約 6 秒載入，剛好卡在使用者講完第一句話
 * 之後最難等的位置；通話一開始就先暖起來。失敗不影響通話。 */
export function warmUpWhisper(): void {
  const active = ensureWorker();
  if (active) {
    active.postMessage({ type: "warmup" } satisfies InboundMessage);
    return;
  }
  void getPipeline().catch(() => { /* 靜默：真正要用時才需要報錯 */ });
}

/** 跑一次辨識。優先丟給 worker；worker 不可用就退回主行程，寧可卡一下也不要整條啞掉。 */
async function runWhisper(
  pcm: Buffer,
  language: WhisperLanguage,
  initialPrompt: string,
  timestamps: WhisperTimestampMode,
  onProgress?: (message: string) => void,
): Promise<WhisperDetailedResult> {
  const active = ensureWorker();
  if (!active) return runWhisperInlineDetailed(pcm, language, initialPrompt, timestamps, onProgress);

  // Buffer 背後常是共用的 pool，直接轉移會把別人的記憶體一起抽走——複製一份再轉移。
  const copy = new Uint8Array(pcm.length);
  copy.set(pcm);
  const id = nextJobId++;

  return new Promise<WhisperDetailedResult>((resolve, reject) => {
    pendingJobs.set(id, { resolve, reject, onProgress, pcm, language, initialPrompt, timestamps });
    syncWorkerRef();
    try {
      active.postMessage(
        { type: "transcribe", id, pcm: copy.buffer, language, initialPrompt, timestamps } satisfies InboundMessage,
        [copy.buffer],
      );
    } catch (error) {
      pendingJobs.delete(id);
      syncWorkerRef();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function transcribeWhisper(
  pcm: Buffer,
  language: WhisperLanguage,
  initialPrompt: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const result = await runWhisper(pcm, language, initialPrompt, false, onProgress);
  return result.text;
}

/** 唱歌對齊用：回每一小段唱詞的起訖時間。文字在唱腔下常常辨錯，但起訖時間
 * 相當可靠——嘴型要的正是後者。 */
export async function transcribeWhisperTimestamps(
  pcm: Buffer,
  language: WhisperLanguage,
  initialPrompt: string,
  onProgress?: (message: string) => void,
): Promise<WhisperChunk[]> {
  const result = await runWhisper(pcm, language, initialPrompt, "word", onProgress);
  return result.chunks;
}

// 刻意不提供「關閉 worker」的入口：模型載入要 6 秒，而微信語音、截圖辨識、通話
// 共用同一條 worker。掛斷時收掉它會打斷別人正在跑的工作，下一通還得再等一次
// 載入。閒置時 worker 是 unref 的，不會擋住行程結束。
