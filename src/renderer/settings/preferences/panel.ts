// 截图热键 + 表情包管理：热键捕获/录入、表情包列表渲染、添加/删除表情包
// 从 settings.ts 抽离。依赖 preferences/appearance DOM + shared/save-status + shared/shell。
// 副作用导入：模块加载时执行事件绑定 + 表情包列表加载。

import { preferencesState } from "./state";
import {
  stickerAddError,
  stickerAddConfirm,
  stickerAddCancel,
  stickerAddPickBtn,
  stickerAddFileName,
  stickerAddId,
  stickerAddDesc,
  stickerAddPhrases,
  stickerAddOverlay,
} from "./dom";
import { addStickerBtn, openStickerManagerBtn } from "../shared/shell";

openStickerManagerBtn.addEventListener("click", async () => {
  try {
    const result = await window.settings?.openStickerManager();
    if (!result?.ok) {
      console.error("[settings] open sticker manager failed", result?.error);
      window.alert(
        "表情包管理窗口打开失败，请查看终端日志。" + (result?.error ? `\n${result.error}` : ""),
      );
    }
  } catch (error) {
    console.error("[settings] open sticker manager error", error);
    window.alert("表情包管理窗口打开失败，请查看终端日志。");
  }
});

// ── 添加表情包弹窗 ──

function openStickerAddModal(): void {
  preferencesState.stickerAddPickedPath = null;
  stickerAddFileName.textContent = "未选择";
  stickerAddId.value = "";
  stickerAddDesc.value = "";
  stickerAddPhrases.value = "";
  stickerAddError.classList.add("is-hidden");
  stickerAddOverlay.classList.remove("is-hidden");
}

function closeStickerAddModal(): void {
  stickerAddOverlay.classList.add("is-hidden");
}

addStickerBtn.addEventListener("click", openStickerAddModal);
stickerAddCancel.addEventListener("click", closeStickerAddModal);

stickerAddPickBtn.addEventListener("click", async () => {
  const filePath = await window.settings?.stickerPickFile?.();
  if (filePath) {
    preferencesState.stickerAddPickedPath = filePath;
    const name = filePath.split(/[\\/]/).pop() || filePath;
    stickerAddFileName.textContent = name;
    if (!stickerAddId.value) {
      const baseName = name.replace(/\.[^.]+$/, "");
      stickerAddId.value = baseName.replace(/[^a-zA-Z0-9_-]/g, "");
    }
  }
});

stickerAddConfirm.addEventListener("click", async () => {
  stickerAddError.classList.add("is-hidden");

  if (!preferencesState.stickerAddPickedPath) {
    stickerAddError.textContent = "请先选择图片文件";
    stickerAddError.classList.remove("is-hidden");
    return;
  }
  const id = stickerAddId.value.trim();
  if (!id) {
    stickerAddError.textContent = "请填写英文名称";
    stickerAddError.classList.remove("is-hidden");
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    stickerAddError.textContent = "名称只能用英文字母、数字、下划线和连字符";
    stickerAddError.classList.remove("is-hidden");
    return;
  }
  const description = stickerAddDesc.value.trim();
  if (!description) {
    stickerAddError.textContent = "请填写图片描述";
    stickerAddError.classList.remove("is-hidden");
    return;
  }
  const phrases = stickerAddPhrases.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (phrases.length === 0) {
    stickerAddError.textContent = "请至少写一行相近语义";
    stickerAddError.classList.remove("is-hidden");
    return;
  }

  try {
    await window.settings?.stickerAdd?.({
      sourcePath: preferencesState.stickerAddPickedPath,
      id,
      description,
      phrases,
    });
    closeStickerAddModal();
  } catch (err) {
    stickerAddError.textContent = "添加失败：" + (err as Error).message;
    stickerAddError.classList.remove("is-hidden");
  }
});
