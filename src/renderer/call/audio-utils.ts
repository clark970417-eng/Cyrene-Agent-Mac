export type CallAudioFormat = "wav" | "mp3";

export interface ConnectableNode {
  connect: (destination: any) => any;
}

/**
 * AudioWorklet processors are only pulled while they belong to a live Web Audio graph.
 * The PCM processor writes no output, so this connection keeps capture alive silently.
 */
export function keepPcmWorkletAlive(
  worklet: ConnectableNode,
  destination: any,
): void {
  worklet.connect(destination);
}

export function callAudioMimeType(format: CallAudioFormat): string {
  return format === "wav" ? "audio/wav" : "audio/mpeg";
}

/** Normalized time-domain RMS (0..1), more stable for VAD than FFT-bin averages. */
export function timeDomainRms(samples: Float32Array | Uint8Array | readonly number[]): number {
  if (!samples || samples.length === 0) return 0;
  let squareSum = 0;
  if (samples instanceof Float32Array || (Array.isArray(samples) && typeof samples[0] === "number" && samples[0] <= 1.05 && samples[0] >= -1.05)) {
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      squareSum += s * s;
    }
    return Math.sqrt(squareSum / samples.length);
  }
  for (let i = 0; i < samples.length; i++) {
    const normalized = (samples[i] - 128) / 128;
    squareSum += normalized * normalized;
  }
  return Math.sqrt(squareSum / samples.length);
}

/** Use a low percentile or exponential moving average so startup clicks or a cough do not poison noise calibration. */
export function calibratedNoiseFloor(
  currentFloorOrSamples: number | readonly number[],
  currentRms?: number,
  isSpeaking?: boolean,
): number {
  if (Array.isArray(currentFloorOrSamples)) {
    if (currentFloorOrSamples.length === 0) return 0.008;
    const sorted = [...currentFloorOrSamples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.35));
    return Math.max(0.003, Math.min(0.12, sorted[index]));
  }
  const currentFloor = typeof currentFloorOrSamples === "number" ? currentFloorOrSamples : 0.005;
  if (typeof currentRms === "number" && !isSpeaking) {
    return Math.max(0.003, Math.min(0.08, currentFloor * 0.95 + Math.min(currentRms, 0.05) * 0.05));
  }
  return currentFloor;
}

export function speechOnsetThreshold(noiseFloor: number, customThreshold?: number): number {
  const base = Math.max(0.018, Math.min(0.22, Math.max(noiseFloor * 1.8, noiseFloor + 0.012)));
  if (typeof customThreshold === "number" && customThreshold > 0) {
    return Math.max(customThreshold, base);
  }
  return base;
}

export function speechReleaseThreshold(noiseFloor: number, customThreshold?: number): number {
  const base = Math.max(0.012, Math.min(0.2, Math.max(noiseFloor * 1.65, noiseFloor + 0.007)));
  if (typeof customThreshold === "number" && customThreshold > 0) {
    return Math.max(customThreshold * 0.7, base);
  }
  return base;
}

/** 已經聽到這麼多字，就算句尾沒有標點也足以判斷「這句話講完了」。 */
const SETTLED_SPEECH_MIN_CHARS = 4;

/**
 * 依據當前辨識到的說話內容語尾特徵與語意完整度，自適應動態調整靜默換手時長：
 * - 明確閉合短句/肯定感謝詞（謝謝、好的、感謝、再見、晚安、拜拜、沒事了等）或標點/疑問助詞：
 *   語意高度完整，極速壓縮至 180~250ms 迅速換手，大幅縮短等待時間。
 * - 若句尾為連接詞/轉折詞（然後、因為、但是、所以、而且、還有、以及、就是）：
 *   判斷使用者仍在思考組織，維持 650ms 以上防止被打斷。
 * - 已有完整主謂賓結構或長度足夠且非懸空句：
 *   平滑收斂至 280~350ms。
 * - 其他情況保持基準值 baseMs。
 */
export function calculateDynamicVadSilenceMs(textOrDuration?: string | number, baseMs = 500): number {
  if (typeof textOrDuration === "number") {
    if (textOrDuration > 3000) return Math.max(300, Math.round(baseMs * 0.7));
    return baseMs;
  }
  if (!textOrDuration || typeof textOrDuration !== "string") return baseMs;
  const trimmed = textOrDuration.trim();
  if (!trimmed) return baseMs;

  // 1. 極速閉合詞（常用感謝、問候、肯定答覆、簡短指令，允許帶句末標點）
  if (/(謝謝|谢谢|感謝|感谢|好的|好喔|好啊|收到|再見|再见|拜拜|晚安|沒事了|没事了|就这样|就這樣|對呀|对呀|嗯嗯|好的呢)[。！？!?~～]*$/i.test(trimmed)) {
    return Math.min(baseMs, 200);
  }

  // 2. 句尾標點或語氣助詞
  if (/[。！？!?]$/.test(trimmed) || /[嗎吧呢啊呀了喔哦啦哈耶呐嘛]$/.test(trimmed)) {
    return Math.min(baseMs, 240);
  }

  // 3. 語意懸空／連接詞（組織語言中，延長等待）
  if (/(然後|然后|因为|因為|但是|如果|不過|不过|所以|而且|還有|还有|以及|就是|我想想|那個|那个|或是|或者)[.。…~～]*$/i.test(trimmed)) {
    return Math.max(baseMs, 650);
  }

  // 4. 已有完整句子長度（>= 4 字），收斂等待時間
  if (baseMs > 400 && trimmed.length >= SETTLED_SPEECH_MIN_CHARS) {
    return Math.max(300, Math.round(baseMs * 0.55));
  }
  return baseMs;
}

