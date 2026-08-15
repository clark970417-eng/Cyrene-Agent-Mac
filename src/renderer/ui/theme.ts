import "./window-corner-radius";
import "./traditional-chinese";
import "./custom-page-theme.css";
import { normalizeUiTheme, type UiTheme } from "../../shared/ui-theme";
import { DEFAULT_UI_FONT, normalizeUiFont, type UiFont } from "../../shared/ui-font";
import type { ChatAppearanceSettings } from "../../shared/chat-appearance";

declare global {
  interface Window {
    cyreneTheme?: {
      get: () => Promise<UiTheme>;
      onChanged: (callback: (theme: UiTheme) => void) => () => void;
      getRadius: () => Promise<boolean>;
      onRadiusChanged: (callback: (theme: boolean) => void) => () => void;
    };
    cyreneFont?: {
      get: () => Promise<UiFont>;
      onChanged: (callback: (font: UiFont) => void) => () => void;
    };
    cyreneAppearance?: {
      get: () => Promise<ChatAppearanceSettings>;
      onChanged: (callback: (settings: ChatAppearanceSettings) => void) => () => void;
    };
  }
}

function applyTheme(theme: unknown): void {
  const normalized = normalizeUiTheme(theme);
  document.documentElement.dataset.uiTheme = normalized;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = normalized === "pearl-white" ? "#f5f2f7" : "#0c0814";
}

function readParentTheme(): UiTheme | null {
  if (window.self === window.top) return null;
  try {
    const theme = window.parent.document.documentElement.dataset.uiTheme;
    return theme === "pearl-white" || theme === "cyrene-night" ? theme : null;
  } catch {
    // Standalone and cross-origin pages keep using the local theme bridge.
    return null;
  }
}

function applyRadius(radius: boolean): void {
  document.documentElement.dataset.uiRadius = radius ? undefined : "false";
}

const CUSTOM_FONT_STYLE_ID = "cyrene-custom-font";
const DEFAULT_FONT_STACK = '"Noto Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Helvetica Neue", "Segoe UI", sans-serif';

function applyFont(value: unknown): void {
  const font = normalizeUiFont(value);
  const style = document.getElementById(CUSTOM_FONT_STYLE_ID);
  if (font.kind !== "custom") {
    style?.remove();
    document.documentElement.style.setProperty("--rb-font-sans", DEFAULT_FONT_STACK);
    document.documentElement.dataset.uiFont = "source-han";
    return;
  }
  const customStyle = style ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: CUSTOM_FONT_STYLE_ID }));
  const format = font.fileName.toLowerCase().endsWith(".otf") ? "opentype" : "truetype";
  customStyle.textContent = `@font-face { font-family: "Cyrene Custom Font"; src: url("local-font://${encodeURIComponent(font.fileName)}") format("${format}"); font-display: swap; }`;
  document.documentElement.style.setProperty("--rb-font-sans", `"Cyrene Custom Font", ${DEFAULT_FONT_STACK}`);
  document.documentElement.dataset.uiFont = "custom";
}

applyTheme(readParentTheme() ?? "cyrene-night");

// Pages share the same renderer in standalone windows and inside the unified
// workspace. Expose that distinction so CSS can remove duplicate window chrome.
document.documentElement.dataset.embedded = window.self !== window.top ? "true" : "false";

// Electron only exposes some preload bridges to the top frame. Keep embedded
// pages visually in sync by mirroring the workspace's resolved theme instead
// of letting each iframe fall back to the night default independently.
if (window.self !== window.top) {
  try {
    const parentRoot = window.parent.document.documentElement;
    const observer = new MutationObserver(() => {
      const theme = readParentTheme();
      if (theme) applyTheme(theme);
    });
    observer.observe(parentRoot, { attributes: true, attributeFilter: ["data-ui-theme"] });
  } catch {
    // Cross-origin embeds cannot inspect their parent and use cyreneTheme.
  }
}

void window.cyreneTheme?.get()
  .then(applyTheme)
  .catch(() => applyTheme(readParentTheme() ?? "cyrene-night"));

window.cyreneTheme?.onChanged((theme) => {
  applyTheme(theme);
});

void window.cyreneTheme?.getRadius()
  .then(applyRadius)
  .catch(() => applyRadius(true));

window.cyreneTheme?.onRadiusChanged((theme) => {
  applyRadius(theme);
});

applyFont(DEFAULT_UI_FONT);
void window.cyreneFont?.get().then(applyFont).catch(() => applyFont(DEFAULT_UI_FONT));
window.cyreneFont?.onChanged((font) => applyFont(font));
