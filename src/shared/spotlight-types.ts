// Spotlight 浮動指令膠囊 共享型別定義

export type SpotlightActionType =
  | "ask"
  | "copilot"
  | "album"
  | "podcast"
  | "trpg"
  | "pomodoro"
  | "clear";

export interface SpotlightCommand {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  action: SpotlightActionType;
}

export const DEFAULT_SPOTLIGHT_COMMANDS: SpotlightCommand[] = [
  { id: "cmd-copilot", title: "視覺看螢幕 (Vision Co-pilot)", subtitle: "立即截取當前桌面並由昔漣深度解答", icon: "👁️", action: "copilot" },
  { id: "cmd-podcast", title: "每日聲音電台 (Daily Podcast)", subtitle: "播報今日晨光簡報或星空晚安廣播", icon: "📻", action: "podcast" },
  { id: "cmd-album", title: "昔漣時光手帳 (Memory Album)", subtitle: "開啟回憶相簿牆、查看珍藏照片", icon: "📸", action: "album" },
  { id: "cmd-trpg", title: "TRPG 跑團冒險房 (GM Mode)", subtitle: "擲出 D20 命運之骰，開啟星語遺跡探索", icon: "🎲", action: "trpg" },
  { id: "cmd-pomodoro", title: "啟動 25 分鐘專注伴讀", subtitle: "開啟沉浸式番茄鐘，昔漣全程安靜陪伴", icon: "⏳", action: "pomodoro" },
];
