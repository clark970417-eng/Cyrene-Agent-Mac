import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pet = {
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    on: vi.fn(),
    isVisible: vi.fn(() => true),
    show: vi.fn(),
    hide: vi.fn(),
    showInactive: vi.fn(),
    minimize: vi.fn(),
    setParentWindow: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setBounds: vi.fn(),
    setSize: vi.fn(),
    setOpacity: vi.fn(),
    getBounds: vi.fn(() => ({ x: 20, y: 30, width: 400, height: 500 })),
    getPosition: vi.fn(() => [20, 30]),
    setPosition: vi.fn(),
    setIcon: vi.fn(),
    webContents: { send: vi.fn(), capturePage: vi.fn(), on: vi.fn() },
  };
  const host = {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    getBounds: vi.fn(() => ({ x: 100, y: 80, width: 1200, height: 800 })),
    webContents: { send: vi.fn() },
  };
  return { pet, host };
});

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
}));
vi.mock("../startup/create-main-window", () => ({
  PET_WINDOW_BASE_WIDTH: 400,
  PET_WINDOW_BASE_HEIGHT: 500,
  createMainWindow: () => mocks.pet,
}));
vi.mock("./create-aux-windows", () => ({
  createReactChatWindow: vi.fn(),
  navigateUnifiedWorkspace: vi.fn(),
}));
vi.mock("./broadcast", () => ({ broadcastToAllWindows: vi.fn() }));
vi.mock("./window-state", () => ({ reactChatWindow: mocks.host }));

