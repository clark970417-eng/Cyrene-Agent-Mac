type StickerRule = { id: string; pattern: RegExp };

const STICKER_RULES: StickerRule[] = [
  { id: "goodmoring1", pattern: /早安|早上好|早呀/u },
  { id: "goodnight", pattern: /晚安|睡覺|好夢/u },
  { id: "hello", pattern: /(?:^|[，！!。\s])(嗨|哈囉|你好|在嗎|你來啦)(?:$|[，！!。？?\s])/u },
  { id: "Thanks", pattern: /謝謝|感謝|多虧/u },
  { id: "Gigglelots", pattern: /哈哈|嘿嘿|嘻嘻|好笑|笑死/u },
  { id: "hugtight", pattern: /抱抱|抱緊|安慰|陪著你|別難過/u },
  { id: "love-happy", pattern: /喜歡你|愛你|最喜歡|好開心|幸福/u },
  { id: "blushhard", pattern: /害羞|臉紅|不好意思/u },
  { id: "fighting", pattern: /加油|你可以的|撐住/u },
  { id: "Allset", pattern: /完成了|搞定了|準備好了|處理好了/u },
  { id: "OK", pattern: /沒問題|好呀|好喔|收到|明白了/u },
  { id: "thinking", pattern: /想想|讓我想|思考/u },
  { id: "sleepynow", pattern: /睏了|好睏|想睡/u },
  { id: "sotired", pattern: /好累|累了|辛苦了/u },
  { id: "Hurtcry", pattern: /難過|傷心|心疼/u },
  { id: "please", pattern: /拜託|求求你/u },
  { id: "teatime", pattern: /八卦|吃瓜|說來聽聽/u },
  { id: "confident", pattern: /交給人家|放心吧|包在人家/u },
  { id: "playful", pattern: /驚喜|可愛|逗你|開玩笑/u },
];

/** Embedding 模型不可用時，仍依本輪語意挑一個保守的昔漣表情。 */
export function selectDiscordStickerFallback(userText: string, replyText: string): string | null {
  const text = `${replyText}\n${userText}`;
  return STICKER_RULES.find((rule) => rule.pattern.test(text))?.id ?? null;
}

export function discordEmojiNameForStickerId(stickerId: string): string {
  return `cyrene_${stickerId.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
}
