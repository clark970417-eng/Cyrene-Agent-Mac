// Ambient Life Service -- 管理 Cyrene 自發作息感知與專注伴讀番茄鐘

import type {
  AmbientState,
  FocusCompanionState,
  FocusPhase,
  StartFocusPayload,
  TimeOfDayPeriod,
} from "../../shared/ambient-types";

export interface AmbientLifeServiceOptions {
  getTimezone?: () => string;
  onStateChange?: (state: AmbientState) => void;
  onActionTrigger?: (actionAlias: string) => void;
}

const PERIOD_CONFIGS: Record<
  TimeOfDayPeriod,
  { label: string; defaultStatus: string; whisper: string; defaultAction?: string }
> = {
  dawn: {
    label: "清晨",
    defaultStatus: "晨光初露 🌅",
    whisper: "早安！新的一天也要元氣滿滿哦~",
    defaultAction: "笑一笑",
  },
  morning: {
    label: "早晨",
    defaultStatus: "伴讀學習中 📖",
    whisper: "早晨的專注度最高了，今天有什麼重要安排嗎？",
    defaultAction: "眨眨眼",
  },
  noon: {
    label: "午間",
    defaultStatus: "午後小憩中 🍵",
    whisper: "記得吃午餐哦，稍微放鬆一下再出發吧~",
    defaultAction: "可愛一下",
  },
  afternoon: {
    label: "下午",
    defaultStatus: "專注工作中 💻",
    whisper: "連續忙碌一陣子了，喝口水活動一下筋骨吧！",
    defaultAction: "回正",
  },
  evening: {
    label: "傍晚",
    defaultStatus: "晚間陪伴中 ✨",
    whisper: "今天辛苦啦，今晚要不要聽首歌放鬆一下呢？",
    defaultAction: "星星眼",
  },
  late_night: {
    label: "深夜",
    defaultStatus: "夜深伴隨中 💤",
    whisper: "已經很晚了呢... 累了的話就早點睡覺吧，晚安~",
    defaultAction: "回正",
  },
};

export class AmbientLifeService {
  private focusState: FocusCompanionState = {
    isActive: false,
    isPaused: false,
    phase: "focus",
    topic: "專注工作與學習",
    targetDurationSec: 25 * 60,
    elapsedSec: 0,
    remainingSec: 25 * 60,
    completedPomodoros: 0,
    sessionStartedAt: 0,
  };

  private breakDurationSec = 5 * 60;
  private idleMinutes = 0;
  private lastTickAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(state: AmbientState) => void>();
  private readonly actionListeners = new Set<(actionAlias: string) => void>();
  private getTimezone: () => string;

  constructor(options: AmbientLifeServiceOptions = {}) {
    this.getTimezone = options.getTimezone ?? (() => "Asia/Taipei");
    if (options.onStateChange) this.listeners.add(options.onStateChange);
    if (options.onActionTrigger) this.actionListeners.add(options.onActionTrigger);
  }

