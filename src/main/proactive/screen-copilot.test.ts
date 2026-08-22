import { describe, expect, it } from "vitest";
import { ScreenCopilot } from "./screen-copilot";

describe("Screen Co-pilot (Visual Screen Perception & Diagnosis)", () => {
  const copilot = new ScreenCopilot();

  it("diagnoses terminal errors and generates companion advice", () => {
    const res = copilot.analyzeVisualContext({
      userQuery: "终端机这里报错了帮我看下",
      activeAppName: "iTerm2",
    });

    expect(res.scenario).toBe("terminal_error");
    expect(res.detectedIssues.length).toBeGreaterThan(0);
    expect(res.companionComment).toContain("别着急");
  });

  it("identifies UI layout and css misalignment issues", () => {
    const res = copilot.analyzeVisualContext({
      userQuery: "这个按钮跑版了样式不对",
      activeAppName: "Chrome",
    });

    expect(res.scenario).toBe("ui_layout_issue");
    expect(res.detectedIssues[0].category).toBe("layout_misalignment");
  });

  it("formats prompt context with clear recommendations", () => {
    const res = copilot.analyzeVisualContext({ userQuery: "报错分析" });
    const prompt = copilot.formatVisualAnalysisPrompt(res);

    expect(prompt).toContain("[SCREEN VISUAL CO-PILOT CONTEXT");
    expect(prompt).toContain("⚠️ 画面中检测到的具体问题:");
  });
});
