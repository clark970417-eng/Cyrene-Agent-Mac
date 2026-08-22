// screen-companion-capture —— 螢幕陪伴用的定期靜默截圖。
// 仿 game-bot/screenshot.ts 的做法：desktopCapturer 截主屏，縮圖控制在 ~1280px 寬，
// 避免把全解析度圖片丟給視覺模型浪費 token。

import { desktopCapturer, screen, systemPreferences } from "electron";

export interface CompanionScreenshot {
  base64: string;
  mime: string;
}

const MAX_WIDTH = 1280;

export async function captureScreen(): Promise<CompanionScreenshot | null> {
  // desktopCapturer itself opens the macOS permission dialog. The companion
  // runs in the background, so never nag the user from a scheduled tick when
  // the current signed build is not authorized. Permission can still be
  // requested intentionally from screen sharing/settings.
  if (
    process.platform === "darwin"
    && systemPreferences.getMediaAccessStatus("screen") !== "granted"
  ) {
    return null;
  }

  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = Math.min(1, MAX_WIDTH / Math.max(1, width));
  const thumbnailSize = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize,
  });
  if (sources.length === 0) return null;

  const thumb = sources[0].thumbnail;
  if (thumb.isEmpty()) return null;

  return {
    base64: thumb.toPNG().toString("base64"),
    mime: "image/png",
  };
}
