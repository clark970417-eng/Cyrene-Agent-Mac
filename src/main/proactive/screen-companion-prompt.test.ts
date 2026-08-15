import { describe, expect, it } from "vitest";
import { buildScreenCompanionMessages } from "./screen-companion-prompt";

describe("screen companion prompt", () => {
  it("includes persona, scene description and the JSON decision contract", () => {
    const messages = buildScreenCompanionMessages({
      basePersona: "PERSONA",
      sceneDescription: "使用者正在寫程式碼",
      talkativeness: "normal",
    });

    expect(messages).toHaveLength(2);
    const system = String(messages[0].content);
    expect(system).toContain("PERSONA");
    expect(system).toContain("不需要隱瞞這件事");

    const user = String(messages[1].content);
    expect(user).toContain("使用者正在寫程式碼");
    expect(user).toContain('{"decision":"send"');
    expect(user).toContain('{"decision":"silent"');
  });

  it.each(["quiet", "normal", "active", "chatty"] as const)(
    "embeds a distinct directive for talkativeness=%s",
    (talkativeness) => {
      const messages = buildScreenCompanionMessages({
        basePersona: "P",
        sceneDescription: "S",
        talkativeness,
      });
      const system = String(messages[0].content);
      expect(system).toContain("說話意願");
    },
  );

  it("produces different directive text across talkativeness levels", () => {
    const texts = (["quiet", "normal", "active", "chatty"] as const).map((talkativeness) =>
      String(buildScreenCompanionMessages({ basePersona: "P", sceneDescription: "S", talkativeness })[0].content),
    );
    expect(new Set(texts).size).toBe(4);
  });
});
