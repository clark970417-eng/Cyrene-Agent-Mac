// 羈絆與好感度成長樹 共享型別定義

export interface AffectionBadge {
  id: string;
  name: string;
  desc: string;
  icon: string;
  unlockedAt: number;
}

export interface AffectionState {
  exp: number;
  level: number;
  levelTitle: string;
  nextLevelExp: number;
  progressPercent: number;
  totalDays: number;
  totalChats: number;
  focusMinutes: number;
  unlockedActions: string[];
  unlockedTitles: string[];
  badges: AffectionBadge[];
}

export interface AddExpPayload {
  amount: number;
  reason?: string;
}

export const AFFECTION_LEVEL_TITLES: Record<number, string> = {
  1: "初識 · 旅途啟程",
  2: "熟悉 · 溫暖陪伴",
  3: "默契 · 心有靈犀",
  4: "摯友 · 璀璨星輝",
  5: "靈魂相通 · 永恆誓約",
};

export const LEVEL_EXP_THRESHOLDS: number[] = [0, 100, 300, 700, 1500, 999999];
