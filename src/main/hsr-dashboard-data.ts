export type HsrBoundAccount = {
  uid: string;
  nickname: string | null;
  region: string | null;
  lastUpdate: string | null;
  invalid: boolean;
};

export type HsrCharacterSummary = {
  id: string;
  name: string;
  level: number;
  eidolon: number;
  rarity: number;
  icon: string;
  portrait: string;
  path: string;
  element: string;
  lightCone: string | null;
  lightConeDetail: HsrLightConeSummary | null;
  relics: HsrRelicSummary[];
  bonusStats: HsrPropertySummary[];
  skillLevels: number[];
};

export type HsrPropertySummary = {
  type: string;
  name: string;
  value: number;
  percent: boolean;
};

export type HsrRelicSummary = {
  id: string;
  name: string;
  level: number;
  icon: string;
  slot: string;
  mainStat: HsrPropertySummary | null;
  subStats: HsrPropertySummary[];
};

export type HsrLightConeSummary = {
  id: string;
  name: string;
  level: number;
  rank: number;
  icon: string;
};

export type HsrProfileSummary = {
  uid: string;
  nickname: string;
  level: number;
  worldLevel: number;
  signature: string;
  avatar: string;
  achievements: number | null;
  charactersCount: number | null;
  lightConesCount: number | null;
  memoryLevel: number | null;
  memoryChaosLevel: number | null;
  memoryChaosStars: number | null;
  universeLevel: number | null;
  characters: HsrCharacterSummary[];
  fetchedAt: string;
};

