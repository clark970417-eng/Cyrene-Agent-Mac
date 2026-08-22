// Daily Podcast IPC 註冊

import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { GeneratePodcastPayload } from "../../shared/podcast-types";
import { DailyPodcastService } from "./daily-podcast-service";

let dailyPodcastInstance: DailyPodcastService | null = null;

export function getDailyPodcastService(): DailyPodcastService {
  if (!dailyPodcastInstance) {
    dailyPodcastInstance = new DailyPodcastService();
  }
  return dailyPodcastInstance;
}

export function registerDailyPodcastIpc(): () => void {
  const service = getDailyPodcastService();

  ipcMain.handle(IPC.PODCAST_GENERATE, async (_event, payload?: GeneratePodcastPayload) => {
    return await service.generatePodcast(payload);
  });

  ipcMain.handle(IPC.PODCAST_GET_TODAY, () => {
    return service.getTodayPodcast();
  });

  return () => {
    ipcMain.removeHandler(IPC.PODCAST_GENERATE);
    ipcMain.removeHandler(IPC.PODCAST_GET_TODAY);
  };
}
