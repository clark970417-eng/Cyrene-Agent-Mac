// TRPG 跑團 IPC 註冊

import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { SendTrpgActionPayload, StartTrpgPayload } from "../../shared/trpg-types";
import { TrpgManager } from "./trpg-manager";

let trpgManagerInstance: TrpgManager | null = null;

export function getTrpgManager(): TrpgManager {
  if (!trpgManagerInstance) {
    trpgManagerInstance = new TrpgManager();
  }
  return trpgManagerInstance;
}

export function registerTrpgIpc(): () => void {
  const manager = getTrpgManager();

  ipcMain.handle(IPC.TRPG_START_SESSION, (_event, payload?: StartTrpgPayload) => {
    return manager.startSession(payload);
  });

  ipcMain.handle(IPC.TRPG_SEND_ACTION, (_event, payload: SendTrpgActionPayload) => {
    return manager.sendAction(payload);
  });

  ipcMain.handle(IPC.TRPG_GET_STATE, () => {
    return manager.getState();
  });

  ipcMain.handle(IPC.TRPG_ROLL_DICE, (_event, bonus?: number, dc?: number) => {
    return manager.rollDice(undefined, bonus, dc);
  });

  return () => {
    ipcMain.removeHandler(IPC.TRPG_START_SESSION);
    ipcMain.removeHandler(IPC.TRPG_SEND_ACTION);
    ipcMain.removeHandler(IPC.TRPG_GET_STATE);
    ipcMain.removeHandler(IPC.TRPG_ROLL_DICE);
  };
}
