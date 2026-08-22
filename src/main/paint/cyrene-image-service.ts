import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildCyreneImagePrompt,
  hasCyreneOutfitRequest,
  inferCyreneImageAspectRatio,
} from "../../shared/cyrene-image-request";
import { COMFYUI_URL, generateWithComfy, getComfyInventory } from "./comfyui";
import { generateWithHuggingFace } from "./huggingface";
import { loadPaintLocalConfig } from "./paint-local-config";

const PREFERRED_CHECKPOINT = "animagine-xl-4.0.safetensors";
const PREFERRED_LORA = "cyrene_hsr_animagine_xl4.safetensors";

let comfyProcess: ChildProcess | null = null;
let comfyStartup: Promise<void> | null = null;

async function configuredComfyRoot(): Promise<string | undefined> {
  return (await loadPaintLocalConfig()).comfyRoot?.trim() || undefined;
}

async function normalizeComfyRoot(candidate: string): Promise<string | undefined> {
  try {
    let resolved = path.resolve(candidate.trim());
    const selected = await fs.stat(resolved);
    if (selected.isFile() && path.basename(resolved) === "main.py") {
      resolved = path.dirname(resolved);
    }
    resolved = await fs.realpath(resolved);
    const [rootStat, mainStat] = await Promise.all([
      fs.stat(resolved),
      fs.stat(path.join(resolved, "main.py")),
    ]);
    return rootStat.isDirectory() && mainStat.isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveCyreneComfyRoot(): Promise<string> {
  const candidates = [
    await configuredComfyRoot(),
    path.join(app.getPath("documents"), "Cyrene Studio", "ComfyUI"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const root = await normalizeComfyRoot(candidate);
    if (root) return root;
  }
  throw new Error("找不到 ComfyUI；請先在昔漣繪圖視窗設定 ComfyUI 目錄。");
}

async function resolvePython(root: string): Promise<string> {
  const candidates = [
    path.join(root, ".venv", "bin", "python"),
    path.join(root, ".venv", "bin", "python3"),
  ];
  for (const candidate of candidates) {
    try {
      const executable = await fs.realpath(candidate);
      if ((await fs.stat(executable)).isFile()) return executable;
    } catch {
      // Try the next venv executable.
    }
  }
  throw new Error("ComfyUI 的 Python 虛擬環境不存在，請確認 .venv 已完成安裝。");
}

async function supportsAppleMps(python: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  return new Promise((resolve) => {
    const probe = spawn(
      python,
      ["-c", "import torch; print('1' if torch.backends.mps.is_available() else '0')"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let output = "";
    const timer = setTimeout(() => {
      probe.kill();
      resolve(false);
    }, 10_000);
    probe.stdout?.setEncoding("utf8");
    probe.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    probe.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    probe.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && output.trim() === "1");
    });
  });
}

async function waitForComfyUi(child?: ChildProcess, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getComfyInventory()).connected) return;
    if (child && child.exitCode !== null) {
      throw new Error(`ComfyUI 啟動後立即停止（exit ${child.exitCode}）；請檢查運算後端。`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`ComfyUI 啟動逾時；請檢查 ${COMFYUI_URL}。`);
}

/** 若 ComfyUI 尚未啟動，使用使用者已安裝的本機環境自動啟動。 */
export async function ensureCyreneComfyUi(): Promise<void> {
  if ((await getComfyInventory()).connected) return;
  if (comfyStartup) return comfyStartup;
  comfyStartup = (async () => {
    const root = await resolveCyreneComfyRoot();
    const python = await resolvePython(root);
    let startedChild: ChildProcess | undefined;
    if (!comfyProcess || comfyProcess.exitCode !== null) {
      const mainPath = path.join(root, "main.py");
      const deviceArgs = (await supportsAppleMps(python)) ? [] : ["--cpu"];
      const child = spawn(
        python,
        [
          mainPath,
          "--listen",
          "127.0.0.1",
          "--port",
          "8188",
          "--disable-auto-launch",
          "--cache-none",
          "--use-split-cross-attention",
          "--disable-pinned-memory",
          "--cpu-vae",
          "--reserve-vram",
          "4",
          ...deviceArgs,
        ],
        {
          cwd: root,
          env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: "1" },
          stdio: "ignore",
        },
      );
      startedChild = child;
      comfyProcess = child;
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", (error) => {
          comfyProcess = null;
          reject(new Error(`無法啟動 ComfyUI（${root}）：${error.message}`));
        });
      });
      child.once("exit", () => {
        if (comfyProcess === child) comfyProcess = null;
      });
    }
    await waitForComfyUi(startedChild);
  })().finally(() => {
    comfyStartup = null;
  });
  return comfyStartup;
}

