// Affection IPC 註冊

import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { AddExpPayload } from "../../shared/affection-types";
import { AffectionService } from "./affection-service";

let affectionServiceInstance: AffectionService | null = null;

export function getAffectionService(): AffectionService {
  if (!affectionServiceInstance) {
    affectionServiceInstance = new AffectionService();
  }
  return affectionServiceInstance;
}

export function registerAffectionIpc(): () => void {
  const service = getAffectionService();

  ipcMain.handle(IPC.AFFECTION_GET_STATE, () => {
    return service.getState();
  });

  ipcMain.handle(IPC.AFFECTION_ADD_EXP, (_event, payload: AddExpPayload) => {
    return service.addExp(payload);
  });

  return () => {
    ipcMain.removeHandler(IPC.AFFECTION_GET_STATE);
    ipcMain.removeHandler(IPC.AFFECTION_ADD_EXP);
  };
}
