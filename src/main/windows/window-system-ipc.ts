import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { IPC } from "../../shared/ipc-channels";
import { getUsage, getUsageByModel } from "../token-usage-store";
import { getCallUsage } from "../call-usage-store";
import {
  tasksWindow,
  settingsWindow,
} from "./window-state";
import type { WindowManager } from "./window-manager";
import { loadGeneralSettings } from "../settings/settings-facade";
import { loadModelSettings } from "../settings/model-settings";
import { getAgentActivities, getAgentActivitySummary } from "../agent-activity-store";
import { getLLMQueueStatus } from "../llm-queue";
import { redactSecrets } from "../security/secret-vault";
import { transcribeOfflineWhisper } from "../asr/offline-whisper-engine";
import { getConnectionStatusItems } from "../connection-status";

export interface WindowSystemIpcDependencies {
  get windowManager(): WindowManager | null;
}

/**
 * 注册窗口控制与系统入口相关的 IPC handler。
 *
 * 注意：TOKEN_USAGE_GET / CALL_USAGE_GET 本质属于用量统计领域，当前仅因改动最小而临时
 * 挂靠在此；后续拆分统计模块时应二次归位。
 */
export function registerWindowSystemIpc(deps: WindowSystemIpcDependencies): void {
  ipcMain.handle(IPC.SYSTEM_CONNECTION_STATUS, async () => getConnectionStatusItems());

  ipcMain.handle(IPC.WINDOW_SET_INTERACTIVE, (_event, interactive: boolean) => {
    deps.windowManager?.setMainWindowInteractive(interactive);
  });

  ipcMain.on(IPC.WINDOW_SET_TEXT_INPUT_ACTIVE, (_event, active: boolean) => {
    deps.windowManager?.setMainWindowTextInputActive(Boolean(active));
  });

  ipcMain.handle(IPC.PET_CHAT_INPUT_VISIBILITY, () => {
    return loadGeneralSettings().petChatInputEnabled === true
      && !(deps.windowManager?.isPetDocked() ?? true);
  });

  ipcMain.on(IPC.WINDOW_MOVE, (_event, dx: number, dy: number) => {
    deps.windowManager?.moveMainWindowRelative(dx, dy);
  });

  ipcMain.on(IPC.WINDOW_MOVE_TO, (_event, x: number, y: number) => {
    deps.windowManager?.moveMainWindowTo(x, y);
  });

  ipcMain.on(IPC.WINDOW_SET_DRAGGING, (_event, isDragging: boolean) => {
    deps.windowManager?.setMainWindowDragging(isDragging);
  });

  ipcMain.handle(IPC.WINDOW_CAPTURE_FRAME, async () => deps.windowManager?.captureMainWindowFrame() ?? null);
  ipcMain.handle(IPC.WINDOW_GET_CURSOR_POSITION, () => deps.windowManager?.getCursorScreenPosition() ?? { x: 0, y: 0 });

  // 統一工作台的標題列按鈕：對送出事件的視窗本身操作（同 CHAT_MINIMIZE/CHAT_CLOSE 的做法）。
  // 舊版這裡綁的是已移除的獨立狀態面板視窗，導致工作台的最小化/關閉按鈕永遠沒有反應。
  ipcMain.on(IPC.SIDEBAR_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IPC.SIDEBAR_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on(IPC.SIDEBAR_OPEN_TASKS, () => {
    deps.windowManager?.createTasksWindow();
  });

  ipcMain.on(IPC.SIDEBAR_OPEN_SETTINGS, (_event, section?: string) => {
    deps.windowManager?.createSettingsWindow(section);
  });

  ipcMain.on(IPC.SIDEBAR_OPEN_CALL, () => {
    // 同上：原本的 `deps.windowManager?.` 在 windowManager 尚未就緒時會靜靜跳過，
    // renderer 那邊完全收不到回饋。這裡把它記下來。
    if (!deps.windowManager) {
      console.error("[CallWindow] 收到 sidebar:open-call，但 windowManager 尚未就緒，略過開窗");
      return;
    }
    console.log("[CallWindow] 收到 sidebar:open-call → createCallWindow()");
    deps.windowManager.createCallWindow();
  });

  ipcMain.on(IPC.SIDEBAR_SET_PET_DOCK_VISIBLE, (_event, visible: boolean) => {
    deps.windowManager?.setPetDockVisible(Boolean(visible));
  });

  ipcMain.on(IPC.SIDEBAR_REPORT_PET_SLOT, (_event, bounds: { x: number; y: number; width: number; height: number; isDocked: boolean }) => {
    deps.windowManager?.updatePetDock(bounds);
  });

  ipcMain.handle(IPC.SIDEBAR_RECALL_PET, (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    return deps.windowManager?.recallPetToDock(bounds) ?? false;
  });

  ipcMain.on(IPC.TASKS_MINIMIZE, () => {
    tasksWindow?.minimize();
  });

  ipcMain.on(IPC.TASKS_CLOSE, () => {
    tasksWindow?.close();
  });
  ipcMain.on(IPC.SETTINGS_MINIMIZE, () => {
    settingsWindow?.minimize();
  });

  ipcMain.on(IPC.SETTINGS_CLOSE, () => {
    settingsWindow?.close();
  });

  ipcMain.on(IPC.SETTINGS_OPEN_CHROME_GPU, async () => {
    const win = new BrowserWindow({ width: 1024, height: 768 });
    win.loadURL("chrome://gpu");
    win.show();
  });

  // Token 用量查询 IPC（临时挂靠，后续归到统计模块）
  ipcMain.handle(IPC.TOKEN_USAGE_GET, (_event, days: number) => {
    return getUsage(Math.max(1, Math.min(90, Number(days) || 7)));
  });
  ipcMain.handle(IPC.CALL_USAGE_GET, (_event, days: number) => {
    return getCallUsage(Math.max(1, Math.min(90, Number(days) || 7)));
  });
  ipcMain.handle(IPC.AGENT_ACTIVITY_GET, (_event, days: number) => {
    const safeDays = Math.max(1, Math.min(90, Number(days) || 7));
    const memory = process.memoryUsage();
    return {
      events: getAgentActivities(200),
      summary: getAgentActivitySummary(),
      models: getUsageByModel(safeDays),
      resources: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        queue: getLLMQueueStatus(),
        activityLimit: 1000,
        callContextTurnLimit: 24,
      },
    };
  });
  ipcMain.handle(IPC.AGENT_DIAGNOSTIC_EXPORT, async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const options: Electron.SaveDialogOptions = {
      title: "匯出昔漣診斷包",
      defaultPath: path.join(app.getPath("documents"), `昔漣診斷-${stamp}.cydiag`),
      filters: [{ name: "昔漣診斷包", extensions: ["cydiag"] }],
    };
    const picked = settingsWindow
      ? await dialog.showSaveDialog(settingsWindow, options)
      : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return null;
    const output = picked.filePath.endsWith(".cydiag") ? picked.filePath : `${picked.filePath}.cydiag`;
    const payload = {
      format: "cyrene-diagnostic",
      version: 1,
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: {
        os: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron,
      },
      settings: {
        general: redactSecrets(loadGeneralSettings()),
        model: redactSecrets(loadModelSettings()),
      },
      activities: getAgentActivities(500),
      activitySummary: getAgentActivitySummary(),
      tokenUsage: getUsage(30),
      tokenUsageByModel: getUsageByModel(30),
      resources: { memory: process.memoryUsage(), queue: getLLMQueueStatus() },
    };
    fs.writeFileSync(
      output,
      zlib.gzipSync(Buffer.from(JSON.stringify(payload, null, 2))),
      { mode: 0o600 },
    );
    return { filePath: output };
  });
  ipcMain.handle(IPC.ASR_TEST_LOCAL, async (_event, payload: { pcmBase64?: string; language?: string }) => {
    const pcm = Buffer.from(payload?.pcmBase64 ?? "", "base64");
    if (!pcm.length || pcm.length > 10 * 1024 * 1024) {
      throw new Error("測試音訊為空或超過 10 MB");
    }
    const startedAt = Date.now();
    const text = await transcribeOfflineWhisper(pcm, payload?.language === "en" ? "en" : "zh");
    return { text, latencyMs: Date.now() - startedAt };
  });

  ipcMain.on(IPC.LIVE2D_SPEECH_PREPARE, () => {
    deps.windowManager?.sendToMainWindow(IPC.LIVE2D_SPEECH_PREPARE);
  });
  ipcMain.on(IPC.LIVE2D_MOUTH_START, (_event, payload: { durationMs?: number }) => {
    deps.windowManager?.sendToMainWindow(IPC.LIVE2D_MOUTH_START, { durationMs: Number(payload?.durationMs ?? 0) });
  });
  ipcMain.on(IPC.LIVE2D_MOUTH_STOP, () => {
    deps.windowManager?.sendToMainWindow(IPC.LIVE2D_MOUTH_STOP);
  });
}
