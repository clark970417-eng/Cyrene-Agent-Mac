// 點歌的 IPC 表面。呼叫端只有 3D 視訊視窗。

import { ipcMain, webContents } from "electron";
import { IPC } from "../../shared/ipc-channels";
import {
  getSongAudio,
  getSongTimeline,
  listReadySongIds,
  listSongTracks,
  searchSongTracks,
  isSongReady,
} from "./song-service";
import type { SongPrepareProgress, SongTrack } from "../../shared/song-types";

export type SongIpcResult<T> = { ok: true; data: T } | { ok: false; message: string };

function fail(error: unknown): { ok: false; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("[Song] 操作失敗:", message);
  return { ok: false, message };
}

/** 準備一首歌可能要跑一分鐘，中途把進度推回發起的視窗，介面才有東西可以顯示。 */
let currentSongProgress: SongPrepareProgress | null = null;
let automaticPractice: Promise<void> | null = null;

function broadcastProgress(progress: SongPrepareProgress): void {
  currentSongProgress = progress;
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    try {
      contents.send(IPC.SONG_PROGRESS, progress);
    } catch {
      // 視窗可能剛好在 isDestroyed() 後關閉；背景練習本身不受影響。
    }
  }
}

function reporterFor(trackId: string) {
  return (progress: string | Omit<SongPrepareProgress, "trackId">) => {
    broadcastProgress(
      typeof progress === "string"
        ? { trackId, stage: "downloading", message: progress }
        : { trackId, ...progress },
    );
  };
}

/** App 一啟動就掃描內建歌單並依序練完。工作在 main process，不依賴舞台視窗存活。 */
export function startAutomaticSongPractice(): Promise<void> {
  if (automaticPractice) return automaticPractice;
  automaticPractice = (async () => {
    try {
      // 每次啟動都重讀內建來源，才能在歌單剛新增歌曲時立刻發現，不等 24h 快取。
      const catalog = await listSongTracks("", true);
      for (const track of catalog.tracks) {
        if (await isSongReady(track)) continue;
        try {
          broadcastProgress({
            trackId: track.id,
            stage: "downloading",
            message: `自動練習《${track.title}》…`,
            completed: 0,
            total: 100,
          });
          await getSongTimeline(track, reporterFor(track.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[Song] 自動練習《${track.title}》失敗:`, message);
          broadcastProgress({ trackId: track.id, stage: "failed", message });
        }
      }
    } catch (error) {
      console.warn("[Song] 啟動時讀取自動練習歌單失敗:", error);
    } finally {
      automaticPractice = null;
      currentSongProgress = null;
    }
  })();
  return automaticPractice;
}

export function registerSongIpc(): void {
  ipcMain.handle(IPC.SONG_LIST, async (_event, payload: { source: string; refresh?: boolean }) => {
    try {
      return { ok: true as const, data: await listSongTracks(payload.source, payload.refresh) };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC.SONG_SEARCH, async (_event, payload: { keyword: string; limit?: number }) => {
    try {
      return { ok: true as const, data: await searchSongTracks(payload.keyword, payload.limit) };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC.SONG_AUDIO, async (_event, track: SongTrack) => {
    try {
      return { ok: true as const, data: await getSongAudio(track, reporterFor(track.id)) };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC.SONG_READY_IDS, async () => {
    try {
      return { ok: true as const, data: await listReadySongIds() };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC.SONG_PROGRESS_CURRENT, () => ({
    ok: true as const,
    data: currentSongProgress,
  }));

  ipcMain.handle(IPC.SONG_TIMELINE, async (_event, track: SongTrack) => {
    try {
      return { ok: true as const, data: await getSongTimeline(track, reporterFor(track.id)) };
    } catch (error) {
      return fail(error);
    }
  });
}
