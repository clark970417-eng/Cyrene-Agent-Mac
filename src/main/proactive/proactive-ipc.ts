// Proactive Assistant IPC 註冊

import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { ProactiveAssistantService } from "./proactive-assistant-service";

let proactiveServiceInstance: ProactiveAssistantService | null = null;

export function getProactiveAssistantService(): ProactiveAssistantService {
  if (!proactiveServiceInstance) {
    proactiveServiceInstance = new ProactiveAssistantService();
  }
  return proactiveServiceInstance;
}

export function registerProactiveIpc(): () => void {
  const service = getProactiveAssistantService();

  ipcMain.handle(IPC.PROACTIVE_GET_NOTIFICATIONS, () => {
    return service.getNotifications();
  });

  ipcMain.handle(IPC.PROACTIVE_DISMISS_NOTIFICATION, (_event, id: string) => {
    return service.dismissNotification(id);
  });

  ipcMain.handle(IPC.PROACTIVE_TRIGGER_CHECK, () => {
    return service.triggerCheck();
  });

  return () => {
    ipcMain.removeHandler(IPC.PROACTIVE_GET_NOTIFICATIONS);
    ipcMain.removeHandler(IPC.PROACTIVE_DISMISS_NOTIFICATION);
    ipcMain.removeHandler(IPC.PROACTIVE_TRIGGER_CHECK);
  };
}
