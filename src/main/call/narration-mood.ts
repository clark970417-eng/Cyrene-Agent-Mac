// 把括號旁白、動作描述與 Discord emoji 換成 3D 手勢與情緒標籤。
//
// 昔漣在對話中常會輸出「（輕輕招手）」、「[托腮思考]」、「(伸了個懶腰)」、「:wave:」、「:blush:」等。
// 這些括號動作在語音合成時會被過濾（不讀出括號音），同時精準轉化為 [gesture:...] 與 [mood:...] 標籤，
// 綁定至該語音句段（TTS Chunk），在語音播放到該句時精準同步觸發 3D 動作與表情。

export type NarrationMood =
  | "happy"
  | "shy"
  | "shyBlush"
  | "thinking"
  | "surprised"
  | "sad"
  | "wink"
  | "winkHeart"
  | "smug"
  | "proud"
  | "excited"
  | "yawn"
  | "angry"
  | "sweat"
  | "curious"
  | "pray";

export interface NarrationAction {
  mood?: NarrationMood;
  gesture?: string;
}

interface NarrationRule {
  pattern: RegExp;
  action: NarrationAction;
}

/**
 * 手勢與情緒匹配規則庫（按優先度排序，繁簡通用、支援 Discord Emoji 代號與常見符號）。
 */
const NARRATION_RULES: ReadonlyArray<NarrationRule> = [
  // ── 特殊手勢（帶情緒聯動） ──
  {
    pattern: /招手|揮手|挥手|打招呼|打個招呼|向你揮|:wave:|👋/,
    action: { gesture: "wave", mood: "happy" },
  },
  {
    pattern: /比心|單眼比心|单眼比心|拋媚眼|眨了眨右眼|啾咪|:heart:|:sparkling_heart:|💖|🫶|🫰/,
    action: { gesture: "winkHeart", mood: "winkHeart" },
  },
  {
    pattern: /伸懶腰|伸懒腰|伸展|舒展|伸了個懶腰|伸了个懒腰/,
    action: { gesture: "stretch", mood: "happy" },
  },
  {
    pattern: /拍手|鼓掌|拍了拍手|鼓起掌|:clap:|👏/,
    action: { gesture: "clap", mood: "excited" },
  },
  {
    pattern: /鞠躬|行禮|行礼|欠身|致謝|致谢|彎腰致意|弯腰|🙇/,
    action: { gesture: "bow", mood: "happy" },
  },
  {
    pattern: /托腮|思考|想了(想|一下)?|沉思|托著下巴|托着下巴|手指抵著下巴|若有所思|:thinking:|🤔/,
    action: { gesture: "think", mood: "thinking" },
  },
  {
    pattern: /害羞|臉紅|脸红|摀臉|捂脸|遮著臉|遮着脸|耳根發燙|不好意思|扭捏|嬌羞|娇羞|:blush:|\(\/\/[▽∇]\/\/\)|😊|🫣/,
    action: { gesture: "shyBlush", mood: "shy" },
  },
  {
    pattern: /哈欠|打哈欠|睏|睏倦|睏了|揉眼睛|揉了揉眼|打瞌睡|:yawn:|🥱/,
    action: { gesture: "yawn", mood: "yawn" },
  },
  {
    pattern: /遵命|敬禮|敬礼|立正|收到指令|包在我身上|🫡/,
    action: { gesture: "salute", mood: "happy" },
  },
  {
    pattern: /挺胸|得意|叉腰挺胸|揚起下巴|骄傲|驕傲|自豪|哼哼|:crown:|👑/,
    action: { gesture: "proud", mood: "smug" },
  },
  {
    pattern: /祈禱|祈祷|許願|许愿|合十|雙手合十|双手合十|保佑|:pray:|🙏/,
    action: { gesture: "pray", mood: "pray" },
  },
  {
    pattern: /撫胸|抚胸|撫著胸口|摸著心口|按著胸口|感動|感动|心動|💓|💕/,
    action: { gesture: "handsOnHeart", mood: "happy" },
  },
  {
    pattern: /側耳|倾听|傾聽|側著頭聽|認真聽|仔细听|👂/,
    action: { gesture: "listen", mood: "happy" },
  },
  {
    pattern: /撓頭|挠头|抓抓頭|抓了抓頭髮|不好意思地笑|尷尬地笑|撓了撓頭|🐱/,
    action: { gesture: "headScratch", mood: "shy" },
  },
  {
    pattern: /掩口|捂嘴|吃驚掩嘴|目瞪口呆|驚訝掩口|驚|惊|訝|讶|愣(住|了)?|瞪大|睜大|睁大|瞪圓|瞪圆|倒抽|嚇|吓|😮/,
    action: { gesture: "gasp", mood: "surprised" },
  },
  {
    pattern: /生氣|生气|氣呼呼|生悶氣|叉腰|嘟嘴生氣|氣鼓鼓|嘟著嘴|哼了一聲|:rage:|:angry:|😤|😡/,
    action: { gesture: "angry", mood: "angry" },
  },
  {
    pattern: /擦汗|流汗|乾笑|尷尬|無奈苦笑|擦了擦額頭|:sweat_smile:|😅|💧/,
    action: { gesture: "sweat", mood: "sweat" },
  },
  {
    pattern: /歪(著|着|了)?(頭|头)|好奇地歪頭|賣萌|🐣/,
    action: { gesture: "tiltHead", mood: "thinking" },
  },
  {
    pattern: /摸摸頭|摸摸头|被摸頭|蹭蹭|蹭著你的手|享受地瞇眼|摸頭|🥰/,
    action: { gesture: "headPat", mood: "shy" },
  },
  {
    pattern: /歡呼|欢呼|雀躍|雀跃|好耶|太棒了|振臂|高興得跳|开心得跳|:tada:|:sparkles:|🎉|✨/,
    action: { gesture: "cheer", mood: "excited" },
  },

  // ── 純情緒類別 ──
  {
    pattern: /眨(了眨)?眼|使了個?眼色|眼色|俏皮|調皮|调皮|:wink:|😉/,
    action: { mood: "wink" },
  },
  {
    pattern: /難過|难过|委屈|失落|沮喪|沮丧|低落|嘆(了)?(口)?氣|叹(了)?(口)?气|苦笑|勉強|勉强|無奈|无奈|哭|眼眶|淚|泪|癟(著)?嘴|瘪(着)?嘴|:sob:|:cry:|😢|😭/,
    action: { mood: "sad" },
  },
  {
    pattern: /笑|開心|开心|高興|高兴|愉快|欣喜|輕快|轻快|哼(著|着)歌|:smile:|:grinning:|😄/,
    action: { mood: "happy" },
  },
];

/**
 * 解析旁白括號中的動作與情緒。
 */
export function inferActionFromNarration(narration: string): NarrationAction | null {
  for (const rule of NARRATION_RULES) {
    if (rule.pattern.test(narration)) return rule.action;
  }
  return null;
}

/**
 * 為了向後相容舊測試與模組的 inferMoodFromNarration。
 */
export function inferMoodFromNarration(narration: string): NarrationMood | null {
  return inferActionFromNarration(narration)?.mood ?? null;
}

/**
 * 將括號/emoji 旁白轉換為合成標籤字串，例如 `[gesture:wave][mood:happy]`。
 */
export function narrationMoodTag(narration: string): string {
  const action = inferActionFromNarration(narration);
  if (!action) return "";
  const tags: string[] = [];
  if (action.gesture) tags.push(`[gesture:${action.gesture}]`);
  if (action.mood) tags.push(`[mood:${action.mood}]`);
  return tags.join("");
}
