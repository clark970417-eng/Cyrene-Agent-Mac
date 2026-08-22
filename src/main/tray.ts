import { app, Menu, nativeImage, Tray } from "electron";
import { getCurrentAppIconPath } from "./windows/window-state";

export interface CreateTrayDependencies {
  toggleMainWindow: () => void;
  openWorkspaceOverview: () => void;
  createSettingsWindow: () => void;
  createCallWindow?: () => void;
}

export function createTray(deps: CreateTrayDependencies): Tray {
  const icon = nativeImage.createFromPath(getCurrentAppIconPath());
  const tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "開啟狀態面板",
      click: () => { deps.openWorkspaceOverview(); },
    },
    {
      label: "設定",
      click: () => { deps.createSettingsWindow(); },
    },
    {
      label: "顯示／隱藏桌寵",
      click: () => { deps.toggleMainWindow(); },
    },
    { type: "separator" },
    {
      label: "結束程式",
      click: () => { app.quit(); },
    },
  ]);

  tray.setToolTip("Cyrene");
  tray.setContextMenu(contextMenu);

  return tray;
}
