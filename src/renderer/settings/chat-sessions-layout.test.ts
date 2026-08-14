import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const css = fs.readFileSync(fileURLToPath(new URL("./settings.css", import.meta.url)), "utf8");

describe("chat session manager layout", () => {
  it("renders the conversation manager with dedicated structural classes", () => {
    expect(html).toContain('class="chat-sessions"');
    expect(html).toContain('class="chat-sessions__new"');
    expect(html).toContain('class="chat-sessions__list"');
    expect(html).toContain('class="chat-sessions__footer"');
  });

  it("removes browser list defaults and presents sessions as cards", () => {
    expect(css).toMatch(/\.chat-sessions__list\s*\{[^}]*display:\s*grid[^}]*list-style:\s*none/s);
    expect(css).toMatch(/\.chat-sessions__item\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/s);
    expect(css).toMatch(/\.chat-sessions__item\.is-active::before\s*\{[^}]*opacity:\s*1/s);
  });

  it("keeps session actions usable instead of exposing loose emoji glyphs", () => {
    expect(css).toMatch(/\.chat-sessions__rename,[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;/);
    expect(css).toMatch(/\.chat-sessions__actions\s*\{[^}]*display:\s*flex/s);
  });

  it("honours the runtime visibility class for empty and rename states", () => {
    expect(css).toMatch(/\.is-hidden\s*\{[^}]*display:\s*none\s*!important/s);
  });
});
