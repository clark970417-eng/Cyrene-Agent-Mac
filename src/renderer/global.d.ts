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

declare global {
  interface Window {
    system?: SystemApi;
    paint?: CyrenePaintApi;
  }
}

// Vite ?raw 导入：把 .md 文件内联为字符串（renderMarkdown 渲染用）
declare module "*.md?raw" {
  const content: string;
  export default content;
}

export {};
