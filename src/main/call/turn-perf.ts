// 一輪通話的分段計時。
//
// 存在的理由：這條鏈上有五、六個階段（VAD → Whisper → prompt → LLM 首字 →
// TTS 首段），每一段都可能是兩秒。光看「她想很久」推不出是哪一段——2026-08-17
// 那天連猜錯四次（冷啟動、畸形段落、併發排隊、參考音檔長度），每次都被實測打臉，
// 而真正找到的原因全是量出來的。所以直接把時間攤在 log 上。
//
// 刻意不用 perf-trace.ts：那支走 debugLog，只在 CYRENE_DEBUG_LOG=1 時才輸出，
// 正式版跑起來什麼都看不到。這裡走 console.log，一輪一行，噪音可以接受。

export interface TurnPerf {
  /** 開始一個階段，回傳結束函式。重複呼叫結束函式只計一次。 */
  stage(name: string): () => void;
  /** 附註一個鍵值（例如 prompt 有沒有命中預熱、切了幾段）。 */
  note(key: string, value: string | number): void;
  /** 從 createTurnPerf 到現在的總毫秒數。 */
  totalMs(): number;
  /** 組成一行摘要。 */
  summary(): string;
}

export function createTurnPerf(now: () => number = Date.now): TurnPerf {
  const startedAt = now();
  const stages: Array<{ name: string; ms: number }> = [];
  const notes: string[] = [];

  return {
    stage(name: string): () => void {
      const stageStart = now();
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        stages.push({ name, ms: now() - stageStart });
      };
    },
    note(key: string, value: string | number): void {
      notes.push(`${key}=${value}`);
    },
    totalMs(): number {
      return now() - startedAt;
    },
    summary(): string {
      const parts = [`total=${now() - startedAt}ms`];
      if (stages.length) parts.push(stages.map((s) => `${s.name}=${s.ms}`).join(" "));
      if (notes.length) parts.push(notes.join(" "));
      return parts.join(" | ");
    },
  };
}
