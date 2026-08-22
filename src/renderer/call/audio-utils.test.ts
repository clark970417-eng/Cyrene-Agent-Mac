import { describe, expect, it, vi } from "vitest";
import {
  BARGE_IN_CONSECUTIVE_TICKS,
  BARGE_IN_THRESHOLD_RATIO,
  calculateDynamicVadSilenceMs,
  calculateVowelWeights,
  calibratedNoiseFloor,
  callAudioMimeType,
  collectRecognitionText,
  keepPcmWorkletAlive,
  isFatalSpeechRecognitionError,
  speechOnsetThreshold,
  speechReleaseThreshold,
  timeDomainRms,
} from "./audio-utils";

describe("call audio helpers", () => {
  it("keeps the PCM worklet connected to the live audio graph", () => {
    const connect = vi.fn();
    const destination = {} as AudioNode;

    keepPcmWorkletAlive({ connect } as unknown as Pick<AudioNode, "connect">, destination);

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(destination);
  });

  it.each([
    ["wav", "audio/wav"],
    ["mp3", "audio/mpeg"],
  ] as const)("maps %s TTS audio to %s", (format, expected) => {
    expect(callAudioMimeType(format)).toBe(expected);
  });

  it("keeps earlier final Web Speech results when a later interim result arrives", () => {
    const results = [
      { isFinal: true, 0: { transcript: "你好，" } },
      { isFinal: true, 0: { transcript: "昔漣。" } },
      { isFinal: false, 0: { transcript: "今天好嗎" } },
    ];

    expect(collectRecognitionText(results)).toEqual({
      final: "你好，昔漣。",
      interim: "今天好嗎",
      combined: "你好，昔漣。今天好嗎",
    });
  });

  it("does not let loud startup spikes dominate noise calibration", () => {
    const floor = calibratedNoiseFloor([0.021, 0.019, 0.022, 0.2, 0.31, 0.02, 0.018]);
    expect(floor).toBeCloseTo(0.02, 3);
    expect(speechOnsetThreshold(floor)).toBeGreaterThan(floor * 1.7);
    expect(speechOnsetThreshold(floor)).toBeLessThan(0.05);
    expect(speechReleaseThreshold(floor)).toBeLessThan(speechOnsetThreshold(floor));
  });

  it("calculates normalized RMS from time-domain microphone samples", () => {
    expect(timeDomainRms(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(timeDomainRms(new Uint8Array([0, 255]))).toBeGreaterThan(0.99);
  });

  it("stops retrying fatal Web Speech errors", () => {
    expect(isFatalSpeechRecognitionError("network")).toBe(true);
    expect(isFatalSpeechRecognitionError("language-not-supported")).toBe(true);
    expect(isFatalSpeechRecognitionError("no-speech")).toBe(false);
  });

  describe("calculateVowelWeights (uLipSync formant analysis)", () => {
    it("returns zero weights for silent audio", () => {
      const silence = new Uint8Array(128).fill(0);
      const result = calculateVowelWeights(silence, 44100);
      expect(result.vol).toBe(0);
      expect(result.a).toBe(0);
      expect(result.i).toBe(0);
      expect(result.u).toBe(0);
      expect(result.e).toBe(0);
      expect(result.o).toBe(0);
    });

    it("identifies /a/ vowel when mid-frequencies are prominent", () => {
      const bins = new Uint8Array(128).fill(0);
      // SampleRate 44100, binHz = 44100 / 256 = 172.2Hz
      // ~850Hz is around bin 5
      bins[4] = 200;
      bins[5] = 250;
      bins[6] = 200;
      const result = calculateVowelWeights(bins, 44100);
      expect(result.vol).toBeGreaterThan(0);
      expect(result.a).toBeGreaterThan(result.i);
    });

    it("identifies /i/ vowel when high frequencies (F2) are prominent", () => {
      const bins = new Uint8Array(128).fill(0);
      // ~350Hz is bin 2, ~2600Hz is bin 15
      bins[2] = 120;
      bins[14] = 220;
      bins[15] = 240;
      bins[16] = 220;
      const result = calculateVowelWeights(bins, 44100);
      expect(result.vol).toBeGreaterThan(0);
      expect(result.i).toBeGreaterThan(result.u);
    });
  });

  describe("barge-in sensitivity", () => {
    // 誤判一次會讓主行程放棄整輪回覆，所以門檻要遠高於一般語音起始。
    const quietRoomFloor = calibratedNoiseFloor([0.004, 0.005, 0.005, 0.006]);

    it("ignores room-level noise that clears plain speech onset", () => {
      const onset = speechOnsetThreshold(quietRoomFloor);
      const bargeIn = onset * BARGE_IN_THRESHOLD_RATIO;
      // 敲鍵盤／椅子聲大約落在 -32 dBFS，剛好越過 onset。
      const keyboardClickRms = 0.025;
      expect(keyboardClickRms).toBeGreaterThan(onset);
      expect(keyboardClickRms).toBeLessThan(bargeIn);
    });

    it("still lets a raised voice through", () => {
      const bargeIn = speechOnsetThreshold(quietRoomFloor) * BARGE_IN_THRESHOLD_RATIO;
      expect(0.08).toBeGreaterThan(bargeIn);
    });

    it("requires at least 200ms of sustained speech at a 100ms tick", () => {
      expect(BARGE_IN_CONSECUTIVE_TICKS * 100).toBeGreaterThanOrEqual(200);
    });
  });
});


describe("calculateDynamicVadSilenceMs", () => {
  it("compresses silence timeout to 200ms for quick closure words and 240ms for sentence endings", () => {
    expect(calculateDynamicVadSilenceMs("謝謝！", 500)).toBe(200);
    expect(calculateDynamicVadSilenceMs("好的", 500)).toBe(200);
    expect(calculateDynamicVadSilenceMs("今天過得好嗎？", 500)).toBe(240);
    expect(calculateDynamicVadSilenceMs("你好呀！", 500)).toBe(240);
    expect(calculateDynamicVadSilenceMs("今天辛苦了", 500)).toBe(240);
    expect(calculateDynamicVadSilenceMs("是這樣嗎", 500)).toBe(240);
    expect(calculateDynamicVadSilenceMs("好喔", 500)).toBe(200);
  });

  it("extends silence timeout to 650ms when ending in connector words to prevent early cut-off", () => {
    expect(calculateDynamicVadSilenceMs("我想一下，然後", 500)).toBe(650);
    expect(calculateDynamicVadSilenceMs("因為", 500)).toBe(650);
    expect(calculateDynamicVadSilenceMs("但是", 500)).toBe(650);
  });

  it("returns base duration for neutral sentences or empty input", () => {
    expect(calculateDynamicVadSilenceMs("音樂", 500)).toBe(500);
    expect(calculateDynamicVadSilenceMs("", 500)).toBe(500);
  });

  it("smoothly converges default baseline for longer complete speech without terminal particles", () => {
    expect(calculateDynamicVadSilenceMs("請幫我查一下明天的天氣", 1000)).toBe(550);
  });

  // 阿里雲的中間結果幾乎不帶標點，所以上面那兩條規則在真實通話裡多半都命中不了。
  // 沒有這一條，設定值調高的人每一輪都要乾等完整的基準時間才換手。
  it("tightens an over-long base once enough speech has been recognized", () => {
    expect(calculateDynamicVadSilenceMs("我今天想去看電影", 1000)).toBe(550);
    expect(calculateDynamicVadSilenceMs("我今天想去看電影", 3000)).toBe(1650);
  });

  it("keeps the full base while barely anything has been heard yet", () => {
    expect(calculateDynamicVadSilenceMs("我", 1000)).toBe(1000);
  });

  it("never tightens past a base the user deliberately kept short", () => {
    expect(calculateDynamicVadSilenceMs("我今天想去看電影", 400)).toBe(400);
  });
});
