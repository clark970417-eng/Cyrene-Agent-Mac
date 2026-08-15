// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const profile = {
  uid: "801162511",
  nickname: "C",
  level: 70,
  worldLevel: 6,
  signature: "",
  avatar: "https://enka.network/ui/hsr/SpriteOutput/AvatarRoundIcon/200159.png",
  achievements: 1412,
  charactersCount: 75,
  lightConesCount: 133,
  memoryLevel: null,
  memoryChaosLevel: null,
  memoryChaosStars: null,
  universeLevel: 9,
  fetchedAt: "2026-08-16T00:00:00.000Z",
  characters: [{
    id: "1407",
    name: "遐蝶",
    level: 80,
    eidolon: 6,
    rarity: 5,
    icon: "https://example.com/icon.png",
    portrait: "https://example.com/portrait.png",
    path: "記憶",
    element: "量子",
    lightCone: "讓告別，更美一點",
    lightConeDetail: { id: "23040", name: "讓告別，更美一點", level: 80, rank: 1, icon: "https://example.com/cone.png" },
    relics: [{
      id: "61241",
      name: "詩人的蒔蘿花冠",
      level: 15,
      icon: "https://example.com/relic.png",
      slot: "頭部",
      mainStat: { type: "HPDelta", name: "生命值", value: 705.6, percent: false },
      subStats: [{ type: "CriticalChance", name: "暴擊率", value: 0.06156, percent: true }],
    }],
    bonusStats: [{ type: "CriticalChance", name: "暴擊率", value: 0.06156, percent: true }],
    skillLevels: [6, 10, 10, 10],
  }],
};

describe("HSR dashboard character detail", () => {
  beforeEach(() => {
    vi.resetModules();
    const html = readFileSync("src/renderer/hsr-dashboard/index.html", "utf8");
    document.open();
    document.write(html);
    document.close();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value() { this.setAttribute("open", ""); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); },
    });
    window.hsrDashboard = {
      status: vi.fn().mockResolvedValue({ installed: true, databaseReady: true, accounts: [], activeUid: profile.uid }),
      profile: vi.fn().mockResolvedValue({ ok: true, profile }),
    };
  });

  it("opens a clickable character panel with equipment details and closes it", async () => {
    await import("./main");
    await vi.waitFor(() => expect(document.querySelectorAll(".character-card")).toHaveLength(1));

    const card = document.querySelector<HTMLButtonElement>(".character-card")!;
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("aria-label")).toContain("遐蝶");
    card.click();

    const dialog = document.querySelector<HTMLDialogElement>("#character-dialog")!;
    expect(dialog.open).toBe(true);
    expect(document.querySelector("#detail-name")?.textContent).toBe("遐蝶");
    expect(document.querySelector("#detail-lightcone")?.textContent).toContain("讓告別，更美一點");
    expect(document.querySelector("#detail-traces")?.textContent).toContain("Lv.10");
    expect(document.querySelector("#detail-relics")?.textContent).toContain("詩人的蒔蘿花冠");
    expect(document.querySelector("#detail-stat-grid")?.textContent).toContain("6.2%");

    document.querySelector<HTMLButtonElement>("#detail-close")!.click();
    expect(dialog.open).toBe(false);
  });
});
