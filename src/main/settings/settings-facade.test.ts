import { describe, expect, it } from "vitest";

import { normalizeGeneralSettings } from "./settings-facade";

describe("general settings compatibility", () => {
  it("keeps custom settings written by older builds", () => {
    const normalized = normalizeGeneralSettings({
      openerPolicy: "balanced",
      customFutureSetting: { enabled: true },
    } as never) as unknown as Record<string, unknown>;

    expect(normalized.openerPolicy).toBe("balanced");
    expect(normalized.customFutureSetting).toEqual({ enabled: true });
  });

  it("always uses Taiwan Traditional Chinese for the desktop UI", () => {
    const normalized = normalizeGeneralSettings({ language: "zh-CN" } as never);
    expect(normalized.language).toBe("zh-TW");
  });

  it("drops settings from the removed daily ritual feature", () => {
    const normalized = normalizeGeneralSettings({
      dailyRitualEnabled: true,
      dailyRitualMorningTime: "08:00",
    } as never) as unknown as Record<string, unknown>;

    expect(normalized).not.toHaveProperty("dailyRitualEnabled");
    expect(normalized).not.toHaveProperty("dailyRitualMorningTime");
  });
});
