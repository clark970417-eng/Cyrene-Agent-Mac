// Ambient Life Mode (自發作息與環境感知) 共享型別定義

export type TimeOfDayPeriod =
  | "dawn"        // 清晨 05:00 - 07:00
  | "morning"     // 早晨 07:00 - 11:30
  | "noon"        // 午間 11:30 - 14:00
  | "afternoon"   // 下午 14:00 - 18:00
  | "evening"     // 傍晚/夜間 18:00 - 23:00
  | "late_night"; // 深夜 23:00 - 05:00

export type FocusPhase = "focus" | "short_break" | "long_break";

export interface FocusCompanionState {
  isActive: boolean;
  isPaused: boolean;
  phase: FocusPhase;
  topic: string;
  targetDurationSec: number;
  elapsedSec: number;
  remainingSec: number;
  completedPomodoros: number;
  sessionStartedAt: number;
}

export interface AmbientActivity {
  period: TimeOfDayPeriod;
  statusText: string;
  defaultMotionAlias?: string;
  whisper?: string;
}

export interface AmbientState {
  period: TimeOfDayPeriod;
  periodLabel: string;
  statusText: string;
  focus: FocusCompanionState;
  idleMinutes: number;
  ambientWhisper?: string;
}

export interface StartFocusPayload {
  topic?: string;
  durationMinutes?: number; // 預設 25
  breakMinutes?: number;    // 預設 5
  durationSeconds?: number; // 測試或精確秒數
  breakSeconds?: number;
}
