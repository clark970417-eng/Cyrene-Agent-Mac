export type LoopType = "identical_consecutive" | "ping_pong" | "repeated_errors";

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown> | string;
  error?: string | null;
  timestamp?: number;
}

export interface LoopDetectionResult {
  isLoop: boolean;
  loopType?: LoopType;
  consecutiveCount?: number;
  message?: string;
  suggestion?: string;
  shouldAbort: boolean;
}

export interface LoopDetectorOptions {
  /** 連續相同呼叫觸發警戒/熔斷次數，預設 3 */
  maxIdenticalConsecutive?: number;
  /** 乒乓循環重複次數 (A-B-A-B-A-B 即 3 組)，預設 3 */
  maxPingPongRepeats?: number;
  /** 連續重複錯誤觸發次數，預設 3 */
  maxConsecutiveErrors?: number;
  /** 滑動窗口大小，預設 12 */
  windowSize?: number;
}

/**
 * 深度排序 Object keys 生成確定性簽名
 */
export function generateCallSignature(toolName: string, args: Record<string, unknown> | string): string {
  const normalize = (val: unknown): unknown => {
    if (val === null || val === undefined) return val;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (typeof parsed === "object" && parsed !== null) {
          return normalize(parsed);
        }
      } catch {
        return val.trim();
      }
      return val.trim();
    }
    if (Array.isArray(val)) {
      return val.map(normalize);
    }
    if (typeof val === "object") {
      const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
      const res: Record<string, unknown> = {};
      for (const k of sortedKeys) {
        res[k] = normalize((val as Record<string, unknown>)[k]);
      }
      return res;
    }
    return val;
  };

  const normalizedArgs = normalize(args);
  return `${toolName}::${JSON.stringify(normalizedArgs)}`;
}

export class LoopDetector {
  private history: ToolCallRecord[] = [];
  private signatures: string[] = [];
  private readonly options: Required<LoopDetectorOptions>;

  constructor(options: LoopDetectorOptions = {}) {
    this.options = {
      maxIdenticalConsecutive: options.maxIdenticalConsecutive ?? 3,
      maxPingPongRepeats: options.maxPingPongRepeats ?? 3,
      maxConsecutiveErrors: options.maxConsecutiveErrors ?? 3,
      windowSize: options.windowSize ?? 12,
    };
  }

  /**
   * 記錄一次工具呼叫並檢測是否陷入死循環
   */
  public recordAndCheck(call: ToolCallRecord): LoopDetectionResult {
    const signature = generateCallSignature(call.toolName, call.args);
    this.history.push({ ...call, timestamp: call.timestamp ?? Date.now() });
    this.signatures.push(signature);

    if (this.history.length > this.options.windowSize) {
      this.history.shift();
      this.signatures.shift();
    }

    // 1. 檢測連續相同呼叫 (Identical Consecutive Calls)
    const identicalResult = this.checkIdenticalConsecutive();
    if (identicalResult.isLoop) return identicalResult;

    // 2. 檢測乒乓擺盪循環 (Ping-Pong Loop A-B-A-B-A-B)
    const pingPongResult = this.checkPingPong();
    if (pingPongResult.isLoop) return pingPongResult;

    // 3. 檢測連續重複錯誤 (Repeated Errors)
    const errorResult = this.checkConsecutiveErrors();
    if (errorResult.isLoop) return errorResult;

    return { isLoop: false, shouldAbort: false };
  }

  private checkIdenticalConsecutive(): LoopDetectionResult {
    const threshold = this.options.maxIdenticalConsecutive;
    const len = this.signatures.length;
    if (len < threshold) return { isLoop: false, shouldAbort: false };

    const lastSig = this.signatures[len - 1];
    let count = 0;
    for (let i = len - 1; i >= 0; i--) {
      if (this.signatures[i] === lastSig) {
        count++;
      } else {
        break;
      }
    }

    if (count >= threshold) {
      const toolName = this.history[this.history.length - 1].toolName;
      return {
        isLoop: true,
        loopType: "identical_consecutive",
        consecutiveCount: count,
        message: `偵測到連續 ${count} 次完全相同的工具呼叫: [${toolName}]`,
        suggestion: `請勿重複發送完全相同的參數。請評估先前的輸出結果，切換解決策略或向使用者尋求指引。`,
        shouldAbort: true,
      };
    }

    return { isLoop: false, shouldAbort: false };
  }

  private checkPingPong(): LoopDetectionResult {
    const repeats = this.options.maxPingPongRepeats;
    const requiredLength = repeats * 2;
    const len = this.signatures.length;
    if (len < requiredLength) return { isLoop: false, shouldAbort: false };

    const recent = this.signatures.slice(len - requiredLength);
    const sigA = recent[0];
    const sigB = recent[1];

    if (sigA === sigB) return { isLoop: false, shouldAbort: false };

    let isPingPong = true;
    for (let i = 0; i < requiredLength; i++) {
      const expected = i % 2 === 0 ? sigA : sigB;
      if (recent[i] !== expected) {
        isPingPong = false;
        break;
      }
    }

    if (isPingPong) {
      return {
        isLoop: true,
        loopType: "ping_pong",
        consecutiveCount: repeats,
        message: `偵測到在兩個工具呼叫之間乒乓擺盪循環 (已重複 ${repeats} 輪)`,
        suggestion: `目前的兩步循環未能取得進展，請跳出當前操作模式或直接整合現有結果。`,
        shouldAbort: true,
      };
    }

    return { isLoop: false, shouldAbort: false };
  }

  private checkConsecutiveErrors(): LoopDetectionResult {
    const threshold = this.options.maxConsecutiveErrors;
    const len = this.history.length;
    if (len < threshold) return { isLoop: false, shouldAbort: false };

    const recent = this.history.slice(len - threshold);
    const allErrored = recent.every((r) => typeof r.error === "string" && r.error.trim().length > 0);

    if (allErrored) {
      return {
        isLoop: true,
        loopType: "repeated_errors",
        consecutiveCount: threshold,
        message: `偵測到連續 ${threshold} 次工具執行失敗`,
        suggestion: `連續工具呼叫發生錯誤。請勿盲目重試，請詳細分析錯誤訊息並修正參數。`,
        shouldAbort: false, // 報錯時給予注入提示讓其嘗試自我修復，若再失敗由外層熔斷
      };
    }

    return { isLoop: false, shouldAbort: false };
  }

  public reset(): void {
    this.history = [];
    this.signatures = [];
  }
}
