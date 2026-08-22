import type { SceneIndex } from "../scene-embedder";
import { buildAlwaysOnContext, buildMemoryInjection } from "../orchestrator";
import { getSceneEmbeddingProvider } from "../rag/embedding";
import { buildToneInjection } from "../orchestrator/tone-injector";
import { buildSkillCatalog, skillRegistry } from "../skills";
import { resolveSlashActivation } from "../skills/slash-activation";
import { resolveChatContextTimezone } from "../chat-time-context";
import { getDateLocale } from "../locale-context";
import { loadPromptFile } from "../prompts/prompt-loader";
import { loadUserProfile } from "../settings-store";
import { searchMemoryEntries } from "../rag";
import { memoryStore } from "../memory/memory-store";
import { l2DmaeManager } from "../memory/l2-dmae-manager";

export interface CallPromptBuilderContext {
  /** 场景嵌入索引，由主进程在后台刷新，可能为 null。 */
  sceneEmbeddingIndex: SceneIndex | null;
}

/** 通話模式專用階段等待上限（1.5s）：
 * 語音通話對延遲極端敏感。這裡每一步都是增益項，若單項檢索超時則迅速 fallback，
 * 絕不讓昔漣因向量查詢卡住思考。 */
const STAGE_TIMEOUT_MS = 1_500;

/** 跑一个可有可无的阶段：逾时或失败就退回 fallback，并把耗时记进 log。 */
async function stage<T>(name: string, fallback: T, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`逾時 ${STAGE_TIMEOUT_MS}ms`)), STAGE_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.warn(
      `[CallPrompt] ${name} 略過（${Date.now() - startedAt}ms）：`,
      err instanceof Error ? err.message : String(err),
    );
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 靜態通話人設快取，避免每輪從硬碟重複讀取 5 個檔案 */
let cachedPhonePrompt: { text: string; cachedAt: number } | null = null;
const PHONE_PROMPT_CACHE_TTL_MS = 30_000;

function getCachedPhonePrompt(): string {
  const now = Date.now();
  if (cachedPhonePrompt && now - cachedPhonePrompt.cachedAt < PHONE_PROMPT_CACHE_TTL_MS) {
    return cachedPhonePrompt.text;
  }
  const phoneParts: string[] = [];
  const phoneSystem = loadPromptFile("phone_system.md");
  if (phoneSystem) phoneParts.push(phoneSystem);
  const phoneIdentity = loadPromptFile("phone_identity.md");
  if (phoneIdentity) phoneParts.push(phoneIdentity);
  const soul = loadPromptFile("soul.md");
  if (soul) phoneParts.push(soul);
  const canon = loadPromptFile("canon_quotes.md");
  if (canon) phoneParts.push(canon);
  const phoneStyle = loadPromptFile("phone_style.md");
  if (phoneStyle) phoneParts.push(phoneStyle);
  const text = phoneParts.join("\n\n---\n\n");
  cachedPhonePrompt = { text, cachedAt: now };
  return text;
}

/**
 * 构建通话（Call）模式专用 system prompt。
 * 并行处理常驻上下文、L2 记忆召回与语气注入，极速合成。
 */
export async function buildCallSystemPrompt(
  ctx: CallPromptBuilderContext,
  userText: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const startedAt = Date.now();

  // ① 时间日期（用用户时区，禁止直接喂未校验的 profile.timezone 给 Intl）
  const now = new Date();
  const userTz = resolveChatContextTimezone(loadUserProfile().timezone);
  const timeStr = `当前时间：${now.toLocaleDateString(getDateLocale(), { timeZone: userTz })} ${now.toLocaleTimeString(getDateLocale(), { hour: "2-digit", minute: "2-digit", timeZone: userTz })}`;

  // ② ③ ④ ⑥ 並行異步計算各階段上下文
  const alwaysOnPromise = stage("alwaysOnContext", "", () => buildAlwaysOnContext(userText, messages));

  const memoryPromise = stage("memoryInjection", "", async () => {
    try {
      const allL2 = await memoryStore.getAllL2();
      const recalled = await searchMemoryEntries(userText, "user_memory", 4);
      const recalledIds = recalled
        .map((r) => r.metadata?.l2Id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")
        ?.content ?? "";
      await l2DmaeManager.updateActivation(allL2, userText, lastAssistant, recalledIds);
    } catch {
      // ignore DMAE errors
    }
    return buildMemoryInjection(userText);
  });

  const sceneProvider = getSceneEmbeddingProvider();
  const tonePromise = (sceneProvider && ctx.sceneEmbeddingIndex)
    ? stage("toneInjection", "", () => buildToneInjection(userText, messages, sceneProvider, ctx.sceneEmbeddingIndex!))
    : Promise.resolve("");

  // 等待並行階段完成
  const [alwaysOnContext, memoryInjection, toneInjection] = await Promise.all([
    alwaysOnPromise,
    memoryPromise,
    tonePromise,
  ]);

  // ⑤ 通話專用人設（快取）
  const phonePrompt = getCachedPhonePrompt();

  // ⑥ Slash 约束（resolveSlashActivation 会原地修改 messages）
  const skillActivation = resolveSlashActivation(messages);

  console.log(`[CallPrompt] SystemPrompt 總耗時 ${Date.now() - startedAt}ms`);

  return timeStr + "\n\n" +
    (alwaysOnContext ? alwaysOnContext + "\n\n" : "") +
    (memoryInjection ? memoryInjection + "\n\n" : "") +
    phonePrompt +
    skillActivation +
    toneInjection;
}

