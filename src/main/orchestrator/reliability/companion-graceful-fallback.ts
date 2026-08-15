export type FallbackReason =
  | "network_error"
  | "timeout"
  | "rate_limit"
  | "tts_failure"
  | "provider_error"
  | "unknown";

export interface CompanionFallbackResponse {
  spokenText: string;
  expression: "confused" | "worried" | "gentle_smile" | "thinking";
  motion?: string;
  isDegraded: boolean;
  reason: FallbackReason;
  rawErrorMessage?: string;
}

export class CompanionGracefulFallback {
  /**
   * 分析錯誤物件並判定降級原因
   */
  public categorizeError(error: unknown): FallbackReason {
    if (!error) return "unknown";

    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

    if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("timed out")) {
      return "timeout";
    }
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("quota exceeded") || msg.includes("too many requests")) {
      return "rate_limit";
    }
    if (msg.includes("tts") || msg.includes("minimax") || msg.includes("synthesis failed") || msg.includes("audio error")) {
      return "tts_failure";
    }
    if (msg.includes("fetch failed") || msg.includes("network") || msg.includes("econnrefused") || msg.includes("enotfound")) {
      return "network_error";
    }
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("provider")) {
      return "provider_error";
    }

    return "unknown";
  }

  /**
   * 根據降級原因產生符合 Cyrene 陪伴人設的溫和台詞與 Live2D 狀態
   */
  public generateFallback(error: unknown): CompanionFallbackResponse {
    const reason = this.categorizeError(error);
    const rawMsg = error instanceof Error ? error.message : String(error);

    switch (reason) {
      case "timeout":
        return {
          spokenText: "唔…網路連線好像稍微花了一點時間呢。要不要稍等我一下，或是我們換個話題聊聊？",
          expression: "worried",
          motion: "head_tilt",
          isDegraded: true,
          reason,
          rawErrorMessage: rawMsg,
        };

      case "rate_limit":
        return {
          spokenText: "剛才說了好多話，思考核心稍微需要喘口氣冷卻一下呢…我們等一分鐘後再繼續好嗎？",
          expression: "gentle_smile",
          motion: "gentle_nod",
          isDegraded: true,
          reason,
          rawErrorMessage: rawMsg,
        };

      case "tts_failure":
        return {
          spokenText: "聲音傳輸模組似乎稍微遇到了點小雜訊呢，不過文字這邊一直都很通暢喔！",
          expression: "gentle_smile",
          isDegraded: true,
          reason,
          rawErrorMessage: rawMsg,
        };

      case "network_error":
        return {
          spokenText: "好像暫時連不上雲端呢…請幫我確認一下網路連線好嗎？我會一直守在這裡等你的。",
          expression: "worried",
          motion: "sad_look",
          isDegraded: true,
          reason,
          rawErrorMessage: rawMsg,
        };

      case "provider_error":
      case "unknown":
      default:
        return {
          spokenText: "抱歉…剛才思緒稍微斷線了一下下。可以請你再說一次剛才的內容嗎？這次我一定會好好接住的。",
          expression: "confused",
          motion: "apologize",
          isDegraded: true,
          reason,
          rawErrorMessage: rawMsg,
        };
    }
  }
}
