import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  discoverProjectRules,
  formatProjectRulesPrompt,
  CANDIDATE_RULE_FILES,
} from "./project-rules-loader";

describe("project-rules-loader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty array if no rule files exist", () => {
    const rules = discoverProjectRules({ workspacePath: tempDir });
    expect(rules).toEqual([]);
    expect(formatProjectRulesPrompt(rules)).toBe("");
  });

  it("discovers AGENTS.md with highest priority and formats properly", () => {
    const agentsPath = path.join(tempDir, "AGENTS.md");
    fs.writeFileSync(agentsPath, "Always run `npm test` before committing.");

    const rules = discoverProjectRules({ workspacePath: tempDir });
    expect(rules).toHaveLength(1);
    expect(rules[0].relativeName).toBe("AGENTS.md");
    expect(rules[0].content).toContain("Always run `npm test`");

    const prompt = formatProjectRulesPrompt(rules);
    expect(prompt).toContain("## 專案專屬規範與指示 (Project Rules)");
    expect(prompt).toContain("### 規範來源: AGENTS.md");
    expect(prompt).toContain("Always run `npm test` before committing.");
  });

  it("preserves priority order when multiple rule files exist", () => {
    fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "Rule 1 from AGENTS.md");
    fs.writeFileSync(path.join(tempDir, ".cursorrules"), "Rule 2 from cursorrules");

    const rules = discoverProjectRules({ workspacePath: tempDir });
    expect(rules).toHaveLength(2);
    expect(rules[0].relativeName).toBe("AGENTS.md");
    expect(rules[1].relativeName).toBe(".cursorrules");
  });

  it("enforces maxChars limit to prevent token blowup", () => {
    const longContent = "A".repeat(500);
    fs.writeFileSync(path.join(tempDir, "AGENTS.md"), longContent);

    const rules = discoverProjectRules({ workspacePath: tempDir, maxChars: 100 });
    expect(rules).toHaveLength(1);
    expect(rules[0].content.length).toBeLessThan(200);
    expect(rules[0].content).toContain("已自動截斷");
  });
});
