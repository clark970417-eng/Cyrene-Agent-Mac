export type SubagentRole = "Architect" | "Coder" | "Reviewer" | "Researcher";

export interface SubagentProfile {
  role: SubagentRole;
  systemPrompt: string;
  allowedTools: string[];
  responsibilities: string[];
}

export interface HandoffPacket {
  id: string;
  fromRole: SubagentRole;
  toRole: SubagentRole;
  taskGoal: string;
  contextData: Record<string, unknown>;
  constraints?: string[];
  acceptanceCriteria?: string[];
  timestamp: number;
}

export interface HandoffResult {
  packetId: string;
  role: SubagentRole;
  success: boolean;
  outputSummary: string;
  artifacts?: string[];
  nextSuggestedRole?: SubagentRole;
}

export const ROLE_PROFILES: Record<SubagentRole, SubagentProfile> = {
  Architect: {
    role: "Architect",
    responsibilities: [
      "分析系統架構、相依關係與技術選型",
      "將龐大任務拆解為模組化、可驗證的子任務",
      "定義驗收標準與驗證計畫",
    ],
    allowedTools: ["read_file", "search_files", "list_dir", "repo_map"],
    systemPrompt:
      "你是系統架構師 (Architect)。你的職責是深入分析全域架構、拆解任務並制定清晰的技術實現方案，切勿盲目修改代碼。",
  },
  Coder: {
    role: "Coder",
    responsibilities: [
      "根據架構方案實作具體功能與修復 Bug",
      "嚴格遵循代碼規範與專案約定",
      "維持乾淨的 Commit 紀錄與檔案結構",
    ],
    allowedTools: ["read_file", "write_file", "edit_file", "run_command"],
    systemPrompt:
      "你是核心開發工程師 (Coder)。你的職責是精準編寫與修改高質量的代碼，嚴格落實架構規範與型別安全。",
  },
  Reviewer: {
    role: "Reviewer",
    responsibilities: [
      "審查代碼改動與邊界條件 (Code Review)",
      "執行自動化測試與 Linter 驗證",
      "檢查是否有潛在安全風險、性能回退或死循環",
    ],
    allowedTools: ["run_command", "read_file", "git_diff"],
    systemPrompt:
      "你是代碼審查與測試工程師 (Reviewer)。你的職責是嚴格審查改動品質、運行測試並驗證是否符合驗收標準。",
  },
  Researcher: {
    role: "Researcher",
    responsibilities: [
      "檢索網路、文檔與開源最佳實踐",
      "探索未知 API 規範與錯誤診斷",
      "提供權威的參考依據與外部資源",
    ],
    allowedTools: ["search_web", "read_url", "read_docs"],
    systemPrompt:
      "你是技術情報與研究員 (Researcher)。你的職責是快速檢索精準的技術資料、API 規範與解決方案。",
  },
};

export class RoleOrchestrator {
  private packets: HandoffPacket[] = [];
  private history: HandoffResult[] = [];

  /**
   * 建立結構化 Handoff 委派封包
   */
  public createHandoff(input: {
    fromRole: SubagentRole;
    toRole: SubagentRole;
    taskGoal: string;
    contextData?: Record<string, unknown>;
    constraints?: string[];
    acceptanceCriteria?: string[];
  }): HandoffPacket {
    const packet: HandoffPacket = {
      id: `hnd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      fromRole: input.fromRole,
      toRole: input.toRole,
      taskGoal: input.taskGoal.trim(),
      contextData: input.contextData || {},
      constraints: input.constraints || [],
      acceptanceCriteria: input.acceptanceCriteria || [],
      timestamp: Date.now(),
    };
    this.packets.push(packet);
    return packet;
  }

  /**
   * 記錄角色執行結果並推薦下一流轉角色
   */
  public completeHandoff(input: {
    packetId: string;
    role: SubagentRole;
    success: boolean;
    outputSummary: string;
    artifacts?: string[];
    nextSuggestedRole?: SubagentRole;
  }): HandoffResult {
    const result: HandoffResult = {
      packetId: input.packetId,
      role: input.role,
      success: input.success,
      outputSummary: input.outputSummary,
      artifacts: input.artifacts || [],
      nextSuggestedRole: input.nextSuggestedRole,
    };
    this.history.push(result);
    return result;
  }

  /**
   * 根據任務進展推薦典型角色流轉鏈
   */
  public getStandardWorkflowNextRole(current: SubagentRole, success: boolean): SubagentRole {
    if (!success) return "Architect"; // 失敗時回到架構師重新評估
    switch (current) {
      case "Researcher":
        return "Architect";
      case "Architect":
        return "Coder";
      case "Coder":
        return "Reviewer";
      case "Reviewer":
        return "Architect"; // 審查通過交回架構師做最終交付
      default:
        return "Architect";
    }
  }

  /**
   * 格式化交接 Prompt
   */
  public formatHandoffPrompt(packet: HandoffPacket): string {
    const profile = ROLE_PROFILES[packet.toRole];
    const lines = [
      `## 任務交接協議 [${packet.fromRole} ➔ ${packet.toRole}]`,
      `**目標**：${packet.taskGoal}`,
      `**角色指示**：${profile.systemPrompt}`,
    ];

    if (packet.constraints && packet.constraints.length > 0) {
      lines.push(`**約束條件**：\n${packet.constraints.map((c) => `  - ${c}`).join("\n")}`);
    }

    if (packet.acceptanceCriteria && packet.acceptanceCriteria.length > 0) {
      lines.push(
        `**驗收標準**：\n${packet.acceptanceCriteria.map((a) => `  - [ ] ${a}`).join("\n")}`,
      );
    }

    return lines.join("\n\n");
  }
}
