const IMAGE_NOUNS = "(?:照片|相片|自拍|圖片|圖像|插畫|繪圖|桌布|壁紙|頭像|立繪|角色圖)";
const OUTFITS =
  "(?:黑絲|白絲|絲襪|褲襪|網襪|過膝襪|長襪|泳裝|睡衣|制服|女僕裝|禮服|裙裝|洋裝|婚紗)";
const ORIGINAL_LOOK = [
  "原皮",
  "原版",
  "原始造型",
  "原本造型",
  "預設造型",
  "預設服裝",
  "官方造型",
  "original outfit",
  "default outfit",
  "canonical outfit",
];

const CYRENE_CANONICAL_OUTFIT = [
  "(canonical original Cyrene outfit from Honkai Star Rail:1.5)",
  "fitted pearl-white sleeveless bodice with a high lavender collar and an iridescent diamond chest jewel",
  "delicate silver-lilac filigree, translucent crystal wing-shaped shoulder ornaments, detached ornamental arm pieces",
  "large blue rose at the waist, asymmetrical layered high-low petal dress",
  "pearl-white outer panels, lavender and rainbow-prismatic inner petals, deep indigo starry underskirt",
  "bare legs with elegant pale rose-vine markings, blue rose ankle ornaments, white pointed crystal heels",
].join(", ");

/** 換裝時稍微降低角色 LoRA，避免訓練集裡的原服裝蓋過使用者要求。 */
export function hasCyreneOutfitRequest(request: string): boolean {
  return (
    new RegExp(OUTFITS, "i").test(request) ||
    includesAny(request, [
      "black tights",
      "black pantyhose",
      "black stockings",
      "white tights",
      "white pantyhose",
      "white stockings",
      "maid dress",
      "swimsuit",
      "pajama",
      "pyjama",
      "wedding dress",
      "uniform",
    ])
  );
}

/** 判斷一句自然對話是否是在請昔漣生成自己的圖片。 */
export function extractCyreneImageRequest(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 1800) return null;
  const intentText = normalized.replace(
    /^(?:(?:昔漣寶寶|昔漣|寶寶|寶貝|老婆|親愛的|姐姐|妹妹)[\s，,、：:~～♪]*)+/i,
    "",
  );

  const wantsCyrenePhoto = new RegExp(
    `(?:我想看|想看|讓我看看|給我看|傳給我|發給我|可以看|能看)(?:一下)?(?:你|妳|她|他|昔漣)?(?:的)?${IMAGE_NOUNS}`,
    "i",
  );
  const firstPersonAppearance =
    /(?:我想看|想看|讓我看看|給我看)(?:一下)?(?:你|妳|她|他|昔漣)(?:穿|換上|換成|戴|拿著|抱著|躺|坐|站|在|做)/i;
  const implicitOutfit = new RegExp(
    String.raw`(?:我想看|想看|讓我看看|給我看)(?:一下)?(?:你|妳|昔漣)?\s*${OUTFITS}(?:$|[，。！？~～♪]|\s)`,
    "i",
  );
  // 使用者和昔漣對話時，口語上的「想看妳／看看昔漣」本身就是索取寫真，
  // 不強迫再補「照片」。仍要求明確指向角色，避免「看電影／看文件」誤觸。
  const directLookAtCyrene =
    /(?:我?想看|想看看|讓我看(?:看)?|給我看(?:看)?|可以看(?:看)?|能看(?:看)?|看(?:看)?)(?:一下)?\s*(?:你|妳|昔漣)(?:本人|現在|今天)?(?:的樣子|的模樣)?(?:$|[，。！？~～♪]|\s)/i;
  const explicitImage = new RegExp(
    `(?:幫我|請|可以|能不能|替我|給我|來一張|生成|產生|畫|繪製|做一張).{0,24}${IMAGE_NOUNS}`,
    "i",
  );
  const imperativeDraw =
    /^(?:幫我|請|替我)?\s*(?:(?:畫|繪製|生成|產生)(?:一張|張)?|做(?:一張|張))\s*.+/i;

  return wantsCyrenePhoto.test(intentText) ||
    firstPersonAppearance.test(intentText) ||
    implicitOutfit.test(intentText) ||
    directLookAtCyrene.test(intentText) ||
    explicitImage.test(intentText) ||
    imperativeDraw.test(intentText)
    ? normalized
    : null;
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.toLowerCase().includes(value.toLowerCase()));
}

