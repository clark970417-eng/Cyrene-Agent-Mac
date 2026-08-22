import { describe, expect, it } from "vitest";
import { createTurnPerf } from "./turn-perf";

/** 可控時鐘：每次呼叫回傳預先排好的時間點。 */
function fakeClock(sequence: number[]): () => number {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

describe("createTurnPerf", () => {
  it("reports each stage's duration and the turn total", () => {
    // create=0, stageA start=0, stageA end=800, stageB start=800, stageB end=820, summary now=830
    const perf = createTurnPerf(fakeClock([0, 0, 800, 800, 820, 830]));
    const endA = perf.stage("asr");
    endA();
    const endB = perf.stage("prompt");
    endB();

    expect(perf.summary()).toBe("total=830ms | asr=800 prompt=20");
  });

  it("carries notes so a stage's cost can be explained", () => {
    const perf = createTurnPerf(fakeClock([0, 0, 12, 100]));
    perf.stage("prompt")();
    perf.note("prewarm", "hit");
    perf.note("segs", 4);

    expect(perf.summary()).toBe("total=100ms | prompt=12 | prewarm=hit segs=4");
  });

  // 首段音訊送出時要記一次，輪次結束再記一次——結束函式會被呼叫兩次。
  it("ignores a repeated end call instead of double-counting the stage", () => {
    const perf = createTurnPerf(fakeClock([0, 0, 500, 9000, 9000]));
    const end = perf.stage("tts_first");
    end();
    end();

    expect(perf.summary()).toBe("total=9000ms | tts_first=500");
  });

  it("still produces a usable line when nothing was recorded", () => {
    const perf = createTurnPerf(fakeClock([0, 42]));
    expect(perf.summary()).toBe("total=42ms");
  });

  it("exposes the running total so callers can log it mid-turn", () => {
    const perf = createTurnPerf(fakeClock([0, 1500]));
    expect(perf.totalMs()).toBe(1500);
  });
});
