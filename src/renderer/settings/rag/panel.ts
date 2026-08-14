// RAG / Embedding / Reranker 面板：模型切換、鏡像源、下載/刪除、狀態檢查
// 從 settings.ts 抽離。完全自含（IIFE 閉包 + localStorage + window.settings IPC）。
// 副作用導入：模塊加載時執行事件綁定 + 狀態初始化。

import { showModal } from "../shared/modal";

/* ===== RAG model card toggle (embedding only) ===== */
(function () {
  const cards = document.querySelectorAll<HTMLButtonElement>(
    ".rag-model-card:not([data-reranker])",
  );
  const KEY = "cyrene.rag.model";
  const saved = localStorage.getItem(KEY) || "minilm";
  cards.forEach((card) => {
    const value = card.dataset.value;
    if (!value) return;
    card.classList.toggle("is-active", value === saved);
    card.addEventListener("click", async () => {
      const previousActive = document.querySelector(
        ".rag-model-card.is-active:not([data-reranker])",
      ) as HTMLElement | null;
      const previousValue = previousActive?.dataset.value;

      // Optimistic UI update
      cards.forEach((c) => c.classList.remove("is-active"));
      card.classList.add("is-active");
      localStorage.setItem(KEY, value);

      // Call IPC to hot-switch the embedding model
      try {
        const result = await (window as any).settings?.embeddingSetModel?.(value);
        if (result?.ok) {
          if (result.clearedEntries && result.clearedEntries > 0) {
            window.alert(
              "已切換至 " +
                (value === "bgem3" ? "BGE-M3" : "MiniLM") +
                "。由於向量維度不同，已清除 " +
                result.clearedEntries +
                " 條舊向量記憶。",
            );
          }
        } else {
          // Rollback on failure
          cards.forEach((c) => c.classList.remove("is-active"));
          if (previousValue) {
            const prevCard = document.querySelector(
              '.rag-model-card[data-value="' + previousValue + '"]:not([data-reranker])',
            );
            prevCard?.classList.add("is-active");
            localStorage.setItem(KEY, previousValue);
          }
          window.alert("切換失敗：" + (result?.error || "未知錯誤"));
        }
      } catch (err) {
        // Rollback on error
        cards.forEach((c) => c.classList.remove("is-active"));
        if (previousValue) {
          const prevCard = document.querySelector(
            '.rag-model-card[data-value="' + previousValue + '"]:not([data-reranker])',
          );
          prevCard?.classList.add("is-active");
          localStorage.setItem(KEY, previousValue);
        }
        console.error("[settings] embedding switch error:", err);
      }
    });
  });
})();

/* ===== Reranker mode toggle ===== */
(function () {
  const cards = document.querySelectorAll<HTMLButtonElement>(".rag-model-card[data-reranker]");
  const KEY = "cyrene.reranker.mode";
  const saved = localStorage.getItem(KEY) || "light";
  cards.forEach((card) => {
    const value = card.dataset.value;
    if (!value) return;
    card.classList.toggle("is-active", value === saved);
    card.addEventListener("click", async () => {
      const previousActive = document.querySelector(
        ".rag-model-card.is-active[data-reranker]",
      ) as HTMLElement | null;
      const previousValue = previousActive?.dataset.value;

      cards.forEach((c) => c.classList.remove("is-active"));
      card.classList.add("is-active");
      localStorage.setItem(KEY, value);
      try {
        await (window as any).settings?.rerankerSetMode?.(value);
      } catch (err) {
        // Rollback on failure
        cards.forEach((c) => c.classList.remove("is-active"));
        if (previousValue) {
          const prevCard = document.querySelector(
            '.rag-model-card[data-value="' + previousValue + '"][data-reranker]',
          );
          prevCard?.classList.add("is-active");
          localStorage.setItem(KEY, previousValue);
        }
        console.warn("[Reranker] set mode failed:", err);
      }
    });
  });
})();

/* ===== Reranker install status (real on-disk check via IPC) ===== */
(async () => {
  const lightEl = document.getElementById("reranker-light-status");
  const standardEl = document.getElementById("reranker-standard-status");
  try {
    const status = await (window as any).settings?.getRerankerStatus?.();
    if (!status) return;
    if (lightEl) lightEl.textContent = status.light ? "已下載 · 約 23MB" : "未下載 · 可選";
    if (standardEl)
      standardEl.textContent = status.standard ? "已下載 · 約 279MB" : "未下載 · 可選";
  } catch (err) {
    console.warn("[Reranker] status check failed:", err);
    if (lightEl) lightEl.textContent = "狀態未知";
    if (standardEl) standardEl.textContent = "狀態未知";
  }
})();

