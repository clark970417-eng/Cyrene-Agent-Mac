import "../ui/theme";

type Quality = "low" | "medium" | "high";
type AspectRatio = "1:1" | "3:4" | "9:16" | "16:9";
type TaskStatus = "loading" | "done" | "failed";

interface PaintTask {
  id: string;
  request: string;
  status: TaskStatus;
  time: string;
  savedPath?: string;
}

interface LoraStatus {
  connected: boolean;
  checkpoints: string[];
  loras: string[];
  comfyUrl: string;
  imageBackend: "huggingface" | "comfyui";
  huggingFace: {
    configured: boolean;
    connected: boolean;
    spaceUrl?: string;
  };
  huggingFaceTokenConfigured: boolean;
}

interface PaintApi {
  getLoraStatus: () => Promise<LoraStatus>;
  saveHuggingFaceConfig: (payload: {
    spaceUrl: string;
    token?: string;
    backend: "huggingface";
  }) => Promise<LoraStatus>;
  generateCyreneImage: (payload: {
    request: string;
    aspectRatio: AspectRatio;
    quality: Quality;
    loraStrength: number;
  }) => Promise<{ dataUrl?: string; savedPath?: string; prompt?: string }>;
}

const paint = window.paint as unknown as PaintApi;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const taskStorageKey = "cyrene.paint.portraits.v1";

