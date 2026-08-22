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

  it("migrates the retired web-speech ASR value to the offline whisper engine", () => {
    // 舊版設定介面的「本機離線 Whisper」選項寫入 web-speech，但它不在允許
    // 清單裡，會被靜默打回 off，害通話收得到音卻永遠不回話。
    const normalized = normalizeGeneralSettings({ asrEngine: "web-speech" } as never);
    expect(normalized.asrEngine).toBe("local");
  });

  it("keeps supported ASR engines and rejects unknown ones", () => {
    expect(normalizeGeneralSettings({ asrEngine: "local" } as never).asrEngine).toBe("local");
    expect(normalizeGeneralSettings({ asrEngine: "aliyun" } as never).asrEngine).toBe("aliyun");
    expect(normalizeGeneralSettings({ asrEngine: "off" } as never).asrEngine).toBe("off");
    expect(normalizeGeneralSettings({ asrEngine: "nonsense" } as never).asrEngine).toBe("off");
    expect(normalizeGeneralSettings({} as never).asrEngine).toBe("off");
  });
});
