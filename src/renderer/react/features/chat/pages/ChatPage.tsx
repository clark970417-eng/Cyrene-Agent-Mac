import { useEffect, useRef, useState, type DragEvent } from "react";
import { DownOutlined } from "@ant-design/icons";
import { ChatComposer, type ComposerAttachment } from "../components/ChatComposer";
import { ComposerSlot } from "../components/ComposerSlot";
import { TodoPanel } from "../components/TodoPanel";
import { CodeGitPanel } from "../components/CodeGitPanel";
import type { TodoState } from "../../../../../shared/todo-types";
import {
  describePermissionRequest,
  normalizeCodeAskInteraction,
  normalizeCodeVerificationInteraction,
  normalizeChoiceInteraction,
  normalizeTaskPlanPresentation,
  shouldDismissAsk,
  type AgentRunStage,
  type ComposerInteraction,
} from "../components/run-presentation";
import { ChatMessageList, type ChatMessageItem } from "../components/ChatMessageList";
import type { WeatherData } from "../components/weather/weather-types";
import { getTtsPlaybackSnapshot, playTtsToCompletion, stopTtsPlayback } from "../components/tts-playback";
import { EarlyTtsPlaybackQueue } from "../tts/early-tts-queue";
import { ConversationSidebar } from "../components/ConversationSidebar";
import { StatusFloat } from "../components/StatusFloat";
import type { ChatMessage, ChatSession, ChatSessionMeta, ConversationMode, ReasoningBlock, RunActivityRecord, TaskDelegationDisplayRecord, ToolExecutionRecord } from "../../../../../shared/chat-types";
import { SidebarToggle } from "../../../components/ui/SidebarToggle";
import { ModeSwitch } from "../../../components/ui/ModeSwitch";
import { CharacterStatusPill } from "../../../components/ui/CharacterStatusPill";
import { WindowControls } from "../../../components/ui/WindowControls";
import { SettingsButton } from "../../../components/ui/SettingsButton";
import { UserAvatar } from "../../../components/ui/UserAvatar";
import { useUserCallPreference } from "../../../hooks/useUserNickname";
import { resolveRevisableLastTurn } from "../components/last-turn-actions";
import { NewTaskButton } from "../../../components/ui/NewTaskButton";
import { MultiAgentButton } from "../../../components/ui/MultiAgentButton";
import { ModelModeButton } from "../../../components/ui/ModelModeButton";
import { SkillModeButton } from "../../../components/ui/SkillModeButton";
import { ToolModeButton } from "../../../components/ui/ToolModeButton";
import { AmbientModeButton } from "../../../components/ui/AmbientModeButton";
import { ModelModePanel } from "../components/ModelModePanel";
import { SkillModePanel } from "../components/SkillModePanel";
import { ToolModePanel } from "../components/ToolModePanel";
import { applyTaskDelegationEvent, normalizeTaskDelegationEvent } from "../components/task-delegations";
import { RightInspector } from "../components/RightInspector";
import { ReviewDiffContent } from "../components/ReviewInspector";
import { shouldRunModelForMode, shouldUseCyreneAutoTts } from "./conversation-run-policy";
import {
  applyCodeRunEvent,
  createCodeRunViewModel,
  restoreCodeRunViewModel,
  type CodeRunApi,
  type CodeRunViewModel,
} from "../../../../lib/code-run-view-model";
import {
  normalizeSessionMode,
  openSessionByIdWithDeps,
  type OpenSessionArgs,
  type ReactSessionMode,
} from "./openSessionByDeps";
import "../../../components/ui/SidebarToggle.css";
import "../../../components/ui/ModeSwitch.css";
import "../../../components/ui/CharacterStatusPill.css";
import "../../../components/ui/WindowControls.css";
import "../../../components/ui/SettingsButton.css";
import "../../../components/ui/UserAvatar.css";
import "../../../components/ui/NewTaskButton.css";
import "../../../components/ui/MultiAgentButton.css";
import "../../../components/ui/ToolModeButton.css";
import "../components/ModelModePanel.css";
import "../components/SkillModePanel.css";
import "../components/ToolModePanel.css";
import "../components/ChatComposer.css";
import "../components/ReasoningControl.css";
import "../components/StyleControl.css";
import "../components/PermissionControl.css";
import "../components/ChatMessageList.css";
import "../components/ConversationSidebar.css";
import "../components/ConversationCharacterCard.css";
import "../components/StatusFloat.css";
// Keep the semantic colour layer last so component-local light defaults cannot
// leak into the dark theme (Ant Design portals are covered by the same layer).
import "../../../styles/react-theme.css";

import avatarLight from "../../../assets/avatars/avatar-light.png";
import compressingPng from "../../../assets/compressing.png";
import { resolveConversationCharacter } from "../character-assets";
import { ConversationCharacterCard } from "../components/ConversationCharacterCard";
import { extractCyreneImageRequest } from "../../../../../shared/cyrene-image-request";
import { AmbientFocusWidget } from "../../ambient/AmbientFocusWidget";
import { MemoryAlbumModal } from "../../album/MemoryAlbumModal";
import { VisionCopilotModal } from "../../copilot/VisionCopilotModal";
import { DailyPodcastModal } from "../../podcast/DailyPodcastModal";
import { TrpgGameModal } from "../../game-room/TrpgGameModal";
import { SpotlightCapsule } from "../../spotlight/SpotlightCapsule";
import { AffectionModal } from "../../affection/AffectionModal";
import { ProactiveAssistantModal } from "../../proactive/ProactiveAssistantModal";

const CONVERSATION_MODES: readonly ConversationMode[] = ["chat", "work", "code", "learn", "daily"];

