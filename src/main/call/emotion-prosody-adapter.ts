// Emotion Prosody Adapter -- 情绪感知与 TTS 语调/语速自适应调节器
//
// 依据用户意图与对话情绪（疲惫、兴奋、专注、安慰），动态微调
// TTS 输出参数（Rate 语速、Pitch 音调、Volume 音量）与 Live2D 情绪映射。

export type DetectedEmotion = "tired" | "excited" | "focused" | "comforting" | "neutral";

export interface ProsodyParameters {
  rate: number; // 0.5 - 2.0, 默认 1.0
  pitch: number; // -10 到 +10, 默认 0
  volume: number; // 0.0 - 1.0, 默认 1.0
  live2dMood: "happy" | "thinking" | "focused" | "sleepy" | "greeting";
}

export function detectEmotionFromContext(text: string): DetectedEmotion {
  const lower = text.toLowerCase();

  if (/好累|好困|头疼|加班|写不完|疲倦|休息|失眠/i.test(lower)) {
    return "tired";
  }

  if (/太棒了|成功了|开心|哈哈|牛逼|好耶|🎉|🚀/i.test(lower)) {
    return "excited";
  }

  if (/别难过|抱抱|安慰|没事|摸摸头|心疼/i.test(lower)) {
    return "comforting";
  }

  if (/认真|专心|算法|架构|重构|数学|论文|debug/i.test(lower)) {
    return "focused";
  }

  return "neutral";
}

export function computeAdaptiveProsody(emotion: DetectedEmotion): ProsodyParameters {
  switch (emotion) {
    case "tired":
      return {
        rate: 0.9,
        pitch: -1,
        volume: 0.85,
        live2dMood: "sleepy",
      };

    case "excited":
      return {
        rate: 1.15,
        pitch: 2,
        volume: 1.0,
        live2dMood: "happy",
      };

    case "comforting":
      return {
        rate: 0.88,
        pitch: -0.5,
        volume: 0.9,
        live2dMood: "greeting",
      };

    case "focused":
      return {
        rate: 1.0,
        pitch: 0,
        volume: 0.95,
        live2dMood: "focused",
      };

    default:
      return {
        rate: 1.0,
        pitch: 0,
        volume: 1.0,
        live2dMood: "greeting",
      };
  }
}
