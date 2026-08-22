import { Bubble, CodeHighlighter, Think, ThoughtChain, type BubbleItemType } from "@ant-design/x";
import { XMarkdown, type ComponentProps } from "@ant-design/x-markdown";
import Latex from "@ant-design/x-markdown/plugins/Latex";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type KeyboardEvent, type ReactNode } from "react";
import { resolveAsset } from "../../../../../shared/renderer-base";
import type { ConversationMode, ReasoningBlock, RunActivityRecord, TaskDelegationDisplayRecord, ToolExecutionRecord } from "../../../../../shared/chat-types";
import thinkingMoodUrl from "../../../assets/status-moods/思考中.png?url";
import completedThinkingMoodUrl from "../../../assets/status-moods/提醒.png?url";
import workingMoodUrl from "../../../assets/status-moods/工作中.png?url";
import companionMoodUrl from "../../../assets/status-moods/陪伴中.png?url";
import offlineMoodUrl from "../../../assets/status-moods/离线.png?url";
import avatarFallbackUrl from "../../../assets/avatars/avatar-light.png?url";
import { useUserAvatar } from "../../../hooks/useUserAvatar";
import {
  assistantRenderStages,
  resolveReasoningExpanded,
  updateReasoningExpanded,
} from "./message-visibility";
import { formatElapsed, resolveRunActivityExpanded, resolveRunActivitySnapshot, shouldAutoCollapseRunActivity } from "./run-activity";
import { RunStageIndicator } from "./RunStageIndicator";
import { TaskPlanCard } from "./TaskPlanCard";
import type { AgentRunStage, TaskPlanPresentation } from "./run-presentation";
import { CopyButton } from "./CopyButton";
import { TtsButton } from "./TtsButton";
import { stopTtsPlayback } from "./tts-playback";
import { LastTurnActionButton } from "./LastTurnActionButton";
import { resolveRevisableLastTurn, type RevisableLastTurn } from "./last-turn-actions";
import { extractMessageStickerId, stripMessageStickerMarkers } from "./message-sticker";
import { CodeRunPanel } from "./CodeRunPanel";
import type { CodeRunViewModel } from "../../../../lib/code-run-view-model";
import type { WeatherData } from "./weather/weather-types";
import { WeatherCard } from "./weather/WeatherCard";
import { ReviewPanel } from "./ReviewPanel";
import { TaskDelegationRow } from "./TaskDelegationRow";

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  reasoningBlocks?: ReasoningBlock[];
  reasoningStreaming?: boolean;
  responseStarted?: boolean;
  streaming?: boolean;
  loading?: boolean;
  /** 請求已發出但尚未收到 Think、工具或正文等首個可視事件。 */
  waitingForFirstEvent?: boolean;
  ttsCacheKey?: string;
  ttsCacheVersion?: string;
  sticker?: string | null;
  toolExecutions?: ToolExecutionRecord[];
  runActivity?: RunActivityRecord;
  runStage?: AgentRunStage;
  taskPlan?: TaskPlanPresentation;
  codeRun?: CodeRunViewModel;
  attachments?: ChatMessageAttachment[];
  weather?: WeatherData;
  runId?: string;
  taskDelegations?: TaskDelegationDisplayRecord[];
}

export interface ChatMessageAttachment {
  name: string;
  kind: string;
  filePath?: string;
  mime?: string;
  previewUrl?: string;
  caption?: string;
  status?: string;
  reason?: string;
  imageSendMode?: "direct" | "caption";
}

interface ChatMessageListProps {
  messages: ChatMessageItem[];
  conversationId?: string;
  characterName?: string;
  characterAvatarUrl?: string;
  characterAvatarUrls?: string[];
  groupCharacters?: GroupCharacterPresentation[];
  mode: ConversationMode;
  preferredAddress: string;
  stickerSize?: "small" | "standard" | "large";
  onTtsCacheKey?: (messageId: string, cacheKey: string, converterVersion: string) => void;
  revisionBusy?: boolean;
  onEditLastUserMessage?: (messageId: string, content: string) => Promise<boolean>;
  onRegenerateLastResponse?: (userMessageId: string, assistantMessageId: string) => Promise<boolean>;
  onScrollToBottomVisibilityChange?: (visible: boolean) => void;
  onRegisterScrollToBottom?: (scroll: () => void) => void;
  onOpenReviewInspector?: (runId: string, fileIndex: number) => void;
}

