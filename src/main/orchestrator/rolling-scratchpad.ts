// Rolling Scratchpad -- 多轮任务滚动工作记忆与状态动态压缩
//
// 在长任务（Work / Code 模式）中，防止多轮执行历史过长导致 Agent 遗忘
// 原始目标或陷入死循环。每隔 4~5 轮自动汇总当前成果、更新待办清单与阻碍，
// 并以极精炼的形式注入 Prompt 上下文中。

export interface ScratchpadMilestone {
  step: string;
  timestamp: number;
  status: "done" | "in_progress" | "failed";
}

export interface RollingScratchpadState {
  taskId: string;
  goal: string;
  totalRounds: number;
  lastSummarizedRound: number;
  milestones: ScratchpadMilestone[];
  keyFindings: string[];
  nextSteps: string[];
  blockers: string[];
  updatedAt: number;
}

export class RollingScratchpad {
  private state: RollingScratchpadState;
  private readonly summaryInterval: number;

  constructor(taskId: string, goal: string, summaryInterval = 4) {
    this.summaryInterval = summaryInterval;
    this.state = {
      taskId,
      goal,
      totalRounds: 0,
      lastSummarizedRound: 0,
      milestones: [],
      keyFindings: [],
      nextSteps: [],
      blockers: [],
      updatedAt: Date.now(),
    };
  }

  /** 记录一轮工具执行 */
  recordStep(milestone: string, finding?: string, isDone = true): void {
    this.state.totalRounds++;
    this.state.updatedAt = Date.now();

    this.state.milestones.push({
      step: milestone,
      timestamp: Date.now(),
      status: isDone ? "done" : "in_progress",
    });

    if (finding) {
      this.state.keyFindings.push(finding);
      // 保持 findings 最多 8 条高价值摘要
      if (this.state.keyFindings.length > 8) {
        this.state.keyFindings.shift();
      }
    }
  }

  /** 添加阻碍或报错 */
  addBlocker(blocker: string): void {
    if (!this.state.blockers.includes(blocker)) {
      this.state.blockers.push(blocker);
    }
  }

  /** 解决阻碍 */
  resolveBlocker(blocker: string): void {
    this.state.blockers = this.state.blockers.filter((b) => b !== blocker);
  }

  /** 设置下一步计划 */
  setNextSteps(steps: string[]): void {
    this.state.nextSteps = steps;
  }

  /** 是否达到滚动压缩总结阈值 */
  needsSummarization(): boolean {
    return this.state.totalRounds - this.state.lastSummarizedRound >= this.summaryInterval;
  }

  /** 执行滚动压缩，折叠早期里程碑并标记 */
  compact(): void {
    this.state.lastSummarizedRound = this.state.totalRounds;
    this.state.updatedAt = Date.now();

    // 仅保留最近 5 条里程碑，其余已汇总
    if (this.state.milestones.length > 5) {
      this.state.milestones = this.state.milestones.slice(-5);
    }
  }

  /** 格式化为注入 System Prompt 的轻量上下文 */
  formatPromptContext(): string {
    const doneMilestones = this.state.milestones.filter((m) => m.status === "done");
    const inProgress = this.state.milestones.filter((m) => m.status === "in_progress");

    const lines: string[] = [
      `[ROLLING TASK SCRATCHPAD | Task: ${this.state.taskId}]`,
      `🎯 核心目标: ${this.state.goal}`,
      `📊 执行轮数: 第 ${this.state.totalRounds} 轮`,
    ];

    if (doneMilestones.length > 0) {
      lines.push("✅ 已完成步骤:");
      for (const m of doneMilestones) {
        lines.push(`  - ${m.step}`);
      }
    }

    if (this.state.keyFindings.length > 0) {
      lines.push("💡 关键产出与发现:");
      for (const f of this.state.keyFindings) {
        lines.push(`  - ${f}`);
      }
    }

    if (inProgress.length > 0) {
      lines.push("⏳ 进行中步骤:");
      for (const m of inProgress) {
        lines.push(`  - ${m.step}`);
      }
    }

    if (this.state.nextSteps.length > 0) {
      lines.push("➡️ 下一步规划:");
      for (const s of this.state.nextSteps) {
        lines.push(`  - ${s}`);
      }
    }

    if (this.state.blockers.length > 0) {
      lines.push("⚠️ 当前阻碍/待解决问题:");
      for (const b of this.state.blockers) {
        lines.push(`  - ${b}`);
      }
    }

    return lines.join("\n");
  }

  /** 导出当前完整工作区状态 */
  exportState(): RollingScratchpadState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /** 从持久化快照中恢复 */
  restoreState(savedState: RollingScratchpadState): void {
    this.state = JSON.parse(JSON.stringify(savedState));
  }
}
