// Visual Memory Album IPC 註冊

import { app, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { CreatePhotoPayload } from "../../shared/album-types";
import { AlbumService } from "./album-service";

let albumServiceInstance: AlbumService | null = null;

export function getAlbumService(): AlbumService {
  if (!albumServiceInstance) {
    albumServiceInstance = new AlbumService(app.getPath("userData"));
  }
  return albumServiceInstance;
}

export function registerAlbumIpc(): () => void {
  const service = getAlbumService();

  ipcMain.handle(IPC.ALBUM_GET_PHOTOS, async () => {
    return await service.getPhotos();
  });

  ipcMain.handle(IPC.ALBUM_ADD_PHOTO, async (_event, payload: CreatePhotoPayload) => {
    return await service.addPhoto(payload);
  });

  ipcMain.handle(IPC.ALBUM_DELETE_PHOTO, async (_event, photoId: string) => {
    return await service.deletePhoto(photoId);
  });

  ipcMain.handle(IPC.ALBUM_TOGGLE_FAVORITE, async (_event, photoId: string) => {
    return await service.toggleFavorite(photoId);
  });

  return () => {
    ipcMain.removeHandler(IPC.ALBUM_GET_PHOTOS);
    ipcMain.removeHandler(IPC.ALBUM_ADD_PHOTO);
    ipcMain.removeHandler(IPC.ALBUM_DELETE_PHOTO);
    ipcMain.removeHandler(IPC.ALBUM_TOGGLE_FAVORITE);
  };
}