/** 把常見中文口語轉成 Animagine/SDXL 能穩定理解的昔漣提示詞。 */
export function buildCyreneImagePrompt(request: string): string {
  const text = request.replace(/\s+/g, " ").trim();
  const wantsBlackHosiery = includesAny(text, [
    "黑絲",
    "黑色絲襪",
    "black tights",
    "black pantyhose",
    "black stockings",
  ]);
  const wantsWhiteHosiery = includesAny(text, [
    "白絲",
    "白色絲襪",
    "white tights",
    "white pantyhose",
    "white stockings",
  ]);
  const wantsOriginalLook = includesAny(text, ORIGINAL_LOOK);
  const wantsFullBody =
    wantsBlackHosiery || wantsWhiteHosiery || includesAny(text, ["全身", "full body"]);
  const parts = [
    "cyrene_hsr, 1girl, solo, Cyrene from Honkai Star Rail, honkai: star rail, safe",
    "adult woman, slender elegant build, long legs, soft youthful oval face, very long flowing pastel pink hair with aqua blue gradient tips",
    "(both eyes clearly open:1.5), large symmetrical prismatic irises blending violet, rose-pink and cyan-blue, small star-like color facets",
    "(matching Cyrene eye pattern:1.5), each eye has one small slender upright dark-magenta rhombus pupil surrounded by one thin pale-lilac hollow rhombus outline, centered pupils, not heart-shaped, not large white gem pupils",
    "clear unobstructed face, pointed elf ears",
    "blue rose hair ornament, white laurel ornament, iridescent feather-like hair ornament, gentle elegant expression",
  ];

  if (wantsOriginalLook) {
    parts.push(CYRENE_CANONICAL_OUTFIT);
  } else if (wantsBlackHosiery) {
    parts.push(
      "(alternate outfit:1.3), (opaque jet-black pantyhose:1.7), " +
        "(continuous black tights visibly covering both legs from waist through toes:1.6), " +
        "(both legs fully covered in dark black hosiery:1.55), full body, feet visible, " +
        "short elegant lavender cocktail dress above the knees, tasteful covered outfit, refined black heels",
    );
  } else if (wantsWhiteHosiery) {
    parts.push(
      "(alternate outfit:1.3), (opaque pure-white pantyhose:1.7), " +
        "(continuous white tights visibly covering both legs from waist through toes:1.6), " +
        "(both legs fully covered in bright white hosiery:1.55), full body, feet visible, " +
        "short elegant lavender dress above the knees, tasteful covered outfit, refined white heels",
    );
  } else if (includesAny(text, ["女僕"])) {
    parts.push("full body, tasteful black and white maid dress, elegant ruffles, fully covered");
  } else if (includesAny(text, ["泳裝", "swimsuit"])) {
    parts.push("tasteful elegant one-piece swimsuit, beach cover-up, non-explicit");
  } else if (includesAny(text, ["睡衣", "pajama", "pyjama"])) {
    parts.push("soft lavender pajamas, cozy fully covered sleepwear");
  } else if (includesAny(text, ["婚紗", "wedding dress"])) {
    parts.push("ethereal white wedding dress, laurel motif, lavender accents");
  } else if (includesAny(text, ["制服", "uniform"])) {
    parts.push("elegant academy uniform, tasteful complete outfit");
  } else {
    parts.push(CYRENE_CANONICAL_OUTFIT);
  }

  if (includesAny(text, ["自拍", "selfie"]))
    parts.push("selfie composition, looking at viewer, warm intimate smile");
  else if (wantsFullBody)
    parts.push("full body composition, entire character visible from head to feet");
  else if (includesAny(text, ["照片", "相片", "photo", "portrait"]))
    parts.push("vertical portrait composition, three-quarter body, looking at viewer");

  if (includesAny(text, ["坐", "sitting"])) parts.push("sitting naturally");
  if (includesAny(text, ["站", "standing"])) parts.push("standing naturally");
  if (includesAny(text, ["回眸", "looking back"])) parts.push("looking back over shoulder");
  if (includesAny(text, ["星空", "starry"])) parts.push("starry night sky, soft violet starlight");
  else if (includesAny(text, ["海邊", "beach"])) parts.push("serene beach, blue hour lighting");
  else if (includesAny(text, ["房間", "臥室", "bedroom"]))
    parts.push("cozy elegant bedroom, soft window light");
  else if (includesAny(text, ["咖啡", "cafe"]))
    parts.push("quiet modern cafe, soft afternoon light");
  else parts.push("ethereal garden, floating petals, soft purple light");

  // 英文關鍵詞可直接補進提示詞；中文部分已由上面的明確映射處理。
  const englishDetails = text
    .match(/[A-Za-z][A-Za-z0-9 ,.'"-]{2,}/g)
    ?.join(", ")
    .slice(0, 320);
  if (englishDetails) parts.push(englishDetails);
  parts.push(
    "clean standalone borderless 2D anime character illustration, polished anime game art, clean anime line art, refined cel shading",
    "single character fills the canvas, simple soft background, no text, no letters, no title, no logo, no frame, no border",
    "accurate anatomy, accurate hands, detailed face, masterpiece, high score, great score, absurdres",
  );
  return parts.join(", ");
}

export function inferCyreneImageAspectRatio(request: string): "1:1" | "3:4" | "9:16" | "16:9" {
  const text = request.toLowerCase();
  if (includesAny(text, ["電腦桌布", "寬螢幕", "desktop wallpaper", "wide screen"])) return "16:9";
  if (includesAny(text, ["方形", "正方形", "頭像", "square", "avatar"])) return "1:1";
  return "9:16";
}
