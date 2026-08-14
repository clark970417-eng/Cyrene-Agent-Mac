import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const source = fs.readFileSync(fileURLToPath(new URL("./settings.ts", import.meta.url)), "utf8");
const presetsSource = fs.readFileSync(
  fileURLToPath(new URL("./api/presets.ts", import.meta.url)),
  "utf8",
);
const styles = fs.readFileSync(fileURLToPath(new URL("./settings.css", import.meta.url)), "utf8");
const icon = fs.readFileSync(
  fileURLToPath(new URL("../public/icons/providers/custom-endpoint.svg", import.meta.url)),
  "utf8",
);

describe("custom endpoint API settings UI", () => {
  it("exposes a provider selector and editable endpoint fields", () => {
    expect(html).toContain('id="preset-select"');
    expect(html).toContain('id="base-url"');
    expect(html).toContain('id="api-key"');
    expect(html).toContain('id="transport-select"');
  });

  it("supports automatic and explicit API protocol selection", () => {
    expect(html).toContain('<option value="auto">');
    expect(html).toContain('<option value="openai">');
    expect(html).toContain('<option value="anthropic">');
    expect(source).toContain('transportSelect.addEventListener("change"');
  });

  it("ships a local custom endpoint icon", () => {
    expect(icon).toContain("<svg");
    expect(icon).toContain("<title>自定义端点</title>");
  });

  it("persists inactive provider profiles together with the active one", () => {
    expect(source).toContain("perProvider: { ...providerProfileCache }");
  });

  it("keeps confirmed Anthropic-compatible preset URLs explicit", () => {
    expect(presetsSource).toContain('anthropicBaseUrl: "https://api.minimaxi.com/anthropic"');
    expect(presetsSource).toContain('anthropicBaseUrl: "https://api.deepseek.com/anthropic"');
    expect(presetsSource).toContain('anthropicBaseUrl: "https://open.bigmodel.cn/api/anthropic"');
  });

  it("top-aligns fields with different amounts of helper text", () => {
    expect(styles).toMatch(/\.field\s*\{[^}]*align-content:\s*start;/s);
  });
});