export type HsrStaticData = {
  characters?: Record<string, unknown>;
  lightCones?: Record<string, unknown>;
  paths?: Record<string, unknown>;
  elements?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  relics?: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function numberOr(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isPercentProperty(type: string, metadata: UnknownRecord): boolean {
  return metadata.percent === true || /(?:Ratio|Chance|Damage|Probability|Resistance|Heal)/i.test(type);
}

function normalizeProperty(value: unknown, staticData: HsrStaticData): HsrPropertySummary | null {
  const property = record(value);
  const type = text(property.type).trim();
  const amount = numberOr(property.value, Number.NaN);
  if (!type || !Number.isFinite(amount)) return null;
  const metadata = record(staticData.properties?.[type]);
  return {
    type,
    name: text(metadata.name).trim() || type,
    value: amount,
    percent: isPercentProperty(type, metadata),
  };
}

const RELIC_SLOT_NAMES: Record<string, string> = {
  HEAD: "頭部", HAND: "手部", BODY: "軀幹", FOOT: "腳部", NECK: "次元球", OBJECT: "連結繩",
  "1": "頭部", "2": "手部", "3": "軀幹", "4": "腳部", "5": "次元球", "6": "連結繩",
};

export function hsrAssetUrl(value: unknown): string {
  const source = text(value).trim();
  if (!source) return "";
  if (/^(?:https?:|data:)/i.test(source)) return source;
  return `https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/${source.replace(/^\/+/, "")}`;
}

export function extractBoundAccounts(rows: Array<{ id?: unknown; json?: unknown }>): HsrBoundAccount[] {
  const accounts = new Map<string, HsrBoundAccount>();
  for (const row of rows) {
    let root: unknown = row.json;
    if (typeof root === "string") {
      try { root = JSON.parse(root); } catch { continue; }
    }
    const value = record(root);
    const canonical = Array.isArray(value.hoyolabs) ? value.hoyolabs : [];
    for (const bindingValue of canonical) {
      const binding = record(bindingValue);
      const characters = Array.isArray(binding.characters) ? binding.characters : [];
      for (const characterValue of characters) {
        const character = record(characterValue);
        const uid = text(character.uid).trim();
        if (!/^\d{9}$/.test(uid)) continue;
        accounts.set(uid, {
          uid,
          nickname: text(character.nickname).trim() || null,
          region: text(character.region).trim() || null,
          lastUpdate: text(character.lastUpdate).trim() || text(binding.lastUpdate).trim() || null,
          invalid: character.invalid === true || binding.invalid === true,
        });
      }
    }
    const legacy = Array.isArray(value.account) ? value.account : [];
    for (const accountValue of legacy) {
      const account = record(accountValue);
      const uid = text(account.uid).trim();
      if (!/^\d{9}$/.test(uid) || accounts.has(uid)) continue;
      accounts.set(uid, {
        uid,
        nickname: text(account.nickname).trim() || null,
        region: text(account.region).trim() || null,
        lastUpdate: text(account.lastUpdate).trim() || null,
        invalid: account.invalid === true,
      });
    }
  }
  return [...accounts.values()].sort((a, b) => (b.lastUpdate ?? "").localeCompare(a.lastUpdate ?? ""));
}

export function normalizeHsrProfile(payload: unknown, requestedUid: string): HsrProfileSummary {
  const root = record(payload);
  const player = record(root.player);
  const space = record(player.space_info ?? root.player_details);
  const memory = record(space.memory_data);
  const rawCharacters = Array.isArray(root.characters) ? root.characters : [];
  const uid = text(player.uid).trim() || requestedUid;
  const nickname = text(player.nickname ?? player.name).trim();
  if (!/^\d{9}$/.test(uid) || !nickname) throw new Error("公開資料沒有回傳有效的玩家資訊，請確認 UID 與遊戲內展示設定。");

  const characters = rawCharacters.map((value): HsrCharacterSummary | null => {
    const character = record(value);
    const path = record(character.path);
    const element = record(character.element);
    const lightCone = record(character.light_cone);
    const id = text(character.id).trim();
    if (!id) return null;
    return {
      id,
      name: text(character.name).trim() || `角色 ${id}`,
      level: numberOr(character.level),
      eidolon: numberOr(character.rank ?? character.eidolon),
      rarity: numberOr(character.rarity),
      icon: hsrAssetUrl(character.icon),
      portrait: hsrAssetUrl(character.portrait ?? character.preview ?? character.icon),
      path: text(path.name ?? character.path).trim(),
      element: text(element.name ?? character.element).trim(),
      lightCone: text(lightCone.name).trim() || null,
      lightConeDetail: text(lightCone.name).trim() ? {
        id: text(lightCone.id).trim(),
        name: text(lightCone.name).trim(),
        level: numberOr(lightCone.level),
        rank: numberOr(lightCone.rank ?? lightCone.superimposition),
        icon: hsrAssetUrl(lightCone.icon),
      } : null,
      relics: [],
      bonusStats: [],
      skillLevels: [],
    };
  }).filter((value): value is HsrCharacterSummary => value !== null);

  return {
    uid,
    nickname,
    level: numberOr(player.level),
    worldLevel: numberOr(player.world_level),
    signature: text(player.signature).trim(),
    avatar: hsrAssetUrl(record(player.avatar).icon ?? player.avatar),
    achievements: nullableNumber(space.achievement_count, space.achievements),
    charactersCount: nullableNumber(space.avatar_count, space.characters, characters.length),
    lightConesCount: nullableNumber(space.light_cone_count, space.light_cones),
    memoryLevel: nullableNumber(memory.level),
    memoryChaosLevel: nullableNumber(memory.chaos_level),
    memoryChaosStars: nullableNumber(memory.chaos_star_count),
    universeLevel: nullableNumber(space.universe_level),
    characters,
    fetchedAt: new Date().toISOString(),
  };
}

export function normalizeEnkaProfile(
  payload: unknown,
  requestedUid: string,
  staticData: HsrStaticData = {},
): HsrProfileSummary {
  const root = record(payload);
  const detail = record(root.detailInfo);
  const recordInfo = record(detail.recordInfo);
  const challenge = record(recordInfo.challengeInfo);
  const uid = text(detail.uid ?? root.uid).trim() || requestedUid;
  const nickname = text(detail.nickname).trim();
  if (!/^\d{9}$/.test(uid) || !nickname) {
    throw new Error("Enka 沒有回傳有效的玩家資訊，請確認 UID 與遊戲內展示設定。");
  }

  const rawCharacters = Array.isArray(detail.avatarDetailList) ? detail.avatarDetailList : [];
  const characters = rawCharacters.map((value): HsrCharacterSummary | null => {
    const character = record(value);
    const id = text(character.avatarId).trim();
    if (!id) return null;
    const metadata = record(staticData.characters?.[id]);
    const pathKey = text(metadata.path).trim();
    const elementKey = text(metadata.element).trim();
    const path = record(staticData.paths?.[pathKey]);
    const element = record(staticData.elements?.[elementKey]);
    const equipment = record(character.equipment);
    const lightConeId = text(equipment.tid).trim();
    const lightCone = record(staticData.lightCones?.[lightConeId]);
    const relics = (Array.isArray(character.relicList) ? character.relicList : []).map((relicValue): HsrRelicSummary | null => {
      const relic = record(relicValue);
      const relicId = text(relic.tid).trim();
      if (!relicId) return null;
      const relicMetadata = record(staticData.relics?.[relicId]);
      const flat = record(relic._flat);
      const props = (Array.isArray(flat.props) ? flat.props : [])
        .map((property) => normalizeProperty(property, staticData))
        .filter((property): property is HsrPropertySummary => property !== null);
      const slotKey = text(relicMetadata.type ?? relic.type).trim();
      return {
        id: relicId,
        name: text(relicMetadata.name).trim() || `遺器 ${relicId}`,
        level: numberOr(relic.level),
        icon: hsrAssetUrl(relicMetadata.icon),
        slot: RELIC_SLOT_NAMES[slotKey] || slotKey || "遺器",
        mainStat: props[0] ?? null,
        subStats: props.slice(1),
      };
    }).filter((relic): relic is HsrRelicSummary => relic !== null);

    const bonusStats = new Map<string, HsrPropertySummary>();
    for (const relic of relics) {
      for (const property of [relic.mainStat, ...relic.subStats]) {
        if (!property) continue;
        const current = bonusStats.get(property.type);
        bonusStats.set(property.type, { ...property, value: (current?.value ?? 0) + property.value });
      }
    }
    const skillLevels = (Array.isArray(character.skillTreeList) ? character.skillTreeList : [])
      .map((skill) => numberOr(record(skill).level))
      .filter((level) => level > 1)
      .slice(0, 4);
    return {
      id,
      name: text(metadata.name).trim() || `角色 ${id}`,
      level: numberOr(character.level),
      eidolon: numberOr(character.rank),
      rarity: numberOr(metadata.rarity, 5),
      icon: hsrAssetUrl(metadata.icon),
      portrait: hsrAssetUrl(metadata.portrait ?? metadata.preview ?? metadata.icon),
      path: text(path.name ?? path.text ?? pathKey).trim(),
      element: text(element.name ?? elementKey).trim(),
      lightCone: text(lightCone.name).trim() || null,
      lightConeDetail: lightConeId ? {
        id: lightConeId,
        name: text(lightCone.name).trim() || `光錐 ${lightConeId}`,
        level: numberOr(equipment.level),
        rank: numberOr(equipment.rank),
        icon: hsrAssetUrl(lightCone.icon),
      } : null,
      relics,
      bonusStats: [...bonusStats.values()].sort((a, b) => {
        const aOrder = numberOr(record(staticData.properties?.[a.type]).order, 999);
        const bOrder = numberOr(record(staticData.properties?.[b.type]).order, 999);
        return aOrder - bOrder;
      }),
      skillLevels,
    };
  }).filter((value): value is HsrCharacterSummary => value !== null);

  const headIcon = text(detail.headIcon).trim();
  return {
    uid,
    nickname,
    level: numberOr(detail.level),
    worldLevel: numberOr(detail.worldLevel),
    signature: text(detail.signature).trim(),
    avatar: headIcon ? `https://enka.network/ui/hsr/SpriteOutput/AvatarRoundIcon/${headIcon}.png` : "",
    achievements: nullableNumber(recordInfo.achievementCount),
    charactersCount: nullableNumber(recordInfo.avatarCount, characters.length),
    lightConesCount: nullableNumber(recordInfo.equipmentCount),
    memoryLevel: nullableNumber(challenge.scheduleMaxLevel, challenge.memoryMaxLevel),
    memoryChaosLevel: nullableNumber(challenge.mazeGroupIndex, challenge.chaosLevel),
    memoryChaosStars: nullableNumber(challenge.mazeGroupPoint, challenge.chaosStarCount),
    universeLevel: nullableNumber(recordInfo.maxRogueChallengeScore),
    characters,
    fetchedAt: new Date().toISOString(),
  };
}
