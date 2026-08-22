import { narrationMoodTag } from "./narration-mood";

const SENTENCE_END = /[。！？!?；;\n]/;
const SOFT_BREAK = /[，、,：:]/;

/** 情緒／貼圖標籤要原封不動留給 call-manager 的 extractMoodAndCleanSegment 解讀。
 * 其餘方括號（模型偶爾冒出來的旁白、標記）照樣當成不該朗讀的內容刪掉。 */
const KEPT_TAG_SOURCE = "\\[(?:mood:[a-z]+|gesture:[a-z0-9_]+|sticker:[a-zA-Z0-9_-]+)\\]";
const DROPPED_BRACKET = /\[(?!mood:|gesture:|sticker:)[^\]]*\]/gi;

type Piece = { isTag: boolean; value: string };

/** 把文字切成「標籤」與「純文字」兩種片段，讓斷句只看得到純文字。 */
function tokenize(text: string): Piece[] {
  const pieces: Piece[] = [];
  const tagRegex = new RegExp(KEPT_TAG_SOURCE, "gi");
  let last = 0;
  for (let match = tagRegex.exec(text); match; match = tagRegex.exec(text)) {
    if (match.index > last) pieces.push({ isTag: false, value: text.slice(last, match.index) });
    pieces.push({ isTag: true, value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ isTag: false, value: text.slice(last) });
  return pieces;
}

/** Split long replies so GPT-SoVITS can return the first playable audio sooner. */
export function splitForEarlySpeech(text: string, maxChars = 34): string[] {
  // 旁白不朗讀，但先看一眼認不認得出情緒——認得出就換成 mood 標籤，讓她的臉
  // 至少動一下，而不是整段白白蒸發。
  const normalized = text
    .replace(/（[^）]*）/g, narrationMoodTag)
    .replace(/\([^)]*\)/g, narrationMoodTag)
    .replace(DROPPED_BRACKET, narrationMoodTag)
    .replace(/\*[^*]*\*/g, narrationMoodTag)
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let current = "";
  // 標籤不算進長度，否則 `[mood:surprised]` 這種十幾個字元會把斷句推到奇怪的位置。
  let spokenLength = 0;
  for (const piece of tokenize(normalized)) {
    if (piece.isTag) {
      current += piece.value;
      continue;
    }
    for (const char of piece.value) {
      current += char;
      spokenLength += 1;
      if (SENTENCE_END.test(char) || (spokenLength >= 18 && SOFT_BREAK.test(char)) || spokenLength >= maxChars) {
        chunks.push(current.trim());
        current = "";
        spokenLength = 0;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/** 掃描結果的一個項目。`text` 要唸出來且計入長度，`tag` 保留但不計長度，
 * `drop` 不朗讀（旁白、非語音標記）。 */
interface ScanItem {
  kind: "text" | "tag" | "drop";
  /** `drop` 的 value 通常是空字串；旁白認得出情緒時則是一個 mood 標籤。 */
  value: string;
  /** 這個項目在**原始** buffer 裡的結束位置（exclusive）。 */
  rawEnd: number;
}

/** 括號沒閉合超過這麼多字，就當它根本不是旁白——模型多半只是在講含括號的話，
 * 再等下去整段回覆都會卡在這裡不出聲。 */
const UNCLOSED_GIVE_UP_CHARS = 50;

const CLOSER_OF: Record<string, string> = { "（": "）", "(": ")", "[": "]", "*": "*" };

/**
 * 掃一遍原始 buffer，切成「要唸的字／要保留的標籤／要丟掉的旁白」，
 * 並記下每個項目在原始字串裡的結束位置。
 *
 * 為什麼要記位置：以前是先用 replace 把旁白刪光，再拿刪過的字串長度去切原始
 * buffer。兩邊長度根本對不上——刪掉幾個字，就會有幾個字被「還」回 buffer，
 * 於是已經唸過的話下一輪再唸一次，中間還夾著旁白的殘骸。
 *
 * 非 final 時遇到還沒閉合的括號就停在那裡（回傳到目前為止的項目），等更多
 * token；已經 final 就把沒閉合的部分整段丟掉——唸出「（笑」比少一句旁白難聽。
 */
function scanBuffer(buffer: string, isFinal: boolean): ScanItem[] {
  const items: ScanItem[] = [];
  const tagRegex = new RegExp(KEPT_TAG_SOURCE, "giy");
  let i = 0;

  while (i < buffer.length) {
    tagRegex.lastIndex = i;
    const tagMatch = tagRegex.exec(buffer);
    if (tagMatch) {
      i += tagMatch[0].length;
      items.push({ kind: "tag", value: tagMatch[0], rawEnd: i });
      continue;
    }

    const closer = CLOSER_OF[buffer[i]];
    if (closer) {
      const closeIdx = buffer.indexOf(closer, i + 1);
      if (closeIdx >= 0) {
        const narration = buffer.slice(i, closeIdx + closer.length);
        i = closeIdx + closer.length;
        items.push({ kind: "drop", value: narrationMoodTag(narration), rawEnd: i });
        continue;
      }
      if (isFinal) {
        items.push({ kind: "drop", value: "", rawEnd: buffer.length });
        return items;
      }
      if (buffer.length - i <= UNCLOSED_GIVE_UP_CHARS) return items;
      // 等太久了，當它是普通文字往下掃。
    }

    // 用 code point 前進，才不會把 emoji 之類的代理對切成兩半。
    const value = String.fromCodePoint(buffer.codePointAt(i)!);
    i += value.length;
    items.push({ kind: "text", value, rawEnd: i });
  }

  return items;
}

/**
 * 串流增量斷句器：
 * 隨 LLM 產生的 delta token 即時切出可朗讀的句子，
 * 特別針對首句（首個標點即切）大幅壓縮 Time-to-First-Audio 延遲。
 */
export class StreamingSentenceSplitter {
  private buffer = "";
  private isFirstSegment = true;
  private maxChars: number;

  constructor(maxChars = 34) {
    this.maxChars = maxChars;
  }

  public push(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;
    return this.drain(false);
  }

  public finish(): string[] {
    return this.drain(true);
  }

  public reset(): void {
    this.buffer = "";
    this.isFirstSegment = true;
  }

  private drain(isFinal: boolean): string[] {
    const readySegments: string[] = [];

    // 只要 buffer 裡有足夠切出完整段落的內容就循環處理
    while (this.buffer.length > 0) {
      const items = scanBuffer(this.buffer, isFinal);

      let currentSegment = "";
      let spokenLength = 0;
      /** 目前為止已經吃掉的原始字元數。切 buffer 只認這個，不認 currentSegment 的長度。 */
      let consumedRaw = 0;
      let splitRawEnd = -1;

      for (const item of items) {
        if (item.kind === "drop") {
          // 旁白不唸出來，但認得出情緒時會留下一個 mood 標籤，讓她的臉跟著動。
          // 另外它佔掉的原始字元必須跟著這一段一起消耗掉，否則下一輪會把它當成
          // 還沒處理的新內容再看一次。
          currentSegment += item.value;
          consumedRaw = item.rawEnd;
          continue;
        }
        if (item.kind === "tag") {
          currentSegment += item.value;
          consumedRaw = item.rawEnd;
          continue;
        }

        currentSegment += item.value;
        consumedRaw = item.rawEnd;
        spokenLength += 1;

        // 斷句條件：
        // 1. 遇句末標點（。！？!?；;\n）
        // 2. 第一句若字數 >= 2 且遇逗號（，、,：:），優先切段讓 TTS 極速開口（如「好喔，」「收到，」「夥伴，」）！
        // 3. 非第一句若字數 >= 18 且遇逗號
        // 4. 字數超標（第一句 10 字 / 後續 maxChars，若首句無標點也能在 10 字以內極速觸發首段合成）
        const isSentenceEnd = SENTENCE_END.test(item.value);
        const isEarlySoftBreak = this.isFirstSegment && spokenLength >= 2 && SOFT_BREAK.test(item.value);
        const isNormalSoftBreak = !this.isFirstSegment && spokenLength >= 18 && SOFT_BREAK.test(item.value);
        const isMaxLen = spokenLength >= (this.isFirstSegment ? Math.min(10, this.maxChars) : this.maxChars);

        if (isSentenceEnd || isEarlySoftBreak || isNormalSoftBreak || isMaxLen) {
          splitRawEnd = consumedRaw;
          break;
        }
      }

      if (splitRawEnd >= 0) {
        const segment = currentSegment.trim();
        if (segment) {
          readySegments.push(segment);
          this.isFirstSegment = false;
        }
        this.buffer = this.buffer.slice(splitRawEnd);
        continue;
      }

      // 沒切到：非 final 就等更多 token，final 就把剩下的一次倒出來。
      if (isFinal) {
        const tail = currentSegment.trim();
        if (tail) readySegments.push(tail);
        this.buffer = "";
      }
      break;
    }

    return readySegments.filter(Boolean);
  }
}