function isConversationMode(value: string): value is ConversationMode {
  return CONVERSATION_MODES.includes(value as ConversationMode);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 校驗後端發來的 cyrene.weather 卡片資料，返回 renderer 側 WeatherData。 */
function normalizeWeatherData(value: unknown): WeatherData | undefined {
  const card = asRecord(value);
  if (!card) return undefined;

  const source = asNonEmptyString(card.source);
  const location = asRecord(card.location);
  const province = asNonEmptyString(location?.province);
  const city = asNonEmptyString(location?.city);
  const temp = typeof card.temp === "number" ? card.temp : undefined;
  const humidity = typeof card.humidity === "number" ? card.humidity : undefined;

  if (!source || !province || !city || temp === undefined || humidity === undefined) {
    return undefined;
  }

  if (source === "open-meteo") {
    const weatherCode = typeof card.weatherCode === "number" ? card.weatherCode : undefined;
    const windDeg = typeof card.windDeg === "number" ? card.windDeg : undefined;
    const windSpeed = typeof card.windSpeed === "number" ? card.windSpeed : undefined;
    if (weatherCode === undefined || windDeg === undefined || windSpeed === undefined) return undefined;
    return {
      source: "open-meteo",
      location: { province, city },
      weatherCode,
      temp,
      feelsLike: typeof card.feelsLike === "number" ? card.feelsLike : temp,
      humidity,
      windDeg,
      windSpeed,
      precipitation: typeof card.precipitation === "number" ? card.precipitation : 0,
      pressure: typeof card.pressure === "number" ? card.pressure : 0,
    };
  }

  if (source === "amap") {
    const weather = asNonEmptyString(card.weather);
    const windDirection = asNonEmptyString(card.windDirection);
    const windPower = asNonEmptyString(card.windPower);
    const reporttime = asNonEmptyString(card.reporttime);
    if (!weather || !windDirection || !windPower || !reporttime) return undefined;
    return {
      source: "amap",
      location: { province, city },
      weather,
      temp,
      humidity,
      windDirection,
      windPower,
      reporttime,
    };
  }

  return undefined;
}

const DEMO_RESPONSES: Readonly<Record<string, string>> = {
  "1": "收到啦♪ 這是一條普通會話訊息。今天也一起把介面慢慢打磨得更舒服吧。",
  "2": [
    "## Markdown 渲染測試",
    "",
    "這是一段包含 **粗體**、*斜體* 和 `行內程式碼` 的內容。",
    "",
    "- 第一項：訊息列表使用 Bubble",
    "- 第二項：正文使用 XMarkdown",
    "- 第三項：樣式仍由昔漣主題控制",
    "",
    "> 這是一段引用，用來觀察間距、顏色和左側邊線。",
    "",
    "| 功能 | 狀態 |",
    "| --- | --- |",
    "| Markdown | 正常 |",
    "| 表格 | 正常 |",
  ].join("\n"),
  "3": String.raw`數學公式測試開始♪

行內公式：$E = mc^2$

塊級公式：

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

再來一個二次方程：

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$`,
  "4": [
    "下面是一段 TypeScript 程式碼，用來測試語法高亮和複製功能：",
    "",
    "```ts",
    "type CyreneMode = \"work\" | \"chat\" | \"code\" | \"learn\" | \"daily\";",
    "",
    "function greeting(mode: CyreneMode): string {",
    "  return mode === \"chat\"",
    "    ? \"昔漣期待和你一起聊天♪\"",
    "    : `當前模式：${mode}`;",
    "}",
    "",
    "console.log(greeting(\"chat\"));",
    "```",
  ].join("\n"),
};

const DEMO_STICKERS: Readonly<Record<string, string>> = {
  "5": "playful",
};

interface ChatStoreApi {
  list: (options?: { mode?: ConversationMode }) => Promise<ChatSessionMeta[]>;
  get: (id: string) => Promise<ChatSession | null>;
  create: (input: { identityId?: string | null; mode: ConversationMode; title?: string; multiAgent?: boolean }) => Promise<ChatSession>;
  append: (id: string, message: ChatMessage) => Promise<ChatSession | null>;
  replaceTail: (id: string, startIndex: number, messages: ChatMessage[]) => Promise<ChatSession | null>;
  setMessageTtsCacheKey: (id: string, messageId: string, cacheKey: string, converterVersion: string) => Promise<ChatSession | null>;
  rename: (id: string, title: string) => Promise<ChatSession | null>;
  delete: (id: string) => Promise<boolean>;
  setPinned: (id: string, pinned: boolean) => Promise<ChatSession | null>;
  setModelProfile: (id: string, modelProfileId?: string) => Promise<ChatSession | null>;
  pickWorkspaceFolder: () => Promise<{ ok: boolean; path?: string; displayName?: string; error?: string }>;
  setWorkspace: (sessionId: string, workspaceRoot: string) => Promise<{ ok: boolean; error?: string; isEmpty?: boolean }>;
  initLearnWorkspace: (sessionId: string) => Promise<{ ok: boolean; error?: string; created?: string[]; skipped?: string[] }>;
  openWorkspace: (workspaceRoot: string) => Promise<{ ok: boolean; error?: string }>;
  setActiveSession: (sessionId: string | null) => Promise<unknown>;
  onChanged: (callback: () => void) => () => void;
  setCodeMode: (sessionId: string, clineMode: "plan" | "act") => Promise<{
    ok: boolean;
    error?: string;
    session?: ChatSession;
  }>;
  // main → reactChatWindow：通知 ChatPage 切換到指定 sessionId
  onReactSwitchSession: (callback: (sessionId: string) => void) => () => void;
  // reactChatWindow → main：ChatPage 已掛好 IPC 監聽，允許 flush pending sessionId
  notifyReactReady: () => void;
  // 初始載入 TODO 狀態，保證卡片常駐
  getCurrentTodos: () => Promise<Record<"work" | "daily" | "learn", TodoState>>;
}

interface SidebarApi {
  openSettings: (section?: string) => void;
}

interface AguiEvent {
  type?: string;
  runId?: string;
  messageId?: string;
  delta?: string;
  message?: string;
  error?: string;
  content?: string;
  name?: string;
  value?: unknown;
  toolCallId?: string;
  toolCallName?: string;
  stepName?: string;
  status?: string;
}

interface AguiApi {
  run: (input: {
    messages: Array<{ role: "user" | "model"; content: string; at?: number }>;
    userTurnId: string;
    assistantTurnId: string;
    styleId?: string;
    sessionId: string;
    imageAttachments?: Array<{ name: string; filePath: string; mime?: string }>;
  }) => Promise<{ success: boolean; error?: string }>;
  onEvent: (callback: (event: AguiEvent) => void) => () => void;
  cancel: (runId?: string) => Promise<unknown>;
}

interface ChoiceApi {
  resolve: (id: string, value: unknown) => Promise<{ ok: boolean }>;
}

interface PermissionApprovalRequest {
  id: string;
  toolId: string;
  toolName: string;
  toolDescription: string;
  args: Record<string, unknown>;
  risk: string;
}

interface SettingsApprovalApi {
  onPermissionApprovalRequest: (callback: (request: PermissionApprovalRequest) => void) => () => void;
  resolvePermissionApproval: (id: string, allowed: boolean) => Promise<{ ok: boolean }>;
}

interface PublicModelConfig {
  model?: unknown;
  displayName?: string;
  stickerSize?: "small" | "standard" | "large";
}

interface ModelConfigApi {
  get: () => Promise<PublicModelConfig>;
  onChanged: (callback: (config: PublicModelConfig) => void) => () => void;
}

function chatStore(): ChatStoreApi | undefined {
  return (window as typeof window & { chatStore?: ChatStoreApi }).chatStore;
}

function sidebarApi(): SidebarApi | undefined {
  return (window as typeof window & { sidebar?: SidebarApi }).sidebar;
}

function aguiApi(): AguiApi | undefined {
  return (window as typeof window & { agui?: AguiApi }).agui;
}

function choiceApi(): ChoiceApi | undefined {
  return (window as typeof window & { choice?: ChoiceApi }).choice;
}

function settingsApprovalApi(): SettingsApprovalApi | undefined {
  return (window as typeof window & { settings?: SettingsApprovalApi }).settings;
}

function codeRunApi(): CodeRunApi | undefined {
  return (window as typeof window & { codeRun?: CodeRunApi }).codeRun;
}

function permissionInteraction(request: PermissionApprovalRequest): ComposerInteraction {
  const target = [request.args.path, request.args.filePath]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return {
    kind: "permission",
    id: request.id,
    toolName: request.toolName || request.toolId,
    summary: describePermissionRequest(request),
    targetPath: target,
  };
}

function stageForStep(stepName: string | undefined): AgentRunStage | undefined {
  if (stepName === "agent-graph-action-gate") return { kind: "understanding" };
  if (stepName === "agent-graph-plan") return { kind: "planning" };
  if (stepName === "agent-graph-soul") return { kind: "responding" };
  if (stepName?.startsWith("agent-graph-tool-")) {
    return { kind: "executing", detail: stepName.slice("agent-graph-tool-".length) };
  }
  return undefined;
}

function toUiMessages(session: ChatSession): ChatMessageItem[] {
  return session.messages.map((message) => ({
    id: message.id,
    role: message.role === "model" ? "assistant" : "user",
    content: message.content,
    reasoning: message.reasoning,
    reasoningBlocks: message.reasoningBlocks,
    runActivity: message.runActivity,
    ttsCacheKey: message.ttsCacheKey,
    ttsCacheVersion: message.ttsCacheVersion,
    responseStarted: message.role === "model",
    sticker: message.sticker,
    toolExecutions: message.toolExecutions,
    taskDelegations: message.taskDelegations,
    runId: message.runSnapshot?.runId,
    attachments: message.attachments,
  }));
}

/**
 * React 視窗會話開啟的純函式 helper：
 * 從同目錄的 openSessionByDeps 模組 re-export 出來，便於 ChatPage 內部元件與
 * 獨立測試檔案共享同一份實現。
 */
export {
  normalizeSessionMode,
  openSessionByIdWithDeps,
  type ReactSessionMode,
  type OpenSessionArgs,
};

const LAST_MODE_STORAGE_KEY = "cyrene-react-last-mode";

function getInitialMode(): ConversationMode {
  try {
    const requested = new URLSearchParams(window.location.search).get("mode");
    if (requested && isConversationMode(requested)) return requested;
    const saved = localStorage.getItem(LAST_MODE_STORAGE_KEY);
    if (saved && isConversationMode(saved)) return saved;
  } catch {
    // localStorage 不可用或資料異常時回退到預設值
  }
  return "chat";
}

export function ChatPage() {
  const preferredAddress = useUserCallPreference();
  const [collapsed, setCollapsed] = useState(false);
  const [utilityPanel, setUtilityPanel] = useState<"model" | "skill" | "tool" | null>(null);
  const [reviewInspector, setReviewInspector] = useState<{ runId: string; fileIndex: number } | null>(null);
  const [mode, setMode] = useState<ConversationMode>(getInitialMode);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [messagesByMode, setMessagesByMode] = useState<Partial<Record<ConversationMode, ChatMessageItem[]>>>({});
  const [modelProfilesBySession, setModelProfilesBySession] = useState<Record<string, string | undefined>>({});
  const [workspaceNames, setWorkspaceNames] = useState<Partial<Record<ConversationMode, string>>>({});
  const [attachmentsByScope, setAttachmentsByScope] = useState<Record<string, ComposerAttachment[]>>({});
  const [sessionsByMode, setSessionsByMode] = useState<Partial<Record<ConversationMode, ChatSessionMeta[]>>>({});
  const [activeSessionIds, setActiveSessionIds] = useState<Partial<Record<ConversationMode, string>>>({});
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [modelBusyByMode, setModelBusyByMode] = useState<Partial<Record<ConversationMode, boolean>>>({});
  const [isCompressingContext, setIsCompressingContext] = useState(false);
  const [composerInteraction, setComposerInteraction] = useState<ComposerInteraction>();
  const [interactionBusy, setInteractionBusy] = useState(false);
  const [lastTurnRevisionStarting, setLastTurnRevisionStarting] = useState(false);
  const [modelName, setModelName] = useState("模型未連線");
  const [modelDisplayName, setModelDisplayName] = useState("");
  const [selectedClineMode, setSelectedClineMode] = useState<"plan" | "act">("act");
  const [stickerSize, setStickerSize] = useState<"small" | "standard" | "large">("standard");
  const [isAmbientWidgetOpen, setIsAmbientWidgetOpen] = useState(false);
  const [isAlbumOpen, setIsAlbumOpen] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isPodcastOpen, setIsPodcastOpen] = useState(false);
  const [isTrpgOpen, setIsTrpgOpen] = useState(false);
  const [isAffectionOpen, setIsAffectionOpen] = useState(false);
  const [isProactiveOpen, setIsProactiveOpen] = useState(false);
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSpotlightOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);
  const [todoStateByMode, setTodoStateByMode] = useState<Partial<Record<"work" | "daily" | "learn", TodoState>>>({});
  const activeModeRef = useRef(mode);
  const activeSessionIdsRef = useRef(activeSessionIds);
  const activeScopeRef = useRef(`mode:${mode}`);
  const sessionSelectionGeneration = useRef(0);
  const dragDepthRef = useRef(0);
  const localPreviewUrlsRef = useRef(new Set<string>());
  const demoTimers = useRef(new Set<number>());
  const activeRunsBySession = useRef<Record<string, { assistantId: string; runId?: string; mode: ConversationMode }>>({});
  // bootstrap 標誌：只由 cold-start finally 寫入；模式切換 effect 僅檢查
  const bootstrapCompletedRef = useRef(false);
  // 長期持有的會話操作 ref：避免 IPC 回撥捕獲陳舊閉包
  const openSessionByIdRef = useRef<(id: string) => Promise<boolean>>(async () => false);
  const refreshSessionsRef = useRef<
    (targetMode: ConversationMode, selectCurrent: boolean) => Promise<void>
  >(async () => {});
  // IPC 切換序列鏈：保證 Ready 後連續切換按順序完成
  const reactSessionSwitchChainRef = useRef<Promise<void>>(Promise.resolve());
  // 滾動到底部按鈕狀態
  const [scrollToBottomVisible, setScrollToBottomVisible] = useState(false);
  const scrollToBottomRef = useRef<() => void>(() => {});

  useEffect(() => {
    const api = aguiApi();
    if (!api) return;

    // 初始同步：從 main 載入各模式 TODO，保證卡片常駐顯示
    const store = chatStore();
    if (store?.getCurrentTodos) {
      store
        .getCurrentTodos()
        .then((state) => {
          if (state) {
            setTodoStateByMode(state);
          }
        })
        .catch(() => {});
    }

    return api.onEvent((event) => {
      if (event.type === "CUSTOM" && event.name === "cyrene.todos") {
        const incoming = (event.value as TodoState) ?? { todos: [] };
        const mode = incoming.mode;
        if (mode === "work" || mode === "daily" || mode === "learn") {
          setTodoStateByMode((prev) => ({ ...prev, [mode]: incoming }));
        }
      }
    });
  }, []);

  useEffect(() => {
    const settings = settingsApprovalApi();
    if (!settings) return;
    return settings.onPermissionApprovalRequest((request) => {
      setInteractionBusy(false);
      setComposerInteraction(permissionInteraction(request));
      const currentMode = activeModeRef.current;
      const currentSessionId = activeSessionIdsRef.current[currentMode];
      const activeRun = currentSessionId ? activeRunsBySessionRef.current[currentSessionId] : undefined;
      if (activeRun) {
        updateMessage(currentMode, activeRun.assistantId, { runStage: { kind: "waiting_permission" } });
      }
    });
  }, []);

  useEffect(() => {
    const modelConfig = (window as typeof window & { modelConfig?: ModelConfigApi }).modelConfig;
    if (!modelConfig) return;
    let active = true;
    const apply = (config: PublicModelConfig) => {
      if (!active) return;
      setModelName(typeof config.model === "string" && config.model.trim() ? config.model.trim() : "模型未連線");
      setModelDisplayName(typeof config.displayName === "string" ? config.displayName.trim() : "");
      setStickerSize(config.stickerSize === "small" || config.stickerSize === "large" ? config.stickerSize : "standard");
    };
    void modelConfig.get().then(apply).catch(() => {
      if (active) setModelName("模型未連線");
    });
    const off = modelConfig.onChanged(apply);
    return () => {
      active = false;
      off();
    };
  }, []);
  const modelBusyByModeRef = useRef<Partial<Record<ConversationMode, boolean>>>({});
  const lastTurnRevisionStartingRef = useRef(false);
  const activeAguiOffRef = useRef<(() => void) | null>(null);
  const activeRunsBySessionRef = useRef(activeRunsBySession);
  const [pendingQueueBySession, setPendingQueueBySession] = useState<Record<string, { id: string; rawContent: string; visibleContent: string; attachments: ComposerAttachment[]; userSticker?: string }[]>>({});
  const pendingQueueBySessionRef = useRef(pendingQueueBySession);
  useEffect(() => {
    pendingQueueBySessionRef.current = pendingQueueBySession;
  }, [pendingQueueBySession]);
  const activeEarlyTtsRef = useRef<{
    queue: EarlyTtsPlaybackQueue;
    mode: ConversationMode;
    sessionId: string;
    messageId: string;
  } | null>(null);

  const taskLabel = ["work", "daily", "code"].includes(mode) ? "新建任務" : "新建對話";
  const activeSessionId = activeSessionIds[mode];
  const scopeKey = activeSessionId ?? `mode:${mode}`;
  const draft = drafts[scopeKey] ?? "";
  const messages = messagesByMode[mode] ?? [];
  const hasMessages = messages.length > 0;
  const attachments = attachmentsByScope[scopeKey] ?? [];
  const sessions = sessionsByMode[mode] ?? [];
  const activeSessionMeta = sessions.find((session) => session.id === activeSessionId);
  const activeCharacterIds = activeSessionMeta?.participantIdentityIds?.length
    ? activeSessionMeta.participantIdentityIds
    : [mode === "chat" ? "cyrene" : activeSessionMeta?.identityId];
  const activeCharacters = activeCharacterIds
    .map(resolveConversationCharacter)
    .filter((character): character is NonNullable<typeof character> => Boolean(character));
  const activeCharacter = activeCharacters[0];
  const isMultiAgentConversation = activeCharacters.length >= 2;

  activeModeRef.current = mode;
  activeSessionIdsRef.current = activeSessionIds;
  activeScopeRef.current = scopeKey;

  // 快取使用者最後停留的模式，下次開啟視窗時恢復
  useEffect(() => {
    try {
      localStorage.setItem(LAST_MODE_STORAGE_KEY, mode);
    } catch {
      // 忽略寫入失敗
    }
  }, [mode]);

  useEffect(() => () => {
    for (const timer of demoTimers.current) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    }
    demoTimers.current.clear();
    activeAguiOffRef.current?.();
    activeAguiOffRef.current = null;
    activeEarlyTtsRef.current?.queue.cancel();
    activeEarlyTtsRef.current = null;
    for (const url of localPreviewUrlsRef.current) URL.revokeObjectURL(url);
    localPreviewUrlsRef.current.clear();
  }, []);

  useEffect(() => window.chat?.onScreenshotInsert?.((data) => {
    const targetScope = activeScopeRef.current;
    const attachment: ComposerAttachment = {
      kind: "image",
      name: `截圖_${Date.now()}.png`,
      filePath: data.filePath,
      mime: data.mime,
      previewUrl: data.previewUrl,
      hasAnnotations: data.hasAnnotations,
    };
    setAttachmentsByScope((current) => ({
      ...current,
      [targetScope]: [...(current[targetScope] ?? []), attachment],
    }));
  }), []);

  useEffect(() => {
    const store = chatStore();
    if (!store) return;
    const refresh = () => void refreshSessions(activeModeRef.current, true);
    const off = store.onChanged(refresh);
    return off;
  }, []);

  // 模式 effect：bootstrap 完成後才重新整理；bootstrap 自身由下方合併 effect 接管
  useEffect(() => {
    if (!bootstrapCompletedRef.current) return;
    void refreshSessionsRef.current(mode, true).catch((error) => {
      console.error("[ChatPage] Failed to refresh sessions after mode change:", error);
    });
  }, [mode]);

  // 合併 effect：註冊 IPC → cold-start → finally 置 bootstrap + 通知 ready
  useEffect(() => {
    const store = chatStore();
    if (!store?.onReactSwitchSession) return;

    let disposed = false;

    const unsubscribe = store.onReactSwitchSession((sessionId) => {
      if (!sessionId) return;
      reactSessionSwitchChainRef.current = reactSessionSwitchChainRef.current
        .then(async () => {
          const opened = await openSessionById(sessionId);
          if (!opened) {
            await refreshSessionsRef.current(activeModeRef.current, true);
          }
        })
        .catch(async (error) => {
          console.error("[ChatPage] Failed to switch React session:", error);
          try {
            await refreshSessionsRef.current(activeModeRef.current, true);
          } catch (fallbackError) {
            console.error("[ChatPage] Switch fallback failed:", fallbackError);
          }
        });
    });

    void (async () => {
      try {
        const urlSessionId = new URLSearchParams(window.location.search).get("sessionId");
        if (urlSessionId) {
          const opened = await openSessionById(urlSessionId);
          if (!opened) {
            await refreshSessionsRef.current(activeModeRef.current, true);
          }
        } else {
          await refreshSessionsRef.current(activeModeRef.current, true);
        }
      } catch (error) {
        console.error("[ChatPage] Failed to bootstrap React session:", error);
        try {
          await refreshSessionsRef.current(activeModeRef.current, true);
        } catch (fallbackError) {
          console.error("[ChatPage] Bootstrap fallback failed:", fallbackError);
        }
      } finally {
        // cold-start 全程完成才標記 bootstrap 完成；只有該標誌置位後
        // mode 切換 effect 才會觸發 refreshSessions
        bootstrapCompletedRef.current = true;
        if (!disposed) store.notifyReactReady?.();
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const active = activeEarlyTtsRef.current;
    if (active && (active.mode !== mode || active.sessionId !== activeSessionId)) {
      active.queue.cancel();
      activeEarlyTtsRef.current = null;
    }
  }, [activeSessionId, mode]);

  function updateMessage(targetMode: ConversationMode, id: string, patch: Partial<ChatMessageItem>) {
    setMessagesByMode((current) => ({
      ...current,
      [targetMode]: (current[targetMode] ?? []).map((item) => (
        item.id === id ? { ...item, ...patch } : item
      )),
    }));
  }

  function handleTtsCacheKey(
    targetMode: ConversationMode,
    sessionId: string,
    messageId: string,
    cacheKey: string,
    converterVersion: string,
  ) {
    updateMessage(targetMode, messageId, { ttsCacheKey: cacheKey, ttsCacheVersion: converterVersion });
    void chatStore()?.setMessageTtsCacheKey(sessionId, messageId, cacheKey, converterVersion);
  }

  function createEarlyTtsQueue(
    targetMode: ConversationMode,
    sessionId: string,
    messageId: string,
  ): EarlyTtsPlaybackQueue {
    activeEarlyTtsRef.current?.queue.cancel();
    const queue = new EarlyTtsPlaybackQueue(
      async (segment) => {
        if (
          activeModeRef.current !== targetMode
          || activeSessionIdsRef.current[targetMode] !== sessionId
          || activeEarlyTtsRef.current?.queue !== queue
        ) return "interrupted";
        return await playTtsToCompletion({
          conversationId: sessionId,
          messageId,
          text: segment,
          speechMode: targetMode === "learn" ? "learn" : "default",
          preferredAddress,
          automatic: true,
        });
      },
      stopTtsPlayback,
    );
    activeEarlyTtsRef.current = { queue, mode: targetMode, sessionId, messageId };
    return queue;
  }

  function finishEarlyTtsQueue(queue: EarlyTtsPlaybackQueue, fullText: string): void {
    void queue.finish(fullText).finally(() => {
      const active = activeEarlyTtsRef.current;
      if (active?.queue !== queue) return;
      const playback = getTtsPlaybackSnapshot();
      if (playback.messageId === active.messageId && playback.status === "completed") stopTtsPlayback();
      activeEarlyTtsRef.current = null;
    });
  }

  async function selectSession(sessionId: string, targetMode: ConversationMode = mode) {
    const store = chatStore();
    if (!store) return;
    const generation = ++sessionSelectionGeneration.current;
    const session = await store.get(sessionId);
    if (!session || generation !== sessionSelectionGeneration.current) return;
    setActiveSessionIds((current) => {
      const next = { ...current, [targetMode]: sessionId };
      activeSessionIdsRef.current = next;
      return next;
    });
    const uiMessages = toUiMessages(session);
    setModelProfilesBySession((current) => ({ ...current, [sessionId]: session.modelProfileId }));
    if (targetMode === "code") {
      setSelectedClineMode(session.codeSession?.clineMode ?? "act");
      const api = codeRunApi();
      if (api) {
        try {
          const restored = await restoreCodeRunViewModel(createCodeRunViewModel(), api, sessionId);
          if (generation !== sessionSelectionGeneration.current) return;
          if (restored.run || restored.card) {
            const assistantIndex = uiMessages.findLastIndex((message) => message.role === "assistant");
            if (assistantIndex >= 0) uiMessages[assistantIndex] = { ...uiMessages[assistantIndex], codeRun: restored };
            else uiMessages.push({
              id: `code-run-${restored.run?.runId ?? sessionId}`,
              role: "assistant",
              content: "",
              responseStarted: false,
              codeRun: restored,
            });
          }
          const verificationInteraction = normalizeCodeVerificationInteraction(restored.approval);
          if (verificationInteraction) {
            setComposerInteraction(verificationInteraction);
          } else {
            const pendingAsks = await api.getPendingAsks(sessionId);
            const askInteraction = normalizeCodeAskInteraction(pendingAsks[0]);
            setComposerInteraction(askInteraction);
          }
        } catch (error) {
          console.warn("[Cyrene React] 恢復 Code 執行狀態失敗:", error);
        }
      }
    }
    setMessagesByMode((current) => ({ ...current, [targetMode]: uiMessages }));
    setWorkspaceNames((current) => ({
      ...current,
      [targetMode]: session.workspaceBinding?.displayName,
    }));
    if (targetMode === activeModeRef.current) {
      void store.setActiveSession(sessionId);
      if (window.self !== window.top) {
        window.parent.postMessage({ type: "active-session-changed", sessionId }, "*");
      }
    }
  }

  /**
   * 通過 ref 暴露給 IPC 切換鏈和初始化 effect；成功切換後同步寫回 URL，
   * 不觸發頁面重新載入。
   */
  async function openSessionById(sessionId: string): Promise<boolean> {
    const opened = await openSessionByIdRef.current(sessionId);
    if (opened && typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("sessionId", sessionId);
        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      } catch {
        // 忽略 URL 同步失敗，不影響會話切換
      }
    }
    return opened;
  }

  // 同步 openSessionByIdRef：每次 chatStore / selectSession 變更時重新打包
  useEffect(() => {
    openSessionByIdRef.current = (sessionId: string) =>
      openSessionByIdWithDeps({
        sessionId,
        getSession: async (id) => {
          const store = chatStore();
          if (!store) return null;
          const result = await store.get(id);
          return (result ?? null) as { mode?: string } | null;
        },
        selectSession: async (id, mode) => {
          // ReactSessionMode ⊂ ConversationMode，可直接傳
          await selectSession(id, mode as ConversationMode);
        },
      });
  }, [chatStore, selectSession]);

  // 同步 refreshSessionsRef
  useEffect(() => {
    refreshSessionsRef.current = refreshSessions;
  }, [refreshSessions]);

  async function refreshSessions(targetMode: ConversationMode, selectCurrent: boolean) {
    const store = chatStore();
    if (!store) return;
    const listed = await store.list({ mode: targetMode });
    setSessionsByMode((current) => ({ ...current, [targetMode]: listed }));
    if (!selectCurrent) return;
    const currentId = activeSessionIdsRef.current[targetMode];
    const nextId = listed.some((session) => session.id === currentId) ? currentId : listed[0]?.id;
    if (nextId) {
      await selectSession(nextId, targetMode);
      return;
    }
    setActiveSessionIds((current) => {
      const next = { ...current };
      delete next[targetMode];
      activeSessionIdsRef.current = next;
      return next;
    });
    setMessagesByMode((current) => ({ ...current, [targetMode]: [] }));
    setWorkspaceNames((current) => ({ ...current, [targetMode]: undefined }));
    if (targetMode === activeModeRef.current) void store.setActiveSession(null);
  }

  function streamDemoResponse(targetMode: ConversationMode, id: string, response: string, sessionId?: string) {
    const earlyTtsQueue = sessionId ? createEarlyTtsQueue(targetMode, sessionId, id) : null;
    const loadingTimer = window.setTimeout(() => {
      demoTimers.current.delete(loadingTimer);
      updateMessage(targetMode, id, { loading: false, streaming: true, responseStarted: true });

      const characters = Array.from(response);
      const chunkSize = Math.max(1, Math.min(4, Math.ceil(characters.length / 120)));
      let cursor = 0;
      let spokenCursor = 0;
      const streamTimer = window.setInterval(() => {
        cursor = Math.min(characters.length, cursor + chunkSize);
        const finished = cursor >= characters.length;
        earlyTtsQueue?.append(characters.slice(spokenCursor, cursor).join(""));
        spokenCursor = cursor;
        updateMessage(targetMode, id, {
          content: characters.slice(0, cursor).join(""),
          streaming: !finished,
        });
        if (finished) {
          window.clearInterval(streamTimer);
          demoTimers.current.delete(streamTimer);
          if (sessionId) {
            void chatStore()?.append(sessionId, {
              id,
              role: "model",
              content: response,
              at: Date.now(),
            }).then((saved) => {
              void refreshSessions(targetMode, false);
              if (saved) finishEarlyTtsQueue(earlyTtsQueue!, response);
              else earlyTtsQueue?.cancel();
            });
          } else {
            earlyTtsQueue?.cancel();
          }
        }
      }, 30);
      demoTimers.current.add(streamTimer);
    }, 450);
    demoTimers.current.add(loadingTimer);
  }

  async function runModel(input: {
    targetMode: "chat" | "work" | "daily" | "code";
    sessionId: string;
    userMessageId: string;
    assistantId: string;
    session: ChatSession;
    attachments: ComposerAttachment[];
  }) {
    const api = aguiApi();
    const store = chatStore();
    if (!api || !store) {
      const visibleError = "模型請求失敗：AG-UI 模型服務尚未就緒";
      updateMessage(input.targetMode, input.assistantId, {
        content: visibleError,
        loading: false,
        waitingForFirstEvent: false,
        streaming: false,
        responseStarted: true,
      });
      await store?.append(input.sessionId, {
        id: input.assistantId,
        role: "model",
        content: visibleError,
        at: Date.now(),
      });
      return;
    }

    modelBusyByModeRef.current = { ...modelBusyByModeRef.current, [input.targetMode]: true };
    activeRunsBySession.current = {
      ...activeRunsBySession.current,
      [input.sessionId]: { assistantId: input.assistantId, mode: input.targetMode },
    };
    activeRunsBySessionRef.current = activeRunsBySession;
    setModelBusyByMode((current) => ({ ...current, [input.targetMode]: true }));
    // 原版只有昔漣一位 assistant，因此所有模型串流都能交給昔漣 TTS。
    // 多人房的回覆屬於其他固定角色，不能讓昔漣代讀。
    const earlyTtsQueue = shouldUseCyreneAutoTts(input.session.participantIdentityIds)
      ? createEarlyTtsQueue(input.targetMode, input.sessionId, input.assistantId)
      : null;
    let streamContent = "";
    let reasoningContent = "";
    let reasoningBlocks: ReasoningBlock[] = [];
    let sticker: string | null = null;
    let toolExecutions: ToolExecutionRecord[] = [];
    let taskDelegations: TaskDelegationDisplayRecord[] = [];
    let canonicalRunId: string | undefined;
    let runStarted = false;
    let runActivity: RunActivityRecord | undefined;
    let codeRunViewModel: CodeRunViewModel = createCodeRunViewModel();
    const activeReasoningStarts = new Map<string, number>();
    let currentReasoningId: string | undefined;
    let resolveTerminal!: (error?: Error) => void;
    const terminal = new Promise<Error | undefined>((resolve) => {
      resolveTerminal = resolve;
    });
    const updateRunTool = (toolId: string, patch: Partial<ToolExecutionRecord>) => {
      const index = toolExecutions.findIndex((tool) => tool.id === toolId);
      toolExecutions = index === -1
        ? [...toolExecutions, { id: toolId, name: patch.name ?? "工具呼叫", status: patch.status ?? "running", result: patch.result }]
        : toolExecutions.map((tool, toolIndex) => toolIndex === index ? { ...tool, ...patch } : tool);
      updateMessage(input.targetMode, input.assistantId, { toolExecutions });
    };
    const publishRunActivity = () => {
      if (!runActivity) return;
      updateMessage(input.targetMode, input.assistantId, { runActivity: { ...runActivity } });
    };
    const publishCodeRun = () => {
      if (input.targetMode !== "code") return;
      updateMessage(input.targetMode, input.assistantId, { codeRun: { ...codeRunViewModel } });
    };
    const updateActiveReasoningStart = () => {
      const starts = [...activeReasoningStarts.values()];
      if (!runActivity) return;
      runActivity = {
        ...runActivity,
        activeReasoningStartedAt: starts.length ? Math.min(...starts) : undefined,
      };
    };
    const completeRunActivity = () => {
      if (!runActivity || runActivity.completedAt === undefined) {
        const completedAt = Date.now();
        for (const startedAt of activeReasoningStarts.values()) {
          runActivity = {
            ...(runActivity ?? { startedAt: completedAt, reasoningMs: 0 }),
            reasoningMs: (runActivity?.reasoningMs ?? 0) + Math.max(0, completedAt - startedAt),
          };
        }
        activeReasoningStarts.clear();
        runActivity = {
          ...(runActivity ?? { startedAt: completedAt, reasoningMs: 0 }),
          completedAt,
          activeReasoningStartedAt: undefined,
        };
        publishRunActivity();
      }
    };
    const markFirstResponse = () => {
      updateMessage(input.targetMode, input.assistantId, { waitingForFirstEvent: false });
    };
    const updateReasoningBlock = (id: string, patch: Partial<ReasoningBlock>) => {
      const index = reasoningBlocks.findIndex((block) => block.id === id);
      reasoningBlocks = index < 0
        ? [...reasoningBlocks, { id, content: "", afterToolCount: toolExecutions.length, ...patch }]
        : reasoningBlocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block);
      reasoningContent = reasoningBlocks.map((block) => block.content).filter(Boolean).join("\n\n");
      updateMessage(input.targetMode, input.assistantId, { reasoning: reasoningContent || undefined, reasoningBlocks });
    };

    const off = api.onEvent((event) => {
      if (event.type === "RUN_STARTED") {
        runStarted = true;
        runActivity = { startedAt: Date.now(), reasoningMs: 0 };
        setIsCompressingContext(false);
        if (event.runId) {
          canonicalRunId = event.runId;
          const existing = activeRunsBySession.current[input.sessionId];
          activeRunsBySession.current = {
            ...activeRunsBySession.current,
            [input.sessionId]: { ...(existing ?? { assistantId: input.assistantId, mode: input.targetMode }), runId: event.runId },
          };
          activeRunsBySessionRef.current = activeRunsBySession;
        }
        if (input.targetMode === "code" && event.runId) {
          codeRunViewModel = {
            ...codeRunViewModel,
            run: {
              runId: event.runId,
              chatSessionId: input.sessionId,
              clineSessionId: "",
              status: "running",
              startedAt: Date.now(),
            },
          };
          publishCodeRun();
        }
        updateMessage(input.targetMode, input.assistantId, {
          waitingForFirstEvent: false,
          runActivity: { ...runActivity },
          runStage: { kind: "understanding" },
        });
        return;
      }
      if (!runStarted) return;
      if (
        event.type === "REASONING_MESSAGE_START"
        || event.type === "REASONING_MESSAGE_CONTENT"
        || event.type === "REASONING_MESSAGE_END"
        || event.type === "TOOL_CALL_START"
        || event.type === "TOOL_CALL_RESULT"
        || event.type === "TOOL_CALL_END"
        || event.type === "TEXT_MESSAGE_START"
        || event.type === "TEXT_MESSAGE_CONTENT"
        || event.type === "TEXT_MESSAGE_END"
        || event.type === "CUSTOM"
      ) markFirstResponse();
      if (event.type === "REASONING_MESSAGE_START") {
        const reasoningId = event.messageId ?? crypto.randomUUID();
        currentReasoningId = reasoningId;
        activeReasoningStarts.set(reasoningId, Date.now());
        updateActiveReasoningStart();
        publishRunActivity();
        updateReasoningBlock(reasoningId, { streaming: true });
        updateMessage(input.targetMode, input.assistantId, {
          loading: false,
          reasoningStreaming: true,
          runStage: { kind: "responding" },
        });
      } else if (event.type === "REASONING_MESSAGE_CONTENT" && event.delta) {
        const reasoningId = event.messageId ?? currentReasoningId ?? crypto.randomUUID();
        currentReasoningId = reasoningId;
        const current = reasoningBlocks.find((block) => block.id === reasoningId)?.content ?? "";
        updateReasoningBlock(reasoningId, { content: current + event.delta, streaming: true });
        updateMessage(input.targetMode, input.assistantId, {
          reasoning: reasoningContent,
          loading: false,
          reasoningStreaming: true,
        });
      } else if (event.type === "REASONING_MESSAGE_END") {
        const reasoningId = event.messageId ?? currentReasoningId;
        if (reasoningId) {
          const startedAt = activeReasoningStarts.get(reasoningId);
          if (startedAt && runActivity) {
            runActivity = {
              ...runActivity,
              reasoningMs: runActivity.reasoningMs + Math.max(0, Date.now() - startedAt),
            };
          }
          activeReasoningStarts.delete(reasoningId);
          updateActiveReasoningStart();
          publishRunActivity();
          updateReasoningBlock(reasoningId, { streaming: false });
        }
        currentReasoningId = undefined;
        updateMessage(input.targetMode, input.assistantId, { reasoningStreaming: false, loading: false });
        } else if (event.type === "STEP_STARTED") {
          const stage = stageForStep(event.stepName);
          if (stage) updateMessage(input.targetMode, input.assistantId, { runStage: stage });
        } else if (event.type === "TOOL_CALL_START" && event.toolCallId) {
          updateRunTool(event.toolCallId, {
            name: event.toolCallName ?? "工具呼叫",
            status: "running",
          });
          updateMessage(input.targetMode, input.assistantId, {
            runStage: { kind: "executing", detail: event.toolCallName ?? "工具呼叫" },
          });
        } else if (event.type === "TOOL_CALL_RESULT" && event.toolCallId) {
        updateRunTool(event.toolCallId, {
          status: event.status === "failed" ? "error" : "success",
          result: (event.content ?? "").slice(0, 4000),
        });
      } else if (event.type === "TOOL_CALL_END" && event.toolCallId) {
        updateRunTool(event.toolCallId, {});
      } else if (event.type === "TEXT_MESSAGE_START") {
        updateMessage(input.targetMode, input.assistantId, {
          loading: false,
          reasoningStreaming: false,
          responseStarted: true,
          streaming: true,
          runStage: { kind: "responding" },
        });
      } else if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
        streamContent += event.delta;
        earlyTtsQueue?.append(event.delta);
        updateMessage(input.targetMode, input.assistantId, {
          content: streamContent,
          loading: false,
          streaming: true,
          responseStarted: true,
        });
      } else if (event.type === "TEXT_MESSAGE_END") {
        updateMessage(input.targetMode, input.assistantId, { streaming: false });
      } else if (event.type === "CUSTOM" && event.name === "cyrene.choice") {
        const interaction = normalizeChoiceInteraction(event.value);
        if (interaction) {
          setInteractionBusy(false);
          setComposerInteraction(interaction);
          updateMessage(input.targetMode, input.assistantId, { runStage: { kind: "waiting_user" } });
        }
      } else if (event.type === "CUSTOM" && event.name === "cyrene.choice.dismiss") {
        setComposerInteraction((current) => {
          if (current?.kind !== "ask" || !shouldDismissAsk(current, event.value)) return current;
          return undefined;
        });
      } else if (event.type === "CUSTOM" && event.name === "cyrene.taskPlan") {
        const taskPlan = normalizeTaskPlanPresentation(event.value);
        if (taskPlan) {
          updateMessage(input.targetMode, input.assistantId, {
            taskPlan,
            runStage: { kind: "executing" },
          });
        }
      } else if (event.type === "CUSTOM" && event.name === "cyrene.task") {
        const delegation = normalizeTaskDelegationEvent(event.value);
        if (delegation) {
          taskDelegations = applyTaskDelegationEvent(taskDelegations, delegation);
          updateMessage(input.targetMode, input.assistantId, {
            taskDelegations,
            runStage: { kind: "executing", detail: delegation.nickname },
          });
        }
      } else if (event.type === "CUSTOM" && event.name === "cyrene.compressingContext") {
        setIsCompressingContext(true);
      } else if (event.type === "CUSTOM" && event.name === "cyrene.sticker") {
        sticker = typeof event.value === "string" ? event.value : null;
        updateMessage(input.targetMode, input.assistantId, { sticker });
      } else if (event.type === "CUSTOM" && event.name === "cyrene.weather") {
        const weather = normalizeWeatherData(event.value);
        if (weather) {
          updateMessage(input.targetMode, input.assistantId, { weather });
        }
      } else if (event.type === "CUSTOM" && event.name === "code_ask") {
        const interaction = normalizeCodeAskInteraction(event.value);
        if (interaction) {
          setInteractionBusy(false);
          setComposerInteraction(interaction);
          updateMessage(input.targetMode, input.assistantId, { runStage: { kind: "waiting_user" } });
        }
      } else if (event.type === "CUSTOM" && (
        event.name === "code_verification_approval"
        || event.name === "code_verification_card"
      )) {
        const next = applyCodeRunEvent(codeRunViewModel, event);
        if (next !== codeRunViewModel) {
          codeRunViewModel = next;
          publishCodeRun();
        }
        if (event.name === "code_verification_approval") {
          const interaction = normalizeCodeVerificationInteraction(codeRunViewModel.approval);
          if (interaction) {
            setInteractionBusy(false);
            setComposerInteraction(interaction);
            updateMessage(input.targetMode, input.assistantId, { runStage: { kind: "waiting_permission" } });
          } else {
            setComposerInteraction((current) => (
              current?.kind === "permission"
              && current.source === "code_verification"
              && current.id === codeRunViewModel.approval?.approvalId
                ? undefined
                : current
            ));
          }
        }
      } else if (event.type === "RUN_FINISHED") {
        completeRunActivity();
        updateMessage(input.targetMode, input.assistantId, { runStage: { kind: "completed" } });
        resolveTerminal();
      } else if (event.type === "RUN_ERROR") {
        completeRunActivity();
        updateMessage(input.targetMode, input.assistantId, { runStage: { kind: "failed" } });
        resolveTerminal(new Error(event.message ?? event.error ?? event.content ?? "模型請求失敗"));
      }
    });
    activeAguiOffRef.current?.();
    activeAguiOffRef.current = off;

    try {
      const general = await window.chat?.getGeneralSettings?.();
      const ack = await api.run({
        messages: input.session.messages.slice(-16).map((item) => ({
          role: item.role,
          content: item.content,
          at: item.at,
        })),
        userTurnId: input.userMessageId,
        assistantTurnId: input.assistantId,
        styleId: general?.currentStyleId,
        sessionId: input.sessionId,
        imageAttachments: input.attachments
          .filter((attachment) => attachment.kind === "image" && attachment.filePath)
          .map((attachment) => ({
            name: attachment.name,
            filePath: attachment.filePath!,
            mime: attachment.mime,
          })),
      });
      if (!ack.success) throw new Error(ack.error ?? "模型請求發起失敗");
      const terminalError = await terminal;
      if (terminalError) throw terminalError;

      const finalContent = streamContent.trim() ? streamContent : "任務已完成。";
      updateMessage(input.targetMode, input.assistantId, {
        content: finalContent,
        loading: false,
        waitingForFirstEvent: false,
        streaming: false,
        reasoning: reasoningContent || undefined,
        reasoningBlocks,
        reasoningStreaming: false,
        runActivity,
        responseStarted: true,
        sticker,
        toolExecutions,
        taskDelegations,
        runId: canonicalRunId,
      });
      const savedAssistant = await store.append(input.sessionId, {
        id: input.assistantId,
        role: "model",
        content: finalContent,
        reasoning: reasoningContent || undefined,
        reasoningBlocks,
        runActivity,
        at: Date.now(),
        sticker,
        toolExecutions,
        taskDelegations,
        runSnapshot: canonicalRunId ? {
          runId: canonicalRunId,
          status: "terminal",
          terminalStatus: "success",
          updatedAt: Date.now(),
        } : undefined,
      });
      if (savedAssistant) {
        if (earlyTtsQueue) finishEarlyTtsQueue(earlyTtsQueue, finalContent);
      } else earlyTtsQueue?.cancel();
    } catch (error) {
      earlyTtsQueue?.cancel();
      completeRunActivity();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const visibleError = `模型請求失敗：${errorMessage}`;
      updateMessage(input.targetMode, input.assistantId, {
        content: visibleError,
        loading: false,
        waitingForFirstEvent: false,
        streaming: false,
        reasoningStreaming: false,
        runActivity,
        responseStarted: true,
      });
      await store.append(input.sessionId, {
        id: input.assistantId,
        role: "model",
        content: visibleError,
        runActivity,
        at: Date.now(),
      });
    } finally {
      off();
      if (activeAguiOffRef.current === off) activeAguiOffRef.current = null;
      const currentActive = activeRunsBySession.current[input.sessionId];
      if (currentActive?.assistantId === input.assistantId) {
        const nextActive = { ...activeRunsBySession.current };
        delete nextActive[input.sessionId];
        activeRunsBySession.current = nextActive;
        activeRunsBySessionRef.current = activeRunsBySession;
      }
      const nextBusy = { ...modelBusyByModeRef.current };
      delete nextBusy[input.targetMode];
      modelBusyByModeRef.current = nextBusy;
      setModelBusyByMode((current) => {
        const next = { ...current };
        delete next[input.targetMode];
        return next;
      });
      void refreshSessions(input.targetMode, false);
      // 當前 session 佇列中的下一條訊息自動消費
      const queue = pendingQueueBySessionRef.current[input.sessionId] ?? [];
      if (queue.length > 0) {
        const [next, ...rest] = queue;
        pendingQueueBySessionRef.current = { ...pendingQueueBySessionRef.current, [input.sessionId]: rest };
        setPendingQueueBySession(pendingQueueBySessionRef.current);
        const assistantId = crypto.randomUUID();
        void dispatchUserMessage({
          targetMode: input.targetMode,
          sessionId: input.sessionId,
          rawContent: next.rawContent,
          visibleContent: next.visibleContent,
          attachments: next.attachments,
          userSticker: next.userSticker,
          shouldRunModel: true,
          assistantId,
          userMessageId: next.id,
        });
      }
    }
  }

  function isSessionBusy(sessionId: string): boolean {
    return Boolean(activeRunsBySessionRef.current[sessionId]);
  }

  async function restartLastChatTurn(
    expectedUserMessageId: string,
    expectedAssistantMessageId: string,
    editedContent?: string,
  ): Promise<boolean> {
    if (
      activeModeRef.current !== "chat"
      || modelBusyByModeRef.current.chat
      || lastTurnRevisionStartingRef.current
    ) return false;
    const store = chatStore();
    const sessionId = activeSessionIdsRef.current.chat;
    if (!store || !sessionId) return false;
    lastTurnRevisionStartingRef.current = true;
    setLastTurnRevisionStarting(true);
    try {
      const session = await store.get(sessionId);
      if (!session || session.mode !== "chat") return false;
      const lastTurn = resolveRevisableLastTurn(session.messages, "chat");
      if (
        !lastTurn
        || lastTurn.userMessageId !== expectedUserMessageId
        || lastTurn.assistantMessageId !== expectedAssistantMessageId
      ) return false;

      const nextContent = editedContent === undefined ? undefined : editedContent.trim();
      if (editedContent !== undefined && !nextContent) return false;
      const userIndex = session.messages.length - 2;
      const previousUserMessage = session.messages[userIndex];
      const nextUserMessage: ChatMessage = nextContent === undefined
        ? previousUserMessage
        : {
            ...previousUserMessage,
            content: nextContent,
            at: Date.now(),
          };
      const truncatedSession = await store.replaceTail(sessionId, userIndex, [nextUserMessage]);
      if (!truncatedSession) return false;

      activeEarlyTtsRef.current?.queue.cancel();
      activeEarlyTtsRef.current = null;
      stopTtsPlayback();
      const assistantId = crypto.randomUUID();
      setMessagesByMode((current) => ({
        ...current,
        chat: [
          ...toUiMessages(truncatedSession),
          {
            id: assistantId,
            role: "assistant",
            content: "",
            loading: true,
            waitingForFirstEvent: true,
            streaming: false,
            responseStarted: false,
          },
        ],
      }));
      void runModel({
        targetMode: "chat",
        sessionId,
        userMessageId: nextUserMessage.id,
        assistantId,
        session: truncatedSession,
        attachments: (nextUserMessage.attachments ?? []).map((attachment) => ({ ...attachment })),
      });
      return true;
    } catch (error) {
      console.error("[Cyrene React] 重建最後一輪對話失敗:", error);
      return false;
    } finally {
      lastTurnRevisionStartingRef.current = false;
      setLastTurnRevisionStarting(false);
    }
  }

  async function editLastChatUserMessage(messageId: string, content: string): Promise<boolean> {
    const lastTurn = resolveRevisableLastTurn(messagesByMode.chat ?? [], "chat");
    if (!lastTurn || lastTurn.userMessageId !== messageId) return false;
    return restartLastChatTurn(lastTurn.userMessageId, lastTurn.assistantMessageId, content);
  }

  async function regenerateLastChatResponse(
    userMessageId: string,
    assistantMessageId: string,
  ): Promise<boolean> {
    return restartLastChatTurn(userMessageId, assistantMessageId);
  }

  async function ensureSession(targetMode: ConversationMode): Promise<string> {
    const existing = activeSessionIdsRef.current[targetMode];
    if (existing) return existing;
    const store = chatStore();
    if (!store) throw new Error("聊天會話服務尚未就緒");
    const session = await store.create({
      identityId: null,
      mode: targetMode,
      title: targetMode === "work" || targetMode === "code" || targetMode === "daily" ? "新任務" : "新對話",
    });
    await refreshSessions(targetMode, false);
    await selectSession(session.id, targetMode);
    return session.id;
  }



  async function initVaultStructure(sessionId: string) {
    const store = chatStore();
    if (!store) return;
    const confirmed = window.confirm(
      "要在當前 Obsidian Vault 中新增 Cyrene 通用學習結構嗎？只會建立缺失的檔案，不會覆蓋已有內容。"
    );
    if (!confirmed) return;
    const result = await store.initLearnWorkspace(sessionId);
    if (!result.ok) {
      window.alert(`新增學習結構失敗：${result.error ?? "未知錯誤"}`);
    } else {
      const created = result.created?.length ?? 0;
      const skipped = result.skipped?.length ?? 0;
      window.alert(`已建立 ${created} 個檔案/目錄${skipped > 0 ? `，跳過 ${skipped} 個已存在項` : ""}。`);
    }
  }

  async function chooseWorkspace(targetMode: ConversationMode = mode): Promise<boolean> {
    if (targetMode === "chat") return true;
    const store = chatStore();
    if (!store?.pickWorkspaceFolder || !store.setWorkspace) {
      window.alert("工作區服務尚未就緒，請重新開啟此頁後再試一次。");
      return false;
    }
    let picked: Awaited<ReturnType<ChatStoreApi["pickWorkspaceFolder"]>>;
    try {
      picked = await store.pickWorkspaceFolder();
    } catch (error) {
      window.alert(`無法開啟工作區選擇器：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    if (!picked.ok || !picked.path) {
      if (picked.error) window.alert(`選擇工作區失敗：${picked.error}`);
      return false;
    }
    const sessionId = await ensureSession(targetMode);
    const result = await store.setWorkspace(sessionId, picked.path);
    if (!result.ok) {
      window.alert(`設定工作區失敗：${result.error ?? "未知錯誤"}`);
      return false;
    }
    setWorkspaceNames((current) => ({ ...current, [targetMode]: picked.displayName ?? "工作資料夾" }));

    // Learn 模式：空目錄詢問是否初始化通用學習結構
    if (targetMode === "learn" && result.isEmpty) {
      const confirmed = window.confirm(
        "這是一個空目錄。Cyrene 可以在這裡建立通用學習工作區結構（materials/、notes/、exercises/、templates/、learn/progress.md），方便你之後和 Cyrene 一起學習。\n\n是否建立？"
      );
      if (confirmed) {
        await initVaultStructure(sessionId);
      }
    }

    await refreshSessions(targetMode, false);
    return true;
  }

  async function createNewTask() {
    const targetMode = mode;
    const store = chatStore();
    if (!store) return;
    let workspace: { path: string; displayName?: string } | undefined;
    if (targetMode === "work" || targetMode === "code" || targetMode === "daily" || targetMode === "learn") {
      // 同一專案下的新任務應繼承當前會話的可信工作區；只有還未選擇
      // 任何專案時才打開目錄選擇器，避免使用者為每個任務重複選一次。
      const activeId = activeSessionIdsRef.current[targetMode];
      const activeSession = activeId ? await store.get(activeId) : null;
      if (activeSession?.workspaceBinding?.workspaceRoot) {
        workspace = {
          path: activeSession.workspaceBinding.workspaceRoot,
          displayName: activeSession.workspaceBinding.displayName,
        };
      } else {
        const picked = await store.pickWorkspaceFolder();
        if (!picked.ok || !picked.path) return;
        workspace = { path: picked.path, displayName: picked.displayName };
      }
    }
    const session = await store.create({
      identityId: null,
      mode: targetMode,
      title: workspace ? "新任務" : "新對話",
    });
    if (workspace) {
      const result = await store.setWorkspace(session.id, workspace.path);
      if (!result.ok) {
        await store.delete(session.id);
        window.alert(`設定工作區失敗：${result.error ?? "未知錯誤"}`);
        return;
      }
      // Learn 模式：空目錄詢問是否初始化通用學習結構
      if (targetMode === "learn" && result.isEmpty) {
        const confirmed = window.confirm(
          "這是一個空目錄。Cyrene 可以在這裡建立通用學習工作區結構（materials/、notes/、exercises/、templates/、learn/progress.md），方便你之後和 Cyrene 一起學習。\n\n是否建立？"
        );
        if (confirmed) {
          await initVaultStructure(session.id);
        }
      }
    }
    await refreshSessions(targetMode, false);
    await selectSession(session.id, targetMode);
  }

  async function createMultiAgentConversation() {
    const store = chatStore();
    if (!store) return;
    const session = await store.create({
      identityId: null,
      mode: "chat",
      title: "多人對話",
      multiAgent: true,
    });
    setMode("chat");
    await refreshSessions("chat", false);
    await selectSession(session.id, "chat");
  }

  // 舊工作臺外框仍負責顯示主要對話清單。React 聊天嵌入 iframe 時，
  // 接回外框送出的建立／切換事件，避免按鈕看得到卻沒有任何作用。
  useEffect(() => {
    if (window.self === window.top) return;

    const handleWorkspaceMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "create-session") {
        void createNewTask();
        return;
      }
      if (event.data.type === "create-multi-session") {
        void createMultiAgentConversation();
        return;
      }
      if (event.data.type === "set-conversation-mode" && isConversationMode(event.data.value)) {
        setMode(event.data.value);
        return;
      }
      if (event.data.type === "switch-session" && typeof event.data.sessionId === "string") {
        void openSessionById(event.data.sessionId);
      }
    };

    window.addEventListener("message", handleWorkspaceMessage);
    return () => window.removeEventListener("message", handleWorkspaceMessage);
  });

  async function handleRenameSession(sessionId: string, newTitle: string) {
    const store = chatStore();
    if (!store?.rename) return;
    const title = newTitle.trim();
    if (!title) return;
    await store.rename(sessionId, title);
    await refreshSessionsRef.current(mode, false);
  }

  async function handleDeleteSession(sessionId: string) {
    const store = chatStore();
    if (!store) return;
    const ok = await store.delete(sessionId);
    if (!ok) return;
    await refreshSessionsRef.current(mode, true);
  }

  async function handleTogglePinSession(sessionId: string, pinned: boolean) {
    const store = chatStore();
    if (!store?.setPinned) return;
    await store.setPinned(sessionId, pinned);
    await refreshSessionsRef.current(mode, false);
  }

  async function changeClineMode(clineMode: "plan" | "act") {
    const store = chatStore();
    if (!store) return;
    const sessionId = await ensureSession("code");
    const previous = selectedClineMode;
    setSelectedClineMode(clineMode);
    try {
      const result = await store.setCodeMode(sessionId, clineMode);
      if (!result.ok) {
        setSelectedClineMode(previous);
        window.alert(`切換 Cline 模式失敗：${result.error ?? "未知錯誤"}`);
      }
    } catch (error) {
      setSelectedClineMode(previous);
      console.warn("[Cyrene React] 切換 Cline 模式失敗:", error);
    }
  }

  async function createNewClineTask() {
    const api = codeRunApi();
    const sessionId = activeSessionIdsRef.current.code;
    if (!api || !sessionId) return;
    try {
      const result = await api.createNewTask(sessionId);
      if (!result.ok) window.alert(`建立 Cline Task 失敗：${result.error ?? "未知錯誤"}`);
    } catch (error) {
      console.warn("[Cyrene React] 建立 Cline Task 失敗:", error);
    }
  }

  async function chooseFiles(files: File[]) {
    const targetScope = scopeKey;
    if (!window.chat || files.length === 0) return;
    setAttachmentBusy(true);
    const previewsByName = new Map<string, string[]>();
    for (const file of files) {
      if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) continue;
      const previewUrl = URL.createObjectURL(file);
      localPreviewUrlsRef.current.add(previewUrl);
      previewsByName.set(file.name, [...(previewsByName.get(file.name) ?? []), previewUrl]);
    }
    try {
      const results = await window.chat.ingestDroppedFiles(files);
      if (results.length > 0) {
        const hydratedResults = results.map((attachment) => {
          if (attachment.kind !== "image") return attachment;
          const previews = previewsByName.get(attachment.name);
          const localPreview = previews?.shift();
          return localPreview ? { ...attachment, previewUrl: localPreview } : attachment;
        });
        setAttachmentsByScope((current) => ({
          ...current,
          [targetScope]: [...(current[targetScope] ?? []), ...hydratedResults],
        }));
      }
    } catch (error) {
      window.alert(`檔案攝入失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAttachmentBusy(false);
    }
  }

  function updateMessageAttachments(
    targetMode: ConversationMode,
    messageId: string,
    updater: (attachments: ComposerAttachment[]) => ComposerAttachment[],
  ) {
    setMessagesByMode((current) => ({
      ...current,
      [targetMode]: (current[targetMode] ?? []).map((item) => (
        item.id === messageId
          ? { ...item, attachments: updater(item.attachments ?? []) }
          : item
      )),
    }));
  }

  async function prepareImageAttachments(
    targetMode: ConversationMode,
    messageId: string,
    attachments: ComposerAttachment[],
  ) {
    const images = attachments.filter((attachment) => attachment.kind === "image" && attachment.filePath);
    if (images.length === 0 || !window.chat) return;

    let strategy: { mode: "direct" | "caption" } = { mode: "caption" };
    try {
      strategy = await window.chat.getImageSendStrategy();
    } catch (error) {
      console.warn("[Cyrene React] 獲取圖片傳送策略失敗，回退視覺描述:", error);
    }

    if (strategy.mode === "direct") {
      const paths = new Set(images.map((image) => image.filePath));
      updateMessageAttachments(targetMode, messageId, (current) => current.map((attachment) => (
        paths.has(attachment.filePath)
          ? { ...attachment, imageSendMode: "direct", status: "done" }
          : attachment
      )));
      return;
    }

    for (const image of images) {
      updateMessageAttachments(targetMode, messageId, (current) => current.map((attachment) => (
        attachment.filePath === image.filePath
          ? { ...attachment, imageSendMode: "caption", status: "processing" }
          : attachment
      )));
      let result: { ok: boolean; caption?: string; error?: string };
      try {
        result = await window.chat.captionImage(image.filePath!, image.hasAnnotations === true);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      updateMessageAttachments(targetMode, messageId, (current) => current.map((attachment) => (
        attachment.filePath === image.filePath
          ? result.ok && result.caption
            ? { ...attachment, imageSendMode: "caption", status: "done", caption: result.caption, reason: undefined }
            : { ...attachment, imageSendMode: "caption", status: "error", reason: result.error ?? "圖片分析失敗" }
          : attachment
      )));
    }
  }

  function removeAttachment(index: number) {
    const targetScope = scopeKey;
    setAttachmentsByScope((current) => ({
      ...current,
      [targetScope]: (current[targetScope] ?? []).filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function containsFiles(dataTransfer: DataTransfer): boolean {
    return Array.from(dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void chooseFiles(files);
  }

  async function sendMessage(content: string) {
    const message = content.trim();
    if (!message) return;
    activeEarlyTtsRef.current?.queue.cancel();
    activeEarlyTtsRef.current = null;
    const stickerMatch = message.match(/\[sticker:([^\]]+)\]/);
    const userSticker = stickerMatch?.[1];
    const visibleMessage = message.replace(/\[sticker:[^\]]+\]/g, "").trim();
    const demoResponse = DEMO_RESPONSES[message];
    const demoSticker = DEMO_STICKERS[message];
    const cyreneImageRequest = mode === "chat" && attachments.length === 0
      ? extractCyreneImageRequest(visibleMessage)
      : null;
    const shouldRunModel = !cyreneImageRequest
      && shouldRunModelForMode(mode, Boolean(demoResponse), Boolean(demoSticker));
    const assistantId = demoResponse || demoSticker || shouldRunModel || cyreneImageRequest
      ? crypto.randomUUID()
      : undefined;
    const userMessageId = crypto.randomUUID();
    const attachmentsForMessage = attachments.map((attachment) => ({ ...attachment }));
    const targetMode = mode;
    if (["work", "code", "daily"].includes(targetMode) && !workspaceNames[targetMode]) {
      const workspaceReady = await chooseWorkspace(targetMode);
      if (!workspaceReady) return;
    }
    const sessionId = await ensureSession(targetMode);
    // 如果當前 session 正在跑模型，新訊息進入 composer 上方佇列，等當前 run 結束後自動傳送
    if (shouldRunModel && isSessionBusy(sessionId)) {
      const nextQueue = {
        ...pendingQueueBySessionRef.current,
        [sessionId]: [
          ...(pendingQueueBySessionRef.current[sessionId] ?? []),
          { id: userMessageId, rawContent: message, visibleContent, attachments: attachmentsForMessage, userSticker },
        ],
      };
      pendingQueueBySessionRef.current = nextQueue;
      setPendingQueueBySession(nextQueue);
      setDrafts((current) => ({ ...current, [scopeKey]: "" }));
      setAttachmentsByScope((current) => ({ ...current, [scopeKey]: [] }));
      return;
    }
    await dispatchUserMessage({
      targetMode,
      sessionId,
      rawContent: message,
      visibleContent: visibleMessage,
      attachments: attachmentsForMessage,
      userSticker,
      shouldRunModel,
      demoResponse,
      demoSticker,
      assistantId,
      userMessageId,
      cyreneImageRequest,
    });
  }

  async function dispatchUserMessage(input: {
    targetMode: ConversationMode;
    sessionId: string;
    rawContent: string;
    visibleContent: string;
    attachments: ComposerAttachment[];
    userSticker?: string;
    shouldRunModel: boolean;
    demoResponse?: string;
    demoSticker?: string;
    assistantId?: string;
    userMessageId: string;
    cyreneImageRequest?: string | null;
  }) {
    const { targetMode, sessionId, rawContent, visibleContent, attachments, userSticker, shouldRunModel, demoResponse, demoSticker, assistantId, userMessageId, cyreneImageRequest } = input;
    setMessagesByMode((current) => ({
      ...current,
      [targetMode]: [
        ...(current[targetMode] ?? []),
        {
          id: userMessageId,
          role: "user",
          content: visibleContent,
          sticker: userSticker,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        ...(assistantId ? [{
          id: assistantId!,
          role: "assistant" as const,
          content: "",
          loading: Boolean(demoResponse || shouldRunModel || cyreneImageRequest),
          waitingForFirstEvent: Boolean(shouldRunModel),
          streaming: false,
          responseStarted: Boolean(demoSticker || cyreneImageRequest),
          sticker: demoSticker,
        }] : []),
      ],
    }));
    setDrafts((current) => ({ ...current, [scopeKey]: "" }));
    setAttachmentsByScope((current) => ({ ...current, [scopeKey]: [] }));
    const updatedSession = await chatStore()?.append(sessionId, {
      id: userMessageId,
      role: "user",
      content: rawContent,
      at: Date.now(),
      sticker: userSticker,
      attachments: attachments
        .filter((attachment) => (attachment.kind === "image" || attachment.kind === "document") && attachment.filePath)
        .map((attachment) => attachment.kind === "image" ? {
          kind: "image" as const,
          name: attachment.name,
          filePath: attachment.filePath!,
          mime: attachment.mime ?? "application/octet-stream",
          caption: attachment.caption,
          status: "pending" as const,
        } : {
          kind: "document" as const,
          name: attachment.name,
          filePath: attachment.filePath!,
          status: "pending" as const,
        }),
    });
    void refreshSessions(targetMode, false);
    if (attachments.length > 0) {
      void prepareImageAttachments(targetMode, userMessageId, attachments);
    }
    if (cyreneImageRequest && assistantId && updatedSession) {
      await runCyreneImageRequest(targetMode, sessionId, assistantId, cyreneImageRequest);
    } else if (cyreneImageRequest && assistantId) {
      updateMessage(targetMode, assistantId, {
        content: "圖片生成失敗：使用者訊息未能寫入當前會話",
        loading: false,
        responseStarted: true,
      });
    } else if (demoResponse && assistantId) streamDemoResponse(targetMode, assistantId, demoResponse, sessionId);
    if (!cyreneImageRequest && shouldRunModel && assistantId && !updatedSession) {
      updateMessage(targetMode, assistantId, {
        content: "模型請求失敗：使用者訊息未能寫入當前會話",
        loading: false,
        waitingForFirstEvent: false,
        streaming: false,
        responseStarted: true,
      });
    } else if (!cyreneImageRequest && shouldRunModel && assistantId && updatedSession) {
      await runModel({
        targetMode,
        sessionId,
        userMessageId,
        assistantId,
        session: updatedSession,
        attachments,
      });
    }
  }

  async function runCyreneImageRequest(
    targetMode: ConversationMode,
    sessionId: string,
    assistantId: string,
    request: string,
  ) {
    const queuedText = "嗯……等我一下喔，我正在把你想看的模樣畫下來♪";
    updateMessage(targetMode, assistantId, {
      content: queuedText,
      loading: true,
      waitingForFirstEvent: false,
      responseStarted: true,
    });
    try {
      const result = await window.paint?.generateCyreneImage({ request, quality: "low", loraStrength: 0.8 });
      if (!result?.savedPath) throw new Error("圖片服務沒有回傳檔案。");
      const content = "畫好啦♪ 這是只給夥伴看的、屬於人家的這一刻。";
      const attachment = {
        kind: "image" as const,
        name: result.savedPath.split(/[\\/]/).pop() || "cyrene-lora.png",
        filePath: result.savedPath,
        mime: result.savedPath.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png",
        status: "done" as const,
      };
      updateMessage(targetMode, assistantId, {
        content,
        attachments: [attachment],
        loading: false,
        streaming: false,
      });
      await chatStore()?.append(sessionId, {
        id: assistantId,
        role: "model",
        content,
        at: Date.now(),
        modelContext: result.prompt ? `本輪已使用昔漣 LoRA 生成圖片。Prompt: ${result.prompt}` : undefined,
        attachments: [attachment],
      });
      void refreshSessions(targetMode, false);
    } catch (error) {
      const content = `唔……這次的光沒有凝成圖片。${error instanceof Error ? error.message : String(error)}`;
      updateMessage(targetMode, assistantId, {
        content,
        loading: false,
        waitingForFirstEvent: false,
        responseStarted: true,
      });
      await chatStore()?.append(sessionId, {
        id: assistantId,
        role: "model",
        content,
        at: Date.now(),
      });
      void refreshSessions(targetMode, false);
    }
  }

  async function cancelCurrentRun() {
    const sessionId = activeSessionId;
    if (!sessionId) return;
    const activeRun = activeRunsBySession.current[sessionId];
    if (!activeRun?.runId) return;
    updateMessage(activeRun.mode, activeRun.assistantId, {
      streaming: false,
      loading: false,
      waitingForFirstEvent: false,
      responseStarted: true,
    });
    await aguiApi()?.cancel(activeRun.runId);
  }

  function removeQueuedMessage(sessionId: string, id: string) {
    const next = {
      ...pendingQueueBySessionRef.current,
      [sessionId]: (pendingQueueBySessionRef.current[sessionId] ?? []).filter((item) => item.id !== id),
    };
    pendingQueueBySessionRef.current = next;
    setPendingQueueBySession(next);
  }

  function queueCurrentDraft(value: string) {
    if (!activeSessionId || !value.trim()) return;
    const sessionId = activeSessionId;
    const stickerMatch = value.match(/\[sticker:([^\]]+)\]/);
    const userSticker = stickerMatch?.[1];
    const visibleContent = value.replace(/\[sticker:[^\]]+\]/g, "").trim();
    const attachmentsForMessage = attachments.map((attachment) => ({ ...attachment }));
    const userMessageId = crypto.randomUUID();
    const nextQueue = {
      ...pendingQueueBySessionRef.current,
      [sessionId]: [
        ...(pendingQueueBySessionRef.current[sessionId] ?? []),
        { id: userMessageId, rawContent: value, visibleContent, attachments: attachmentsForMessage, userSticker },
      ],
    };
    pendingQueueBySessionRef.current = nextQueue;
    setPendingQueueBySession(nextQueue);
    setDrafts((current) => ({ ...current, [scopeKey]: "" }));
    setAttachmentsByScope((current) => ({ ...current, [scopeKey]: [] }));
  }

  const isCurrentScopeRunning = Boolean(activeSessionId && activeRunsBySession.current[activeSessionId]);
  const currentPendingQueue = activeSessionId
    ? (pendingQueueBySession[activeSessionId] ?? []).map((item) => ({ id: item.id, content: item.visibleContent }))
    : [];
  const isEmbedded = window.self !== window.top;

  return (
    <div className={`cy-page ${collapsed ? "is-collapsed" : ""} ${isEmbedded ? "is-embedded" : ""}`}>
      <div className="cy-page-toggle">
        <SidebarToggle collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </div>
      <div className="cy-page-top-center">
        <CharacterStatusPill
          avatarPath={activeCharacter?.avatarUrl ?? avatarLight}
          avatarPaths={activeCharacters.map((character) => character.avatarUrl)}
          name={isMultiAgentConversation ? "多人對話" : activeCharacter?.name ?? "昔漣"}
          status={isMultiAgentConversation
            ? `${activeCharacters.map((character) => character.name).join(" · ")} · ${modelDisplayName || modelName}`
            : activeCharacter
            ? `${activeCharacter.appearanceTags.join(" · ")} · ${modelDisplayName || modelName}`
            : modelDisplayName || modelName}
          onClick={() => setIsAmbientWidgetOpen((value) => !value)}
        />
        <ModeSwitch value={mode} onChange={(nextMode) => {
          if (isConversationMode(nextMode)) setMode(nextMode);
        }} />
      </div>
      <AmbientFocusWidget
        isOpen={isAmbientWidgetOpen}
        onClose={() => setIsAmbientWidgetOpen(false)}
        onOpenAlbum={() => setIsAlbumOpen(true)}
        onOpenCopilot={() => setIsCopilotOpen(true)}
        onOpenPodcast={() => setIsPodcastOpen(true)}
        onOpenTrpg={() => setIsTrpgOpen(true)}
        onOpenAffection={() => setIsAffectionOpen(true)}
        onOpenProactive={() => setIsProactiveOpen(true)}
        onOpenSpotlight={() => setIsSpotlightOpen(true)}
      />
      <MemoryAlbumModal isOpen={isAlbumOpen} onClose={() => setIsAlbumOpen(false)} />
      <VisionCopilotModal isOpen={isCopilotOpen} onClose={() => setIsCopilotOpen(false)} />
      <DailyPodcastModal isOpen={isPodcastOpen} onClose={() => setIsPodcastOpen(false)} />
      <TrpgGameModal isOpen={isTrpgOpen} onClose={() => setIsTrpgOpen(false)} />
      <AffectionModal
        isOpen={isAffectionOpen}
        onClose={() => setIsAffectionOpen(false)}
        onTriggerAction={(actionName) => {
          void window.chat?.playLive2dAction({
            name: actionName,
            target: { type: "motion", value: "Tick3_3" },
          });
        }}
      />
      <ProactiveAssistantModal
        isOpen={isProactiveOpen}
        onClose={() => setIsProactiveOpen(false)}
        onActionClick={(action) => {
          if (action.includes("電台")) setIsPodcastOpen(true);
        }}
      />
      <SpotlightCapsule
        isOpen={isSpotlightOpen}
        onClose={() => setIsSpotlightOpen(false)}
        onOpenCopilot={() => setIsCopilotOpen(true)}
        onOpenAlbum={() => setIsAlbumOpen(true)}
        onOpenPodcast={() => setIsPodcastOpen(true)}
        onOpenTrpg={() => setIsTrpgOpen(true)}
        onStartFocus={() => void window.ambient?.startFocus({ durationMinutes: 25, topic: "專注工作與學習" })}
        onSendQuery={(query) => {
          // Send query in current conversation
          const inputEl = document.querySelector(".cy-chat-input") as HTMLTextAreaElement | null;
          if (inputEl) {
            inputEl.value = query;
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }}
      />
      <div className="cy-page-windows">
        <WindowControls
          onMinimize={() => window.chat?.minimize()}
          onMaximize={() => window.chat?.toggleMaximize()}
          onClose={() => window.chat?.close()}
        />
      </div>
      <div className="cy-page-settings">
        <SettingsButton onClick={() => sidebarApi()?.openSettings("appearance")} />
      </div>
      <div className="cy-page-user">
        <UserAvatar />
      </div>
      <div className="cy-page-newtask">
        <NewTaskButton label={taskLabel} onClick={() => void createNewTask()} />
        <MultiAgentButton onClick={() => void createMultiAgentConversation()} />
        <div className="cy-page-utilities" aria-label="能力設定">
          <AmbientModeButton active={isAmbientWidgetOpen} onClick={() => setIsAmbientWidgetOpen((v) => !v)} />
          <ToolModeButton active={utilityPanel === "tool"} onClick={() => setUtilityPanel((value) => value === "tool" ? null : "tool")} />
          <SkillModeButton active={utilityPanel === "skill"} onClick={() => setUtilityPanel((value) => value === "skill" ? null : "skill")} />
          <ModelModeButton active={utilityPanel === "model"} onClick={() => setUtilityPanel((value) => value === "model" ? null : "model")} />
        </div>
      </div>
      <div className="cy-page-conversations">
        <StatusFloat />
        <ConversationSidebar
          mode={mode}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={(sessionId) => void selectSession(sessionId)}
          onOpenProject={(workspaceRoot) => {
            void chatStore()?.openWorkspace(workspaceRoot).then((result) => {
              if (!result.ok) window.alert(`無法開啟專案資料夾：${result.error ?? "未知錯誤"}`);
            });
          }}
          onRename={(sessionId, newTitle) => void handleRenameSession(sessionId, newTitle)}
          onDelete={(sessionId) => void handleDeleteSession(sessionId)}
          onTogglePin={(sessionId, pinned) => void handleTogglePinSession(sessionId, pinned)}
        />
      </div>
      <main
        className={`cy-workspace ${hasMessages ? "has-messages" : "is-empty"} ${isDraggingFiles ? "is-dragging-files" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles && (
          <div className="cy-file-drop-overlay" aria-hidden="true">
            <span>鬆開即可新增到當前對話</span>
          </div>
        )}
        {utilityPanel ? (
          utilityPanel === "model" ? <ModelModePanel />
            : utilityPanel === "skill" ? <SkillModePanel />
              : <ToolModePanel />
        ) : <>
        {(mode === "work" || mode === "daily" || mode === "learn") && (
          <TodoPanel state={todoStateByMode[mode]} mode={mode} workspaceName={workspaceNames[mode]} />
        )}
        {mode === "code" && activeSessionId && (
          <CodeGitPanel
            sessionId={activeSessionId}
            projectName={workspaceNames.code}
            todoState={null}
          />
        )}
        {!hasMessages && activeCharacters.length > 0 && (
          <ConversationCharacterCard characters={activeCharacters} />
        )}
        {hasMessages && (
          <ChatMessageList
            messages={messages}
            conversationId={activeSessionId}
            characterName={isMultiAgentConversation ? "多人對話" : activeCharacter?.name}
            characterAvatarUrl={activeCharacter?.avatarUrl}
            characterAvatarUrls={activeCharacters.map((character) => character.avatarUrl)}
            groupCharacters={isMultiAgentConversation
              ? activeCharacters.map((character) => ({ id: character.id, name: character.name, avatarUrl: character.avatarUrl }))
              : undefined}
            mode={mode}
            preferredAddress={preferredAddress}
            stickerSize={stickerSize}
            revisionBusy={Boolean(modelBusyByMode[mode]) || lastTurnRevisionStarting}
            onEditLastUserMessage={mode === "chat" ? editLastChatUserMessage : undefined}
            onRegenerateLastResponse={mode === "chat" ? regenerateLastChatResponse : undefined}
            onTtsCacheKey={activeSessionId
              ? (messageId, cacheKey, converterVersion) => handleTtsCacheKey(
                mode,
                activeSessionId,
                messageId,
                cacheKey,
                converterVersion,
              )
              : undefined}
            onScrollToBottomVisibilityChange={setScrollToBottomVisible}
            onRegisterScrollToBottom={(scroll) => {
              scrollToBottomRef.current = scroll;
            }}
            onOpenReviewInspector={(runId, fileIndex) => setReviewInspector({ runId, fileIndex })}
          />
        )}
        {isCompressingContext && (
          <div className="cy-compressing-context" aria-live="polite" aria-busy="true">
            <img src={compressingPng} className="cy-compressing-context-icon" alt="" aria-hidden="true" />
            <span>昔漣正在壓縮上下文…</span>
          </div>
        )}
        <div className="cy-workspace-composer">
          {scrollToBottomVisible && (
            <button
              type="button"
              className="cy-workspace-composer__scroll-to-bottom"
              onClick={() => scrollToBottomRef.current()}
              aria-label="滾動到底部"
              title="滾動到底部"
            >
              <DownOutlined />
            </button>
          )}
          <ComposerSlot
            composer={<ChatComposer
            value={draft}
            mode={mode}
            docked={hasMessages}
            workspaceName={workspaceNames[mode]}
            conversationId={activeSessionId}
            workspaceRoot={activeSessionId ? sessionsByMode[mode]?.find((session) => session.id === activeSessionId)?.workspaceRoot : undefined}
            activeModelProfileId={activeSessionId ? modelProfilesBySession[activeSessionId] : undefined}
            onSelectModelProfile={activeSessionId ? (profileId) => {
              void chatStore()?.setModelProfile(activeSessionId, profileId).then((session) => {
                if (session) setModelProfilesBySession((current) => ({ ...current, [activeSessionId]: session.modelProfileId }));
              });
            } : undefined}
            attachments={attachments}
            attachmentBusy={attachmentBusy}
            modelBusy={isCurrentScopeRunning}
            pendingQueue={currentPendingQueue}
            clineMode={selectedClineMode}
            onChange={(value) => setDrafts((current) => ({ ...current, [scopeKey]: value }))}
            onSubmit={(value) => void sendMessage(value)}
            onCancel={() => void cancelCurrentRun()}
            onQueueMessage={(value) => queueCurrentDraft(value)}
            onRemoveQueuedMessage={(id) => removeQueuedMessage(activeSessionId, id)}
            onChooseWorkspace={() => void chooseWorkspace()}
            onInitVaultStructure={mode === "learn" ? () => {
              const sessionId = activeSessionIdsRef.current[mode];
              if (sessionId) void initVaultStructure(sessionId);
            } : undefined}
            onChooseFiles={(files) => void chooseFiles(files)}
            onRemoveAttachment={removeAttachment}
            onScreenshot={() => void window.chat?.startScreenshot()}
            onChooseSticker={(id) => {
              const separator = draft && !draft.endsWith(" ") ? " " : "";
              setDrafts((current) => ({ ...current, [scopeKey]: `${draft}${separator}[sticker:${id}]` }));
            }}
            onClineModeChange={(nextMode) => void changeClineMode(nextMode)}
            onNewClineTask={() => void createNewClineTask()}
            />}
            interaction={composerInteraction}
            interactionBusy={interactionBusy}
            onAnswer={(id, answer) => {
              if (composerInteraction?.kind === "ask" && composerInteraction.source === "code") {
                const api = codeRunApi();
                if (!api || typeof answer !== "string" || !answer.trim()) return;
                setInteractionBusy(true);
                void api.respondAsk(id, answer).then((result) => {
                  if (result.ok) setComposerInteraction(undefined);
                  setInteractionBusy(false);
                }).catch(() => setInteractionBusy(false));
                return;
              }
              const choice = choiceApi();
              if (!choice) return;
              setInteractionBusy(true);
              void choice.resolve(id, answer).then((result) => {
                if (result.ok) setComposerInteraction(undefined);
                setInteractionBusy(false);
              }).catch(() => setInteractionBusy(false));
            }}
            onIgnore={(id) => {
              if (composerInteraction?.kind === "ask" && composerInteraction.source === "code") {
                const api = codeRunApi();
                if (!api) return;
                setInteractionBusy(true);
                void api.cancelAsk(id).then((result) => {
                  if (result.ok) setComposerInteraction(undefined);
                  setInteractionBusy(false);
                }).catch(() => setInteractionBusy(false));
                return;
              }
              const choice = choiceApi();
              if (!choice) return;
              setInteractionBusy(true);
              void choice.resolve(id, "").then((result) => {
                if (result.ok) setComposerInteraction(undefined);
                setInteractionBusy(false);
              }).catch(() => setInteractionBusy(false));
            }}
            onPermissionDecision={(id, allowed) => {
              if (composerInteraction?.kind === "permission" && composerInteraction.source === "code_verification") {
                const api = codeRunApi();
                if (!api) return;
                setInteractionBusy(true);
                const request = allowed ? api.approveVerification(id) : api.rejectVerification(id);
                void request.then((result) => {
                  if (result.ok) setComposerInteraction(undefined);
                  setInteractionBusy(false);
                }).catch(() => setInteractionBusy(false));
                return;
              }
              const settings = settingsApprovalApi();
              if (!settings) return;
              setInteractionBusy(true);
              void settings.resolvePermissionApproval(id, allowed).then((result) => {
                if (result.ok) setComposerInteraction(undefined);
                setInteractionBusy(false);
              }).catch(() => setInteractionBusy(false));
            }}
          />
        </div>
        </>}
      </main>
      {reviewInspector && (
        <RightInspector
          tabs={[{
            id: "diff",
            label: "變更審查",
            dotClass: "is-review",
            content: <ReviewDiffContent {...reviewInspector} />,
          }]}
          activeTabId="diff"
          onTabChange={() => undefined}
          onClose={() => setReviewInspector(null)}
        />
      )}
    </div>
  );
}
