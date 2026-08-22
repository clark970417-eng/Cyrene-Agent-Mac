// 播歌時的嘴型：只看「這一刻有沒有字在被唱」，不看音量。
//
// 通話裡的 TTS 嘴型可以拿音量來推，因為那條音軌只有她的聲音。播翻唱影片不行——
// 音軌裡混著鼓、貝斯、和聲，音量最大的地方常常是間奏。所以這裡完全不碰音訊，
// 只查主行程事先對齊好的音節時間軸：時間落在某個字上就張嘴，落在空白就閉嘴。

import type { SongLipTimeline } from "../../shared/song-types";

export interface MouthShape {
  a: number;
  i: number;
  u: number;
  e: number;
  o: number;
}

export const CLOSED_MOUTH: MouthShape = { a: 0, i: 0, u: 0, e: 0, o: 0 };

/** 張嘴、收嘴各給一點時間，免得每個字都像被開關切出來的方波。 */
const ATTACK_MS = 55;
const RELEASE_MS = 110;

/** 閉唇音：唱到這些字時嘴幾乎不開，開了反而不像。 */
const CLOSED_LIP = /[不沒沒摸抱朋閉夢風分問們麼嗎嘛沒媽命民名滅面妹每美夢忙盲]/;
/** 扁平音：嘴角拉開、開口小。 */
const FLAT = /[一七西希裡里意義機咪你妳細記息喜氣戲期its]/;
/** 大開口音。 */
const OPEN = /[啊呀啦吧哪哇哈嗨愛白開大放看喊唱亮真心天邊來海]/;
/** 圓唇音。 */
const ROUND = /[喔哦嗚我唔虎路都做走後受口手周有由夜遊]/;

/**
 * 這個字大致該擺哪個口型。
 *
 * Whisper 在唱腔下辨出的字常常是錯的，所以這裡不追求「拼音正確」——只求同一個
 * 字每次都給同一個口型，而且開口大小分佈自然。落在幾組常見字之外時，用字碼決定
 * 一個固定的母音，讓連續的字看起來有變化而不是同一張嘴開開關關。
 */
export function vowelShapeFor(char: string): MouthShape {
  if (!char) return { ...CLOSED_MOUTH };
  if (CLOSED_LIP.test(char)) return { a: 0.12, i: 0.06, u: 0.34, e: 0, o: 0.1 };
  if (FLAT.test(char)) return { a: 0.16, i: 0.62, u: 0, e: 0.24, o: 0 };
  if (OPEN.test(char)) return { a: 0.92, i: 0, u: 0, e: 0.14, o: 0.22 };
  if (ROUND.test(char)) return { a: 0.24, i: 0, u: 0.3, e: 0, o: 0.7 };

  switch (char.codePointAt(0)! % 4) {
    case 0:
      return { a: 0.7, i: 0, u: 0, e: 0.2, o: 0.16 };
    case 1:
      return { a: 0.3, i: 0.34, u: 0, e: 0.44, o: 0 };
    case 2:
      return { a: 0.34, i: 0, u: 0.18, e: 0, o: 0.56 };
    default:
      return { a: 0.5, i: 0.18, u: 0, e: 0.3, o: 0.1 };
  }
}

/** 音節內的開口包絡：起音張開、中段撐住、收尾閉合。 */
export function syllableEnvelope(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs < 0 || elapsedMs > durationMs) return 0;
  const attack = Math.min(ATTACK_MS, durationMs * 0.4);
  const release = Math.min(RELEASE_MS, durationMs * 0.45);
  if (elapsedMs < attack) return elapsedMs / attack;
  const remaining = durationMs - elapsedMs;
  if (remaining < release) return remaining / release;
  return 1;
}

/** 二分找出這個時間點落在哪個音節上；落在字與字的空隙回 -1。 */
export function syllableIndexAt(timeline: SongLipTimeline, timeMs: number): number {
  const list = timeline.syllables;
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const item = list[mid];
    if (timeMs < item.startMs) high = mid - 1;
    else if (timeMs >= item.endMs) low = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * 唱得大聲，嘴就張大一點。
 *
 * 刻意壓在 0.75~1.15 這個窄帶裡：唱歌本來就有強弱，但如果讓音量直接決定開口
 * 大小，副歌會變成大吼、主歌會小到看不出在唱。而且這個係數只在「有字在唱」
 * 的時間裡起作用，所以伴奏再大聲也影響不到她。
 */
export function loudnessScale(gain: number | undefined): number {
  if (gain === undefined || !Number.isFinite(gain)) return 1;
  return 0.75 + Math.min(1, Math.max(0, gain)) * 0.4;
}

/** 讀取隔離人聲活動包絡。v3 舊快取沒有這條資料時回 undefined，維持舊行為。 */
export function voiceActivityAt(timeline: SongLipTimeline, timeMs: number): number | undefined {
  const values = timeline.voiceActivity;
  const hopMs = timeline.voiceHopMs;
  if (!values?.length || !hopMs || hopMs <= 0) return undefined;
  const position = Math.max(0, timeMs / hopMs);
  const index = Math.min(values.length - 1, Math.floor(position));
  const next = Math.min(values.length - 1, index + 1);
  const mix = position - index;
  return values[index] * (1 - mix) + values[next] * mix;
}

/** 播到 `timeMs` 時的嘴型。沒有字在唱就是閉著。 */
export function mouthShapeAt(timeline: SongLipTimeline, timeMs: number): MouthShape {
  const voiceActivity = voiceActivityAt(timeline, timeMs);
  // v4：即使 Whisper 在間奏幻聽出字，只要隔離人聲沒有真的唱就必須閉嘴。
  if (voiceActivity !== undefined && voiceActivity < 0.08) return { ...CLOSED_MOUTH };
  const index = syllableIndexAt(timeline, timeMs);
  if (index < 0) return { ...CLOSED_MOUTH };

  const syllable = timeline.syllables[index];
  const envelope = syllableEnvelope(timeMs - syllable.startMs, syllable.endMs - syllable.startMs);
  // 真實人聲包絡比「把一句歌詞平均切字」更貼近起音與收尾；仍保留一點音節包絡，
  // 避免持續音量造成僵硬的固定開口。
  const activityGain = voiceActivity === undefined ? 1 : Math.min(1, voiceActivity * 1.35);
  const gain = Math.min(envelope, 0.3 + activityGain * 0.7) * activityGain * loudnessScale(syllable.gain);
  const shape = vowelShapeFor(syllable.char);
  return {
    a: Math.min(1, shape.a * gain),
    i: Math.min(1, shape.i * gain),
    u: Math.min(1, shape.u * gain),
    e: Math.min(1, shape.e * gain),
    o: Math.min(1, shape.o * gain),
  };
}
