// Ambient Life Mode IPC 註冊與狀態廣播

import { BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { StartFocusPayload } from "../../shared/ambient-types";
import { ambientLifeService } from "./ambient-life-service";

function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

import { findAction } from "../../shared/live2d-actions";

export function registerAmbientIpc(): () => void {
  ambientLifeService.startTimer();

  const unsubState = ambientLifeService.subscribe((state) => {
    broadcastToWindows(IPC.AMBIENT_STATE_CHANGED, state);
  });

  const unsubAction = ambientLifeService.subscribeAction((alias) => {
    broadcastToWindows(IPC.AMBIENT_TRIGGER_ACTION, alias);
    const action = findAction(alias);
    if (action) {
      broadcastToWindows(IPC.LIVE2D_PLAY_ACTION, action.target);
    }
  });

  ipcMain.handle(IPC.AMBIENT_GET_STATE, () => {
    return ambientLifeService.getCurrentState();
  });

  ipcMain.handle(IPC.AMBIENT_FOCUS_START, (_event, payload?: StartFocusPayload) => {
    return ambientLifeService.startFocus(payload);
  });

  ipcMain.handle(IPC.AMBIENT_FOCUS_PAUSE, () => {
    return ambientLifeService.pauseFocus();
  });

  ipcMain.handle(IPC.AMBIENT_FOCUS_RESUME, () => {
    return ambientLifeService.resumeFocus();
  });

  ipcMain.handle(IPC.AMBIENT_FOCUS_STOP, () => {
    return ambientLifeService.stopFocus();
  });

  ipcMain.handle(IPC.AMBIENT_TRIGGER_ACTION, (_event, alias: string) => {
    if (alias) ambientLifeService.triggerAction(alias);
  });

  return () => {
    unsubState();
    unsubAction();
    ambientLifeService.stopTimer();
    ipcMain.removeHandler(IPC.AMBIENT_GET_STATE);
    ipcMain.removeHandler(IPC.AMBIENT_FOCUS_START);
    ipcMain.removeHandler(IPC.AMBIENT_FOCUS_PAUSE);
    ipcMain.removeHandler(IPC.AMBIENT_FOCUS_RESUME);
    ipcMain.removeHandler(IPC.AMBIENT_FOCUS_STOP);
    ipcMain.removeHandler(IPC.AMBIENT_TRIGGER_ACTION);
  };
}