export interface GroupCharacterPresentation {
  id: string;
  name: string;
  avatarUrl: string;
}

const markdownConfig = { extensions: Latex() };
// This page always lives at /react/index.html in both Vite and packaged
// Electron builds. Keeping the portrait relative to the document makes the
// URL stable when the page is embedded or reloaded as a workspace iframe.
const cyreneAvatarUrl = "../avatars/cyrene-avatar.png";

function MarkdownCode({ children, lang, block }: ComponentProps<{ children?: ReactNode }>) {
  if (!block) return <code>{children}</code>;
  return (
    <CodeHighlighter lang={(lang ?? "text").split(/\s+/)[0]} prismLightMode={false}>
      {String(children ?? "").replace(/\n$/, "")}
    </CodeHighlighter>
  );
}

const markdownComponents = { code: MarkdownCode };
const completedMarkdownOptions = {
  hasNextChunk: false,
  enableAnimation: false,
  tail: false,
};

class MarkdownRenderBoundary extends Component<{
  content: string;
  children: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ReactChat] Markdown/KaTeX 渲染失敗，已降級為原始文本", error, info);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <pre className="cy-message-markdown-fallback">{this.props.content}</pre>;
    }
    return this.props.children;
  }
}

function MarkdownContent({ content }: { content: string; streaming?: boolean }) {
  return (
    <MarkdownRenderBoundary content={content}>
      <XMarkdown
        content={content}
        config={markdownConfig}
        components={markdownComponents}
        openLinksInNewTab
        escapeRawHtml
        rootClassName="cy-message-markdown"
        streaming={completedMarkdownOptions}
      />
    </MarkdownRenderBoundary>
  );
}

interface EnabledSticker {
  id: string;
  src: string;
}

function resolveStickerUrl(id: string, stickers: EnabledSticker[]): string | undefined {
  const raw = stickers.find((sticker) => sticker.id === id)?.src;
  if (!raw) return undefined;
  return raw.startsWith("/stickers/") ? resolveAsset(raw) : raw;
}

function AssistantContent({
  content,
  streaming,
  stickerUrl,
  attachments = [],
}: {
  content: string;
  streaming: boolean;
  stickerUrl?: string;
  attachments?: ChatMessageAttachment[];
}) {
  return (
    <div className="cy-message__assistant-body">
      <UserAttachments attachments={attachments} />
      {content && <MarkdownContent content={content} streaming={streaming} />}
      {stickerUrl && <img className="cy-message__sticker" src={stickerUrl} alt="昔漣表情" draggable={false} />}
    </div>
  );
}

function DotSpinner() {
  return (
    <span className="cy-dot-spinner" aria-label="載入中" role="status">
      {Array.from({ length: 8 }, (_, index) => <span className="cy-dot-spinner__dot" key={index} />)}
    </span>
  );
}

function ModelWaitContent() {
  return (
    <section className="cy-model-wait" aria-label="等待模型響應">
      <span className="cy-model-wait__art" aria-hidden="true">
        <img src={offlineMoodUrl} alt="" draggable={false} />
        <DotSpinner />
      </span>
      <span>昔漣正在等模型回應…</span>
    </section>
  );
}

function ReasoningContent({
  content,
  loading,
  expanded,
  onExpand,
}: {
  content: string;
  loading: boolean;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
}) {
  const statusArt = loading ? thinkingMoodUrl : completedThinkingMoodUrl;
  return (
    <Think
      rootClassName="cy-message-reasoning"
      title={loading ? "正在思考…" : "思考完成"}
      icon={
        <span className={`cy-reasoning-status-art${loading ? " is-thinking" : " is-complete"}`} aria-hidden="true">
          <img src={statusArt} alt="" draggable={false} />
          {loading && <DotSpinner />}
        </span>
      }
      blink={loading}
      expanded={expanded}
      onExpand={onExpand}
      destroyOnHidden
    >
      {content && <MarkdownContent content={content} streaming={loading} />}
    </Think>
  );
}

function useRunActivityNow(processing: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!processing) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [processing]);
  return now;
}

