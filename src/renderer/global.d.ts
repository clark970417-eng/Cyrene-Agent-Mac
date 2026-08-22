// Global type augmentations for renderer

interface SystemApi {
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

interface CyrenePaintApi {
  generateCyreneImage: (payload: {
    request: string;
    aspectRatio?: "1:1" | "3:4" | "9:16" | "4:3" | "16:9";
    quality?: "auto" | "low" | "medium" | "high";
    loraStrength?: number;
  }) => Promise<{ dataUrl?: string; savedPath?: string; prompt?: string; checkpoint?: string; lora?: string }>;
}

interface AmbientApi {
  getState: () => Promise<import("../shared/ambient-types").AmbientState>;
  startFocus: (payload?: import("../shared/ambient-types").StartFocusPayload) => Promise<import("../shared/ambient-types").AmbientState>;
  pauseFocus: () => Promise<import("../shared/ambient-types").AmbientState>;
  resumeFocus: () => Promise<import("../shared/ambient-types").AmbientState>;
  stopFocus: () => Promise<import("../shared/ambient-types").AmbientState>;
  triggerAction: (alias: string) => Promise<void>;
  onStateChanged: (callback: (state: import("../shared/ambient-types").AmbientState) => void) => () => void;
  onActionTriggered: (callback: (alias: string) => void) => () => void;
}

interface AlbumApi {
  getPhotos: () => Promise<import("../shared/album-types").MemoryPhoto[]>;
  addPhoto: (payload: import("../shared/album-types").CreatePhotoPayload) => Promise<import("../shared/album-types").MemoryPhoto>;
  deletePhoto: (photoId: string) => Promise<boolean>;
  toggleFavorite: (photoId: string) => Promise<import("../shared/album-types").MemoryPhoto | null>;
}

interface VisionCopilotApi {
  analyzeScreen: (req?: import("../shared/copilot-types").VisionCopilotRequest) => Promise<import("../shared/copilot-types").VisionCopilotResponse>;
}

interface PodcastApi {
  generate: (payload?: import("../shared/podcast-types").GeneratePodcastPayload) => Promise<import("../shared/podcast-types").DailyPodcastScript>;
  getToday: () => Promise<import("../shared/podcast-types").DailyPodcastScript | null>;
}

interface TrpgApi {
  startSession: (payload?: import("../shared/trpg-types").StartTrpgPayload) => Promise<import("../shared/trpg-types").TrpgSessionState>;
  sendAction: (payload: import("../shared/trpg-types").SendTrpgActionPayload) => Promise<import("../shared/trpg-types").TrpgSessionState>;
  getState: () => Promise<import("../shared/trpg-types").TrpgSessionState | null>;
  rollDice: (bonus?: number, dc?: number) => Promise<import("../shared/trpg-types").DiceRollResult>;
}

interface AffectionApi {
  getState: () => Promise<import("../shared/affection-types").AffectionState>;
  addExp: (payload: import("../shared/affection-types").AddExpPayload) => Promise<import("../shared/affection-types").AffectionState>;
}

interface ProactiveApi {
  getNotifications: () => Promise<import("../shared/proactive-types").ProactiveNotification[]>;
  dismissNotification: (id: string) => Promise<boolean>;
  triggerCheck: () => Promise<import("../shared/proactive-types").ProactiveNotification | null>;
}

declare global {
  interface Window {
    system?: SystemApi;
    paint?: CyrenePaintApi;
    ambient?: AmbientApi;
    album?: AlbumApi;
    visionCopilot?: VisionCopilotApi;
    podcast?: PodcastApi;
    trpg?: TrpgApi;
    affection?: AffectionApi;
    proactive?: ProactiveApi;
  }
}

// Vite ?raw 导入：把 .md 文件内联为字符串（renderMarkdown 渲染用）
declare module "*.md?raw" {
  const content: string;
  export default content;
}

export {};
