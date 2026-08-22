import { describe, expect, it, vi } from "vitest";

vi.mock("@ant-design/x", () => ({
  Bubble: { List: () => null },
  CodeHighlighter: () => null,
  Think: () => null,
  ThoughtChain: () => null,
}));
vi.mock("@ant-design/x-markdown", () => ({ XMarkdown: () => null }));
vi.mock("@ant-design/x-markdown/plugins/Latex", () => ({ default: () => ({}) }));
vi.mock("../../../../../shared/renderer-base", () => ({ resolveAsset: (path: string) => path }));

import { createMessageItems, splitGroupAssistantContent, type ChatMessageItem } from "./ChatMessageList";
import { extractMessageStickerId, stripMessageStickerMarkers } from "./message-sticker";

describe("React chat sticker messages", () => {
  it("extracts a persisted user sticker marker and hides the raw marker", () => {
    expect(extractMessageStickerId("[sticker:hugtight]")).toBe("hugtight");
    expect(stripMessageStickerMarkers("[sticker:hugtight]")).toBe("");
  });

  it("keeps user text while removing only its sticker marker", () => {
    expect(stripMessageStickerMarkers("给你一个 [sticker:hugtight]")).toBe("给你一个");
  });
});

describe("React Code run messages", () => {
  it("places a deterministic verification result in the assistant timeline", () => {
    const message = {
      id: "assistant-code-1",
      role: "assistant",
      content: "任务已完成。",
      responseStarted: true,
      codeRun: {
        run: null,
        approval: null,
        card: {
          runId: "run-1",
          status: "completed_verified",
          workspaceRoot: "C:\\repo",
          mutations: { created: [], modified: ["src/a.ts"], deleted: [], touchedPreExisting: [] },
          verification: { status: "passed", steps: [] },
          warnings: [],
        },
      },
    } as ChatMessageItem & { codeRun: unknown };

    const items = createMessageItems([message], []);

    expect(items.map((item) => item.role)).toContain("codeRun");
  });
});

describe("multi-agent message bubbles", () => {
  const characters = [
    { id: "a", name: "甲", avatarUrl: "a.png" },
    { id: "b", name: "乙", avatarUrl: "b.png" },
    { id: "c", name: "丙", avatarUrl: "c.png" },
  ];

  it("splits one persisted group response into one bubble per speaker", () => {
    const content = "### 甲\n\n第一個觀點\n\n### 乙\n\n第二個觀點\n\n### 丙\n\n第三個觀點";
    expect(splitGroupAssistantContent(content, characters)).toEqual([
      { characterIndex: 0, name: "甲", content: "### 甲\n\n第一個觀點" },
      { characterIndex: 1, name: "乙", content: "### 乙\n\n第二個觀點" },
      { characterIndex: 2, name: "丙", content: "### 丙\n\n第三個觀點" },
    ]);

    const items = createMessageItems([{
      id: "group-reply",
      role: "assistant",
      content,
      responseStarted: true,
    }], [], characters);
    expect(items.map((item) => item.role)).toEqual([
      "assistant-group-0", "assistant-group-1", "assistant-group-2",
    ]);
  });
});
