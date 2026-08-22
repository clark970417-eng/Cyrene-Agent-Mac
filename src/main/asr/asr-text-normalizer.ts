import { toTraditionalTaiwan } from "../utils/opencc";

/**
 * 常見語音辨識同音/近音字修正字典（語境敏感）
 */
const HOMOPHONE_REPLACEMENTS: Array<[RegExp, string | ((match: string, ...args: any[]) => string)]> = [
  // 角色名 / 昔漣相關（語音常將 昔漣 辨識為 洗臉、吸臉、西蓮 等）
  [/(?:^|[，,。！？!?\s])(洗臉|吸臉|西蓮|汐漣|息蓮|希漣|膝連|西連|希連|昔蓮|昔连|賽蓮|塞蓮)(?=[，,。！？!?\s]|$|[\u4e00-\u9fa5a-zA-Z])/g, (match, p1) => match.replace(p1, "昔漣")],
  [/(昔|西|希|汐)(寶|宝)/g, "昔寶"],
  // 常見日常口語
  [/幹麻/g, "幹嘛"],
  [/做啥/g, "在做什麼"],
  [/app\s*key/gi, "AppKey"],
];

/**
 * 對 ASR 識別結果進行綜合正規化：
 * 1. 轉繁體（台灣慣用字詞）
 * 2. 修正語音辨識專用同音字（昔漣、昔寶、常見錯字）
 * 3. 去除多餘空格與畸形標點
 */
export function normalizeAsrText(text: string): string {
  if (!text) return "";
  let clean = text.trim();
  if (!clean) return "";

  // 1. 繁體轉換
  clean = toTraditionalTaiwan(clean);

  // 2. 同音字與常見語音誤辨識校正
  for (const [pattern, replacement] of HOMOPHONE_REPLACEMENTS) {
    clean = clean.replace(pattern, replacement as any);
  }

  // 3. 標點與空白精修（英數間保留空格，中文字間去空格）
  while (/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/.test(clean)) {
    clean = clean.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2");
  }
  clean = clean.replace(/\s+([，。！？、；：])/g, "$1");

  return clean;
}