function RunActivityReasoningBlock({ block }: { block: ReasoningBlock }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ReasoningContent
      content={block.content}
      loading={Boolean(block.streaming)}
      expanded={expanded}
      onExpand={setExpanded}
    />
  );
}

function RunActivityDetail({
  reasoningBlocks,
  tools,
}: {
  reasoningBlocks: ReasoningBlock[];
  tools: ToolExecutionRecord[];
}) {
  const timeline: ReactNode[] = [];
  for (let index = 0; index <= tools.length; index += 1) {
    reasoningBlocks
      .filter((block) => (block.afterToolCount ?? 0) === index)
      .forEach((block) => {
        if (!block.content.trim()) return;
        timeline.push(
          <RunActivityReasoningBlock
            key={`reasoning-${block.id}`}
            block={block}
          />,
        );
      });
    if (index < tools.length) {
      timeline.push(<ToolExecutionContent key={`tool-${tools[index].id}`} tools={[tools[index]]} />);
    }
  }
  return timeline.length
    ? <div className="cy-run-activity__detail">{timeline}</div>
    : <div className="cy-run-activity__empty">昔漣正在整理這一輪迴復…</div>;
}

function RunActivityContent({
  activityId,
  activity,
  reasoningBlocks,
  tools,
  stage,
  taskPlan,
  expanded,
  onExpand,
}: {
  activityId: string;
  activity: RunActivityRecord;
  reasoningBlocks: ReasoningBlock[];
  tools: ToolExecutionRecord[];
  stage?: AgentRunStage;
  taskPlan?: TaskPlanPresentation;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
}) {
  const now = useRunActivityNow(activity.completedAt === undefined);
  const snapshot = resolveRunActivitySnapshot(activity, now);
  const wasProcessingRef = useRef(snapshot.processing);
  useEffect(() => {
    if (shouldAutoCollapseRunActivity(wasProcessingRef.current, snapshot.processing)) onExpand(false);
    wasProcessingRef.current = snapshot.processing;
  }, [onExpand, snapshot.processing]);

  const title = snapshot.processing
    ? `昔漣正在處理中 ${formatElapsed(snapshot.processingMs)}`
    : `昔漣已處理 ${formatElapsed(snapshot.processingMs)}`;
  const image = snapshot.processing ? workingMoodUrl : companionMoodUrl;

  return (
    <section className={`cy-run-activity${snapshot.processing ? " is-processing" : " is-complete"}`}>
      <button
        type="button"
        className="cy-run-activity__header"
        onClick={() => onExpand(!expanded)}
        aria-expanded={expanded}
        aria-controls={`${activityId}-details`}
      >
        <span className="cy-run-activity__title">
            <span className="cy-run-activity__art" aria-hidden="true">
              <img src={image} alt="" draggable={false} />
              {snapshot.processing && <DotSpinner />}
            </span>
            <span>{title}</span>
            {stage && <RunStageIndicator stage={stage} />}
        </span>
        <svg className={`cy-run-activity__chevron${expanded ? " is-expanded" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
        </svg>
      </button>
      {expanded && (
        <div className="cy-run-activity__expanded" id={`${activityId}-details`}>
          {taskPlan && <TaskPlanCard plan={taskPlan} />}
          <div className="cy-run-activity__divider" />
          <RunActivityDetail reasoningBlocks={reasoningBlocks} tools={tools} />
          <div className="cy-run-activity__divider" />
        </div>
      )}
    </section>
  );
}

function ToolExecutionContent({ tools }: { tools: ToolExecutionRecord[] }) {
  return (
    <section className="cy-tool-executions" aria-label="工具執行過程">
      <ThoughtChain
        rootClassName="cy-tool-executions__chain"
        line="dashed"
        items={tools.map((tool) => ({
          key: tool.id,
          title: tool.name,
          description: tool.status === "running" ? "正在執行…" : tool.status === "error" ? "執行失敗" : "執行完成",
          status: tool.status === "running" ? "loading" : tool.status === "error" ? "error" : "success",
          blink: tool.status === "running",
          collapsible: Boolean(tool.result),
          content: tool.result ? <pre className="cy-tool-executions__result">{tool.result}</pre> : undefined,
        }))}
      />
    </section>
  );
}

function attachmentStatus(attachment: ChatMessageAttachment): string | undefined {
  if (attachment.status === "processing") return "視覺分析中…";
  if (attachment.status === "error") return attachment.reason ?? "圖片分析失敗";
  if (attachment.imageSendMode === "direct") return "已交給主模型檢視";
  if (attachment.imageSendMode === "caption" && attachment.status === "done") return "視覺分析完成";
  return undefined;
}

function UserAttachments({ attachments }: { attachments: ChatMessageAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="cy-message__attachments">
      {attachments.map((attachment, index) => {
        const status = attachmentStatus(attachment);
        if (attachment.kind === "image" && (attachment.previewUrl || attachment.filePath)) {
          return (
            <figure className="cy-message__image-attachment" key={`${attachment.filePath ?? attachment.name}-${index}`}>
              <AttachmentImage attachment={attachment} />
              {status && <figcaption className={attachment.status === "error" ? "is-error" : ""}>{status}</figcaption>}
            </figure>
          );
        }
        return <span className="cy-message__file-attachment" key={`${attachment.filePath ?? attachment.name}-${index}`}>{attachment.name}</span>;
      })}
    </div>
  );
}

function AttachmentImage({ attachment }: { attachment: ChatMessageAttachment }) {
  const [src, setSrc] = useState(attachment.previewUrl);

  useEffect(() => {
    setSrc(attachment.previewUrl);
    if ((!attachment.previewUrl || attachment.previewUrl.startsWith("file:")) && attachment.filePath) {
      let active = true;
      void window.chat?.getImagePreview?.(attachment.filePath).then((result) => {
        if (active && result.ok && result.dataUrl) setSrc(result.dataUrl);
      });
      return () => {
        active = false;
      };
    }
  }, [attachment.filePath, attachment.previewUrl]);

  return <img src={src} alt={attachment.name} draggable={false} />;
}

function UserContent({
  content,
  stickerUrl,
  attachments = [],
}: {
  content: string;
  stickerUrl?: string;
  attachments?: ChatMessageAttachment[];
}) {
  return (
    <div className="cy-message__user-body">
      <UserAttachments attachments={attachments} />
      {content && <MarkdownContent content={content} />}
      {stickerUrl && <img className="cy-message__sticker" src={stickerUrl} alt="使用者表情" draggable={false} />}
    </div>
  );
}

function LastUserMessageEditor({
  value,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="cy-last-message-editor">
      <textarea
        autoFocus
        value={value}
        disabled={busy}
        aria-label="編輯最後一條訊息"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="cy-last-message-editor__actions">
        <button type="button" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className="is-primary" disabled={busy || !value.trim()} onClick={onSubmit}>
          儲存並重新生成
        </button>
      </div>
    </div>
  );
}

function CharacterMessageAvatar({ name, src, sources }: { name: string; src: string; sources?: string[] }) {
  if ((sources?.length ?? 0) > 1) {
    return (
      <span className="cy-message-avatar__group" aria-label={name}>
        {sources!.slice(0, 3).map((source, index) => (
          <img className="cy-message-avatar__image" src={source} alt="" draggable={false} key={`${source}-${index}`} />
        ))}
      </span>
    );
  }
  return (
    <img
      className="cy-message-avatar__image"
      src={src}
      alt={name}
      draggable={false}
      onError={(event) => {
        const image = event.currentTarget;
        if (image.src === avatarFallbackUrl) return;
        image.src = avatarFallbackUrl;
      }}
    />
  );
}

function UserMessageAvatar({ src }: { src: string | null }) {
  if (src) return <img className="cy-message-avatar__image" src={src} alt="使用者" draggable={false} />;
  return <span className="cy-message-avatar__user" aria-label="使用者" />;
}

function createRoles(
  userAvatarUrl: string | null,
  characterName: string,
  characterAvatarUrl: string,
  characterAvatarUrls: string[] | undefined,
  groupCharacters: GroupCharacterPresentation[] | undefined,
  conversationId: string | undefined,
  mode: ConversationMode,
  preferredAddress: string,
  lastTurn: RevisableLastTurn | null,
  editingMessageId: string | null,
  editDraft: string,
  revisionBusy: boolean,
  onBeginEdit: (messageId: string, content: string) => void,
  onEditDraftChange: (value: string) => void,
  onCancelEdit: () => void,
  onSubmitEdit: () => void,
  onRegenerate: () => void,
  reasoningExpanded: Readonly<Record<string, boolean>>,
  onReasoningExpand: (id: string, expanded: boolean) => void,
  onTtsCacheKey?: (messageId: string, cacheKey: string, converterVersion: string) => void,
  onOpenReviewInspector?: (runId: string, fileIndex: number) => void,
) {
  const createAssistantRole = (
    name: string,
    avatarUrl: string,
    avatarUrls?: string[],
    allowCyreneTts = true,
  ) => ({
    placement: "start" as const,
    variant: "filled" as const,
    rootClassName: "cy-message cy-message--assistant",
    avatar: <CharacterMessageAvatar name={name} src={avatarUrl} sources={avatarUrls} />,
    contentRender: (content: string, info: { extraInfo?: { streaming?: boolean; stickerUrl?: string; attachments?: ChatMessageAttachment[] } }) => (
      <AssistantContent
        content={content}
        streaming={Boolean(info.extraInfo?.streaming)}
        stickerUrl={info.extraInfo?.stickerUrl}
        attachments={info.extraInfo?.attachments}
      />
    ),
    footer: (content: string, info: { extraInfo?: { messageId?: string; streaming?: boolean; ttsCacheKey?: string; groupSegment?: boolean; isLastGroupSegment?: boolean } }) => {
      const cleanText = content.trim();
      const messageId = info.extraInfo?.messageId;
      const isGroupSegment = Boolean(info.extraInfo?.groupSegment);
      const canRegenerate = messageId === lastTurn?.assistantMessageId
        && (!isGroupSegment || Boolean(info.extraInfo?.isLastGroupSegment));
      if (info.extraInfo?.streaming || (!cleanText && !canRegenerate)) return null;
      return (
        <div className="cy-message-actions">
          {(!isGroupSegment || allowCyreneTts) && cleanText && messageId && conversationId && (
            <TtsButton
              conversationId={conversationId}
              messageId={messageId}
              text={cleanText}
              speechMode={mode === "learn" ? "learn" : "default"}
              preferredAddress={preferredAddress}
              onCacheKey={isGroupSegment
                ? undefined
                : (cacheKey, converterVersion) => onTtsCacheKey?.(messageId, cacheKey, converterVersion)}
            />
          )}
          {cleanText && <CopyButton text={cleanText} />}
          {canRegenerate && (
            <LastTurnActionButton kind="regenerate" disabled={revisionBusy} onClick={onRegenerate} />
          )}
        </div>
      );
    },
  });

  return {
  user: {
    placement: "end" as const,
    variant: "filled" as const,
    rootClassName: "cy-message cy-message--user",
    avatar: <UserMessageAvatar src={userAvatarUrl} />,
    contentRender: (content: string, info: { extraInfo?: { messageId?: string; stickerUrl?: string; attachments?: ChatMessageAttachment[] } }) => (
      info.extraInfo?.messageId === editingMessageId
        ? <LastUserMessageEditor
            value={editDraft}
            busy={revisionBusy}
            onChange={onEditDraftChange}
            onCancel={onCancelEdit}
            onSubmit={onSubmitEdit}
          />
        : <UserContent
            content={content}
            stickerUrl={info.extraInfo?.stickerUrl}
            attachments={info.extraInfo?.attachments}
          />
    ),
    footer: (content: string, info: { extraInfo?: { messageId?: string } }) => {
      const cleanText = content.replace(/\[sticker:[^\]]+\]/g, "").trim();
      const messageId = info.extraInfo?.messageId;
      if (!cleanText || messageId === editingMessageId) return null;
      return (
        <div className="cy-message-actions">
          {messageId === lastTurn?.userMessageId && (
            <LastTurnActionButton
              kind="edit"
              disabled={revisionBusy}
              onClick={() => onBeginEdit(messageId, cleanText)}
            />
          )}
          <CopyButton text={cleanText} />
        </div>
      );
    },
  },
  assistant: createAssistantRole(characterName, characterAvatarUrl, characterAvatarUrls),
  ...Object.fromEntries((groupCharacters ?? []).map((character, index) => [
    `assistant-group-${index}`,
    createAssistantRole(character.name, character.avatarUrl, undefined, character.id === "cyrene"),
  ])),
  reasoning: {
    placement: "start" as const,
    variant: "borderless" as const,
    rootClassName: "cy-message cy-message--reasoning",
    contentRender: (_content: string, info: { extraInfo?: { reasoningId?: string; reasoning?: string; reasoningStreaming?: boolean } }) => (
      <ReasoningContent
        content={info.extraInfo?.reasoning ?? ""}
        loading={Boolean(info.extraInfo?.reasoningStreaming)}
        expanded={info.extraInfo?.reasoningId
          ? resolveReasoningExpanded(reasoningExpanded, info.extraInfo.reasoningId)
          : false}
        onExpand={(expanded) => {
          if (info.extraInfo?.reasoningId) onReasoningExpand(info.extraInfo.reasoningId, expanded);
        }}
      />
    ),
  },
  activity: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--activity",
    contentRender: (_content: string, info: {
      extraInfo?: {
        activityId?: string;
        activity?: RunActivityRecord;
        reasoningBlocks?: ReasoningBlock[];
        tools?: ToolExecutionRecord[];
        runStage?: AgentRunStage;
        taskPlan?: TaskPlanPresentation;
      };
    }) => {
      const activityId = info.extraInfo?.activityId;
      const activity = info.extraInfo?.activity;
      if (!activityId || !activity) return null;
      return (
        <RunActivityContent
          activityId={activityId}
          activity={activity}
          reasoningBlocks={info.extraInfo?.reasoningBlocks ?? []}
          tools={info.extraInfo?.tools ?? []}
          stage={info.extraInfo?.runStage}
          taskPlan={info.extraInfo?.taskPlan}
          expanded={resolveRunActivityExpanded(reasoningExpanded, activityId, activity)}
          onExpand={(expanded) => onReasoningExpand(activityId, expanded)}
        />
      );
    },
  },
  tool: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--tool",
    contentRender: (_content: string, info: { extraInfo?: { tools?: ToolExecutionRecord[] } }) => (
      info.extraInfo?.tools?.length ? <ToolExecutionContent tools={info.extraInfo.tools} /> : null
    ),
  },
  waiting: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--waiting",
    contentRender: () => <ModelWaitContent />,
  },
  codeRun: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--code-run",
    contentRender: (_content: string, info: { extraInfo?: { codeRun?: CodeRunViewModel } }) => (
      info.extraInfo?.codeRun ? <CodeRunPanel value={info.extraInfo.codeRun} /> : null
    ),
  },
  weather: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--weather",
    contentRender: (_content: string, info: { extraInfo?: { weather?: WeatherData } }) => (
      info.extraInfo?.weather ? <WeatherCard data={info.extraInfo.weather} /> : null
    ),
  },
  delegation: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--delegation",
    contentRender: (_content: string, info: { extraInfo?: { delegation?: TaskDelegationDisplayRecord } }) => (
      info.extraInfo?.delegation ? <TaskDelegationRow delegation={info.extraInfo.delegation} /> : null
    ),
  },
  review: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--review",
    contentRender: (_content: string, info: { extraInfo?: { runId?: string } }) => (
      info.extraInfo?.runId ? <ReviewPanel runId={info.extraInfo.runId} onOpenInspector={onOpenReviewInspector} /> : null
    ),
  },
  system: {
    placement: "start" as const,
    variant: "borderless" as const,
    rootClassName: "cy-message cy-message--system",
  },
  };
}

export function splitGroupAssistantContent(
  content: string,
  characters: GroupCharacterPresentation[],
): Array<{ characterIndex: number; name: string; content: string }> {
  if (characters.length < 2) return [];
  const matches = [...content.matchAll(/^###\s+(.+?)\s*$/gm)];
  if (matches.length === 0) return [];
  return matches.flatMap((match, index) => {
    const name = match[1].trim();
    const characterIndex = characters.findIndex((character) => character.name === name);
    if (characterIndex < 0 || match.index === undefined) return [];
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    const body = content.slice(start, end).trim();
    return [{ characterIndex, name, content: `### ${name}${body ? `\n\n${body}` : ""}` }];
  });
}

