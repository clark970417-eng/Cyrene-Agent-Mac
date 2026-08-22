import { BrowserWindow, screen, type NativeImage } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { createMainWindow, PET_WINDOW_BASE_HEIGHT, PET_WINDOW_BASE_WIDTH, type MainWindowSettingsSlice } from "../startup/create-main-window";
import {
  createReactChatWindow,
  navigateUnifiedWorkspace,
  createSettingsWindow as createStandaloneSettingsWindow,
  createCallWindow as createStandaloneCallWindow,
} from "./create-aux-windows";
import { broadcastToAllWindows } from "./broadcast";
import { PetWindowMoveController } from "../pet-window-movement";
import { reactChatWindow } from "./window-state";

export interface WindowManagerOptions {
  getCurrentAppIconPath: () => string;
  isDev: boolean;
  loadMainWindowSettingsSlice: () => MainWindowSettingsSlice & {
    petZoom?: number;
    petAlwaysOnTop?: boolean;
    petChatInputEnabled?: boolean;
  };
  persistMainWindowPosition: (position: { x: number; y: number }) => void;
}

export interface WindowManager {
  createMainWindow(): BrowserWindow;
  createReactChatWindow(sessionId?: string): void;
  openWorkspaceOverview(): void;
  createSettingsWindow(section?: string): void;
  createTasksWindow(): void;
  createStickerManagerWindow(): void;
  createCallWindow(): void;
  setPetDockVisible(visible: boolean): void;
  updatePetDock(bounds: { x: number; y: number; width: number; height: number; isDocked: boolean }): void;
  recallPetToDock(bounds: { x: number; y: number; width: number; height: number }): boolean;
  isPetDocked(): boolean;

  showMainWindow(): void;
  hideMainWindow(): void;
  toggleMainWindow(): void;
  minimizeMainWindow(): void;
  setMainWindowAlwaysOnTop(alwaysOnTop: boolean): void;
  setMainWindowInteractive(interactive: boolean): void;
  setMainWindowTextInputActive(active: boolean): void;
  setMainWindowDragging(isDragging: boolean): void;
  moveMainWindowRelative(dx: number, dy: number): void;
  moveMainWindowTo(x: number, y: number): void;
  applyMainWindowZoom(zoom: number): void;
  captureMainWindowFrame(): Promise<string | null>;
  captureMainWindow(): Promise<Electron.NativeImage | null>;
  getCursorScreenPosition(): { x: number; y: number };
  setIconForAllWindows(icon: NativeImage): void;
  sendToMainWindow(channel: string, payload?: unknown): void;
  broadcast(channel: string, payload: unknown): void;

  onMainWindowReady(handler: (win: BrowserWindow) => void): void;
  onMainWindowClosed(handler: () => void): void;
  onMainWindowMoved(handler: (position: { x: number; y: number }) => void): void;

  dispose(): void;
}

