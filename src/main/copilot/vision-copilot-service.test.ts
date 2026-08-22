import { describe, expect, it, vi } from "vitest";
import { VisionCopilotService } from "./vision-copilot-service";

describe("VisionCopilotService", () => {
  it("handles screen analysis without vision model gracefully", async () => {
    const service = new VisionCopilotService();
    const result = await service.analyzeScreen({});

    expect(result.analysis).toBeDefined();
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("captures screen and queries vision model", async () => {
    const mockCapture = vi.fn().mockResolvedValue({ base64: "dummy_image_data" });
    const mockQuery = vi.fn().mockResolvedValue("我看到你正在編輯 TypeScript 程式碼，第 42 行有一個語法小錯誤喔！");
    const mockSpeak = vi.fn().mockResolvedValue(undefined);

    const service = new VisionCopilotService({
      captureScreen: mockCapture,
      queryVisionModel: mockQuery,
      speakText: mockSpeak,
    });

    const result = await service.analyzeScreen({
      question: "幫我看看哪裡有 Bug",
      autoSpeak: true,
    });

    expect(mockCapture).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalled();
    expect(result.analysis).toContain("第 42 行有一個語法小錯誤");
  });
});
