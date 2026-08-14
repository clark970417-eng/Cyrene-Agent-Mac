import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const source = fs.readFileSync(fileURLToPath(new URL("./settings.ts", import.meta.url)), "utf8");

function form(id: string): string {
  const match = html.match(new RegExp(`<form[^>]+id="${id}"[\\s\\S]*?</form>`));
  if (!match) throw new Error(`missing form ${id}`);
  return match[0];
}

describe("appearance settings markup", () => {
  const general = form("general-form");

  it("keeps appearance and desktop-pet controls in one general settings surface", () => {
    expect(html).toContain('data-section="general"');
    for (const id of ["pet-always-on-top", "pet-visible", "pet-zoom", "window-corner-radius"]) {
      expect(general).toContain(`id="${id}"`);
    }
  });

  it("offers the two supported synchronized themes only", () => {
    expect(general).toContain('id="ui-theme-select"');
    expect(general).toContain('data-theme="cyrene-night"');
    expect(general).toContain('data-theme="pearl-white"');
    expect(general).not.toContain('data-theme="classic"');
    expect(general).not.toContain('data-theme="polished-pink"');
  });

  it("offers the two supplied desktop icon presets", () => {
    expect(general).toContain('id="ui-icon-select"');
    expect(general).toContain('data-icon="cyrene-pink"');
    expect(general).toContain('data-icon="cyrene-sun"');
  });

  it("provides shared reply-bubble and social-context switches", () => {
    expect(general).toContain('id="assistant-bubble-enabled"');
    expect(general).toContain('id="chat-social-context-enabled"');
    expect(source).toContain("assistantBubbleEnabledInput.addEventListener");
    expect(source).toContain("chatSocialContextEnabledInput.addEventListener");
  });

  it("provides a shared chat line-height control", () => {
    expect(general).toContain('id="chat-line-height"');
    expect(general).toContain('type="range" min="1.2" max="2.2" step="0.05"');
    expect(source).toContain("chatLineHeightInput.addEventListener");
  });

  it("offers a shared window corner-radius slider", () => {
    expect(general).toContain('id="window-corner-radius"');
    expect(general).toContain('type="range" min="0" max="40" step="1"');
  });
});
