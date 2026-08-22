import { describe, expect, it, vi } from "vitest";
import { IncrementalTranscriber, trimSilentPreroll, type PartialTranscript } from "./incremental-transcriber";

/** 16kHz/16bit → 32 byte/ms。測試裡用毫秒描述長度比較好讀。 */
function bytesForMs(ms: number): number {
  return Math.round(16_000 * 2 * (ms / 1000));
}

interface Harness {
  transcriber: IncrementalTranscriber;
  partials: string[];
  calls: number[];
  /** 讓下一次辨識回傳什麼；預設回傳「聽到 N」。 */
  setNextText: (text: string) => void;
  resolveNext: () => void;
  advance: (ms: number) => void;
  push: (totalBytes: number) => void;
  materializeCount: () => number;
}

function makeHarness(options: { hasSpeech?: (pcm: Buffer) => boolean } = {}): Harness {
  let clock = 10_000;
  let materializations = 0;
  const partials: string[] = [];
  const calls: number[] = [];
  let nextText = "";
  let pendingResolve: (() => void) | null = null;

  const transcriber = new IncrementalTranscriber({
    transcribe: async (pcm) => {
      calls.push(pcm.length);
      await new Promise<void>((resolve) => { pendingResolve = resolve; });
      return nextText || `聽到${calls.length}`;
    },
    hasSpeech: options.hasSpeech ?? (() => true),
    onPartial: (result) => partials.push(result.text),
    now: () => clock,
    minIntervalMs: 1_200,
    minNewBytes: bytesForMs(1_200),
    recentWindowBytes: bytesForMs(500),
  });

  return {
    transcriber,
    partials,
    calls,
    setNextText: (text) => { nextText = text; },
    resolveNext: () => { const resolve = pendingResolve; pendingResolve = null; resolve?.(); },
    advance: (ms) => { clock += ms; },
    push: (totalBytes) => transcriber.push(totalBytes, () => {
      materializations += 1;
      return Buffer.alloc(totalBytes);
    }),
    materializeCount: () => materializations,
  };
}