  startTimer(): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => {
      this.tick();
    }, 1000);
  }

  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  subscribe(listener: (state: AmbientState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeAction(listener: (actionAlias: string) => void): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  setIdleMinutes(minutes: number): void {
    this.idleMinutes = Math.max(0, minutes);
    this.emitState();
  }

  getTimeOfDayPeriod(hour: number): TimeOfDayPeriod {
    if (hour >= 5 && hour < 7) return "dawn";
    if (hour >= 7 && hour < 11.5) return "morning";
    if (hour >= 11.5 && hour < 14) return "noon";
    if (hour >= 14 && hour < 18) return "afternoon";
    if (hour >= 18 && hour < 23) return "evening";
    return "late_night";
  }

  getLocalHour(now = Date.now()): number {
    try {
      const tz = this.getTimezone();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date(now));
      const hourPart = parts.find((p) => p.type === "hour")?.value ?? "12";
      const minutePart = parts.find((p) => p.type === "minute")?.value ?? "0";
      return parseInt(hourPart, 10) + parseInt(minutePart, 10) / 60;
    } catch {
      const d = new Date(now);
      return d.getHours() + d.getMinutes() / 60;
    }
  }

  getCurrentState(now = Date.now()): AmbientState {
    const localHour = this.getLocalHour(now);
    const period = this.getTimeOfDayPeriod(localHour);
    const config = PERIOD_CONFIGS[period];

    let statusText = config.defaultStatus;
    if (this.focusState.isActive) {
      const mins = Math.floor(this.focusState.remainingSec / 60);
      const secs = this.focusState.remainingSec % 60;
      const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      if (this.focusState.phase === "focus") {
        statusText = `專注伴讀中 ${timeStr} ⏳`;
      } else {
        statusText = `休息時段 ${timeStr} 🍵`;
      }
    } else if (this.idleMinutes > 15) {
      statusText = "安靜守候中 ✨";
    }

    return {
      period,
      periodLabel: config.label,
      statusText,
      focus: { ...this.focusState },
      idleMinutes: this.idleMinutes,
      ambientWhisper: config.whisper,
    };
  }

  startFocus(payload: StartFocusPayload = {}): AmbientState {
    const durationSec = payload.durationSeconds ?? (payload.durationMinutes ?? 25) * 60;
    const breakSec = payload.breakSeconds ?? (payload.breakMinutes ?? 5) * 60;
    const topic = payload.topic || "專注工作與學習";

    this.breakDurationSec = breakSec;
    this.focusState = {
      isActive: true,
      isPaused: false,
      phase: "focus",
      topic,
      targetDurationSec: durationSec,
      elapsedSec: 0,
      remainingSec: durationSec,
      completedPomodoros: 0,
      sessionStartedAt: Date.now(),
    };

    this.triggerAction("笑一笑");
    this.emitState();
    return this.getCurrentState();
  }

  pauseFocus(): AmbientState {
    if (this.focusState.isActive) {
      this.focusState.isPaused = true;
      this.emitState();
    }
    return this.getCurrentState();
  }

  resumeFocus(): AmbientState {
    if (this.focusState.isActive) {
      this.focusState.isPaused = false;
      this.emitState();
    }
    return this.getCurrentState();
  }

  stopFocus(): AmbientState {
    this.focusState.isActive = false;
    this.focusState.isPaused = false;
    this.triggerAction("回正");
    this.emitState();
    return this.getCurrentState();
  }

  triggerAction(alias: string): void {
    for (const listener of this.actionListeners) {
      try {
        listener(alias);
      } catch (err) {
        console.error("[AmbientLifeService] Action listener error:", err);
      }
    }
  }

  tick(now = Date.now()): void {
    if (!this.focusState.isActive || this.focusState.isPaused) {
      return;
    }

    if (this.focusState.remainingSec > 0) {
      this.focusState.remainingSec -= 1;
      this.focusState.elapsedSec += 1;
    }

    if (this.focusState.remainingSec <= 0) {
      if (this.focusState.phase === "focus") {
        // 完成專注，進入休息
        this.focusState.completedPomodoros += 1;
        this.focusState.phase = "short_break";
        this.focusState.targetDurationSec = this.breakDurationSec;
        this.focusState.remainingSec = this.breakDurationSec;
        this.focusState.elapsedSec = 0;
        this.triggerAction("星星眼");
      } else {
        // 休息結束，返回專注
        this.focusState.phase = "focus";
        this.focusState.targetDurationSec = 25 * 60;
        this.focusState.remainingSec = 25 * 60;
        this.focusState.elapsedSec = 0;
        this.triggerAction("笑一笑");
      }
    }

    this.emitState(now);
  }

  private emitState(now = Date.now()): void {
    const state = this.getCurrentState(now);
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error("[AmbientLifeService] State listener error:", err);
      }
    }
  }
}

export const ambientLifeService = new AmbientLifeService();
