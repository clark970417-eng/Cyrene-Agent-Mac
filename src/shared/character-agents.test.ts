import { describe, expect, it } from "vitest";
import {
  CHARACTER_AGENT_PROFILES,
  CYRENE_AGENT_PROFILE,
  buildCharacterAgentPrompt,
  getCharacterAgentProfile,
  pickStableCharacterAgentId,
  pickStableCharacterAgentIds,
} from "./character-agents";

describe("character agents", () => {
  it("keeps Cyrene as the ordinary Chat identity outside the guest pool", () => {
    expect(CYRENE_AGENT_PROFILE.id).toBe("cyrene");
    expect(getCharacterAgentProfile("cyrene")?.name).toBe("昔漣");
    expect(CHARACTER_AGENT_PROFILES.map((profile) => profile.id)).not.toContain("cyrene");
  });

  it("keeps the assignment stable for the same conversation", () => {
    const first = pickStableCharacterAgentId("conversation-a");
    expect(pickStableCharacterAgentId("conversation-a")).toBe(first);
    expect(getCharacterAgentProfile(first)).toBeDefined();
  });

  it("ships a complete local profile for every selectable character", () => {
    expect(CHARACTER_AGENT_PROFILES).toHaveLength(12);
    expect(new Set(CHARACTER_AGENT_PROFILES.map((profile) => profile.id)).size).toBe(12);
    for (const profile of CHARACTER_AGENT_PROFILES) {
      expect(profile.appearanceTags.length).toBeGreaterThanOrEqual(3);
      expect(buildCharacterAgentPrompt(profile.id)).toContain(`「${profile.name}」`);
    }
  });

  it("picks three distinct and stable participants for a group conversation", () => {
    const participants = pickStableCharacterAgentIds("group-session", 3);
    expect(participants).toHaveLength(3);
    expect(new Set(participants).size).toBe(3);
    expect(pickStableCharacterAgentIds("group-session", 3)).toEqual(participants);
  });
});
