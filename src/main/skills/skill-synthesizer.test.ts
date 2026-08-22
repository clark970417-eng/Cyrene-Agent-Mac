import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { SkillSynthesizer } from "./skill-synthesizer";
import * as fs from "fs";

describe("Skill Synthesizer (Automated Skill Synthesis & SOP Generation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("synthesizes valid SKILL.md with YAML frontmatter and markdown sections", () => {
    const synthesizer = new SkillSynthesizer();
    const md = synthesizer.synthesizeSkillMarkdown({
      skillId: "react-refactor-sop",
      title: "React 元件重構標準 SOP",
      description: "用於處理大型 React 元件拆分與 Hooks 提取",
      triggerCondition: "當元件超過 300 行且包含多個狀態時觸發",
      toolsUsed: ["ast_grep_search", "apply_patch"],
      executionSteps: [
        "使用 ast_grep 定位重複的 JSX 區塊",
        "將邏輯抽離至自定義 Hook",
        "應用補丁並執行單元測試",
      ],
      verificationCriteria: [
        "元件行數減少 50% 以上",
        "所有既有測試皆通過",
      ],
    });

    expect(md).toContain("name: React 元件重構標準 SOP");
    expect(md).toContain("ast_grep_search");
    expect(md).toContain("## 核心執行步驟");
    expect(md).toContain("1. 使用 ast_grep 定位重複的 JSX 區塊");
  });

  it("writes synthesized skill to target learned directory", () => {
    const synthesizer = new SkillSynthesizer();
    const res = synthesizer.saveLearnedSkill(
      {
        skillId: "vite-config-setup",
        title: "Vite 配置設定",
        description: "自動配置 Vite 與 TS",
        triggerCondition: "專案初始化時",
        toolsUsed: ["write_file"],
        executionSteps: ["生成 vite.config.ts"],
        verificationCriteria: ["npm run build 成功"],
      },
      "/mock/skills",
    );

    expect(res.success).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
});