async function saveCyreneImage(bytes: Uint8Array, mimeType: string): Promise<string> {
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const directory = path.join(app.getPath("pictures"), "Cyrene Studio");
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `cyrene-lora-${Date.now()}.${extension}`);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

export interface CyreneImageOptions {
  request: string;
  aspectRatio?: "1:1" | "3:4" | "9:16" | "4:3" | "16:9";
  quality?: "auto" | "low" | "medium" | "high";
  loraStrength?: number;
}

export interface CyreneImageResult {
  bytes: Uint8Array;
  mimeType: string;
  savedPath: string;
  prompt: string;
  checkpoint: string;
  lora: string;
}

/** 主程式、Discord 與繪圖視窗共用的昔漣 LoRA 生成入口。 */
export async function generateCyreneImage(options: CyreneImageOptions): Promise<CyreneImageResult> {
  const request = options.request.trim();
  if (!request) throw new Error("請先描述想看的昔漣照片。");
  const imageConfig = await loadPaintLocalConfig();
  const prompt = buildCyreneImagePrompt(request);
  const requestedLoraStrength = options.loraStrength ?? 0.8;
  const hosieryRequest =
    /黑絲|白絲|絲襪|褲襪|black (?:tights|pantyhose|stockings)|white (?:tights|pantyhose|stockings)/i.test(
      request,
    );
  const loraStrength = hosieryRequest
    ? Math.min(requestedLoraStrength, 0.6)
    : hasCyreneOutfitRequest(request)
      ? Math.min(requestedLoraStrength, 0.7)
      : requestedLoraStrength;
  if (imageConfig.imageBackend === "huggingface" || imageConfig.huggingFaceSpaceUrl?.trim()) {
    if (!imageConfig.huggingFaceSpaceUrl?.trim()) {
      throw new Error("尚未設定 Hugging Face ZeroGPU Space URL。");
    }
    const generated = await generateWithHuggingFace({
      spaceUrl: imageConfig.huggingFaceSpaceUrl,
      token: imageConfig.huggingFaceToken,
      prompt,
      aspectRatio: options.aspectRatio ?? inferCyreneImageAspectRatio(request),
      quality: options.quality ?? "medium",
      loraStrength,
    });
    return {
      ...generated,
      savedPath: await saveCyreneImage(generated.bytes, generated.mimeType),
      prompt,
      checkpoint: "cagliostrolab/animagine-xl-4.0",
      lora: "cyrene_hsr_animagine_xl4.safetensors · Hugging Face ZeroGPU",
    };
  }
  await ensureCyreneComfyUi();
  const inventory = await getComfyInventory();
  const checkpoint =
    inventory.checkpoints.find((name) => name === PREFERRED_CHECKPOINT) ??
    inventory.checkpoints.find((name) => /animagine.*xl.*4/i.test(name)) ??
    inventory.checkpoints[0];
  const lora =
    inventory.loras.find((name) => name === PREFERRED_LORA) ??
    inventory.loras.find((name) => /cyrene|昔漣/i.test(name)) ??
    inventory.loras[0];
  if (!checkpoint) throw new Error("ComfyUI 找不到 Animagine XL checkpoint。");
  if (!lora) throw new Error("ComfyUI 找不到昔漣 LoRA。");

  const generated = await generateWithComfy({
    checkpoint,
    lora,
    loraStrength,
    prompt,
    aspectRatio: options.aspectRatio ?? inferCyreneImageAspectRatio(request),
    quality: options.quality ?? "medium",
  });
  return {
    ...generated,
    savedPath: await saveCyreneImage(generated.bytes, generated.mimeType),
    prompt,
    checkpoint,
    lora,
  };
}
