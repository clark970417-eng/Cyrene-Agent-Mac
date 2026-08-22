// Vision Co-pilot IPC 註冊

import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { VisionCopilotRequest } from "../../shared/copilot-types";
import { VisionCopilotService } from "./vision-copilot-service";

let visionCopilotInstance: VisionCopilotService | null = null;

export function getVisionCopilotService(): VisionCopilotService {
  if (!visionCopilotInstance) {
    visionCopilotInstance = new VisionCopilotService();
  }
  return visionCopilotInstance;
}

export function registerVisionCopilotIpc(): () => void {
  const service = getVisionCopilotService();

  ipcMain.handle(IPC.VISION_COPILOT_CAPTURE_AND_ANALYZE, async (_event, req?: VisionCopilotRequest) => {
    return await service.analyzeScreen(req);
  });

  return () => {
    ipcMain.removeHandler(IPC.VISION_COPILOT_CAPTURE_AND_ANALYZE);
  };
}
