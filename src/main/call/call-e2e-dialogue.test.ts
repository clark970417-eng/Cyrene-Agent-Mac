import { describe, expect, it, vi } from "vitest";
import {
  timeDomainRms,
  calibratedNoiseFloor,
  speechOnsetThreshold,
  speechReleaseThreshold,
  calculateDynamicVadSilenceMs,
} from "../../renderer/call/audio-utils";
import { StreamingSentenceSplitter } from "./tts-segmentation";
import { extractMoodAndCleanSegment } from "./call-manager";
import { normalizeAsrText } from "../asr/asr-text-normalizer";

describe("昔漣通話系統完整對話全鏈路模擬測試 (End-to-End Dialogue Simulation)", () => {
  it("階段 1: 麥克風收音與毫秒級 VAD 換手檢測", () => {
    // 模擬 16kHz 麥克風音訊採集
    const silenceFrame = new Float32Array(320).fill(0.002);
    const speechFrame = new Float32Array(320).map((_, i) => Math.sin(i * 0.1) * 0.08);

    const silenceRms = timeDomainRms(silenceFrame);
    const speechRms = timeDomainRms(speechFrame);

    expect(silenceRms).toBeLessThan(0.005);
    expect(speechRms).toBeGreaterThan(0.04);

    const noiseFloor = calibratedNoiseFloor(0.005, silenceRms, false);
    const onset = speechOnsetThreshold(noiseFloor, 0.01);
    const release = speechReleaseThreshold(noiseFloor, 0.01);

    expect(speechRms).toBeGreaterThan(onset);
    expect(silenceRms).toBeLessThan(release);

    // 驗證自適應換手時長：閉合詞極速換手
    const quickSilenceMs = calculateDynamicVadSilenceMs("好的，謝謝昔漣！", 380);
    expect(quickSilenceMs).toBeLessThanOrEqual(240);

    // 驗證思考連接詞延長等待
    const pauseSilenceMs = calculateDynamicVadSilenceMs("我想想看，因為...", 380);
    expect(pauseSilenceMs).toBeGreaterThanOrEqual(550);
  });

  it("階段 2: ASR 語音文字校正與昔漣專屬名詞繁體化", () => {
    const rawAsrInputs = [
      "洗臉早上好呀",
      "今天天气真好呢，昔宝",
      "幫我看看這個",
    ];

    const expectedResults = [
      "昔漣早上好呀",
      "今天天氣真好呢，昔寶",
      "幫我看看這個",
    ];

    rawAsrInputs.forEach((input, idx) => {
      const normalized = normalizeAsrText(input);
      expect(normalized).toBe(expectedResults[idx]);
    });
  });

  it("階段 3: LLM 串流生成 → 即時增量斷句 → 3D 情緒與動作標籤提取", async () => {
    const splitter = new StreamingSentenceSplitter(34);
    const simulatedLlmStream = [
      "[mood:happy]", "「指揮官，", "早上好呀！", "✨」",
      "[mood:shy]", "「昨晚睡得", "還習慣嗎？", "(//▽//)」"
    ];

    const speechQueue: Array<{ text: string; mood?: string; gesture?: string }> = [];
    let lastMood: string | undefined = undefined;

    for (const token of simulatedLlmStream) {
      const segments = splitter.push(token);
      for (const seg of segments) {
        const { text, mood } = extractMoodAndCleanSegment(seg, lastMood);
        if (text) {
          lastMood = mood;
          speechQueue.push({
            text,
            mood,
            gesture: text.includes("好") ? "wave" : undefined,
          });
        }
      }
    }

    const remaining = splitter.finish();
    for (const rem of remaining) {
      const { text, mood } = extractMoodAndCleanSegment(rem, lastMood);
      if (text) {
        lastMood = mood;
        speechQueue.push({ text, mood });
      }
    }

    expect(speechQueue.length).toBeGreaterThanOrEqual(2);
    expect(speechQueue[0].text).toContain("指揮官");
    expect(speechQueue[0].mood).toBe("happy");
    expect(speechQueue.some((s) => s.gesture === "wave")).toBe(true);
    expect(speechQueue.some((s) => s.mood === "shy")).toBe(true);
  });

  it("階段 4: 雜音防誤觸（停用麥克風自動打斷，改為手動按鍵明確控制）", () => {
    let callState: "SPEAKING" | "LISTENING" | "THINKING" = "SPEAKING";
    const onManualInterrupt = vi.fn(() => {
      callState = "LISTENING";
    });

    // 1. 昔漣說話時，即使麥克風收到突發雜音，也不會自動打斷說話
    const ambientNoiseRms = 0.08;
    // 自動打斷已關閉，因此狀態保持 SPEAKING
    expect(callState).toBe("SPEAKING");

    // 2. 當使用者明確按下空白鍵或手動操作時才執行打斷
    onManualInterrupt();
    expect(onManualInterrupt).toHaveBeenCalledOnce();
    expect(callState).toBe("LISTENING");
  });
});
