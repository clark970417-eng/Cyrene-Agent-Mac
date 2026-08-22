// Affection Service -- 昔漣羈絆與好感度成長系統

import {
  AFFECTION_LEVEL_TITLES,
  LEVEL_EXP_THRESHOLDS,
  type AddExpPayload,
  type AffectionBadge,
  type AffectionState,
} from "../../shared/affection-types";

export class AffectionService {
  private exp = 120; // 預設有些許基礎好感度
  private totalDays = 1;
  private totalChats = 15;
  private focusMinutes = 25;
  private badges: AffectionBadge[] = [
    {
      id: "badge-start",
      name: "初遇之約",
      desc: "第一次與昔漣開啟桌面陪伴",
      icon: "🌸",
      unlockedAt: Date.now() - 86400000,
    },
  ];

  constructor(initialExp?: number, initialFocusMinutes?: number) {
    if (initialExp !== undefined) {
      this.exp = initialExp;
    }
    if (initialFocusMinutes !== undefined) {
      this.focusMinutes = initialFocusMinutes;
    }
  }

  getState(): AffectionState {
    let level = 1;
    for (let i = 1; i < LEVEL_EXP_THRESHOLDS.length; i++) {
      if (this.exp >= LEVEL_EXP_THRESHOLDS[i]) {
        level = i + 1;
      } else {
        break;
      }
    }
    level = Math.min(5, level);

    const currentTierBase = LEVEL_EXP_THRESHOLDS[level - 1] || 0;
    const nextTierTarget = LEVEL_EXP_THRESHOLDS[level] || LEVEL_EXP_THRESHOLDS[4];
    const tierRange = Math.max(1, nextTierTarget - currentTierBase);
    const progressInTier = Math.max(0, this.exp - currentTierBase);
    const progressPercent = level >= 5 ? 100 : Math.min(100, Math.round((progressInTier / tierRange) * 100));

    const unlockedActions = ["眨眼", "微笑", "點頭"];
    if (level >= 2) unlockedActions.push("裝可愛", "害羞");
    if (level >= 3) unlockedActions.push("星星眼", "比心");
    if (level >= 4) unlockedActions.push("優雅旋轉", "深情注視");
    if (level >= 5) unlockedActions.push("永恆之舞", "專屬誓約");

    const unlockedTitles = ["開拓者", "朋友"];
    if (level >= 2) unlockedTitles.push("親愛的夥伴");
    if (level >= 3) unlockedTitles.push("默契知己");
    if (level >= 4) unlockedTitles.push("命中注定的旅人");
    if (level >= 5) unlockedTitles.push("靈魂共鳴者");

    return {
      exp: this.exp,
      level,
      levelTitle: AFFECTION_LEVEL_TITLES[level] || "初識",
      nextLevelExp: nextTierTarget,
      progressPercent,
      totalDays: this.totalDays,
      totalChats: this.totalChats,
      focusMinutes: this.focusMinutes,
      unlockedActions,
      unlockedTitles,
      badges: [...this.badges],
    };
  }

  addExp(payload: AddExpPayload): AffectionState {
    this.exp += Math.max(0, payload.amount);
    this.checkBadges();
    return this.getState();
  }

  recordChat(): AffectionState {
    this.totalChats += 1;
    this.exp += 5;
    this.checkBadges();
    return this.getState();
  }

  recordFocusMinutes(minutes: number): AffectionState {
    this.focusMinutes += Math.max(0, minutes);
    this.exp += Math.floor(minutes * 2);
    this.checkBadges();
    return this.getState();
  }

  private checkBadges(): void {
    if (this.focusMinutes >= 60 && !this.badges.some((b) => b.id === "badge-focus-60")) {
      this.badges.push({
        id: "badge-focus-60",
        name: "深度沉浸",
        desc: "累計與昔漣專注超過 60 分鐘",
        icon: "⏳",
        unlockedAt: Date.now(),
      });
    }
    if (this.totalChats >= 50 && !this.badges.some((b) => b.id === "badge-chat-50")) {
      this.badges.push({
        id: "badge-chat-50",
        name: "無話不談",
        desc: "累計完成 50 次深度對話",
        icon: "💬",
        unlockedAt: Date.now(),
      });
    }
  }
}
