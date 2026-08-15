import { describe, it, expect, beforeEach } from "vitest";
import { SelfEditingMemoryManager } from "./self-editing-memory";

describe("SelfEditingMemoryManager", () => {
  let memory: SelfEditingMemoryManager;

  beforeEach(() => {
    memory = new SelfEditingMemoryManager();
  });

  it("updates and retrieves user preferences", () => {
    memory.updateUserPreference({
      category: "coding_style",
      key: "preferred_css",
      value: "Vanilla CSS or TailwindCSS v4",
    });

    const prefs = memory.getPreferences();
    expect(prefs).toHaveLength(1);
    expect(prefs[0].key).toBe("preferred_css");
    expect(prefs[0].value).toBe("Vanilla CSS or TailwindCSS v4");
  });

  it("archives insights and formats structured memory context", () => {
    memory.updateUserPreference({
      category: "language",
      key: "ui_language",
      value: "繁體中文 (台灣)",
    });

    memory.archiveInsight({
      topic: "架構設計",
      insight: "優先採用 LangGraph 進行多階段狀態機調度",
      tags: ["architecture", "langgraph"],
    });

    const context = memory.formatSelfEditedMemoryContext();
    expect(context).toContain("## Agent 自我更新記憶庫 (Self-Editing Memory)");
    expect(context).toContain("繁體中文 (台灣)");
    expect(context).toContain("優先採用 LangGraph 進行多階段狀態機調度");
    expect(context).toContain("[標籤: architecture, langgraph]");
  });

  it("records retired memories cleanly", () => {
    const retired = memory.retireMemory({
      memoryId: "mem_old_vue_rule",
      reason: "專案已全面遷移至 React 19",
    });

    expect(retired.memoryId).toBe("mem_old_vue_rule");
    expect(retired.reason).toContain("React 19");
  });
});
