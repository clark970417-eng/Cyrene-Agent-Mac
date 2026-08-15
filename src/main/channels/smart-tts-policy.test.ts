import { describe, expect, it } from "vitest";
import { isColloquialVoiceRequest, shouldUseSmartChannelTts } from "./smart-tts-policy";
import type { IncomingMessage } from "./types";

function message(text: string, withImage = false): IncomingMessage {
  return {
    channel: "discord",
    senderId: "owner",
    chatId: "chat",
    text,
    at: new Date(),
    attachments: withImage ? [{ kind: "image", filePath: "/tmp/question.png" }] : undefined,
  };
}

describe("smart channel TTS policy", () => {
  it("明確要求語音時一定傳", () => {
    expect(shouldUseSmartChannelTts(message("用語音回我"), "好呀，人家說給你聽♪")).toBe(true);
    expect(shouldUseSmartChannelTts(message("傳個自我介紹的語音"), "嗨，我是昔漣♪")).toBe(true);
    expect(shouldUseSmartChannelTts(message("我想聽你的聲音"), "人家就在這裡喔♪")).toBe(true);
  });

  it("口語的「說/講/跟我說」也能判斷為語音", () => {
    for (const text of [
      "說", "講啊", "念一下", "讀給我聽", "講幾句", "跟我說", "對我講幾句",
      "講個笑話", "說個冷笑話", "跟我說晚安", "說給我聽", "你講講看",
      "唸一段故事", "念個繞口令", "讀一段台詞", "唱首歌", "說點什麼", "陪我聊聊",
    ]) {
      expect(isColloquialVoiceRequest(text), text).toBe(true);
      expect(shouldUseSmartChannelTts(message(text), "好呀，人家說給你聽♪"), text).toBe(true);
    }
  });

  it("不會因普通句子出現「說/講」就誤傳語音", () => {
    for (const text of ["我之前說我喜歡草莓", "你說的那間學校在哪裡", "跟我說這題怎麼算", "解釋一下你剛才說的話"]) {
      expect(isColloquialVoiceRequest(text), text).toBe(false);
    }
  });

  it("適合聲音的安慰、晚安情境會傳", () => {
    expect(shouldUseSmartChannelTts(message("我今天好累，陪陪我"), "過來吧，人家陪你休息一下♪")).toBe(true);
    expect(shouldUseSmartChannelTts(message("晚安昔漣"), "晚安，做個好夢喔♪")).toBe(true);
    expect(shouldUseSmartChannelTts(message("我最近壓力好大，想被哄"), "過來吧，人家陪著你♪")).toBe(true);
    expect(shouldUseSmartChannelTts(message("今天是我生日，祝福我吧"), "生日快樂，願你每天都幸福♪")).toBe(true);
  });

  it("一般閒聊不會每則都傳語音", () => {
    expect(shouldUseSmartChannelTts(message("你在幹嘛"), "人家正在這裡等你喔♪")).toBe(false);
  });

  it("附圖解題與資訊型問答只回文字", () => {
    expect(shouldUseSmartChannelTts(message("做這一題", true), "這題可以用洛必達法則。")).toBe(false);
    expect(shouldUseSmartChannelTts(message("幫我解釋什麼是極限"), "極限是函數趨近某個輸入時的行為。")).toBe(false);
  });

  it("過長回覆即使是情緒情境也不自動讀完", () => {
    expect(shouldUseSmartChannelTts(message("我好難過，安慰我"), "抱".repeat(261))).toBe(false);
  });
});
