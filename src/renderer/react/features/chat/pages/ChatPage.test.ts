import { describe, expect, it } from "vitest";
import { shouldRunModelForMode, shouldUseCyreneAutoTts } from "./conversation-run-policy";

describe("React Code conversation run policy", () => {
  it("runs the model for ordinary Code messages", () => {
    expect(shouldRunModelForMode("code", false, false)).toBe(true);
  });
});

describe("Cyrene automatic TTS policy", () => {
  it("allows Cyrene to read an ordinary single-character conversation", () => {
    expect(shouldUseCyreneAutoTts(undefined)).toBe(true);
  });

  it("never lets Cyrene read replies from a multi-agent room", () => {
    expect(shouldUseCyreneAutoTts(["dan_heng", "tribbie", "evernight"])).toBe(false);
  });
});
