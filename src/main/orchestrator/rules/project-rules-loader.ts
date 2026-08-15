import fs from "node:fs";
import path from "node:path";

export interface ProjectRuleFile {
  filePath: string;
  relativeName: string;
  content: string;
  source: string;
}

export interface LoadProjectRulesOptions {
  /** 工作區目錄路徑（通常為工作區根目錄） */
  workspacePath?: string;
  /** 最大注入字符上限（防止過大規則檔撐爆 Context）預設 12,000 字元 (~3000 tokens) */
  maxChars?: number;
}

/**
 * 規則文件標準掃描清單（由高優先級至低優先級排序）
 * 1. AGENTS.md / agents.md (2025/2026 通用標準)
 * 2. .clinerules
 * 3. .cursorrules
 * 4. .github/copilot-instructions.md
 * 5. .windsurfrules
 * 6. .gemini/rules.md
 */
export const CANDIDATE_RULE_FILES = [
  "AGENTS.md",
  "agents.md",
  ".clinerules",
  ".cursorrules",
  ".github/copilot-instructions.md",
  ".windsurfrules",
  ".gemini/rules.md",
] as const;

/**
 * 掃描工作區並依優先級載入專案規則
 */
export function discoverProjectRules(options: LoadProjectRulesOptions = {}): ProjectRuleFile[] {
  const workspacePath = options.workspacePath || process.cwd();
  const maxChars = options.maxChars ?? 12000;
  const discovered: ProjectRuleFile[] = [];
  const visitedRealPaths = new Set<string>();
  let currentTotalChars = 0;

  if (!fs.existsSync(workspacePath)) {
    return discovered;
  }

  for (const candidate of CANDIDATE_RULE_FILES) {
    const fullPath = path.resolve(workspacePath, candidate);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        let realPath: string;
        try {
          realPath = fs.realpathSync.native ? fs.realpathSync.native(fullPath) : fs.realpathSync(fullPath);
        } catch {
          realPath = fullPath.toLowerCase();
        }

        if (visitedRealPaths.has(realPath)) {
          continue;
        }
        visitedRealPaths.add(realPath);

        const rawContent = fs.readFileSync(fullPath, "utf8").trim();
        if (rawContent.length > 0) {
          const remainingBudget = maxChars - currentTotalChars;
          if (remainingBudget <= 0) break;

          let truncatedContent = rawContent;
          if (rawContent.length > remainingBudget) {
            truncatedContent = rawContent.slice(0, remainingBudget) + "\n... [專案規則過長，已自動截斷]";
          }

          discovered.push({
            filePath: fullPath,
            relativeName: candidate,
            content: truncatedContent,
            source: candidate,
          });

          currentTotalChars += truncatedContent.length;
        }
      }
    } catch {
      // 忽略單一規則檔讀取錯誤
    }
  }

  return discovered;
}

/**
 * 將多個專案規則格式化為注入 System Prompt 的結構化 Markdown 區塊
 */
export function formatProjectRulesPrompt(rules: ProjectRuleFile[]): string {
  if (rules.length === 0) return "";

  const sections = rules.map((r) => {
    return `### 規範來源: ${r.relativeName}\n\`\`\`markdown\n${r.content}\n\`\`\``;
  });

  return [
    "## 專案專屬規範與指示 (Project Rules)",
    "以下為當前工作區配置的開發規範、建置指令與約定，請嚴格遵守：",
    ...sections,
  ].join("\n\n");
}