export function createMessageItems(
  messages: ChatMessageItem[],
  enabledStickers: EnabledSticker[],
  groupCharacters: GroupCharacterPresentation[] = [],
): BubbleItemType[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant") {
      const stickerId = extractMessageStickerId(message.content, message.sticker);
      return [{
        key: message.id,
        role: message.role,
        content: stripMessageStickerMarkers(message.content),
        extraInfo: {
          stickerUrl: stickerId ? resolveStickerUrl(stickerId, enabledStickers) : undefined,
          attachments: message.attachments,
          messageId: message.id,
        },
      }];
    }

    const assistantItems: BubbleItemType[] = [];
    const stages = assistantRenderStages(message);
    if (message.waitingForFirstEvent && !message.runActivity) {
      assistantItems.push({
        key: `${message.id}-waiting`,
        role: "waiting",
        content: "",
      });
    }
    const reasoningBlocks = message.reasoningBlocks?.length
      ? message.reasoningBlocks
      : (stages.includes("reasoning") ? [{ id: `${message.id}-legacy`, content: message.reasoning ?? "", streaming: message.reasoningStreaming }] : []);
    const appendReasoning = (block: ReasoningBlock) => {
      assistantItems.push({
        key: `${message.id}-reasoning-${block.id}`,
        role: "reasoning",
        content: "",
        extraInfo: {
          reasoningId: block.id,
          reasoning: block.content,
          reasoningStreaming: block.streaming,
        },
      });
    };
    const tools = message.toolExecutions ?? [];
    if (message.runActivity) {
      assistantItems.push({
        key: `${message.id}-activity`,
        role: "activity",
        content: "",
        extraInfo: {
          activityId: `${message.id}-activity`,
          activity: message.runActivity,
          reasoningBlocks,
          tools,
          runStage: message.runStage,
          taskPlan: message.taskPlan,
        },
      });
    } else {
      for (let index = 0; index <= tools.length; index += 1) {
        reasoningBlocks.filter((block) => (block.afterToolCount ?? 0) === index).forEach(appendReasoning);
        if (index === tools.length) continue;
        assistantItems.push({
          key: `${message.id}-tool-${tools[index].id}`,
          role: "tool",
          content: "",
          extraInfo: { tools: [tools[index]] },
        });
      }
    }
    if (message.codeRun && (message.codeRun.run || message.codeRun.card)) {
      assistantItems.push({
        key: `${message.id}-code-run`,
        role: "codeRun",
        content: "",
        extraInfo: { codeRun: message.codeRun },
      });
    }
    if (message.weather) {
      assistantItems.push({
        key: `${message.id}-weather`,
        role: "weather",
        content: "",
        extraInfo: { weather: message.weather },
      });
    }
    for (const delegation of message.taskDelegations ?? []) {
      assistantItems.push({
        key: `${message.id}-delegation-${delegation.invocationId}`,
        role: "delegation",
        content: "",
        extraInfo: { delegation },
      });
    }
    if (message.runId && !message.streaming) {
      assistantItems.push({
        key: `${message.id}-review`,
        role: "review",
        content: "",
        extraInfo: { runId: message.runId },
      });
    }
    if (stages.includes("assistant")) {
      const groupSegments = splitGroupAssistantContent(message.content, groupCharacters);
      if (groupSegments.length > 0) {
        groupSegments.forEach((segment, index) => assistantItems.push({
          key: `${message.id}-group-${index}`,
          role: `assistant-group-${segment.characterIndex}`,
          content: segment.content,
          streaming: message.streaming && index === groupSegments.length - 1,
          extraInfo: {
            messageId: message.id,
            streaming: message.streaming && index === groupSegments.length - 1,
            groupSegment: true,
            isLastGroupSegment: index === groupSegments.length - 1,
          },
        }));
      } else {
        assistantItems.push({
          key: message.id,
          role: "assistant",
          content: message.content,
          streaming: message.streaming,
          extraInfo: {
            messageId: message.id,
            streaming: message.streaming,
            ttsCacheKey: message.ttsCacheKey,
            stickerUrl: message.sticker ? resolveStickerUrl(message.sticker, enabledStickers) : undefined,
            attachments: message.attachments,
          },
        });
      }
    }
    return assistantItems;
  });
}

