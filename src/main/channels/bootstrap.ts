import type { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { loadGeneralSettings } from "../settings/settings-facade";
import { loadModelSettings, loadVisionConfig } from "../settings/model-settings";
import { CyreneAgent } from "../orchestrator/cyrene-agent";
import { toolRegistry } from "../orchestrator/tool-registry";
import type { ToolDefinition } from "../orchestrator/tool-registry";
import type { ToolRiskLevel } from "../permission";
import { decideImageSendStrategy } from "../chat/image-send-strategy";
import {
  IMAGE_CAPTION_PROMPT,
  validateCaptionImagePath,
} from "../chat/image-caption";
import { buildChannelLongTermMemoryContext, indexConversationTurn } from "../orchestrator/history-tools";
import type { AgentRuntime } from "../orchestrator/agent-runtime";
import type { TtsSynthesisService } from "../services/tts/tts-synthesis-service";
import { buildChannelAttachmentInputs } from "./agent-input";
import { selectDiscordStickerFallback } from "./adapters/discord/emoji-fallback";
import { loadChannelsSettings } from "./settings-store";
import {
  setDispatcherBuildAndRunAgent,
  setDispatcherBroadcastChat,
  setDispatcherLoadGeneralSettings,
  setDispatcherLoadRecentHistory,
  setDispatcherSynthesizeTts,
} from "./dispatcher";
import { initChannels, shutdownChannels } from "./init";
import { StreamingTextSegmenter } from "./streaming-text-segmenter";
import { toTraditionalTaiwan } from "../utils/opencc";
import { setDiscordVoiceServices } from "./adapters/discord/voice-call";
import { transcribeOfflineWhisper } from "../asr/offline-whisper-engine";
import {
  addTraditionalChineseTurnRequirement,
  buildTraditionalChineseRepairPrompt,
  classifyTraditionalChineseStreamSample,
  needsTraditionalChineseRepair,
  requiresTraditionalChineseReply,
} from "./reply-language-policy";

export interface ChannelsSubsystem {
  shutdown(): Promise<void>;
}

export interface ChannelsSubsystemDeps {
  agentRuntime: AgentRuntime;
  ttsSynthesisService: TtsSynthesisService;
  getReactChatWindow: () => BrowserWindow | null;
}

export function createChannelsSubsystem(deps: ChannelsSubsystemDeps): ChannelsSubsystem {
  // DiscordVoiceCall 需要明確注入 STT/TTS；缺少這一步時 /join 永遠只會回報「語音服務尚未就緒」。
  setDiscordVoiceServices({
    transcribe: async (pcm16Mono16k) => transcribeOfflineWhisper(pcm16Mono16k, "zh"),
    synthesize: async (text) => {
      const result = await deps.ttsSynthesisService.synthesizeChannelTts(
        text,
        loadGeneralSettings(),
        "discord",
      );
      if (!result || (result.format !== "wav" && result.format !== "mp3")) return null;
      return { audio: result.audio, format: result.format };
    },
  });

  setDispatcherLoadRecentHistory(async (sessionId, limit) => {
    const { loadRecentHistory } = await import("./history-log");
    return loadRecentHistory(sessionId, limit);
  });
  setDispatcherLoadGeneralSettings(loadGeneralSettings);

  setDispatcherBuildAndRunAgent(async (msg, sessionId, priorMessages) => {
    const channelResult: { text: string; sticker: string | null; textDelivered?: boolean } = { text: "", sticker: null };

    const sandbox = loadChannelsSettings().toolSandbox;
    const allTools = toolRegistry.getEnabledTools();
    const filteredTools: ToolDefinition[] = sandbox === "off"
      ? []
      : sandbox === "safe-only"
        ? allTools.filter((t) => (t.risk ?? "safe") === ("safe" as ToolRiskLevel))
        : allTools;
    console.log(
      "[Channels] bot run:",
      `msg.channel=${msg.channel} sandbox=${sandbox} tools=${filteredTools.length}/${allTools.length} priorMsgs=${priorMessages?.length ?? 0}`,
    );

    const historyMessages = (priorMessages ?? [])
      .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content as string,
      }));

    const channelModelSettings = loadModelSettings();
    const imageSendStrategy = decideImageSendStrategy({
      // Gemini 網頁橋接可把 Discord 圖片直接附加到網頁輸入框，不需要先走另一個 Vision API。
      multimodal: channelModelSettings.multimodal || channelModelSettings.provider === "gemini_web",
      vision: loadVisionConfig(),
    });
    const attachmentInputs = await buildChannelAttachmentInputs(msg, {
      imageMode: imageSendStrategy.mode,
      captionImage: async (filePath: string) => {
        const validated = validateCaptionImagePath(filePath);
        if (!validated.ok) return { ok: false, error: validated.error };
        const visionCfg = loadVisionConfig();
        if (!visionCfg) return { ok: false, error: "未配置视觉模型，无法分析图片" };
        try {
          const { captionImage } = await import("../orchestrator/vision-captioner");
          const caption = await captionImage(
            { base64: validated.buffer.toString("base64"), mime: validated.mime },
            IMAGE_CAPTION_PROMPT,
            visionCfg,
          );
          if (caption.startsWith("[错误")) return { ok: false, error: caption };
          return { ok: true, caption };
        } catch (err: any) {
          return { ok: false, error: err?.message || String(err) };
        }
      },
    });
    const longTermMemoryContext = await buildChannelLongTermMemoryContext(
      sessionId,
      msg.text,
      historyMessages.map((message) => message.content),
    );
    const runAttachments = [
      ...(attachmentInputs.attachments ?? []),
      ...(longTermMemoryContext ? [{ name: "同一使用者的長期對話記憶", text: longTermMemoryContext }] : []),
    ];
    const modelUserText = addTraditionalChineseTurnRequirement(msg.text);
    const enforceTraditionalChinese = requiresTraditionalChineseReply(msg.text);
    const { options } = await deps.agentRuntime.buildOptions({
      messages: [
        ...historyMessages,
        { role: "user", content: modelUserText },
      ],
      style: "01_default.md",
      sessionId,
      attachments: runAttachments.length > 0 ? runAttachments : undefined,
      imageAttachments: attachmentInputs.imageAttachments,
      channel: msg.channel,
      executionMode: sandbox === "off" ? "chat" : "work",
      ...(sandbox === "off" ? {
        userTurnId: `${msg.channel}:${msg.senderId}:${msg.at.toISOString()}:user`,
        assistantTurnId: `${msg.channel}:${msg.senderId}:${msg.at.toISOString()}:assistant`,
      } : {}),
    });
    options.tools = filteredTools;

    const threadId = `thread-${sessionId}-${Date.now()}`;
    const agent = new CyreneAgent({ threadId, description: `bot:${msg.channel}:${msg.senderId}` });
    const segmenter = new StreamingTextSegmenter();
    let streamQueue = Promise.resolve();
    let streamAttempted = false;
    let streamSucceeded = true;
    let languageGate: "pending" | "accept" | "reject" = enforceTraditionalChinese ? "pending" : "accept";
    const heldSegments: string[] = [];
    const enqueueSegments = (segments: string[]) => {
      if (!msg.sendTextSegment) return;
      for (const segment of segments) {
        streamAttempted = true;
        streamQueue = streamQueue.then(async () => {
          if (!streamSucceeded) return;
          streamSucceeded = await msg.sendTextSegment!(toTraditionalTaiwan(segment));
        });
      }
    };
    const reply = await new Promise<string>((resolve, reject) => {
      agent.runWithEvents(options).subscribe({
        next: (event) => {
          if (event.type !== "TEXT_MESSAGE_CONTENT") return;
          const delta = "delta" in event && typeof event.delta === "string" ? event.delta : "";
          const segments = segmenter.push(delta);
          if (languageGate === "accept") {
            enqueueSegments(segments);
          } else if (languageGate === "pending") {
            heldSegments.push(...segments);
            languageGate = classifyTraditionalChineseStreamSample(msg.text, heldSegments.join("\n"));
            if (languageGate === "accept") enqueueSegments(heldSegments.splice(0));
          }
        },
        complete: () => {
          resolve(agent.lastResult?.reply ?? "");
        },
        error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      });
    });
    const tailSegments = segmenter.finish();
    if (languageGate === "accept") enqueueSegments(tailSegments);
    else heldSegments.push(...tailSegments);

    let finalReply = reply;
    let completedAgent = agent;
    if (needsTraditionalChineseRepair(msg.text, reply)) {
      console.warn("[Channels] 偵測到回覆語言偏移，改寫為臺灣繁體中文");
      const repairInput = buildTraditionalChineseRepairPrompt(msg.text, reply);
      const { options: repairOptions } = await deps.agentRuntime.buildOptions({
        messages: [{ role: "user", content: repairInput }],
        style: "01_default.md",
        sessionId: `${sessionId}:language-repair`,
        channel: msg.channel,
        executionMode: "chat",
      });
      repairOptions.tools = [];
      const repairAgent = new CyreneAgent({
        threadId: `thread-${sessionId}-language-repair-${Date.now()}`,
        description: `language-repair:${msg.channel}:${msg.senderId}`,
      });
      finalReply = await new Promise<string>((resolve, reject) => {
        repairAgent.runWithEvents(repairOptions).subscribe({
          complete: () => resolve(repairAgent.lastResult?.reply ?? ""),
          error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
        });
      });
      finalReply = toTraditionalTaiwan(finalReply);
      completedAgent = repairAgent;
      heldSegments.length = 0;
      const repairedSegmenter = new StreamingTextSegmenter();
      enqueueSegments(repairedSegmenter.push(finalReply));
      enqueueSegments(repairedSegmenter.finish());
    } else if (languageGate !== "accept") {
      enqueueSegments(heldSegments.splice(0));
    }
    await streamQueue;
    channelResult.textDelivered = streamAttempted && streamSucceeded;
    channelResult.text = finalReply;
    if (completedAgent.lastResult) {
      const finished = await deps.agentRuntime.onRunFinished(completedAgent.lastResult, msg.text, msg.channel, sessionId);
      channelResult.sticker = finished.sticker
        ?? (msg.channel === "discord" ? selectDiscordStickerFallback(msg.text, finalReply) : null);
    }
    // 向量模型存在時額外寫入語意索引；沒有時仍有 channel history 的長期後援。
    void indexConversationTurn(sessionId, msg.text, finalReply);
    return channelResult;
  });

  setDispatcherSynthesizeTts(async (text: string, context) => {
    const cfg = loadGeneralSettings();
    return await deps.ttsSynthesisService.synthesizeChannelTts(text, cfg, context.channel);
  });

  setDispatcherBroadcastChat((event) => {
    const win = deps.getReactChatWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send(IPC.AGUI_EVENT, {
        type: "CUSTOM",
        name: "cyrene.botMessage",
        value: event,
      });
    } catch (err) {
      console.warn("[Channels] botMessage 广播失败:", err);
    }
  });

  void initChannels();

  return {
    shutdown: shutdownChannels,
  };
}
