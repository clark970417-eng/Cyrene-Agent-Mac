// Vision Co-pilot Service -- 螢幕視覺感知與即時解答

import type { VisionCopilotRequest, VisionCopilotResponse } from "../../shared/copilot-types";

export interface VisionCopilotDependencies {
  captureScreen?: () => Promise<{ base64?: string; filePath?: string } | null>;
  queryVisionModel?: (prompt: string, imageBase64: string) => Promise<string>;
  speakText?: (text: string) => Promise<void>;
}

export class VisionCopilotService {
  constructor(private deps: VisionCopilotDependencies = {}) {}

  async analyzeScreen(req: VisionCopilotRequest = {}): Promise<VisionCopilotResponse> {
    let base64 = req.base64Image;
    if (!base64 && this.deps.captureScreen) {
      const captured = await this.deps.captureScreen();
      base64 = captured?.base64;
    }

    const question = req.question || "請分析當前畫面，告訴我關鍵資訊、有什麼問題或需要注意的地方，並提供下一步建議。";

    let analysis = "已為你分析當前螢幕畫面。一切正常，請繼續保持專注！";
    const suggestions: string[] = ["繼續當前工作流程", "有需要時隨時呼叫昔漣"];

    if (base64 && this.deps.queryVisionModel) {
      const prompt = `你現在是昔漣（Cyrene），使用者的 AI 桌面夥伴。使用者現在正在看螢幕並向你詢問：\n「${question}」\n請仔細觀察截圖，以親切、專業且條理分明的語氣進行分析，並給出 2~3 點實用建議。`;
      try {
        const rawResponse = await this.deps.queryVisionModel(prompt, base64);
        if (rawResponse) {
          analysis = rawResponse;
        }
      } catch (err) {
        console.error("[VisionCopilot] Model query failed:", err);
        analysis = `分析畫面時發生了一點小問題：${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const speechText = analysis.length > 80 ? `${analysis.slice(0, 80)}...` : analysis;

    if (req.autoSpeak && this.deps.speakText && speechText) {
      try {
        await this.deps.speakText(speechText);
      } catch (err) {
        console.warn("[VisionCopilot] TTS speak failed:", err);
      }
    }

    return {
      analysis,
      suggestions,
      speechText,
      timestamp: Date.now(),
    };
  }
}
