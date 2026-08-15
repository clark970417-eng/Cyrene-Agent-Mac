// Memory 面板業務邏輯：L0/L1 編輯、L2 事件記憶列表、記憶圖譜、導入文檔
// 從 settings.ts 抽離。依賴 memory DOM 引用（./dom）、memoryState（./state）、
// shared 工具（renderInfoList / renderEmptyState / shallowEqual / formatDateTime / escapeHtml / showModal）。

import { memoryState } from "./state";
import {
  memoryL0NameInput, memoryL0OccupationInput, memoryL0InterestsInput,
  memoryL0LanguageInput, memoryL0NoteInput,
  memoryL1GoalsInput, memoryL1PreferencesInput, memoryL1ProjectInput,
  memoryL2SearchInput, memoryL2StatusFilter, memoryL2List,
  memoryTimelineToolbar, memoryTimelineView,
  memoryGraphView, memoryGraphNodes, memoryGraphLines, memoryGraphDetail, memoryGraphEmpty,
  memoryViewCount,
  memoryImportedList, memoryReflectionList,
  memoryL0EditBtn, memoryL0CancelBtn,
  memoryL1EditBtn, memoryL1CancelBtn,
} from "./dom";
import { renderInfoList, renderEmptyState } from "../shared/render";
import { shallowEqual } from "../shared/utils";
import { formatDateTime, escapeHtml } from "../shared/format";
import { showModal } from "../shared/modal";

function renderL2List(query = ""): void {
  const list = memoryState.panelCache?.l2 ?? [];
  const normalized = query.trim().toLowerCase();
  const statusFilter = memoryL2StatusFilter?.value ?? "all";
  const filtered = list.filter((item) => {
    if (statusFilter === "pinned" && !item.isPinned) return false;
    if (statusFilter === "conflict" && item.conflictCount === 0) return false;
    if (!["all", "pinned", "conflict"].includes(statusFilter) && item.status !== statusFilter)
      return false;
    if (!normalized) return true;
    const evidenceText = item.evidence.map((evidence) => evidence.quoteSnippet).join(" ");
    return [item.content, item.triggerText, item.status, evidenceText, item.sourceConversationId]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });

  if (memoryViewCount) memoryViewCount.textContent = `${filtered.length} 段記憶`;
  if (!memoryL2List) return;
  if (filtered.length === 0) {
    renderEmptyState(
      memoryL2List,
      normalized || statusFilter !== "all" ? "沒有符合條件的記憶" : "暫無事件記憶",
      normalized || statusFilter !== "all"
        ? "調整搜尋文字或狀態篩選"
        : "聊天後昔漣會自動提煉重要資訊",
    );
    return;
  }

  const groups = new Map<string, typeof filtered>();
  for (const item of filtered) {
    const date = new Date(item.createdAt);
    const key = Number.isNaN(date.getTime())
      ? "時間未知"
      : date.toLocaleDateString("zh-TW", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "short",
        });
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const statusLabels: Record<string, string> = {
    active: "活躍",
    aging: "淡化中",
    archived: "已封存",
    superseded: "已更新",
    merged: "已合併",
  };
  memoryL2List.innerHTML = [...groups.entries()]
    .map(([date, items]) =>
      [
        '<section class="memory-day">',
        `  <div class="memory-day__label"><span></span><strong>${escapeHtml(date)}</strong><small>${items.length} 段</small></div>`,
        '  <div class="memory-day__events">',
        items
          .map((item) => {
            const evidence =
              item.evidence.find((entry) => entry.sourceStatus === "active") ?? item.evidence[0];
            const badges = [
              `<span class="memory-event__status" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] ?? item.status)}</span>`,
              item.isPinned ? '<span class="memory-event__badge">已固定</span>' : "",
              item.isSummary ? '<span class="memory-event__badge">階段摘要</span>' : "",
              item.conflictCount > 0
                ? `<span class="memory-event__badge memory-event__badge--warning">${item.conflictCount} 個衝突</span>`
                : "",
            ]
              .filter(Boolean)
              .join("");
            const quote = evidence?.quoteSnippet || item.triggerText;
            return [
              `<article class="memory-event" data-memory-id="${escapeHtml(item.id)}">`,
              '  <span class="memory-event__dot"></span>',
              '  <div class="memory-event__card">',
              `    <div class="memory-event__top"><time>${escapeHtml(new Date(item.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }))}</time><div>${badges}</div></div>`,
              `    <p class="memory-event__content">${escapeHtml(item.content)}</p>`,
              quote
                ? `    <blockquote class="memory-event__evidence"><span>證據</span>${escapeHtml(quote)}</blockquote>`
                : "",
              `    <div class="memory-event__meta"><span>權重 ${item.weight.toFixed(1)}</span><span>想起 ${item.accessCount} 次</span><span>最近取用 ${escapeHtml(formatDateTime(item.lastAccessedAt))}</span></div>`,
              '    <div class="memory-event__actions">',
              `      <button type="button" data-memory-action="pin">${item.isPinned ? "取消固定" : "固定記憶"}</button>`,
              item.sourceConversationId
                ? '      <button type="button" data-memory-action="source">開啟來源對話</button>'
                : "",
              '      <button type="button" class="is-danger" data-memory-action="delete">忘記這段</button>',
              "    </div>",
              "  </div>",
              "</article>",
            ].join("\n");
          })
          .join("\n"),
        "  </div>",
        "</section>",
      ].join("\n"),
    )
    .join("\n");
}