export function ChatMessageList({
  messages,
  conversationId,
  characterName = "昔漣",
  characterAvatarUrl = cyreneAvatarUrl,
  characterAvatarUrls,
  groupCharacters,
  mode,
  preferredAddress,
  stickerSize = "standard",
  onTtsCacheKey,
  revisionBusy = false,
  onEditLastUserMessage,
  onRegenerateLastResponse,
  onScrollToBottomVisibilityChange,
  onRegisterScrollToBottom,
  onOpenReviewInspector,
}: ChatMessageListProps) {
  const userAvatarUrl = useUserAvatar();
  const [enabledStickers, setEnabledStickers] = useState<EnabledSticker[]>([]);
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const lastTurn = resolveRevisableLastTurn(messages, mode);
  const onReasoningExpand = useCallback((id: string, expanded: boolean) => {
    setReasoningExpanded((current) => updateReasoningExpanded(current, id, expanded));
  }, []);
  const beginEdit = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditDraft(content);
  }, []);
  const cancelEdit = useCallback(() => {
    if (revisionBusy) return;
    setEditingMessageId(null);
    setEditDraft("");
  }, [revisionBusy]);
  const submitEdit = useCallback(() => {
    if (!editingMessageId || !editDraft.trim() || !onEditLastUserMessage || revisionBusy) return;
    void onEditLastUserMessage(editingMessageId, editDraft.trim()).then((accepted) => {
      if (!accepted) return;
      setEditingMessageId(null);
      setEditDraft("");
    });
  }, [editDraft, editingMessageId, onEditLastUserMessage, revisionBusy]);
  const regenerate = useCallback(() => {
    if (!lastTurn || !onRegenerateLastResponse || revisionBusy) return;
    void onRegenerateLastResponse(lastTurn.userMessageId, lastTurn.assistantMessageId);
  }, [lastTurn, onRegenerateLastResponse, revisionBusy]);

  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // 向父元件註冊滾動到底部的回撥
  useEffect(() => {
    onRegisterScrollToBottom?.(scrollToBottom);
  }, [onRegisterScrollToBottom, scrollToBottom]);

  const updateScrollState = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance < 100;
    isNearBottomRef.current = nearBottom;
    onScrollToBottomVisibilityChange?.(!nearBottom);
  }, [onScrollToBottomVisibilityChange]);

  // 開啟/切換會話時滾動到底部
  useEffect(() => {
    scrollToBottom("auto");
    // 內容渲染後再次兜底滾動
    const timer = window.setTimeout(() => scrollToBottom("auto"), 100);
    isNearBottomRef.current = true;
    onScrollToBottomVisibilityChange?.(false);
    return () => window.clearTimeout(timer);
  }, [conversationId, onScrollToBottomVisibilityChange, scrollToBottom]);

  const roles = useMemo(
    () => createRoles(
      userAvatarUrl,
      characterName,
      characterAvatarUrl,
      characterAvatarUrls,
      groupCharacters,
      conversationId,
      mode,
      preferredAddress,
      lastTurn,
      editingMessageId,
      editDraft,
      revisionBusy,
      beginEdit,
      setEditDraft,
      cancelEdit,
      submitEdit,
      regenerate,
      reasoningExpanded,
      onReasoningExpand,
      onTtsCacheKey,
      onOpenReviewInspector,
    ),
    [beginEdit, cancelEdit, characterAvatarUrl, characterAvatarUrls, characterName, conversationId, editDraft, editingMessageId, groupCharacters, lastTurn, mode, onOpenReviewInspector, onReasoningExpand, onTtsCacheKey, preferredAddress, reasoningExpanded, regenerate, revisionBusy, submitEdit, userAvatarUrl],
  );

  useEffect(() => {
    if (editingMessageId && editingMessageId !== lastTurn?.userMessageId) {
      setEditingMessageId(null);
      setEditDraft("");
    }
  }, [editingMessageId, lastTurn?.userMessageId]);

  useEffect(() => stopTtsPlayback, [conversationId]);

  useEffect(() => {
    let active = true;
    void window.chat?.getEnabledStickers?.().then((stickers) => {
      if (active) setEnabledStickers(stickers);
    }).catch(() => {
      if (active) setEnabledStickers([]);
    });
    return () => {
      active = false;
    };
  }, []);

  const items = createMessageItems(messages, enabledStickers, groupCharacters);

  return (
    <div
      ref={containerRef}
      className={`cy-message-list cy-message-list--stickers-${stickerSize}`}
      aria-live="polite"
      onScroll={updateScrollState}
    >
      <Bubble.List items={items} role={roles} autoScroll />
    </div>
  );
}