document.addEventListener("DOMContentLoaded", () => {
  const requestEl = byId<HTMLTextAreaElement>("creation-params");
  const aspectSelect = byId<HTMLSelectElement>("aspect-select");
  const qualitySelect = byId<HTMLSelectElement>("quality-select");
  const strengthEl = byId<HTMLInputElement>("lora-strength");
  const strengthValue = byId<HTMLOutputElement>("lora-strength-value");
  const metaStrength = byId<HTMLSpanElement>("meta-strength");
  const metaResolution = byId<HTMLSpanElement>("meta-resolution");
  const generateBtn = byId<HTMLButtonElement>("generate-btn");
  const inlineMessage = byId<HTMLDivElement>("inline-message");
  const headerStatus = byId<HTMLDivElement>("header-status");
  const headerLabel = byId<HTMLSpanElement>("header-provider-label");
  const engineCard = byId<HTMLDivElement>("engine-card");
  const engineTitle = byId<HTMLElement>("engine-title");
  const engineCopy = byId<HTMLElement>("engine-copy");
  const engineState = byId<HTMLElement>("engine-state");
  const spaceUrlEl = byId<HTMLInputElement>("hf-space-url");
  const tokenEl = byId<HTMLInputElement>("hf-token");
  const saveHfConfigBtn = byId<HTMLButtonElement>("save-hf-config");
  const hfConfigState = byId<HTMLElement>("hf-config-state");
  const canvasTitle = byId<HTMLHeadingElement>("canvas-title");
  const canvasLoader = byId<HTMLDivElement>("canvas-loader");
  const displayImage = byId<HTMLImageElement>("display-image");
  const imageStage = byId<HTMLDivElement>("image-stage");
  const tasksCount = byId<HTMLSpanElement>("tasks-count");
  const tasksList = byId<HTMLDivElement>("tasks-list");
  const taskHistory = loadTasks();

  function loadTasks(): PaintTask[] {
    try {
      const value = JSON.parse(localStorage.getItem(taskStorageKey) || "[]") as PaintTask[];
      return Array.isArray(value) ? value.slice(0, 10) : [];
    } catch {
      return [];
    }
  }

  function saveTasks() {
    localStorage.setItem(
      taskStorageKey,
      JSON.stringify(taskHistory.filter((task) => task.status !== "loading").slice(0, 10)),
    );
  }

  function setMessage(message: string, error = false) {
    inlineMessage.textContent = message;
    inlineMessage.classList.toggle("is-error", error);
  }

  function renderTasks() {
    tasksCount.textContent = `${taskHistory.length} 張`;
    tasksList.replaceChildren();
    if (!taskHistory.length) {
      const empty = document.createElement("div");
      empty.className = "task-empty";
      empty.textContent = "第一張完成後，最近的願望會留在這裡。";
      tasksList.appendChild(empty);
      return;
    }
    for (const task of taskHistory) {
      const item = document.createElement("div");
      item.className = "task-item";
      const mark = document.createElement("span");
      mark.className = `task-item__status task-item__status--${task.status}`;
      mark.textContent = task.status === "done" ? "✓" : task.status === "failed" ? "!" : "⋯";
      const prompt = document.createElement("div");
      prompt.className = "task-item__prompt";
      prompt.textContent = task.request;
      const time = document.createElement("span");
      time.className = "task-item__time";
      time.textContent = task.time;
      item.append(mark, prompt, time);
      tasksList.appendChild(item);
    }
  }

  function updateMeta() {
    const steps = qualitySelect.value === "low" ? 24 : qualitySelect.value === "high" ? 32 : 28;
    metaResolution.textContent = `${aspectSelect.value} · ${steps} steps`;
    metaStrength.textContent = `Cyrene LoRA ${Number(strengthEl.value).toFixed(2)}`;
    strengthValue.value = Number(strengthEl.value).toFixed(2);
  }

  async function refreshStatus() {
    try {
      const status = await paint.getLoraStatus();
      const usingCloud = status.imageBackend === "huggingface";
      const ready = usingCloud
        ? status.huggingFace.connected
        : status.checkpoints.length > 0 && status.loras.length > 0;
      headerStatus.classList.toggle("is-offline", !ready);
      engineCard.classList.toggle("is-ready", ready);
      if (usingCloud) {
        engineTitle.textContent = ready ? "ZeroGPU 私人畫室已連線" : "ZeroGPU 私人畫室待連線";
        engineCopy.textContent = status.huggingFace.spaceUrl || "請填入 Hugging Face Space URL";
        engineState.textContent = ready
          ? "雲端就緒"
          : status.huggingFace.configured
            ? "喚醒中"
            : "未設定";
        headerLabel.textContent = ready ? "Hugging Face ZeroGPU 已連線" : "等待 ZeroGPU Space 設定";
      } else {
        engineTitle.textContent = ready ? "昔漣 LoRA 已就緒" : "本機模型尚未完整";
        engineCopy.textContent = ready
          ? `${status.checkpoints[0]} · ${status.loras[0]}`
          : "需要 Animagine XL 4.0 與昔漣 LoRA";
        engineState.textContent = status.connected ? "運行中" : ready ? "自動啟動" : "缺少模型";
        headerLabel.textContent = status.connected
          ? "本機 ComfyUI 已連線"
          : ready
            ? "生成時會自動啟動 ComfyUI"
            : "昔漣 LoRA 尚未就緒";
      }
      if (status.huggingFace.spaceUrl && !spaceUrlEl.value)
        spaceUrlEl.value = status.huggingFace.spaceUrl;
      hfConfigState.textContent = status.huggingFace.connected
        ? "已連線"
        : status.huggingFace.configured
          ? "等待喚醒"
          : "尚未設定";
      hfConfigState.classList.toggle("is-connected", status.huggingFace.connected);
      tokenEl.placeholder = status.huggingFaceTokenConfigured
        ? "已加密儲存；留空可保留"
        : "貼上唯讀 hf_ 憑證";
    } catch (error) {
      headerLabel.textContent = "無法讀取畫室狀態";
      engineTitle.textContent = "狀態檢查失敗";
      engineCopy.textContent = error instanceof Error ? error.message : String(error);
      engineState.textContent = "離線";
    }
  }

  document.querySelectorAll<HTMLButtonElement>(".quick-prompts button").forEach((button) => {
    button.addEventListener("click", () => {
      requestEl.value = button.dataset.prompt || "";
      if (/黑絲|白絲|絲襪|全身/.test(requestEl.value)) aspectSelect.value = "9:16";
      updateMeta();
      requestEl.focus();
    });
  });
  requestEl.addEventListener("input", () => {
    if (
      /黑絲|白絲|絲襪|褲襪|網襪|過膝襪|全身/i.test(requestEl.value) &&
      aspectSelect.value === "1:1"
    ) {
      aspectSelect.value = "9:16";
      updateMeta();
    }
  });
  strengthEl.addEventListener("input", updateMeta);
  aspectSelect.addEventListener("change", updateMeta);
  qualitySelect.addEventListener("change", updateMeta);

  saveHfConfigBtn.addEventListener("click", async () => {
    const spaceUrl = spaceUrlEl.value.trim();
    if (!spaceUrl) {
      setMessage("請先填入 Hugging Face ZeroGPU Space URL。", true);
      spaceUrlEl.focus();
      return;
    }
    saveHfConfigBtn.disabled = true;
    setMessage("正在儲存並喚醒私人 ZeroGPU Space…");
    try {
      await paint.saveHuggingFaceConfig({
        spaceUrl,
        token: tokenEl.value.trim() || undefined,
        backend: "huggingface",
      });
      tokenEl.value = "";
      await refreshStatus();
      setMessage("Hugging Face 私人畫室設定已儲存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存 ZeroGPU 設定。", true);
    } finally {
      saveHfConfigBtn.disabled = false;
    }
  });

  generateBtn.addEventListener("click", async () => {
    const request = requestEl.value.trim();
    if (!request) {
      setMessage("先告訴人家，你想看什麼樣的照片。", true);
      requestEl.focus();
      return;
    }
    const task: PaintTask = {
      id: crypto.randomUUID(),
      request,
      status: "loading",
      time: new Date().toLocaleTimeString("zh-TW", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    };
    taskHistory.unshift(task);
    renderTasks();
    canvasTitle.textContent = request;
    canvasLoader.classList.add("is-loading");
    generateBtn.disabled = true;
    setMessage("正在排入 Hugging Face ZeroGPU，完成後會自動取回昔漣照片…");
    try {
      const result = await paint.generateCyreneImage({
        request,
        aspectRatio: aspectSelect.value as AspectRatio,
        quality: qualitySelect.value as Quality,
        loraStrength: Number(strengthEl.value),
      });
      if (!result.dataUrl) throw new Error("圖片服務沒有回傳預覽。");
      displayImage.src = result.dataUrl;
      imageStage.style.aspectRatio = aspectSelect.value.replace(":", " / ");
      task.status = "done";
      task.savedPath = result.savedPath;
      setMessage(result.savedPath ? `畫好啦♪ 已儲存到 ${result.savedPath}` : "畫好啦♪");
      await refreshStatus();
    } catch (error) {
      task.status = "failed";
      setMessage(error instanceof Error ? error.message : "生成失敗，請再試一次。", true);
    } finally {
      canvasLoader.classList.remove("is-loading");
      generateBtn.disabled = false;
      saveTasks();
      renderTasks();
    }
  });

  renderTasks();
  updateMeta();
  void refreshStatus();
});
