import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const workspaceCss = fs.readFileSync(fileURLToPath(new URL("./workspace.css", import.meta.url)), "utf8");
const reactCss = fs.readFileSync(fileURLToPath(new URL("../react/styles/react-root.css", import.meta.url)), "utf8");
const chatPage = fs.readFileSync(fileURLToPath(new URL("../react/features/chat/pages/ChatPage.tsx", import.meta.url)), "utf8");
const chatComposer = fs.readFileSync(fileURLToPath(new URL("../react/features/chat/components/ChatComposer.tsx", import.meta.url)), "utf8");
const legacyChatHtml = fs.readFileSync(fileURLToPath(new URL("../chat/index.html", import.meta.url)), "utf8");
const legacyChatCss = fs.readFileSync(fileURLToPath(new URL("../chat/chat.css", import.meta.url)), "utf8");
const main = fs.readFileSync(fileURLToPath(new URL("./main.ts", import.meta.url)), "utf8");

describe("unified conversation navigation", () => {
  it("places the primary new-conversation action above workspace history", () => {
    const sessions = html.match(/<div class="sidebar__sessions">[\s\S]*?<\/ul>\s*<\/div>/)?.[0];
    expect(sessions).toBeTruthy();
    expect(sessions).toContain('id="sidebar-new-session-btn"');
    expect(sessions).toContain('id="sidebar-new-multi-session-btn"');
    expect(sessions).toContain("新建對話");
    expect(sessions).toContain("多人對話");
    expect(sessions).toContain('id="sidebar-sessions-list"');
    expect(sessions?.indexOf("sidebar-new-session-btn")).toBeLessThan(sessions?.indexOf("sidebar-sessions-list") ?? 0);
  });

  it("preserves a guided empty state instead of rendering a blank rail", () => {
    expect(main).toContain('empty.textContent = "還沒有對話"');
    expect(workspaceCss).toContain(".sidebar__sessions-empty");
  });

  it("keeps the new-conversation action subordinate to the conversation list", () => {
    expect(workspaceCss).toMatch(/\.sidebar__sessions-create-icon\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px/s);
    expect(workspaceCss).toMatch(/\.sidebar__sessions-create-label\s*\{[^}]*font-size:\s*12px/s);
  });

  it("routes workspace chat through one embedded chat surface", () => {
    expect(main).toContain('iframe.src = "../react/index.html?mode=chat"');
    expect(main).not.toContain('iframe.src = "../chat/index.html"');
    expect(html).toContain('src="../react/index.html?mode=chat"');
    expect(html.match(/<iframe\b/g)).toHaveLength(1);
  });

  it("keeps one conversation control bar and removes the duplicate shell settings", () => {
    expect(html).not.toContain('id="header-model-status"');
    expect(html).not.toContain('id="ws-mode-dropdown"');
    expect(html).not.toContain('id="ws-style-dropdown"');
    expect(html).not.toContain('id="ws-reasoning-dropdown"');
    expect(html).toContain('class="titlebar__actions"');
    const unifiedShellCss = workspaceCss.slice(workspaceCss.lastIndexOf("The conversation workspace owns"));
    expect(unifiedShellCss).toMatch(/\.titlebar\s*\{[^}]*position:\s*absolute;[^}]*background:\s*transparent/s);
    expect(chatPage).toContain('<ModeSwitch value={mode}');
    expect(chatComposer).toContain('{supportsStyle && <StyleControl />}');
    expect(chatComposer).toContain('<ReasoningControl />');
  });

  it("uses the React welcome template instead of the legacy preset empty state", () => {
    expect(legacyChatHtml).not.toContain('class="chat__empty-state"');
    expect(legacyChatHtml).not.toContain('class="chat__particles"');
    expect(legacyChatCss).toMatch(/\.chat\s*\{[^}]*background:\s*var\(--rb-bg-1\)/s);
    expect(legacyChatCss).toMatch(/\.chat::before\s*\{[^}]*content:\s*none/s);
  });

  it("keeps Code input available before a project is selected", () => {
    expect(chatComposer).not.toContain('disabled={requiresWorkspace && !workspaceName}');
    expect(chatPage).toContain('const workspaceReady = await chooseWorkspace(targetMode)');
    expect(chatPage).toContain('if (!workspaceReady) return');
  });

  it("removes the duplicate React rail only when embedded in the workspace", () => {
    expect(reactCss).toMatch(/\.cy-page\.is-embedded\s*\{[^}]*padding-left:\s*10px/s);
    expect(reactCss).toMatch(/\.cy-page\.is-embedded \.cy-page-newtask[\s\S]*?display:\s*none/);
    expect(reactCss).toMatch(/\.cy-page\.is-embedded \.cy-page-conversations[\s\S]*?display:\s*none/);
    expect(reactCss).toContain(".cy-page-newtask {");
    expect(reactCss).toContain(".cy-page-conversations {");
  });

  it("bridges the workspace conversation controls into the embedded React chat", () => {
    expect(main).toContain('type: "create-session"');
    expect(main).toContain('type: "create-multi-session"');
    expect(main).toContain('type: "switch-session"');
    expect(chatPage).toContain('event.data.type === "create-session"');
    expect(chatPage).toContain('event.data.type === "create-multi-session"');
    expect(chatPage).toContain('event.data.type === "switch-session"');
    expect(chatPage).toContain('event.data.type === "set-conversation-mode"');
    expect(chatPage).toContain('type: "active-session-changed"');
    expect(main).toMatch(/type === "active-session-changed"[\s\S]*?renderSidebarSessionsList\(\)/);
  });
});
