// Proactive Assistant Service -- 主動生活秘書與主動關懷引擎

import { randomUUID } from "node:crypto";
import type {
  ProactiveNotification,
  ProactiveNotificationType,
  ProactiveSettings,
} from "../../shared/proactive-types";

export class ProactiveAssistantService {
  private notifications: ProactiveNotification[] = [];
  private lastActiveTimestamp = Date.now();
  private settings: ProactiveSettings = {
    enabled: true,
    fatigueRemindIntervalMinutes: 45,
    morningBriefingEnabled: true,
    nightSleepRemindEnabled: true,
  };

  constructor(initialSettings?: Partial<ProactiveSettings>) {
    if (initialSettings) {
      this.settings = { ...this.settings, ...initialSettings };
    }
  }

  getNotifications(): ProactiveNotification[] {
    return [...this.notifications];
  }

  pushNotification(
    title: string,
    message: string,
    type: ProactiveNotificationType = "custom",
    icon = "🌸",
    actionLabel?: string
  ): ProactiveNotification {
    const item: ProactiveNotification = {
      id: randomUUID(),
      title,
      message,
      type,
      icon,
      actionLabel,
      createdAt: Date.now(),
      read: false,
    };
    this.notifications.unshift(item);
    if (this.notifications.length > 20) {
      this.notifications.pop();
    }
    return item;
  }

  dismissNotification(id: string): boolean {
    const initialLen = this.notifications.length;
    this.notifications = this.notifications.filter((n) => n.id !== id);
    return this.notifications.length < initialLen;
  }

  triggerCheck(nowMs: number = Date.now()): ProactiveNotification | null {
    if (!this.settings.enabled) return null;

    const date = new Date(nowMs);
    const hour = date.getHours();

    // 1. 深夜休息提醒 (23:00 ~ 04:00)
    if (this.settings.nightSleepRemindEnabled && (hour >= 23 || hour < 4)) {
      const alreadyHasNight = this.notifications.some(
        (n) => n.type === "greeting" && nowMs - n.createdAt < 4 * 3600 * 1000
      );
      if (!alreadyHasNight) {
        return this.pushNotification(
          "夜深了，昔漣提醒你該休息囉 🌙",
          "現在已經是深夜時段，請放下手邊的工作與螢幕，喝口水準備就寢吧～晚安好夢！",
          "greeting",
          "🌙",
          "開啟晚安電台"
        );
      }
    }

    // 2. 長時間專注疲勞提醒
    const elapsedMinutes = (nowMs - this.lastActiveTimestamp) / (60 * 1000);
    if (elapsedMinutes >= this.settings.fatigueRemindIntervalMinutes) {
      this.lastActiveTimestamp = nowMs;
      return this.pushNotification(
        "連續工作提醒 ☕",
        "你已經連續專注一段時間囉！閉上眼睛深呼吸，伸展一下肩膀和頸部吧～",
        "fatigue",
        "☕",
        "放鬆 5 分鐘"
      );
    }

    return null;
  }
}
