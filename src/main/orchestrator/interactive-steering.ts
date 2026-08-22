// Interactive Steering -- 任务中途即时插话与动态微调引导器 (Human-in-the-Loop)
//
// 允许用户在 Agent 执行长任务的间隙随时发送补充需求与纠偏指令。
// Agent 在下一个工具决策点前自动消费并融入 Scratchpad，实现无需重置任务的连续动态协同。

export interface SteeringCue {
  id: string;
  runId: string;
  text: string;
  timestamp: number;
  priority: "normal" | "urgent";
}

export class InteractiveSteeringManager {
  private queues = new Map<string, SteeringCue[]>();

  /** 用户在中途添加一条补充指令 */
  addSteeringCue(runId: string, text: string, priority: "normal" | "urgent" = "normal"): SteeringCue {
    const cue: SteeringCue = {
      id: `steer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      runId,
      text: text.trim(),
      timestamp: Date.now(),
      priority,
    };

    const list = this.queues.get(runId) || [];
    list.push(cue);
    this.queues.set(runId, list);

    return cue;
  }

  /** 消费并获取当前 runId 下所有未处理的插话指令 */
  pollSteeringCues(runId: string): SteeringCue[] {
    const cues = this.queues.get(runId) || [];
    this.queues.delete(runId);
    return cues;
  }

  /** 是否存在未处理的插话 */
  hasPendingCues(runId: string): boolean {
    const cues = this.queues.get(runId);
    return !!cues && cues.length > 0;
  }

  /** 格式化为注入当前决策轮次的动态上下文 */
  formatSteeringPrompt(cues: SteeringCue[]): string {
    if (!cues || cues.length === 0) return "";

    const lines = [
      "\n[USER MID-RUN STEERING GUIDANCE (用户中途补充指令)]",
      "⚠️ 用户在当前任务执行中途补充了以下修正与调整要求，请在后续步骤中优先吸纳并调整方案：",
    ];

    for (let i = 0; i < cues.length; i++) {
      lines.push(`${i + 1}. [${cues[i].priority.toUpperCase()}] "${cues[i].text}"`);
    }

    return lines.join("\n");
  }

  /** 清理指定会话的插话队列 */
  clearRun(runId: string): void {
    this.queues.delete(runId);
  }
}

export const interactiveSteeringManager = new InteractiveSteeringManager();
