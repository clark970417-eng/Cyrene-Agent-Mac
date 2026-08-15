import { describe, it, expect, beforeEach } from "vitest";
import { RoleOrchestrator, ROLE_PROFILES } from "./role-orchestrator";

describe("RoleOrchestrator", () => {
  let orchestrator: RoleOrchestrator;

  beforeEach(() => {
    orchestrator = new RoleOrchestrator();
  });

  it("provides valid profiles for all 4 subagent roles", () => {
    expect(ROLE_PROFILES.Architect.role).toBe("Architect");
    expect(ROLE_PROFILES.Coder.role).toBe("Coder");
    expect(ROLE_PROFILES.Reviewer.role).toBe("Reviewer");
    expect(ROLE_PROFILES.Researcher.role).toBe("Researcher");
  });

  it("creates structured handoff packet and formats prompt", () => {
    const packet = orchestrator.createHandoff({
      fromRole: "Architect",
      toRole: "Coder",
      taskGoal: "實作使用者驗證 API",
      constraints: ["不得引入第三方加密庫", "遵循 TypeScript strict mode"],
      acceptanceCriteria: ["通過單元測試", "覆蓋率達 90%"],
    });

    expect(packet.fromRole).toBe("Architect");
    expect(packet.toRole).toBe("Coder");

    const prompt = orchestrator.formatHandoffPrompt(packet);
    expect(prompt).toContain("## 任務交接協議 [Architect ➔ Coder]");
    expect(prompt).toContain("實作使用者驗證 API");
    expect(prompt).toContain("不得引入第三方加密庫");
    expect(prompt).toContain("- [ ] 通過單元測試");
  });

  it("follows standard role transition DAG (Researcher -> Architect -> Coder -> Reviewer -> Architect)", () => {
    expect(orchestrator.getStandardWorkflowNextRole("Researcher", true)).toBe("Architect");
    expect(orchestrator.getStandardWorkflowNextRole("Architect", true)).toBe("Coder");
    expect(orchestrator.getStandardWorkflowNextRole("Coder", true)).toBe("Reviewer");
    expect(orchestrator.getStandardWorkflowNextRole("Reviewer", true)).toBe("Architect");

    // 失敗時退回 Architect 重新規劃
    expect(orchestrator.getStandardWorkflowNextRole("Coder", false)).toBe("Architect");
  });
});
