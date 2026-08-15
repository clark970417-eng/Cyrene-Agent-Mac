import { describe, expect, it } from "vitest";
import { WebLlmAdapter } from "./web-llm-adapter";
import type { ProviderCapability } from "./types";

const capability: ProviderCapability = {
  id: "gemini_web",
  displayName: "Gemini Advanced (網頁版)",
  transport: "openai",
  baseUrl: "https://gemini.google.com",
  authStyle: "bearer",
  defaultModel: "Gemini Web",
  supportsTools: false,
  supportsThinking: true,
  thinkingField: null,
  cacheStrategy: "none",
  testStrategy: "text",
  supportsVision: true,
};

describe("WebLlmAdapter multimodal prompt", () => {
  it("keeps text readable and extracts Gemini image attachments", () => {
    const adapter = new WebLlmAdapter("gemini_web", capability, "gemini_web");
    const request = {
      model: "Gemini Web",
      messages: [
        { role: "system" as const, content: "維持昔漣人設" },
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "看看這張圖" },
            { type: "image_url" as const, image_url: { url: "data:image/png;base64,aGVsbG8=" } },
          ],
        },
      ],
    };

    expect(adapter.buildPromptText(request)).toContain("夥伴: 看看這張圖");
    expect(adapter.buildPromptText(request)).not.toContain("[object Object]");
    expect(adapter.getWebPromptAttachments(request)).toEqual([{
      name: "discord-image-1.png",
      mime: "image/png",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    }]);
  });
});
