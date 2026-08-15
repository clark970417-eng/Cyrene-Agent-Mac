import type { IncomingMessage } from "./types";
import { isDiscordTextVoiceRequestText } from "./adapters/discord/text-voice-request";

const EMOTIONAL_VOICE_MOMENT = /(?:晚安|睡不著|失眠|想睡|哄我睡|難過|傷心|委屈|想哭|哭了|崩潰|焦慮|不安|壓力大|好累|累了|害怕|孤單|寂寞|安慰我|抱抱|哄我|想被哄|陪陪我|陪伴我|陪我(?:一下|聊聊|睡|休息)|想你|愛你|生日|祝我|祝福我|恭喜|慶祝)/u;
const INFORMATIONAL_REQUEST = /(?:這題|解題|計算|證明|翻譯|分析|解釋|教學|怎麼做|怎麼算|為什麼|什麼是|幫我看|查一下|搜尋|程式|代碼|圖片|照片|附圖)/u;
const SPOKEN_CONTENT = "笑話|冷笑話|故事|睡前故事|晚安|早安|秘密|悄悄話|情話|心裡話|繞口令|台詞|自我介紹|自介|想法|幾句話|一句話|點什麼|些什麼|唱歌|一首歌|首歌|哼歌|asmr|耳語";

/** 不必明說「語音」，台灣口語中明顯要求「開口說」也算語音意圖。 */
export function isColloquialVoiceRequest(text: string): boolean {
  const cleaned = text.replace(/<@!?\d+>/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || INFORMATIONAL_REQUEST.test(cleaned)) return false;

  const contentPattern = new RegExp(
    `(?:跟我|對我)?(?:說|講|唸|念|讀|唱|哼)(?:給我聽)?(?:一下|個|一個|段|一段|句|一句|首|一首|些|點)?\\s*(?:${SPOKEN_CONTENT})`,
    "u",
  );
  if (contentPattern.test(cleaned)) return true;
  if (/(?:說|講|唸|念|讀)(?:給|講給|說給|念給|讀給)?我聽/u.test(cleaned)) return true;
  if (/^(?:你)?(?:能不能|可不可以|可以|能|要不要)?(?:跟我|對我)(?:說|講|唸|念|讀)(?:一下|幾句|些話|點話|說話|講話)?[!！?？~～。，,]*$/u.test(cleaned)) return true;
  if (/(?:跟我|陪我)(?:說說話|講講話|聊聊|聊天)/u.test(cleaned)) return true;
  return /^(?:你)?(?:說|講|唸|念|讀)(?:一下|幾句|幾句話|些話|點話|說看|講看|念念看|讀讀看|看|啊|呀|嘛|吧|呢|說|講)?[!！?？~～。，,]*$/u.test(cleaned);
}

/**
 * TTS 是一種表達選擇，不是每輪的固定副產品。
 * 明確語音請求優先；其餘只在適合用聲音表達的情緒情境附上短語音。
 */
export function shouldUseSmartChannelTts(msg: IncomingMessage, replyText: string): boolean {
  const userText = msg.text.replace(/\[\u9644\u4ef6:[^\]]*\]/gu, " ").trim();
  if (isDiscordTextVoiceRequestText(userText)) return true;

  if (msg.attachments?.length) return false;
  if (isColloquialVoiceRequest(userText)) return true;
  if (!replyText.trim() || replyText.length > 260) return false;
  if (userText.startsWith("/") || /^(?:ww|!)[a-z\u4e00-\u9fff]/iu.test(userText)) return false;
  if (INFORMATIONAL_REQUEST.test(userText)) return false;
  if (/```|https?:\/\/|\b(?:error|exception|stack trace)\b/i.test(replyText)) return false;

  return EMOTIONAL_VOICE_MOMENT.test(userText);
}
