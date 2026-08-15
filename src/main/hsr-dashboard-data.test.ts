import { describe, expect, it } from "vitest";
import { extractBoundAccounts, hsrAssetUrl, normalizeEnkaProfile, normalizeHsrProfile } from "./hsr-dashboard-data";

describe("hsr dashboard data", () => {
  it("extracts only safe account summaries from QuickDB rows", () => {
    const accounts = extractBoundAccounts([{
      id: "123456789012345678",
      json: JSON.stringify({
        hoyolabs: [{
          cookie: "secret-cookie-must-not-escape",
          ltuid_v2: "private-id",
          lastUpdate: "2026-08-14T10:00:00.000Z",
          characters: [{ uid: "800123456", nickname: "星", region: "Asia", invalid: false }],
        }],
      }),
    }]);

    expect(accounts).toEqual([{
      uid: "800123456",
      nickname: "星",
      region: "Asia",
      lastUpdate: "2026-08-14T10:00:00.000Z",
      invalid: false,
    }]);
    expect(JSON.stringify(accounts)).not.toContain("secret-cookie");
    expect(JSON.stringify(accounts)).not.toContain("private-id");
  });

  it("normalizes Mihomo player and character data", () => {
    const result = normalizeHsrProfile({
      player: {
        uid: "800123456",
        nickname: "開拓者",
        level: 70,
        world_level: 6,
        signature: "向星海前進",
        avatar: { icon: "icon/avatar/1001.png" },
        space_info: {
          achievement_count: 777,
          avatar_count: 42,
          light_cone_count: 55,
          universe_level: 8,
          memory_data: { chaos_level: 12, chaos_star_count: 36 },
        },
      },
      characters: [{
        id: "1001",
        name: "三月七",
        level: 80,
        rank: 6,
        rarity: 4,
        portrait: "image/character_portrait/1001.png",
        path: { name: "存護" },
        element: { name: "冰" },
        light_cone: { name: "餘生的第一天" },
      }],
    }, "800123456");

    expect(result.nickname).toBe("開拓者");
    expect(result.memoryChaosStars).toBe(36);
    expect(result.characters[0]).toMatchObject({ name: "三月七", eidolon: 6, path: "存護", element: "冰" });
    expect(result.characters[0]?.portrait).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
  });

  it("keeps remote assets and rejects an empty player", () => {
    expect(hsrAssetUrl("https://example.com/avatar.png")).toBe("https://example.com/avatar.png");
    expect(() => normalizeHsrProfile({ player: {} }, "800123456")).toThrow(/有效的玩家資訊/);
  });

  it("normalizes Enka fallback data with Traditional Chinese local metadata", () => {
    const result = normalizeEnkaProfile({
      uid: 801162511,
      detailInfo: {
        uid: 801162511,
        nickname: "C",
        level: 70,
        worldLevel: 6,
        headIcon: 200159,
        recordInfo: { achievementCount: 1412, avatarCount: 75, equipmentCount: 133, maxRogueChallengeScore: 9 },
        avatarDetailList: [{
          avatarId: 1407,
          level: 80,
          rank: 6,
          equipment: { tid: 23040, level: 80, rank: 1 },
          skillTreeList: [{ pointId: 1407001, level: 6 }, { pointId: 1407002, level: 10 }],
          relicList: [{
            tid: 61241,
            type: 1,
            level: 15,
            _flat: { props: [{ type: "HPDelta", value: 705.6 }, { type: "CriticalChance", value: 0.06156 }] },
          }],
        }],
      },
    }, "801162511", {
      characters: { "1407": { name: "遐蝶", rarity: 5, path: "Memory", element: "Quantum", portrait: "image/character_portrait/1407.png" } },
      lightCones: { "23040": { name: "讓告別，更美一點" } },
      paths: { Memory: { name: "記憶" } },
      elements: { Quantum: { name: "量子" } },
      relics: { "61241": { name: "詩人的蒔蘿花冠", type: "HEAD", icon: "icon/relic/124_0.png" } },
      properties: {
        HPDelta: { name: "生命值", order: 1 },
        CriticalChance: { name: "暴擊率", order: 5 },
      },
    });

    expect(result).toMatchObject({ uid: "801162511", nickname: "C", achievements: 1412, charactersCount: 75 });
    expect(result.characters[0]).toMatchObject({ name: "遐蝶", path: "記憶", element: "量子", lightCone: "讓告別，更美一點" });
    expect(result.avatar).toBe("https://enka.network/ui/hsr/SpriteOutput/AvatarRoundIcon/200159.png");
    expect(result.characters[0]?.lightConeDetail).toMatchObject({ level: 80, rank: 1 });
    expect(result.characters[0]?.relics[0]).toMatchObject({ name: "詩人的蒔蘿花冠", slot: "頭部", level: 15 });
    expect(result.characters[0]?.bonusStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "暴擊率", value: 0.06156, percent: true }),
    ]));
    expect(result.characters[0]?.skillLevels).toEqual([6, 10]);
  });
});
