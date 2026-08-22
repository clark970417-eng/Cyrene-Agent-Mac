// 主動生活秘書 共享型別定義

export type ProactiveNotificationType =
  | "greeting"
  | "fatigue"
  | "pomodoro_done"
  | "weather_alert"
  | "custom";

export interface ProactiveNotification {
  id: string;
  title: string;
  message: string;
  type: ProactiveNotificationType;
  icon: string;
  actionLabel?: string;
  actionPayload?: string;
  createdAt: number;
  read: boolean;
}

export interface ProactiveSettings {
  enabled: boolean;
  fatigueRemindIntervalMinutes: number; // 疲勞提醒間隔
  morningBriefingEnabled: boolean;
  nightSleepRemindEnabled: boolean;
}
