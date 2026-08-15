type EmojiRule = { name: string; pattern: RegExp };

const EMOJI_RULES: EmojiRule[] = [
  { name: "cyrene_goodmoring1", pattern: /早安|早上好|早呀/u },
  { name: "cyrene_goodnight", pattern: /晚安|睡覺|好夢/u },
  { name: "cyrene_hello", pattern: /(?:^|[，！!。\s])(嗨|哈囉|你好|在嗎|你來啦)(?:$|[，！!。？?\s])/u },
  { name: "cyrene_thanks", pattern: /謝謝|感謝|多虧/u },
  { name: "cyrene_gigglelots", pattern: /哈哈|嘿嘿|嘻嘻|好笑|笑死/u },
  { name: "cyrene_hugtight", pattern: /抱抱|抱緊|安慰|陪著你|別難過/u },
  { name: "cyrene_love_happy", pattern: /喜歡你|愛你|最喜歡|好開心|幸福/u },
  { name: "cyrene_blushhard", pattern: /害羞|臉紅|不好意思/u },
  { name: "cyrene_fighting", pattern: /加油|你可以的|撐住/u },
  { name: "cyrene_allset", pattern: /完成了|搞定了|準備好了|處理好了/u },
  { name: "cyrene_ok", pattern: /沒問題|好呀|好喔|收到|明白了/u },
  { name: "cyrene_sleepynow", pattern: /睏了|好睏|想睡/u },
  { name: "cyrene_sotired", pattern: /好累|累了|辛苦了/u },
  { name: "cyrene_hurtcry", pattern: /難過|傷心|心疼/u },
  { name: "cyrene_please", pattern: /拜託|求求你/u },
  { name: "cyrene_teatime", pattern: /八卦|吃瓜|說來聽聽/u },
  { name: "cyrene_confident", pattern: /交給人家|放心吧|包在人家/u },
  { name: "cyrene_playful", pattern: /驚喜|可愛|逗你|開玩笑/u },
];

export function selectCloudDiscordEmojiName(userText: string, replyText: string): string | null {
  if (/<a?:[a-z0-9_]+:\d+>/i.test(replyText)) return null;
  const text = `${replyText}\n${userText}`;
  return EMOJI_RULES.find((rule) => rule.pattern.test(text))?.name ?? null;
}