describe("IncrementalTranscriber", () => {
  it("waits for enough new audio before spending a pass", () => {
    const h = makeHarness();

    h.push(bytesForMs(400));
    h.push(bytesForMs(900));
    expect(h.calls).toEqual([]);

    h.push(bytesForMs(1_300));
    expect(h.calls).toEqual([bytesForMs(1_300)]);
  });

  // 每來一幀就把散落的 chunk 併成一塊是 O(n)，20ms 一幀會直接吃掉主行程。
  it("does not materialize the audio on frames it is going to skip", () => {
    const h = makeHarness();

    for (let ms = 20; ms <= 1_000; ms += 20) h.push(bytesForMs(ms));

    expect(h.materializeCount()).toBe(0);
  });

  it("never runs two passes at once, so a slow machine throttles itself", async () => {
    const h = makeHarness();

    h.push(bytesForMs(1_300));
    expect(h.calls).toHaveLength(1);

    // 上一趟還沒回來，就算音訊又長了一大段也不該再開一趟。
    h.advance(5_000);
    h.push(bytesForMs(6_000));
    expect(h.calls).toHaveLength(1);

    h.resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    h.push(bytesForMs(6_000));
    expect(h.calls).toHaveLength(2);
  });

  it("surfaces each partial and keeps the newest one available", async () => {
    const h = makeHarness();

    h.setNextText("我今天");
    h.push(bytesForMs(1_300));
    h.resolveNext();
    await vi.waitFor(() => expect(h.partials).toEqual(["我今天"]));

    h.advance(1_500);
    h.setNextText("我今天想去看電影");
    h.push(bytesForMs(3_000));
    h.resolveNext();
    await vi.waitFor(() => expect(h.partials).toHaveLength(2));

    expect(h.transcriber.latest).toEqual<PartialTranscript>({
      text: "我今天想去看電影",
      bytesCovered: bytesForMs(3_000),
    });
  });

  // 純靜音餵給 Whisper 只會換來一句訓練語料的字幕署名。
  it("skips audio that carries no speech, and retries once someone speaks", () => {
    let speaking = false;
    const h = makeHarness({ hasSpeech: () => speaking });

    h.push(bytesForMs(1_300));
    expect(h.calls).toEqual([]);

    speaking = true;
    h.advance(1_500);
    h.push(bytesForMs(2_600));
    expect(h.calls).toEqual([bytesForMs(2_600)]);
  });

  // 量過：兩趟推論並行，兩邊都會慢一倍以上。使用者剛停下來時開的那趟，正好會
  // 擋在他最在意的那趟前面。
  it("does not start a pass once the user has gone quiet, since the turn is about to end", () => {
    const speechByLength = new Map<number, boolean>();
    const h = makeHarness({ hasSpeech: (pcm) => speechByLength.get(pcm.length) ?? true });

    // 整段有人聲，但最近 500ms 是靜默 → 這時候不該開工。
    speechByLength.set(bytesForMs(500), false);
    h.push(bytesForMs(3_000));
    expect(h.calls).toEqual([]);

    // 使用者又開口了，就照常跑。
    speechByLength.set(bytesForMs(500), true);
    h.advance(1_500);
    h.push(bytesForMs(4_500));
    expect(h.calls).toEqual([bytesForMs(4_500)]);
  });

  // 停下來之後每一幀都重新併一次音訊去檢查，本身就是 O(n) 的白工。
  it("re-evaluates the quiet gate at most once per interval", () => {
    const h = makeHarness({ hasSpeech: (pcm) => pcm.length !== bytesForMs(500) });

    for (let i = 0; i < 50; i += 1) h.push(bytesForMs(3_000) + i);

    expect(h.calls).toEqual([]);
    expect(h.materializeCount()).toBe(1);
  });

  it("drops results that land after a reset, so one turn never leaks into the next", async () => {
    const h = makeHarness();

    h.setNextText("上一輪的話");
    h.push(bytesForMs(1_300));
    h.transcriber.reset();
    h.resolveNext();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.partials).toEqual([]);
    expect(h.transcriber.latest).toBeNull();
  });

  it("keeps going after a failed pass instead of wedging in-flight forever", async () => {
    const failing = new IncrementalTranscriber({
      transcribe: async () => { throw new Error("模型還沒載好"); },
      hasSpeech: () => true,
      onPartial: () => { throw new Error("不該有 partial"); },
      now: () => 0,
      minIntervalMs: 0,
      minNewBytes: 1,
    });

    failing.push(100, () => Buffer.alloc(100));
    await vi.waitFor(() => expect(failing.latest).toBeNull());

    // in-flight 沒有卡住，下一次還推得動。
    let secondAttempt = false;
    const probe = new IncrementalTranscriber({
      transcribe: async () => { secondAttempt = true; return "好"; },
      hasSpeech: () => true,
      onPartial: () => { /* noop */ },
      now: () => 0,
      minIntervalMs: 0,
      minNewBytes: 1,
    });
    probe.push(100, () => Buffer.alloc(100));
    await vi.waitFor(() => expect(secondAttempt).toBe(true));
  });
});

describe("trimSilentPreroll", () => {
  const silence = () => false;
  const speech = () => true;
  const MAX = bytesForMs(3_000);

  // 實測看過錄音緩衝累積 69 秒、只辨識出 16 個字：通話開著沒人講話時音訊照堆，
  // 而 Whisper 超過 30 秒切塊上限就被迫切成多塊，辨識從 700ms 漲到 2000ms。
  it("drops the dead air that piled up before anyone spoke", () => {
    const pcm = Buffer.alloc(bytesForMs(69_000));
    const trimmed = trimSilentPreroll(pcm, MAX, silence);
    expect(trimmed.length).toBe(MAX);
  });

  // 一旦使用者開口，後面每個 byte 都要留——寧可多算也不能吃掉他講的話。
  it("keeps everything once the buffer contains speech", () => {
    const pcm = Buffer.alloc(bytesForMs(69_000));
    expect(trimSilentPreroll(pcm, MAX, speech)).toBe(pcm);
  });

  it("leaves a short buffer alone regardless of content", () => {
    const pcm = Buffer.alloc(bytesForMs(1_000));
    expect(trimSilentPreroll(pcm, MAX, silence)).toBe(pcm);
  });

  // 保留的是尾端，不是開頭：使用者要開口的那一刻在最後面。
  it("keeps the newest audio, not the oldest", () => {
    const pcm = Buffer.alloc(bytesForMs(10_000));
    pcm[pcm.length - 2] = 0x7f;   // 尾端做記號
    const trimmed = trimSilentPreroll(pcm, MAX, silence);
    expect(trimmed[trimmed.length - 2]).toBe(0x7f);
  });
});