/* ===== Embedding model status ===== */
(async () => {
  const bgem3El = document.getElementById("embedding-bgem3-status");
  const minilmEl = document.getElementById("embedding-minilm-status");
  try {
    const status = await window.modelConfig?.getModelInstallStatus?.();
    if (!status) {
      if (bgem3El) bgem3El.textContent = "狀態未知";
      if (minilmEl) minilmEl.textContent = "狀態未知";
      return;
    }
    if (bgem3El) bgem3El.textContent = status.embedding?.bgem3 ? "已下載 · 約 570MB" : "未下載";
    if (minilmEl) minilmEl.textContent = status.embedding?.minilm ? "已下載 · 約 23MB" : "未下載";
  } catch (err) {
    console.warn("[Embedding] status check failed:", err);
    if (bgem3El) bgem3El.textContent = "狀態未知";
    if (minilmEl) minilmEl.textContent = "狀態未知";
  }
})();

/* ===== Embedding download / delete ===== */
(function () {
  const downloadBtn = document.getElementById("embedding-download-btn") as HTMLButtonElement | null;
  const deleteBtn = document.getElementById("embedding-delete-btn") as HTMLButtonElement | null;
  const mirrorGroup = document.getElementById("embedding-mirror") as HTMLElement | null;

  function getSelectedModel(): string {
    const active = document.querySelector(
      ".rag-model-card.is-active:not([data-reranker])",
    ) as HTMLElement | null;
    return active?.dataset.value || "minilm";
  }

  downloadBtn?.addEventListener("click", async () => {
    // 打開模型安裝說明文檔
    await window.system?.openExternal(
      "https://github.com/Playa-0v0/Cyrene-Agent/blob/master/docs/local-models.md",
    );
  });

  deleteBtn?.addEventListener("click", async () => {
    const model = getSelectedModel();
    const name = model === "minilm" ? "MiniLM" : "BGE-M3";
    const confirmed = await showModal({
      title: "刪除模型",
      message: "確定刪除 " + name + " 模型緩存？下次使用需重新下載。",
      icon: "⚠️",
      confirmText: "刪除",
      cancelText: "取消",
    });
    if (!confirmed) return;
    deleteBtn.disabled = true;
    deleteBtn.textContent = "刪除中…";
    try {
      const result = await window.settings?.deleteEmbeddingModel?.(model);
      if (result?.ok) {
        deleteBtn.textContent = "✅ 已刪除";
        setTimeout(() => location.reload(), 800);
      } else {
        deleteBtn.textContent = "❌ 失敗";
        deleteBtn.disabled = false;
      }
    } catch {
      deleteBtn.textContent = "❌ 失敗";
      deleteBtn.disabled = false;
    }
  });

  // Mirror source toggle
  mirrorGroup?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-value]") as HTMLElement | null;
    if (!btn) return;
    const value = btn.dataset.value;
    if (!value) return;
    mirrorGroup.querySelectorAll(".option-block").forEach((b) => {
      const v = b.getAttribute("data-value");
      b.classList.toggle("is-active", v === value);
      b.setAttribute("aria-pressed", v === value ? "true" : "false");
    });
    localStorage.setItem("cyrene.rag.mirror", value);
  });

  // Restore saved mirror on load
  const savedMirror = localStorage.getItem("cyrene.rag.mirror") || "official";
  mirrorGroup?.querySelectorAll(".option-block").forEach((b) => {
    const v = b.getAttribute("data-value");
    b.classList.toggle("is-active", v === savedMirror);
    b.setAttribute("aria-pressed", v === savedMirror ? "true" : "false");
  });
})();

(function () {
  const updateBtn = document.getElementById("embedding-update-btn") as HTMLButtonElement | null;
  updateBtn?.addEventListener("click", () => {
    updateBtn.textContent = "已是最新版本";
    updateBtn.disabled = true;
    setTimeout(() => {
      updateBtn.textContent = "檢查更新";
      updateBtn.disabled = false;
    }, 2000);
  });
})();
