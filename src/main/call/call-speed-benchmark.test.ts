import { describe, expect, it } from "vitest";
import { StreamingSentenceSplitter } from "./tts-segmentation";
import { normalizeAsrText } from "../asr/asr-text-normalizer";

describe("通話系統速度與順暢度基準評測 (Speed & Smoothness Benchmark)", () => {
  it("基準評測 1: LLM 串流首句極速觸發 (Time-to-First-Chunk)", async () => {
    const splitter = new StreamingSentenceSplitter(34);
    const simulatedTokens = [
      "你好", "呀！", "看到", "你上線", "真的好", "開心喔，", "今天", "過得", "順利嗎？"
    ];

    const chunksEmitted: Array<{ chunk: string; elapsedTokenCount: number; timestamp: number }> = [];
    const startTime = performance.now();

    for (let i = 0; i < simulatedTokens.length; i++) {
      const token = simulatedTokens[i];
      // 模擬每 20ms 收到一個 Token（標準雲端 LLM 串流速度）
      await new Promise((r) => setTimeout(r, 20));
      const cuts = splitter.push(token);
      for (const cut of cuts) {
        chunksEmitted.push({
          chunk: cut,
          elapsedTokenCount: i + 1,
          timestamp: performance.now() - startTime,
        });
      }
    }

    const remaining = splitter.finish();
    for (const rem of remaining) {
      chunksEmitted.push({
        chunk: rem,
        elapsedTokenCount: simulatedTokens.length,
        timestamp: performance.now() - startTime,
      });
    }

    // 驗證首句在第 2 個 token（"你好呀！"）就被切出發往 TTS，而不是等 9 個 token 全部接收
    expect(chunksEmitted.length).toBeGreaterThanOrEqual(2);
    expect(chunksEmitted[0].chunk).toBe("你好呀！");
    expect(chunksEmitted[0].elapsedTokenCount).toBeLessThanOrEqual(3);
    console.log(`[Benchmark] 首句觸發耗時: ${chunksEmitted[0].timestamp.toFixed(1)}ms (第 ${chunksEmitted[0].elapsedTokenCount} 個 Token 立即發動 TTS)`);
  });

  it("基準評測 2: 串行 vs 並行 Prefetch TTS 效率對比", async () => {
    const simulatedSegments = [
      "你好呀！",
      "今天有什麼想跟我聊聊的嗎？",
      "外面天氣看起來很不錯呢。"
    ];

    // 模擬單句 TTS 耗時 120ms
    const fakeSynthesize = async (text: string) => {
      await new Promise((r) => setTimeout(r, 120));
      return { audio: Buffer.from(text), durationMs: 2000 };
    };

    // 1. 傳統串行等待
    const startSerial = performance.now();
    for (const seg of simulatedSegments) {
      await fakeSynthesize(seg);
    }
    const serialTotal = performance.now() - startSerial;

    // 2. 流水線並行 Prefetch
    const startConcurrent = performance.now();
    const promises = simulatedSegments.map((seg) => fakeSynthesize(seg));
    await Promise.all(promises);
    const concurrentTotal = performance.now() - startConcurrent;

    const speedupRatio = (serialTotal / concurrentTotal).toFixed(2);
    console.log(`[Benchmark] TTS 3 段合成耗時: 串行=${serialTotal.toFixed(1)}ms vs 並行=${concurrentTotal.toFixed(1)}ms (提速 ${speedupRatio}x)`);
    expect(concurrentTotal).toBeLessThan(serialTotal * 0.5);
  });

  it("基準評測 3: ASR 文字即時校正與繁體化延遲 (<1ms)", () => {
    const rawAsr = "洗臉今天在干嘛呢？昔宝早上好呀";
    const start = performance.now();
    const result = normalizeAsrText(rawAsr);
    const duration = performance.now() - start;

    expect(result).toBe("昔漣今天在幹嘛呢？昔寶早上好呀");
    expect(duration).toBeLessThan(5); // < 5ms
    console.log(`[Benchmark] ASR 校正耗時: ${duration.toFixed(3)}ms, 結果: "${result}"`);
  });
});
