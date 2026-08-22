import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const css = fs.readFileSync(fileURLToPath(new URL("./workspace.css", import.meta.url)), "utf8");
const main = fs.readFileSync(fileURLToPath(new URL("./main.ts", import.meta.url)), "utf8");

describe("connection status card", () => {
  it("keeps a visible management control and routes it to connection settings", () => {
    expect(html).toContain('id="connection-manage-btn"');
    expect(html).toContain("管理 API、登入與雲端連接");
    expect(main).toContain('connectionManageBtn?.addEventListener("click", () => openSettingsSection("channels"))');
    expect(css).toMatch(/\.conn-card \.card-header__link\s*\{[^}]*min-width:\s*48px;[^}]*min-height:\s*28px/s);
  });

  it("scrolls long service lists without pushing the management button away", () => {
    expect(css).toMatch(/\.conn-list\s*\{[^}]*max-height:\s*360px;[^}]*overflow-y:\s*auto/s);
  });
});
