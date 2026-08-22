// Focus Companion Tracker -- 桌面伴学伴工与专注时段关怀追踪器 (Pomodoro Companion)
//
// 记录用户的持续工作与专注时长，在连续专注 45~60 分钟后主动提醒
// 喝水、远眺或活动筋骨，提供温馨沉浸的伴侣陪伴体验。

export interface FocusSessionState {
  isActive: boolean;
  sessionStartedAt: number;
  totalFocusedMinutes: number;
  lastBreakReminderAt: number;
  topic?: string;
}

export class FocusCompanionTracker {
  private state: FocusSessionState = {
    isActive: false,
    sessionStartedAt: 0,
    totalFocusedMinutes: 0,
    lastBreakReminderAt: 0,
  };

  /** 开始一次专注工作/学习时段 */
  startFocusSession(topic = "编程与工作"): void {
    const now = Date.now();
    this.state = {
      isActive: true,
      sessionStartedAt: now,
      totalFocusedMinutes: 0,
      lastBreakReminderAt: now,
      topic,
    };
  }

  /** 结束专注时段 */
  endFocusSession(): number {
    if (!this.state.isActive) return 0;
    const elapsedMinutes = Math.round((Date.now() - this.state.sessionStartedAt) / 60_000);
    this.state.isActive = false;
    return elapsedMinutes;
  }

  /** 检查是否达到休息提醒阈值（默认 45 分钟） */
  checkBreakReminder(reminderIntervalMinutes = 45, now = Date.now()): {
    shouldRemind: boolean;
    focusedMinutes: number;
    message?: string;
  } {
    if (!this.state.isActive) {
      return { shouldRemind: false, focusedMinutes: 0 };
    }

    const focusedMinutes = Math.round((now - this.state.sessionStartedAt) / 60_000);
    const sinceLastReminder = Math.round((now - this.state.lastBreakReminderAt) / 60_000);

    if (sinceLastReminder >= reminderIntervalMinutes) {
      this.state.lastBreakReminderAt = now;
      return {
        shouldRemind: true,
        focusedMinutes,
        message: `你已经连续专注 ${focusedMinutes} 分钟啦！要不要站起来喝杯水、活动一下肩膀呢？🍵`,
      };
    }

    return {
      shouldRemind: false,
      focusedMinutes,
    };
  }

  getState(): FocusSessionState {
    return { ...this.state };
  }
}

export const focusCompanionTracker = new FocusCompanionTracker();
