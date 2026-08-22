// 邊講邊辨識：本機 Whisper 的增量排程器。
//
// 雲端 ASR 是串流的，使用者一開口就有中間結果回來，於是畫面上的字、以及
// system prompt 的預熱都能在他還在講的時候就開始跑。本機 Whisper 沒有這種東西：
// 它只能對一段完整音訊做一次性推論，所以以前整條路都得等使用者閉嘴才開始動，
// 全部串在關鍵路徑上。
//
// 這裡把「重跑整段」變成可以接受的做法：Whisper 不是串流模型，硬要增量解碼會
// 在邊界吃字，所以每一輪就老老實實把目前錄到的全部重跑一次。看似浪費，但
//   - 通話的一句話通常只有幾秒，whisper-base 量化版跑得動；
//   - 推論在 worker thread 裡，不佔主行程；
//   - 「上一輪還沒跑完就不開新的」這條規則本身就是自適應節流：機器越慢，
//     間隔自動拉得越開，不會越積越多。
//
// 收穫有兩個：畫面上即時看得到字，以及 system prompt 的預熱終於能在使用者
// 還在講的時候就開始跑（本機路徑以前完全沒有預熱）。
//
// 刻意「不」做的事：拿增量結果當最終答案。量過兩種長度的句子，增量涵蓋的是
// 「那一趟開始跑的當下」，而推論要跑近一秒，這期間使用者還在講——結尾那段
// 永遠是沒涵蓋的，省不掉最終那趟。

export interface PartialTranscript {
  text: string;
  /** 這份結果是對「前 N 個 byte」的音訊跑出來的（診斷與記錄用）。 */
  bytesCovered: number;
}

export interface IncrementalTranscriberDeps {
  /** 跑一次辨識。回傳空字串代表這段沒有值得採用的內容（靜音、幻覺樣板）。 */
  transcribe: (pcm: Buffer) => Promise<string>;
  /** 這段音訊裡有沒有人聲。純靜音送去辨識只會得到幻覺樣板。 */
  hasSpeech: (pcm: Buffer) => boolean;
  onPartial: (result: PartialTranscript) => void;
  now?: () => number;
  /** 兩次增量辨識之間至少隔這麼久（下限；實際間隔由推論耗時決定）。 */
  minIntervalMs?: number;
  /** 累積這麼多「新」音訊才值得重跑一次。16kHz/16bit → 32 byte/ms。 */
  minNewBytes?: number;
  /** 判斷「使用者是不是剛停下來」時要回看多長的音訊。 */
  recentWindowBytes?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 1_200;
/** 約 1.2 秒的新音訊。再短就只是把同一句話重跑一遍，白花 CPU。 */
const DEFAULT_MIN_NEW_BYTES = 16_000 * 2 * 1.2;
/** 回看最近 500ms。VAD 的靜默門檻是 320~600ms，用同一個量級才對得上。 */
const DEFAULT_RECENT_WINDOW_BYTES = 16_000 * 2 * 0.5;

export class IncrementalTranscriber {
  private readonly deps: Required<Pick<IncrementalTranscriberDeps, "transcribe" | "hasSpeech" | "onPartial">>
    & { now: () => number; minIntervalMs: number; minNewBytes: number; recentWindowBytes: number };

  private inFlight: Promise<void> | null = null;
  /** 上次「評估要不要跑」的時間。不論實際有沒有開工都會更新，否則使用者停下來
   * 之後每一幀都會重新併一次音訊去檢查，那本身就是 O(n) 的白工。 */
  private lastAttemptAtMs = 0;
  /** 已經送去辨識過的 byte 數（不論結果採不採用），避免對同一段音訊重複開工。 */
  private attemptedBytes = 0;
  private latestResult: PartialTranscript | null = null;
  /** reset 後遞增：還在跑的舊推論回來時直接丟掉，不會污染新的一輪。 */
  private generation = 0;

