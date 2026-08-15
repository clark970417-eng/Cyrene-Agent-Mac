// screen-companion —— 「螢幕陪伴與主動搭話」執行模組。
// 跟 proactive-trigger.ts（早安/晚安/工作休息那套情境評分）完全獨立：
// 這裡是「定期看螢幕→視覺模型描述→主模型判斷要不要說話」的另一條管線，
// 有自己的冷卻節奏（observeIntervalSeconds/minTalkIntervalSeconds），不共用
// proactive-policy.ts 的 2 小時全域冷卻/每日上限/proactiveChatMode 開關。

import { powerMonitor } from "electron";
import { channelManager } from "../channels/manager";
import { loadGeneralSettings } from "../settings/settings-facade";
import { loadModelSettings, loadVisionConfig } from "../settings/model-settings";
import { captureScreen } from "./screen-companion-capture";
import { deliverScreenCompanionMessage } from "./screen-companion-delivery";
import { buildProactivePersonaPrompt } from "./proactive-persona";
import { buildScreenCompanionMessages } from "./screen-companion-prompt";
import { runProactiveModel } from "./proactive-model";
import { captionImage } from "../orchestrator/vision-captioner";

const TICK_INTERVAL_MS = 30_000;
const LOG = "[ScreenCompanion]";

let timer: ReturnType<typeof setInterval> | null = null;
let lastObservedAt = 0;
let lastSentAt = 0;
let inFlight = false;
let screenLocked = false;
let listenersAttached = false;

function attachPowerMonitorListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  try {
    powerMonitor.on("lock-screen", () => { screenLocked = true; });
    powerMonitor.on("unlock-screen", () => { screenLocked = false; });
    powerMonitor.on("suspend", () => { screenLocked = true; });
    powerMonitor.on("resume", () => { screenLocked = false; });
  } catch {
    // app 尚未 ready 時 powerMonitor 可能不可用，忽略即可（下次 tick 仍會嘗試）。
  }
}

async function runTick(): Promise<void> {
  const vision = loadModelSettings().vision;
  if (!vision?.screenCompanionEnabled) return;
  if (screenLocked) return;

  const visionConfig = loadVisionConfig();
  if (!visionConfig) return;

  const now = Date.now();
  if (now - lastObservedAt < vision.observeIntervalSeconds * 1000) return;
  if (inFlight) return;

  lastObservedAt = now;
  inFlight = true;
  try {
    const screenshot = await captureScreen();
    if (!screenshot) {
      console.warn(LOG, "截圖失敗，跳過本輪");
      return;
    }

    const caption = await captionImage(screenshot, "", visionConfig);
    if (caption.startsWith("[错误")) {
      console.warn(LOG, "視覺模型分析失敗，跳過本輪:", caption);
      return;
    }

    const modelSettings = loadModelSettings();
    if (!modelSettings.apiKey) {
      console.warn(LOG, "主聊天模型未設定 API Key，跳過本輪");
      return;
    }

    const messages = buildScreenCompanionMessages({
      basePersona: buildProactivePersonaPrompt(),
      sceneDescription: caption,
      talkativeness: vision.talkativeness,
    });

    const decision = await runProactiveModel({
      settings: {
        provider: modelSettings.provider,
        baseUrl: modelSettings.baseUrl,
        model: modelSettings.model,
        apiKey: modelSettings.apiKey,
        explicitTransport: modelSettings.explicitTransport,
        reasoning: modelSettings.reasoning,
      },
      messages,
      timeoutMs: 45_000,
    });

    if (decision.kind !== "send") {
      console.log(LOG, "本輪判斷不需要開口:", decision.kind);
      return;
    }

    const sentNow = Date.now();
    if (sentNow - lastSentAt < vision.minTalkIntervalSeconds * 1000) {
      console.log(LOG, "冷卻中，跳過本次發送");
      return;
    }

    const delivered = await deliverScreenCompanionMessage(
      decision.text,
      vision,
      loadGeneralSettings(),
      { manager: channelManager },
    );
    if (delivered) {
      lastSentAt = sentNow;
      console.log(LOG, "已送出螢幕陪伴訊息，目標:", vision.proactiveTarget);
    }
  } catch (err) {
    console.error(LOG, "本輪執行異常:", err);
  } finally {
    inFlight = false;
  }
}

export function startScreenCompanion(): void {
  if (timer) return; // 幂等
  attachPowerMonitorListeners();
  timer = setInterval(() => { void runTick(); }, TICK_INTERVAL_MS);
  timer.unref?.();
}

export function stopScreenCompanion(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