/**
 * Barge-in has to clear a far higher bar than plain speech onset. A false
 * trigger does not merely cut the current sentence: the main process drops
 * every remaining segment of the reply, so the whole turn is lost silently.
 */
export const BARGE_IN_THRESHOLD_RATIO = 2;
/** VAD ticks every 100ms, so 2 consecutive hits means 200ms of real speech for responsive barge-in. */
export const BARGE_IN_CONSECUTIVE_TICKS = 2;

export function isFatalSpeechRecognitionError(error: string): boolean {
  return ["network", "not-allowed", "service-not-allowed", "language-not-supported"].includes(error);
}

type RecognitionAlternative = { transcript?: string };
type RecognitionResult = { isFinal: boolean; 0?: RecognitionAlternative };

/** Rebuild the complete continuous-recognition text, including earlier final results. */
export function collectRecognitionText(results: ArrayLike<RecognitionResult>): {
  final: string;
  interim: string;
  combined: string;
} {
  let final = "";
  let interim = "";
  for (let i = 0; i < results.length; i += 1) {
    const transcript = results[i]?.[0]?.transcript ?? "";
    if (results[i]?.isFinal) final += transcript;
    else interim += transcript;
  }
  return { final, interim, combined: final + interim };
}

export interface VowelWeights {
  a: number;
  i: number;
  u: number;
  e: number;
  o: number;
  vol: number;
}

/**
 * uLipSync-style Formant / Multi-band spectrum analysis for Japanese/Chinese vowels (A, I, U, E, O).
 * Analyzes FFT frequency bins from Web Audio AnalyserNode to calculate vowel blendshape weights.
 */
export function calculateVowelWeights(
  freqData: Uint8Array,
  sampleRate: number,
): VowelWeights {
  if (!freqData || freqData.length === 0 || sampleRate <= 0) {
    return { a: 0, i: 0, u: 0, e: 0, o: 0, vol: 0 };
  }

  const binHz = sampleRate / 2 / freqData.length;

  const getBandEnergy = (minHz: number, maxHz: number): number => {
    const startBin = Math.max(0, Math.floor(minHz / binHz));
    const endBin = Math.min(freqData.length - 1, Math.ceil(maxHz / binHz));
    if (startBin >= endBin) return freqData[startBin] / 255;
    let sum = 0;
    for (let i = startBin; i <= endBin; i++) {
      sum += freqData[i];
    }
    return sum / (endBin - startBin + 1) / 255;
  };

  // 1. Overall human speech energy (300Hz ~ 3400Hz)
  const speechEnergy = getBandEnergy(300, 3400);
  if (speechEnergy < 0.025) {
    return { a: 0, i: 0, u: 0, e: 0, o: 0, vol: 0 };
  }

  const vol = Math.min(1.0, Math.max(0, (speechEnergy - 0.02) * 3.5));

  // 2. Specific formant bands
  const bandLow = getBandEnergy(250, 450);      // ~350Hz: F1 for I, U
  const bandMidLow = getBandEnergy(450, 700);   // ~550Hz: F1 for E, O
  const bandMid = getBandEnergy(700, 1050);     // ~850Hz: F1 for A, F2 for U, O
  const bandMidHigh = getBandEnergy(1100, 1550);// ~1300Hz: F2 for A
  const bandHighMid = getBandEnergy(1600, 2100);// ~1850Hz: F2 for E
  const bandHigh = getBandEnergy(2200, 3400);   // ~2600Hz: F2 for I

  // 3. Raw scores based on acoustic formant properties
  let scoreA = bandMid * 1.3 + bandMidHigh * 1.1;
  let scoreI = bandLow * 0.7 + bandHigh * 1.6;
  let scoreU = bandLow * 1.4 + bandMid * 0.5 - bandHigh * 0.7;
  let scoreE = bandMidLow * 0.9 + bandHighMid * 1.3;
  let scoreO = bandMidLow * 1.3 + bandMid * 0.9 - bandHigh * 0.5;

  scoreA = Math.max(0, scoreA);
  scoreI = Math.max(0, scoreI);
  scoreU = Math.max(0, scoreU);
  scoreE = Math.max(0, scoreE);
  scoreO = Math.max(0, scoreO);

  const totalScore = scoreA + scoreI + scoreU + scoreE + scoreO;
  if (totalScore <= 0.0001) {
    return { a: vol * 0.6, i: 0, u: vol * 0.2, e: 0, o: 0, vol };
  }

  // Softmax-like sharpening for more distinct mouth shapes
  const power = 2.0;
  const pA = Math.pow(scoreA / totalScore, power);
  const pI = Math.pow(scoreI / totalScore, power);
  const pU = Math.pow(scoreU / totalScore, power);
  const pE = Math.pow(scoreE / totalScore, power);
  const pO = Math.pow(scoreO / totalScore, power);
  const pSum = pA + pI + pU + pE + pO || 1;

  return {
    a: (pA / pSum) * vol,
    i: (pI / pSum) * vol,
    u: (pU / pSum) * vol,
    e: (pE / pSum) * vol,
    o: (pO / pSum) * vol,
    vol,
  };
}
