import { describe, expect, it } from "vitest";
import { TrpgManager } from "./trpg-manager";

describe("TrpgManager", () => {
  it("starts a new TRPG session with initial character and choices", () => {
    const manager = new TrpgManager();
    const session = manager.startSession({ characterName: "旅人", className: "星光法師" });

    expect(session.id).toBeDefined();
    expect(session.character.name).toBe("旅人");
    expect(session.character.className).toBe("星光法師");
    expect(session.choices.length).toBeGreaterThan(0);
    expect(session.logs.length).toBe(1);
  });

  it("handles D20 roll mechanics correctly", () => {
    const manager = new TrpgManager();

    // Natural 20 always passes
    expect(manager.rollDice(20, 0, 25).passed).toBe(true);

    // Natural 1 always fails
    expect(manager.rollDice(1, 10, 5).passed).toBe(false);

    // Standard DC check
    expect(manager.rollDice(10, 3, 12).passed).toBe(true);
    expect(manager.rollDice(8, 2, 12).passed).toBe(false);
  });

  it("advances session when player takes an action", () => {
    const manager = new TrpgManager();
    manager.startSession();

    const nextState = manager.sendAction({ choiceId: "c2" });
    expect(nextState.logs.length).toBe(3); // Initial + Player + GM
  });
});
