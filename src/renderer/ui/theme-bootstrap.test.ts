import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rendererRoot = fileURLToPath(new URL("../", import.meta.url));
const windowEntries = [
  "index.html",
  "chat/index.html",
  "call/index.html",
  "sidebar/index.html",
  "tasks/index.html",
  "sticker-manager/index.html",
  "settings/index.html",
  "react/index.html",
  "workspace/index.html",
  "notebook/index.html",
  "exam/index.html",
  "game-room/index.html",
  "wavesuid/index.html",
  "paint/index.html",
  "discord-activity/index.html",
];

const directThemeStylesheetEntries = windowEntries;

describe("renderer theme bootstrap", () => {
  it.each(windowEntries)("boots %s directly into the Cyrene night theme", (entry) => {
    const html = fs.readFileSync(`${rendererRoot}/${entry}`, "utf8");
    expect(html).toMatch(/<html\b[^>]*\bdata-ui-theme="cyrene-night"/);
  });

  it.each(directThemeStylesheetEntries)("loads the shared theme stylesheet last in %s", (entry) => {
    const html = fs.readFileSync(`${rendererRoot}/${entry}`, "utf8");
    const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
    expect(stylesheets.at(-1)?.[1]).toMatch(/ui\/theme\.css$/);
  });
});