describe("window manager pet docking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pet.getPosition.mockReturnValue([20, 30]);
    mocks.pet.getBounds.mockReturnValue({ x: 20, y: 30, width: 400, height: 500 });
  });

  it("渲染器重載後重新套用停靠縮放，不被桌面縮放覆蓋", async () => {
    const { createWindowManager } = await import("./window-manager");
    const manager = createWindowManager({
      getCurrentAppIconPath: () => "icon.png",
      isDev: false,
      loadMainWindowSettingsSlice: () => ({ petZoom: 1.8, petAlwaysOnTop: true, petChatInputEnabled: true }),
      persistMainWindowPosition: vi.fn(),
    });
    manager.createMainWindow();
    manager.updatePetDock({ x: 900, y: 120, width: 220, height: 180, isDocked: true });
    mocks.pet.webContents.send.mockClear();

    const didFinishLoad = mocks.pet.webContents.on.mock.calls.find(([event]) => event === "did-finish-load")?.[1];
    expect(didFinishLoad).toBeTypeOf("function");
    didFinishLoad?.();

    expect(mocks.pet.webContents.send).toHaveBeenCalledWith("pet:zoom", 0.36);
    expect(mocks.pet.webContents.send).not.toHaveBeenCalledWith("pet:zoom", 1.8);
    expect(mocks.pet.setBounds).toHaveBeenLastCalledWith({ x: 1000, y: 200, width: 220, height: 180 });
  });

  it("uses one pet window and restores detached chat only after drag finishes", async () => {
    const { createWindowManager } = await import("./window-manager");
    const manager = createWindowManager({
      getCurrentAppIconPath: () => "icon.png",
      isDev: false,
      loadMainWindowSettingsSlice: () => ({ petZoom: 1, petAlwaysOnTop: true, petChatInputEnabled: true }),
      persistMainWindowPosition: vi.fn(),
    });
    manager.createMainWindow();
    manager.updatePetDock({ x: 900, y: 120, width: 220, height: 180, isDocked: true });

    expect(mocks.pet.setParentWindow).toHaveBeenLastCalledWith(mocks.host);
    expect(mocks.pet.setBounds).toHaveBeenCalledWith({ x: 1000, y: 200, width: 220, height: 180 });
    expect(mocks.pet.webContents.send).toHaveBeenCalledWith("pet-chat:input-visibility", false);

    mocks.pet.setSize.mockClear();
    manager.setMainWindowDragging(true);
    manager.updatePetDock({ x: 900, y: 120, width: 220, height: 180, isDocked: false });

    expect(mocks.pet.setParentWindow).toHaveBeenLastCalledWith(null);
    expect(mocks.host.webContents.send).toHaveBeenCalledWith("workspace:pet-dock-changed", false);
    expect(mocks.pet.setSize).not.toHaveBeenCalled();

    manager.setMainWindowDragging(false);

    expect(mocks.pet.setSize).toHaveBeenCalledWith(400, 500);
    expect(mocks.pet.webContents.send).toHaveBeenCalledWith("pet-chat:input-visibility", true);
    expect(mocks.pet.setAlwaysOnTop).toHaveBeenLastCalledWith(true, "screen-saver");
    expect(mocks.pet.setOpacity).not.toHaveBeenCalled();
  });

  it("召回命令會強制清除拖曳狀態並移回最新槽位", async () => {
    const { createWindowManager } = await import("./window-manager");
    const manager = createWindowManager({
      getCurrentAppIconPath: () => "icon.png",
      isDev: false,
      loadMainWindowSettingsSlice: () => ({ petZoom: 1, petAlwaysOnTop: true, petChatInputEnabled: true }),
      persistMainWindowPosition: vi.fn(),
    });
    manager.createMainWindow();
    manager.updatePetDock({ x: 900, y: 120, width: 220, height: 180, isDocked: false });
    manager.setMainWindowDragging(true);
    mocks.pet.setBounds.mockClear();
    mocks.pet.hide.mockClear();
    mocks.pet.setAlwaysOnTop.mockClear();
    mocks.pet.setParentWindow.mockClear();

    const recalled = manager.recallPetToDock({ x: 910, y: 130, width: 210, height: 170 });

    expect(recalled).toBe(true);
    expect(manager.isPetDocked()).toBe(true);
    expect(mocks.host.webContents.send).toHaveBeenLastCalledWith("workspace:pet-dock-changed", true);
    expect(mocks.pet.setParentWindow).toHaveBeenLastCalledWith(mocks.host);
    expect(mocks.pet.setBounds).toHaveBeenLastCalledWith({ x: 1010, y: 210, width: 210, height: 170 });
    expect(mocks.pet.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(mocks.pet.hide.mock.invocationCallOrder[0]).toBeLessThan(mocks.pet.setAlwaysOnTop.mock.invocationCallOrder[0]);
    expect(mocks.pet.setAlwaysOnTop.mock.invocationCallOrder[0]).toBeLessThan(mocks.pet.setParentWindow.mock.invocationCallOrder[0]);

    // Native reparenting can deliver the old renderer's blur/pointerup, move,
    // and slot report after recall. None of them may undo the explicit recall.
    mocks.pet.setParentWindow.mockClear();
    mocks.pet.setBounds.mockClear();
    mocks.pet.setSize.mockClear();
    manager.moveMainWindowTo(1500, 900);
    manager.updatePetDock({ x: 900, y: 120, width: 220, height: 180, isDocked: false });
    manager.setMainWindowDragging(false);

    expect(manager.isPetDocked()).toBe(true);
    expect(mocks.pet.setPosition).not.toHaveBeenCalled();
    expect(mocks.pet.setSize).not.toHaveBeenCalled();
    expect(mocks.pet.setParentWindow).not.toHaveBeenCalledWith(null);
  });

  it("停靠時不讓透明像素偵測吃掉第一次拖曳", async () => {
    const { createWindowManager } = await import("./window-manager");
    const manager = createWindowManager({
      getCurrentAppIconPath: () => "icon.png",
      isDev: false,
      loadMainWindowSettingsSlice: () => ({ petZoom: 1, petAlwaysOnTop: true, petChatInputEnabled: true }),
      persistMainWindowPosition: vi.fn(),
    });
    manager.createMainWindow();
    manager.updatePetDock({ x: 900, y: 120, width: 220, height: 180, isDocked: true });
    mocks.pet.setIgnoreMouseEvents.mockClear();

    manager.setMainWindowInteractive(false);

    expect(mocks.pet.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
    expect(mocks.pet.setIgnoreMouseEvents).not.toHaveBeenCalledWith(true, { forward: true });

    manager.setMainWindowDragging(true);
    mocks.pet.setIgnoreMouseEvents.mockClear();
    manager.setMainWindowInteractive(false);

    expect(mocks.pet.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });

  it("套用外觀設定時保持小昔漣停靠，不會放大或浮出工作台", async () => {
    const { createWindowManager } = await import("./window-manager");
    const manager = createWindowManager({
      getCurrentAppIconPath: () => "icon.png",
      isDev: false,
      loadMainWindowSettingsSlice: () => ({ petZoom: 1.8, petAlwaysOnTop: true, petChatInputEnabled: true }),
      persistMainWindowPosition: vi.fn(),
    });
    manager.createMainWindow();
    manager.updatePetDock({ x: 900, y: 120, width: 220, height: 180, isDocked: true });
    mocks.pet.setSize.mockClear();
    mocks.pet.setBounds.mockClear();

    manager.setMainWindowAlwaysOnTop(true);
    manager.showMainWindow();
    manager.applyMainWindowZoom(1.8);

    expect(mocks.pet.setSize).not.toHaveBeenCalled();
    expect(mocks.pet.setBounds).toHaveBeenLastCalledWith({ x: 1000, y: 200, width: 220, height: 180 });
    expect(mocks.pet.setParentWindow).toHaveBeenLastCalledWith(mocks.host);
    expect(mocks.pet.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(manager.isPetDocked()).toBe(true);
  });

  it("依較窄的停靠槽寬度縮放並垂直置中", async () => {
    const { createWindowManager } = await import("./window-manager");
    const manager = createWindowManager({
      getCurrentAppIconPath: () => "icon.png",
      isDev: false,
      loadMainWindowSettingsSlice: () => ({ petZoom: 1 }),
      persistMainWindowPosition: vi.fn(),
    });
    manager.createMainWindow();

    manager.updatePetDock({ x: 900, y: 120, width: 120, height: 200, isDocked: true });

    expect(mocks.pet.webContents.send).toHaveBeenCalledWith("pet:zoom", 0.3);
    expect(mocks.pet.setBounds).toHaveBeenLastCalledWith({ x: 1000, y: 200, width: 120, height: 200 });
  });
});