export function createWindowManager(options: WindowManagerOptions): WindowManager {
  let mainWindow: BrowserWindow | null = null;
  let petDockVisible = true;
  let petTextInputActive = false;
  let petDragging = false;
  let petDockBounds: { x: number; y: number; width: number; height: number; isDocked: boolean } | null = null;
  const readyHandlers: Array<(win: BrowserWindow) => void> = [];
  const closedHandlers: Array<() => void> = [];
  const movedHandlers: Array<(position: { x: number; y: number }) => void> = [];

  const petWindowMoveController = new PetWindowMoveController(
    () => mainWindow,
    (position) => {
      options.persistMainWindowPosition(position);
    },
  );

  function getUsableMainWindow(): BrowserWindow | null {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    return mainWindow;
  }

  function applyPetDock(): void {
    const pet = getUsableMainWindow();
    const host = reactChatWindow;
    const slot = petDockBounds;
    if (!pet || !host || host.isDestroyed() || !slot?.isDocked) return;
    if (!petDockVisible || !host.isVisible()) {
      pet.hide();
      return;
    }
    // The pet is a separate BrowserWindow, so the dock slot's CSS overflow
    // cannot clip it. Fit the whole window inside the reported slot instead
    // of relying on a fixed scale that can be taller than the slot.
    const zoom = Math.min(
      slot.width / PET_WINDOW_BASE_WIDTH,
      slot.height / PET_WINDOW_BASE_HEIGHT,
    );
    const hostBounds = host.getBounds();
    // Reparenting a visible transparent window while it is still at the
    // macOS screen-saver level can wedge WindowServer/Electron.  Make the
    // transition off-screen and lower its level before assigning the parent.
    pet.hide();
    pet.setAlwaysOnTop(false);
    pet.setParentWindow(host);
    pet.setIgnoreMouseEvents(false);
    pet.setBounds({
      x: Math.round(hostBounds.x + slot.x),
      y: Math.round(hostBounds.y + slot.y),
      width: Math.round(slot.width),
      height: Math.round(slot.height),
    });
    pet.webContents.send(IPC.PET_ZOOM, zoom);
    pet.webContents.send(IPC.PET_CHAT_INPUT_VISIBILITY, false);
    pet.showInactive();
  }

  function applyDetachedPetAppearance(): void {
    const pet = getUsableMainWindow();
    if (!pet) return;
    const settings = options.loadMainWindowSettingsSlice();
    const zoom = Math.max(0.5, Math.min(2, settings.petZoom ?? 1));
    const width = Math.round(PET_WINDOW_BASE_WIDTH * zoom);
    const height = Math.round(PET_WINDOW_BASE_HEIGHT * zoom);
    pet.setParentWindow(null);
    pet.setSize(width, height);
    pet.setAlwaysOnTop(!petTextInputActive && settings.petAlwaysOnTop !== false, "screen-saver");
    pet.webContents.send(IPC.PET_ZOOM, zoom);
    pet.webContents.send(IPC.PET_CHAT_INPUT_VISIBILITY, settings.petChatInputEnabled === true);
  }

  function undockPetForDrag(): void {
    if (!petDockBounds?.isDocked) return;
    petDockBounds = { ...petDockBounds, isDocked: false };
    const pet = getUsableMainWindow();
    pet?.setParentWindow(null);
    pet?.webContents.send(IPC.PET_CHAT_INPUT_VISIBILITY, false);
    reactChatWindow?.webContents.send("workspace:pet-dock-changed", false);
  }

  function setMainWindow(window: BrowserWindow): void {
    mainWindow = window;
    // PET_ZOOM sent before the renderer registers its listener is lost.  Reapply
    // the *effective* appearance after every load so a docked pet stays at the
    // dock scale, while a detached pet restores the user's desktop scale.
    window.webContents.on("did-finish-load", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (petDockBounds?.isDocked) applyPetDock();
      else applyDetachedPetAppearance();
    });
    window.once("ready-to-show", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.show();
      for (const handler of readyHandlers) {
        try { handler(mainWindow); } catch (err) { console.error("[WindowManager] ready handler failed:", err); }
      }
    });
    window.on("closed", () => {
      petWindowMoveController.dispose();
      mainWindow = null;
      for (const handler of closedHandlers) {
        try { handler(); } catch (err) { console.error("[WindowManager] closed handler failed:", err); }
      }
    });
    window.on("moved", () => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) return;
      try {
        const [x, y] = win.getPosition();
        for (const handler of movedHandlers) {
          try { handler({ x, y }); } catch (err) { console.error("[WindowManager] moved handler failed:", err); }
        }
      } catch {
        // ignore
      }
    });
  }

  return {
    createMainWindow(): BrowserWindow {
      if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
      const win = createMainWindow({
        getCurrentAppIconPath: options.getCurrentAppIconPath,
        isDev: options.isDev,
        loadGeneralSettings: options.loadMainWindowSettingsSlice,
      });
      setMainWindow(win);
      return win;
    },

    createReactChatWindow,
    openWorkspaceOverview(): void { navigateUnifiedWorkspace("overview"); },
    // 設定用獨立視窗（1060x920, minWidth 920），不透過工作台 iframe 嵌入——
    // 嵌入模式下容器寬度會被工作台版面擠壓，側邊欄文字在極窄寬度時會斷字。
    createSettingsWindow(section?: string): void { createStandaloneSettingsWindow(section); },
    createTasksWindow(): void { navigateUnifiedWorkspace("tasks"); },
    createStickerManagerWindow(): void { navigateUnifiedWorkspace("stickers"); },
    createCallWindow(): void { createStandaloneCallWindow(); },
    setPetDockVisible(visible: boolean): void {
      petDockVisible = visible;
      applyPetDock();
    },
    updatePetDock(bounds): void {
      // A slot report can already be queued when an explicit recall wins the
      // race.  Do not let that stale `isDocked: false` report undo the recall;
      // leaving the dock is only valid while a pet drag is active (or when the
      // manager is already in the detached state).
      if (!bounds.isDocked && petDockBounds?.isDocked && !petDragging) return;
      petDockBounds = bounds;
      if (!bounds.isDocked) {
        if (!petDragging) applyDetachedPetAppearance();
        reactChatWindow?.webContents.send("workspace:pet-dock-changed", false);
        return;
      }
      applyPetDock();
    },
    recallPetToDock(bounds): boolean {
      const pet = getUsableMainWindow();
      const host = reactChatWindow;
      if (!pet || !host || host.isDestroyed()) return false;

      // Recall is an explicit user command, so it wins over any delayed drag
      // IPC still in flight. Flush/cancel pending movement before atomically
      // restoring the dock state and native parent relationship.
      petDragging = false;
      petWindowMoveController.cancelPending();
      petDockVisible = true;
      petDockBounds = { ...bounds, isDocked: true };
      reactChatWindow?.webContents.send("workspace:pet-dock-changed", true);
      applyPetDock();
      return true;
    },
    isPetDocked(): boolean {
      return petDockBounds?.isDocked ?? true;
    },

    showMainWindow(): void {
      if (petDockBounds?.isDocked) {
        applyPetDock();
        return;
      }
      getUsableMainWindow()?.show();
    },
    hideMainWindow(): void {
      getUsableMainWindow()?.hide();
    },
    toggleMainWindow(): void {
      const win = getUsableMainWindow();
      if (!win) return;
      if (win.isVisible()) win.hide();
      else win.show();
    },
    minimizeMainWindow(): void {
      getUsableMainWindow()?.minimize();
    },
    setMainWindowAlwaysOnTop(alwaysOnTop: boolean): void {
      const win = getUsableMainWindow();
      if (!win) return;
      // 停靠中的小昔漣必須維持為工作台子視窗。外觀設定儲存會重新套用
      // GeneralSettings；若在這裡改成 screen-saver 層級，她會浮到工作台外面。
      if (petDockBounds?.isDocked) {
        win.setParentWindow(reactChatWindow && !reactChatWindow.isDestroyed() ? reactChatWindow : null);
        win.setAlwaysOnTop(false);
        return;
      }
      win.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "normal");
    },
    setMainWindowInteractive(interactive: boolean): void {
      const win = getUsableMainWindow();
      if (!win) return;
      // A docked pet occupies a dedicated workspace slot, so there is no
      // underlying desktop UI that needs per-pixel click-through.  Keeping the
      // child window interactive also prevents the first pointerdown of a drag
      // from being lost while the renderer's asynchronous alpha probe is still
      // switching ignoreMouseEvents off.
      if (petDockBounds?.isDocked) {
        win.setIgnoreMouseEvents(false);
        return;
      }
      win.setIgnoreMouseEvents(!interactive, { forward: true });
    },
    setMainWindowTextInputActive(active: boolean): void {
      petTextInputActive = active;
      if (petDockBounds?.isDocked) return;
      const win = getUsableMainWindow();
      if (!win) return;
      const settings = options.loadMainWindowSettingsSlice();
      win.setAlwaysOnTop(!active && settings.petAlwaysOnTop !== false, active ? "normal" : "screen-saver");
    },
    setMainWindowDragging(isDragging: boolean): void {
      if (!getUsableMainWindow()) return;
      if (isDragging) {
        petDragging = true;
        undockPetForDrag();
        return;
      }

      // Reparenting during recall can blur the pet renderer.  If that renderer
      // still believed it owned a pointer gesture, its delayed blur/pointerup
      // sends `false` after recall.  Recall has already cleared petDragging,
      // so treating this as a fresh drag end would immediately detach the pet
      // again (the visible ~0.2 s snap-back reported by the user).
      if (!petDragging) return;
      petDragging = false;
      petWindowMoveController.finishDragging();
      if (petDockBounds?.isDocked) applyPetDock();
      else applyDetachedPetAppearance();
    },
    moveMainWindowRelative(dx: number, dy: number): void {
      if (!petDragging) return;
      petWindowMoveController.moveRelative(dx, dy);
    },
    moveMainWindowTo(x: number, y: number): void {
      if (!petDragging) return;
      petWindowMoveController.queueAbsolute(x, y);
    },
    applyMainWindowZoom(zoom: number): void {
      const win = getUsableMainWindow();
      if (!win) return;
      // 停靠時依槽位尺寸自動縮放。使用者的縮放值只套用到明確拖出
      // 工作台後的桌面桌寵，不能因調整主題／字型而撐破停靠槽。
      if (petDockBounds?.isDocked) {
        applyPetDock();
        return;
      }
      const width = Math.round(PET_WINDOW_BASE_WIDTH * zoom);
      const height = Math.round(PET_WINDOW_BASE_HEIGHT * zoom);
      win.setSize(width, height);
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.PET_ZOOM, zoom);
      }
    },
    async captureMainWindowFrame(): Promise<string | null> {
      const image = await this.captureMainWindow();
      return image ? image.toDataURL() : null;
    },
    async captureMainWindow(): Promise<Electron.NativeImage | null> {
      const win = getUsableMainWindow();
      if (!win) return null;
      try {
        return await win.webContents.capturePage();
      } catch (err) {
        console.error("[WindowManager] captureMainWindow failed:", err);
        return null;
      }
    },
    getCursorScreenPosition(): { x: number; y: number } {
      return screen.getCursorScreenPoint();
    },
    setIconForAllWindows(icon: NativeImage): void {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setIcon(icon);
      }
    },
    sendToMainWindow(channel: string, payload?: unknown): void {
      const win = getUsableMainWindow();
      if (!win) return;
      if (payload === undefined) win.webContents.send(channel);
      else win.webContents.send(channel, payload);
    },
    broadcast(channel: string, payload: unknown): void {
      broadcastToAllWindows(channel, payload);
    },

    onMainWindowReady(handler: (win: BrowserWindow) => void): void {
      readyHandlers.push(handler);
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        try { handler(mainWindow); } catch (err) { console.error("[WindowManager] ready handler failed:", err); }
      }
    },
    onMainWindowClosed(handler: () => void): void {
      closedHandlers.push(handler);
    },
    onMainWindowMoved(handler: (position: { x: number; y: number }) => void): void {
      movedHandlers.push(handler);
    },

    dispose(): void {
      petWindowMoveController.dispose();
    },
  };
}
