import { describe, expect, it } from "vitest";
import { detectEmotionFromContext, computeAdaptiveProsody } from "./emotion-prosody-adapter";

describe("Emotion Prosody Adapter (TTS Prosody & Live2D Mood)", () => {
  it("detects tiredness and adapts prosody with softer, slower voice", () => {
    const emotion = detectEmotionFromContext("今天加班写代码好累啊");
    expect(emotion).toBe("tired");

    const prosody = computeAdaptiveProsody(emotion);
    expect(prosody.rate).toBeLessThan(1.0);
    expect(prosody.live2dMood).toBe("sleepy");
  });

  it("detects excitement and speeds up with energetic pitch", () => {
    const emotion = detectEmotionFromContext("太棒了，所有测试全部通过了！🎉");
    expect(emotion).toBe("excited");

    const prosody = computeAdaptiveProsody(emotion);
    expect(prosody.rate).toBeGreaterThan(1.0);
    expect(prosody.pitch).toBeGreaterThan(0);
    expect(prosody.live2dMood).toBe("happy");
  });
});
