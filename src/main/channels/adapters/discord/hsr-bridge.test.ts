import { describe, expect, it } from "vitest";
import {
  isHsrBangCommand,
  isHsrComponentId,
  mergeHsrCommandDefinitions,
  probeHsrNativeRuntime,
} from "./hsr-bridge";
import { DISCORD_SLASH_COMMANDS } from "./slash-commands";

describe("hsr bridge", () => {
  it("recognizes only HSR component identifiers", () => {
    expect(isHsrComponentId("account-select:0")).toBe(true);
    expect(isHsrComponentId("warp_query")).toBe(true);
    expect(isHsrComponentId("profile_SelectCharacter:1")).toBe(true);
    expect(isHsrComponentId("cyrene:music:skip")).toBe(false);
    expect(isHsrComponentId("favorite-modal")).toBe(false);
  });

  it("recognizes HSR bang commands without claiming Cyrene or Wuwa messages", () => {
    expect(isHsrBangCommand("!daily")).toBe(true);
    expect(isHsrBangCommand("!兌換碼 list")).toBe(true);
    expect(isHsrBangCommand("!ww 幫助")).toBe(false);
    expect(isHsrBangCommand("!chat hello")).toBe(false);
  });

  it("does not register Wuwa as a slash command", () => {
    expect(DISCORD_SLASH_COMMANDS.some((command) => command.name === "ww")).toBe(false);
  });

  it("keeps Cyrene's command when upstream has the same name", () => {
    expect(mergeHsrCommandDefinitions(
      [{ name: "profile", description: "cyrene" }, { name: "chat" }],
      [{ name: "profile", description: "hsr" }, { name: "warp" }],
    )).toEqual([
      { name: "profile", description: "cyrene" },
      { name: "chat" },
      { name: "warp" },
    ]);
  });
});

describe("HSR native runtime probe", () => {
  it("rejects a missing better-sqlite3 installation without touching the host process", () => {
    const result = probeHsrNativeRuntime("/path/that/does/not/exist");
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("better-sqlite3 未安裝");
  });
});
