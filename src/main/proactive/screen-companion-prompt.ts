import type { ChatMessage } from "../orchestrator/vendors/types";
import type { VisionModelConfig } from "../settings/model-settings";

export type ScreenCompanionTalkativeness = VisionModelConfig["talkativeness"];

const TALKATIVENESS_DIRECTIVE: Record<ScreenCompanionTalkativeness, string> = {
  quiet:
    "你現在的說話意願很低：只有畫面出現真正特別、少見、值得一提的內容時才開口，大多數時候應該保持沉默（decision=silent）。",
  normal:
    "你現在的說話意願適中：畫面有變化或有趣的地方時可以自然搭話，但不必每次都說話。",
  active:
    "你現在的說話意願較高：只要畫面有一點值得聊的內容，都可以主動搭話。",
  chatty:
    "你現在的說話意願很高：幾乎任何畫面細節都可以成為你搭話的理由，保持活潑健談。",
};

const SCREEN_COMPANION_SYSTEM = `[screen_companion_system]
你剛瞄了一眼使用者的電腦螢幕，正在判斷要不要主動說一句話陪伴他，而不是回答使用者的新訊息。
你知道自己看了螢幕，可以自然地提到你看到的東西（吐槽、關心、好奇、鼓勵都可以），不需要隱瞞這件事。
如果沒有自然且值得說的內容，請返回 silent，不要為了開口而硬找話題。
訊息應當簡短自然，像是不經意瞄了一眼後隨口說的一句話，不要長篇分析畫面內容，也不要連續提出多個問題。
不要提及"視覺模型""AI""偵測""系統""截圖"等字眼，那會破壞人設。`;

export interface BuildScreenCompanionMessagesInput {
  basePersona: string;
  sceneDescription: string;
  talkativeness: ScreenCompanionTalkativeness;
}

export function buildScreenCompanionMessages(
  input: BuildScreenCompanionMessagesInput,
): ChatMessage[] {
  const systemParts = [
    input.basePersona.trim(),
    SCREEN_COMPANION_SYSTEM,
    TALKATIVENESS_DIRECTIVE[input.talkativeness],
  ];

  const trigger = `[本次螢幕陪伴候選]
你剛看到的畫面描述：
${input.sceneDescription.trim()}

請只返回以下一種 JSON，不要使用 Markdown 代碼塊，也不要添加解釋：
{"decision":"send","text":"要說的一句自然的話"}
或
{"decision":"silent","text":""}`;

  return [
    { role: "system", content: systemParts.filter(Boolean).join("\n\n---\n\n") },
    { role: "user", content: trigger },
  ];
}