  constructor(deps: IncrementalTranscriberDeps) {
    this.deps = {
      transcribe: deps.transcribe,
      hasSpeech: deps.hasSpeech,
      onPartial: deps.onPartial,
      now: deps.now ?? (() => Date.now()),
      minIntervalMs: deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
      minNewBytes: deps.minNewBytes ?? DEFAULT_MIN_NEW_BYTES,
      recentWindowBytes: deps.recentWindowBytes ?? DEFAULT_RECENT_WINDOW_BYTES,
    };
  }

  /** 每收到一幀音訊就呼叫（20ms 一次），所以擋掉的分支必須都很便宜。
   * `materialize` 只在真的要評估時才會被呼叫——把散落的 chunk 併成一塊是
   * O(n) 的，不能每幀都做。 */
  push(totalBytes: number, materialize: () => Buffer): void {
    if (this.inFlight) return;
    if (totalBytes - this.attemptedBytes < this.deps.minNewBytes) return;
    const now = this.deps.now();
    if (now - this.lastAttemptAtMs < this.deps.minIntervalMs) return;
    this.lastAttemptAtMs = now;

    const pcm = materialize();
    if (!this.deps.hasSpeech(pcm)) {
      // 到目前為止都只有底噪。記下來，等真的有人開口再重試。
      this.attemptedBytes = pcm.length;
      return;
    }
    // 最近這半秒沒聲音＝使用者剛講完，VAD 再過幾百毫秒就要換手了。這時候開一趟
    // 增量只會排在最終那趟前面擋路——而最終那趟正是使用者在等的。
    // （量過：兩趟推論並行會雙雙慢一倍以上，所以真的不能讓它們擠在一起。）
    if (!this.deps.hasSpeech(pcm.subarray(Math.max(0, pcm.length - this.deps.recentWindowBytes)))) return;
    this.inFlight = this.run(pcm);
  }

  private async run(pcm: Buffer): Promise<void> {
    const generation = this.generation;
    const bytesCovered = pcm.length;
    try {
      const text = await this.deps.transcribe(pcm);
      if (generation !== this.generation) return;
      this.attemptedBytes = bytesCovered;
      const clean = text.trim();
      if (!clean) return;
      this.latestResult = { text: clean, bytesCovered };
      this.deps.onPartial(this.latestResult);
    } catch (error) {
      // 增量辨識失敗不影響這一輪：使用者講完時還會跑一次完整的。
      console.warn("[IncrementalASR] 增量辨識略過:", error instanceof Error ? error.message : String(error));
      if (generation === this.generation) this.attemptedBytes = bytesCovered;
    } finally {
      if (generation === this.generation) this.inFlight = null;
    }
  }

  /** 目前最新的一份增量結果；還沒有任何可用結果時為 null。 */
  get latest(): PartialTranscript | null {
    return this.latestResult;
  }

  /** 換一輪：作廢所有進行中與已完成的結果。 */
  reset(): void {
    this.generation += 1;
    this.inFlight = null;
    this.lastAttemptAtMs = 0;
    this.attemptedBytes = 0;
    this.latestResult = null;
  }
}

/**
 * 丟掉開口前多餘的靜音。
 *
 * 通話開著、使用者還沒講話的那段時間，音訊會一直往錄音緩衝堆。實測看過累積
 * 69 秒卻只辨識出 16 個字——而 Whisper 的切塊上限是 30 秒，超過就被迫切成多塊，
 * 辨識時間從 700ms 漲到 2000ms。純粹是白工。
 *
 * 只在「整段都還沒有人聲」時裁：一旦使用者開口，後面每一個 byte 都要留，
 * 寧可多算也不能吃掉他講的話。裁完保留尾端一段餘裕，免得削掉起音。
 */
export function trimSilentPreroll(
  pcm: Buffer,
  maxSilentBytes: number,
  hasSpeech: (pcm: Buffer) => boolean,
): Buffer {
  if (pcm.length <= maxSilentBytes) return pcm;
  if (hasSpeech(pcm)) return pcm;
  return pcm.subarray(pcm.length - maxSilentBytes);
}
