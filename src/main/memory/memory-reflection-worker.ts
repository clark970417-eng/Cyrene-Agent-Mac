// Memory Reflection Worker -- DMAE 记忆后台异步反思与情境主动关怀
//
// 1. 后台反思：在系统空闲或定时触发时，深入分析近期 L1/L2 记忆，更新实体关系图谱（去重、推断用户习惯）。
// 2. 情境主动关怀 (Proactive Care)：根据学习进展、久未对话或日程需求，产生符合人设的情境关怀建议（严格遵守免打扰时段）。

import { entityGraph, type ExtractedEntity } from "./entity-graph";
import type { L1Profile } from "./memory-types";

export interface ReflectionWorkerConfig {
  /** 免打扰开始时间（小时 0-23，默认 23） */
  dndStartHour?: number;
  /** 免打扰结束时间（小时 0-23，默认 8） */
  dndEndHour?: number;
  /** 空闲触发间隔毫秒（默认 30 分钟） */
  idleIntervalMs?: number;
}

export interface ProactiveCareMessage {
  id: string;
  topic: "learning_goal" | "daily_greeting" | "schedule_reminder" | "wellbeing";
  content: string;
  suggestedAction?: string;
  priority: "low" | "medium" | "high";
  createdAt: number;
}

export class MemoryReflectionWorker {
  private isRunning = false;
  private lastReflectionAt = 0;
  private readonly config: Required<ReflectionWorkerConfig>;

  constructor(config: ReflectionWorkerConfig = {}) {
    this.config = {
      dndStartHour: config.dndStartHour ?? 23,
      dndEndHour: config.dndEndHour ?? 8,
      idleIntervalMs: config.idleIntervalMs ?? 30 * 60_000,
    };
  }

  /** 判断当前时间是否处于免打扰时段 (DND) */
  isDndTime(currentDate = new Date()): boolean {
    const hour = currentDate.getHours();
    if (this.config.dndStartHour > this.config.dndEndHour) {
      // 跨午夜：例如 23:00 到 08:00
      return hour >= this.config.dndStartHour || hour < this.config.dndEndHour;
    } else {
      return hour >= this.config.dndStartHour && hour < this.config.dndEndHour;
    }
  }

  /**
   * 异步执行记忆反思与图谱演进
   */
  async runReflection(
    l1: L1Profile,
    recentMemories: Array<{ text: string; category?: string }>,
  ): Promise<{
    mergedEntities: number;
    newInsights: string[];
    proactiveCare?: ProactiveCareMessage;
  }> {
    if (this.isRunning) {
      return { mergedEntities: 0, newInsights: [] };
    }

    this.isRunning = true;
    try {
      this.lastReflectionAt = Date.now();
      const newInsights: string[] = [];
      const extractedToIngest: ExtractedEntity[] = [];

      // 1. 扫描近期记忆中的高频概念与实体
      for (const m of recentMemories) {
        if (m.text.includes("学习") || m.text.includes("阅读") || m.text.includes("研究")) {
          newInsights.push(`近期专注方向: ${m.text.slice(0, 40)}`);
          extractedToIngest.push({
            name: m.text.slice(0, 15),
            type: "concept",
          });
        }
        if (m.text.includes("喜欢") || m.text.includes("偏好") || m.text.includes("习惯")) {
          newInsights.push(`用户偏好发现: ${m.text.slice(0, 40)}`);
          extractedToIngest.push({
            name: m.text.slice(0, 15),
            type: "preference",
          });
        }
      }

      if (extractedToIngest.length > 0) {
        entityGraph.ingestEntities(extractedToIngest);
      }

      // 2. 生成情境主动关怀建议（非 DND 时段）
      let proactiveCare: ProactiveCareMessage | undefined;
      if (!this.isDndTime()) {
        if (newInsights.length > 0) {
          proactiveCare = {
            id: `care-${Date.now()}`,
            topic: "learning_goal",
            content: `注意到你最近在探索 ${newInsights[0]}，如果需要整理学习笔记或技术调研，随时告诉我哦~`,
            priority: "medium",
            createdAt: Date.now(),
          };
        } else if (l1.userName) {
          proactiveCare = {
            id: `care-${Date.now()}`,
            topic: "daily_greeting",
            content: `嗨 ${l1.userName}，今天工作进展顺利吗？累了记得适当休息一下！`,
            priority: "low",
            createdAt: Date.now(),
          };
        }
      }

      return {
        mergedEntities: extractedToIngest.length,
        newInsights,
        proactiveCare,
      };
    } finally {
      this.isRunning = false;
    }
  }

  getLastReflectionTime(): number {
    return this.lastReflectionAt;
  }
}

export const memoryReflectionWorker = new MemoryReflectionWorker();