function renderMemoryGraph(): void {
  const graph = memoryState.panelCache?.graph;
  if (!graph || !graph.nodes || !memoryGraphNodes || !memoryGraphLines || !memoryGraphEmpty) return;
  memoryGraphNodes.replaceChildren();
  memoryGraphLines.replaceChildren();
  const entityNodes = graph.nodes.filter((node) => node && node.type !== "user");
  memoryGraphEmpty.classList.toggle("is-hidden", entityNodes.length > 0);
  if (entityNodes.length === 0 || graph.nodes.length === 0) return;

  const positions = new Map<string, { x: number; y: number }>();
  const root = graph.nodes.find((node) => node.type === "user") ?? graph.nodes[0];
  if (root) {
    positions.set(root.id, { x: 50, y: 50 });
  }
  entityNodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / entityNodes.length;
    const radiusX = index % 2 === 0 ? 39 : 31;
    const radiusY = index % 2 === 0 ? 39 : 31;
    positions.set(node.id, {
      x: 50 + Math.cos(angle) * radiusX,
      y: 50 + Math.sin(angle) * radiusY,
    });
  });

  memoryGraphLines.setAttribute("viewBox", "0 0 1000 600");
  for (const edge of graph.edges) {
    const source = positions.get(edge.sourceId);
    const target = positions.get(edge.targetId);
    if (!source || !target) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(source.x * 10));
    line.setAttribute("y1", String(source.y * 6));
    line.setAttribute("x2", String(target.x * 10));
    line.setAttribute("y2", String(target.y * 6));
    line.setAttribute("class", edge.inferred ? "is-inferred" : "is-explicit");
    line.setAttribute(
      "stroke-width",
      String(Math.min(5, 1 + Math.log2(Math.max(1, edge.strength)))),
    );
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${edge.relation} · 強度 ${edge.strength}`;
    line.appendChild(title);
    memoryGraphLines.appendChild(line);
  }

  for (const node of graph.nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "memory-graph-node";
    button.dataset.nodeId = node.id;
    button.dataset.type = node.type;
    button.style.setProperty("--node-x", `${position.x}%`);
    button.style.setProperty("--node-y", `${position.y}%`);
    button.style.setProperty(
      "--node-scale",
      String(Math.min(1.22, 0.88 + Math.log2(Math.max(1, node.mentionCount)) * 0.08)),
    );
    const name = document.createElement("strong");
    name.textContent = node.name;
    const count = document.createElement("small");
    count.textContent = node.type === "user" ? "記憶中心" : `${node.mentionCount} 次`;
    button.append(name, count);
    button.addEventListener("click", () => showMemoryGraphNode(node.id));
    memoryGraphNodes.appendChild(button);
  }
}

function showMemoryGraphNode(nodeId: string): void {
  const graph = memoryState.panelCache?.graph;
  if (!graph || !memoryGraphDetail) return;
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  memoryGraphNodes?.querySelectorAll(".memory-graph-node").forEach((element) => {
    element.classList.toggle("is-active", (element as HTMLElement).dataset.nodeId === nodeId);
  });
  const edges = graph.edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);
  const related = edges
    .map((edge) => {
      const otherId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
      return { edge, other: graph.nodes.find((item) => item.id === otherId) };
    })
    .filter((item) => item.other);
  const typeNames: Record<string, string> = {
    user: "記憶中心",
    person: "人物",
    place: "地點",
    preference: "偏好",
    organization: "組織",
    concept: "概念",
  };
  memoryGraphDetail.replaceChildren();
  const eyebrow = document.createElement("span");
  eyebrow.className = "memory-graph-detail__eyebrow";
  eyebrow.textContent = typeNames[node.type] ?? node.type;
  const title = document.createElement("h3");
  title.textContent = node.name;
  const meta = document.createElement("p");
  meta.textContent =
    node.type === "user"
      ? `目前連著 ${related.length} 個記憶實體。`
      : `提及 ${node.mentionCount} 次 · 最近出現 ${formatDateTime(node.lastMentionedAt)}`;
  const list = document.createElement("div");
  list.className = "memory-graph-relations";
  for (const item of related.slice(0, 12)) {
    const row = document.createElement("button");
    row.type = "button";
    const relation = document.createElement("span");
    relation.textContent = item.edge.relation;
    const other = document.createElement("strong");
    other.textContent = item.other?.name ?? "未知";
    row.append(relation, other);
    row.addEventListener("click", () => showMemoryGraphNode(item.other!.id));
    list.appendChild(row);
  }
  memoryGraphDetail.append(eyebrow, title, meta, list);
}

export async function loadMemoryPanel(): Promise<void> {
  try {
    const payload = await window.memoryPanel?.getData();
    if (!payload) return;
    memoryState.panelCache = payload;

    if (memoryL0NameInput) memoryL0NameInput.value = payload.l0.preferredName || "";
    if (memoryL0OccupationInput) memoryL0OccupationInput.value = payload.l0.occupation || "";
    if (memoryL0InterestsInput) memoryL0InterestsInput.value = payload.l0.longTermInterests || "";
    if (memoryL0LanguageInput) memoryL0LanguageInput.value = payload.l0.language || "";
    if (memoryL0NoteInput) memoryL0NoteInput.value = payload.l0.permanentNote || "";

    if (memoryL1GoalsInput) memoryL1GoalsInput.value = payload.l1.recentGoals || "";
    if (memoryL1PreferencesInput) memoryL1PreferencesInput.value = payload.l1.recentPreferences || "";
    if (memoryL1ProjectInput) memoryL1ProjectInput.value = payload.l1.currentProject || "";

    renderL2List(memoryL2SearchInput?.value || "");
    renderMemoryGraph();
    renderImportedDocs();

    renderInfoList(
      memoryReflectionList,
      payload.reflections,
      "暫無階段總結",
      "持續聊天後，昔漣會在整理記憶時留下階段回顧",
    );

    if (memoryL0EditBtn) memoryL0EditBtn.disabled = false;
    if (memoryL1EditBtn) memoryL1EditBtn.disabled = false;
  } catch (err) {
    console.error("[settings] load memory panel failed", err);
    renderEmptyState(memoryL2List, "記憶讀取失敗", "請查看終端日誌");
    renderEmptyState(memoryImportedList, "導入知識讀取失敗", "請查看終端日誌");
    renderEmptyState(memoryReflectionList, "階段總結讀取失敗", "請查看終端日誌");
  }
}

memoryL2SearchInput?.addEventListener("input", () => renderL2List(memoryL2SearchInput.value));
memoryL2StatusFilter?.addEventListener("change", () =>
  renderL2List(memoryL2SearchInput?.value ?? ""),
);

document.querySelectorAll<HTMLButtonElement>("[data-memory-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.memoryView === "graph" ? "graph" : "timeline";
    document.querySelectorAll<HTMLButtonElement>("[data-memory-view]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    memoryTimelineView?.classList.toggle("is-hidden", view !== "timeline");
    memoryTimelineToolbar?.classList.toggle("is-hidden", view !== "timeline");
    memoryGraphView?.classList.toggle("is-hidden", view !== "graph");
    if (memoryViewCount) {
      memoryViewCount.textContent =
        view === "graph"
          ? `${Math.max(0, (memoryState.panelCache?.graph.nodes.length ?? 1) - 1)} 個實體`
          : `${memoryState.panelCache?.l2.length ?? 0} 段記憶`;
    }
    if (view === "graph") renderMemoryGraph();
  });
});

memoryL2List?.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
    "[data-memory-action]",
  );
  const article = button?.closest<HTMLElement>("[data-memory-id]");
  const id = article?.dataset.memoryId;
  const item = memoryState.panelCache?.l2.find((memory) => memory.id === id);
  if (!button || !item) return;
  const action = button.dataset.memoryAction;
  button.disabled = true;
  try {
    if (action === "pin") {
      const result = await window.memoryPanel?.pinL2(item.id, !item.isPinned);
      if (!result?.ok) throw new Error(result?.error || "無法更新固定狀態");
      await loadMemoryPanel();
    } else if (action === "source" && item.sourceConversationId) {
      const chatStore = (
        window as unknown as { chatStore?: { openInChatWindow: (id: string) => Promise<unknown> } }
      ).chatStore;
      await chatStore?.openInChatWindow(item.sourceConversationId);
    } else if (action === "delete") {
      const confirmed = await showModal({
        title: "忘記這段記憶",
        message: `確定要讓昔漣忘記這段嗎？\n\n${item.content}\n\n這個動作無法復原。`,
        icon: "🫧",
        confirmText: "忘記",
        cancelText: "保留",
      });
      if (!confirmed) return;
      const result = await window.memoryPanel?.deleteL2(item.id);
      if (!result?.ok) throw new Error(result?.error || "無法刪除記憶");
      await loadMemoryPanel();
    }
  } catch (err) {
    console.error("[settings] memory action failed", err);
    await showModal({
      title: "記憶操作未完成",
      message: err instanceof Error ? err.message : String(err),
      icon: "⚠️",
      confirmText: "知道了",
      cancelText: "關閉",
    });
  } finally {
    button.disabled = false;
  }
});

// --- L0/L1 editable logic ---

function takeL0Snapshot(): Record<string, string> {
  return {
    preferredName: memoryL0NameInput?.value ?? "",
    occupation: memoryL0OccupationInput?.value ?? "",
    longTermInterests: memoryL0InterestsInput?.value ?? "",
    language: memoryL0LanguageInput?.value ?? "",
    permanentNote: memoryL0NoteInput?.value ?? "",
  };
}

function takeL1Snapshot(): Record<string, string> {
  return {
    recentGoals: memoryL1GoalsInput?.value ?? "",
    recentPreferences: memoryL1PreferencesInput?.value ?? "",
    currentProject: memoryL1ProjectInput?.value ?? "",
  };
}

function setL0FieldsDisabled(disabled: boolean): void {
  memoryL0NameInput?.toggleAttribute("disabled", disabled);
  memoryL0OccupationInput?.toggleAttribute("disabled", disabled);
  memoryL0InterestsInput?.toggleAttribute("disabled", disabled);
  memoryL0LanguageInput?.toggleAttribute("disabled", disabled);
  memoryL0NoteInput?.toggleAttribute("disabled", disabled);
}

function setL1FieldsDisabled(disabled: boolean): void {
  memoryL1GoalsInput?.toggleAttribute("disabled", disabled);
  memoryL1PreferencesInput?.toggleAttribute("disabled", disabled);
  memoryL1ProjectInput?.toggleAttribute("disabled", disabled);
}

export function enterL0EditMode(): void {
  if (memoryState.l0Editing) return;
  memoryState.l0Editing = true;
  memoryState.l0Snapshot = takeL0Snapshot();
  setL0FieldsDisabled(false);
  if (memoryL0EditBtn) memoryL0EditBtn.textContent = "💾 保存";
  if (memoryL0CancelBtn) memoryL0CancelBtn.classList.remove("is-hidden");
}

export function exitL0EditMode(): void {
  memoryState.l0Editing = false;
  memoryState.l0Snapshot = null;
  setL0FieldsDisabled(true);
  if (memoryL0EditBtn) memoryL0EditBtn.textContent = "✏️ 編輯";
  if (memoryL0CancelBtn) memoryL0CancelBtn.classList.add("is-hidden");
}

export async function saveL0(): Promise<void> {
  const current = takeL0Snapshot();
  if (memoryState.l0Snapshot && shallowEqual(current, memoryState.l0Snapshot)) {
    exitL0EditMode();
    return;
  }
  try {
    await window.memoryPanel?.saveL0(current);
    await loadMemoryPanel();
    exitL0EditMode();
    if (memoryL0EditBtn) {
      memoryL0EditBtn.textContent = "✅ 已保存";
      setTimeout(() => {
        if (memoryL0EditBtn && !memoryState.l0Editing) memoryL0EditBtn.textContent = "✏️ 編輯";
      }, 2000);
    }
  } catch (err) {
    console.error("[settings] save L0 failed", err);
    alert("保存失敗，請重試");
  }
}

export function cancelL0Edit(): void {
  if (memoryState.l0Snapshot) {
    if (memoryL0NameInput) memoryL0NameInput.value = memoryState.l0Snapshot.preferredName;
    if (memoryL0OccupationInput) memoryL0OccupationInput.value = memoryState.l0Snapshot.occupation;
    if (memoryL0InterestsInput) memoryL0InterestsInput.value = memoryState.l0Snapshot.longTermInterests;
    if (memoryL0LanguageInput) memoryL0LanguageInput.value = memoryState.l0Snapshot.language;
    if (memoryL0NoteInput) memoryL0NoteInput.value = memoryState.l0Snapshot.permanentNote;
  }
  exitL0EditMode();
}

export function enterL1EditMode(): void {
  if (memoryState.l1Editing) return;
  memoryState.l1Editing = true;
  memoryState.l1Snapshot = takeL1Snapshot();
  setL1FieldsDisabled(false);
  if (memoryL1EditBtn) memoryL1EditBtn.textContent = "💾 保存";
  if (memoryL1CancelBtn) memoryL1CancelBtn.classList.remove("is-hidden");
}

export function exitL1EditMode(): void {
  memoryState.l1Editing = false;
  memoryState.l1Snapshot = null;
  setL1FieldsDisabled(true);
  if (memoryL1EditBtn) memoryL1EditBtn.textContent = "✏️ 編輯";
  if (memoryL1CancelBtn) memoryL1CancelBtn.classList.add("is-hidden");
}

export async function saveL1(): Promise<void> {
  const current = takeL1Snapshot();
  if (memoryState.l1Snapshot && shallowEqual(current, memoryState.l1Snapshot)) {
    exitL1EditMode();
    return;
  }
  try {
    await window.memoryPanel?.saveL1(current);
    await loadMemoryPanel();
    exitL1EditMode();
    if (memoryL1EditBtn) {
      memoryL1EditBtn.textContent = "✅ 已保存";
      setTimeout(() => {
        if (memoryL1EditBtn && !memoryState.l1Editing) memoryL1EditBtn.textContent = "✏️ 編輯";
      }, 2000);
    }
  } catch (err) {
    console.error("[settings] save L1 failed", err);
    alert("保存失敗，請重試");
  }
}

export function cancelL1Edit(): void {
  if (memoryState.l1Snapshot) {
    if (memoryL1GoalsInput) memoryL1GoalsInput.value = memoryState.l1Snapshot.recentGoals;
    if (memoryL1PreferencesInput) memoryL1PreferencesInput.value = memoryState.l1Snapshot.recentPreferences;
    if (memoryL1ProjectInput) memoryL1ProjectInput.value = memoryState.l1Snapshot.currentProject;
  }
  exitL1EditMode();
}

// Bind edit button events
memoryL0EditBtn?.addEventListener("click", () => {
  if (memoryState.l0Editing) {
    void saveL0();
  } else {
    enterL0EditMode();
  }
});
memoryL0CancelBtn?.addEventListener("click", cancelL0Edit);

memoryL1EditBtn?.addEventListener("click", () => {
  if (memoryState.l1Editing) {
    void saveL1();
  } else {
    enterL1EditMode();
  }
});
memoryL1CancelBtn?.addEventListener("click", cancelL1Edit);

export function renderImportedDocs(): void {
  const list = memoryState.panelCache?.importedDocs ?? [];
  if (!memoryImportedList) return;

  if (list.length === 0) {
    renderEmptyState(memoryImportedList, "暫無導入文檔", "在聊天窗口上傳文件後會自動索引");
    return;
  }

  memoryImportedList.innerHTML = list
    .map((item) => {
      const importId = item.importId || "";
      const fileName = escapeHtml(item.fileName);
      const chunkInfo = "已索引 " + item.chunkCount + " 個片段";
      const timeInfo = "最近導入：" + formatDateTime(item.lastImportedAt);
      return [
        '<article class="memory-record memory-record--doc">',
        '  <div class="memory-record__main">',
        '    <h3 class="memory-record__title">' + fileName + "</h3>",
        '    <p class="memory-record__body">' + escapeHtml(chunkInfo) + "</p>",
        '    <p class="memory-record__meta">' + escapeHtml(timeInfo) + "</p>",
        "  </div>",
        '  <button type="button" class="memory-record__delete" data-import-id="' +
          escapeHtml(importId) +
          '" data-file-name="' +
          fileName +
          '" title="刪除此導入文檔">🗑️</button>',
        "</article>",
      ].join("\n");
    })
    .join("\n");
}

memoryImportedList?.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement | null;
  const deleteBtn = target?.closest(".memory-record__delete") as HTMLElement | null;
  if (!deleteBtn) return;

  const importId = deleteBtn.dataset.importId || "";
  const fileName = deleteBtn.dataset.fileName || "未命名文檔";

  const confirmed = await showModal({
    title: "刪除導入知識",
    message:
      "確定刪除導入知識？\n\n文件：\n《" + fileName + "》\n\n刪除後不可恢復，如需使用請重新導入。",
    icon: "⚠️",
    confirmText: "刪除",
    cancelText: "取消",
  });

  if (!confirmed) return;

  try {
    const result = await window.memoryPanel?.deleteImportedDoc(importId, fileName);
    if (result?.ok) {
      await loadMemoryPanel();
    }
  } catch (err) {
    console.error("[settings] delete imported doc failed", err);
  }
});

// 模塊加載時拉一次配置
void loadMemoryPanel();
