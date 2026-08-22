// Skill Synthesizer -- 复杂任务 SOP 技能自动沉淀与自我进化 (Voyager / Devin Playbooks)
//
// 当 Agent 成功解决一项复杂的多步骤任务时，自动提炼执行路径、
// 工具组合与验证命令，生成合规的 SKILL.md 沉淀至技能库中。

import * as fs from "fs";
import * as path from "path";

export interface WorkflowSynthesisInput {
  skillId: string; // kebab-case
  title: string;
  description: string;
  triggerCondition: string;
  toolsUsed: string[];
  executionSteps: string[];
  verificationCriteria: string[];
}

export class SkillSynthesizer {
  /**
   * 将任务执行路径转换为标准的 SKILL.md Markdown 格式
   */
  synthesizeSkillMarkdown(input: WorkflowSynthesisInput): string {
    const yamlTools =
      input.toolsUsed.length > 0 ? input.toolsUsed.map((t) => `  - ${t}`).join("\n") : "  - none";

    const steps = input.executionSteps.map((s, idx) => `${idx + 1}. ${s}`).join("\n");
    const verifications = input.verificationCriteria.map((v) => `- [ ] ${v}`).join("\n");

    return `---
name: ${input.title}
description: ${input.description}
version: 1.0.0
tools:
${yamlTools}
---

# ${input.title} SOP 指南

## 觸發條件 (When to Use)
${input.triggerCondition}

## 核心執行步驟 (Execution Steps)
${steps}

## 成果驗證 (Verification Criteria)
${verifications}

## 注意事項 (Best Practices)
- 遵循工作區邊界安全限制。
- 修改前先進行測試或備份。
`;
  }

  /**
   * 保存新沉淀的 Skill 到本地技能目录
   */
  saveLearnedSkill(
    input: WorkflowSynthesisInput,
    skillsRootDir: string,
  ): { success: boolean; skillPath: string; error?: string } {
    try {
      const sanitizedId = input.skillId
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-");
      const targetDir = path.join(skillsRootDir, "learned", sanitizedId);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const skillPath = path.join(targetDir, "SKILL.md");
      const content = this.synthesizeSkillMarkdown(input);

      fs.writeFileSync(skillPath, content, "utf-8");

      return {
        success: true,
        skillPath,
      };
    } catch (err: any) {
      return {
        success: false,
        skillPath: "",
        error: err?.message ?? String(err),
      };
    }
  }
}

export const skillSynthesizer = new SkillSynthesizer();
