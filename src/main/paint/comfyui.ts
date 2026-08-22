import { randomUUID } from "node:crypto";

export interface ComfyInventory {
  connected: boolean;
  checkpoints: string[];
  loras: string[];
}

export interface ComfyGenerateOptions {
  checkpoint: string;
  lora?: string;
  loraStrength?: number;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  quality: "auto" | "low" | "medium" | "high";
}

interface ComfyImageDescriptor {
  filename: string;
  subfolder?: string;
  type?: string;
}

const COMFY_URL = "http://127.0.0.1:8188";
const DEFAULT_NEGATIVE = "lowres, worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, text, logo, watermark";

function stringOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export async function getComfyInventory(fetcher: typeof fetch = fetch): Promise<ComfyInventory> {
  try {
    const response = await fetcher(`${COMFY_URL}/object_info`, { signal: AbortSignal.timeout(2_500) });
    if (!response.ok) return { connected: false, checkpoints: [], loras: [] };
    const info = await response.json() as Record<string, { input?: { required?: Record<string, unknown[]> } }>;
    const checkpoints = stringOptions(info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]);
    const loras = stringOptions(info.LoraLoader?.input?.required?.lora_name?.[0]);
    return { connected: true, checkpoints, loras };
  } catch {
    return { connected: false, checkpoints: [], loras: [] };
  }
}

export function dimensionsForAspect(
  aspectRatio: string,
  quality: ComfyGenerateOptions["quality"] = "medium",
): { width: number; height: number } {
  const balanced: Record<string, { width: number; height: number }> = {
    "1:1": { width: 1024, height: 1024 },
    "3:4": { width: 896, height: 1152 },
    "9:16": { width: 768, height: 1344 },
    "4:3": { width: 1152, height: 896 },
    "16:9": { width: 1344, height: 768 },
  };
  const fast: Record<string, { width: number; height: number }> = {
    "1:1": { width: 768, height: 768 },
    "3:4": { width: 672, height: 896 },
    "9:16": { width: 576, height: 1024 },
    "4:3": { width: 896, height: 672 },
    "16:9": { width: 1024, height: 576 },
  };
  const presets = quality === "low" ? fast : balanced;
  return presets[aspectRatio] ?? presets["1:1"];
}

export function buildComfyWorkflow(options: ComfyGenerateOptions): Record<string, unknown> {
  const { width, height } = dimensionsForAspect(options.aspectRatio, options.quality);
  const useLora = Boolean(options.lora);
  const modelSource: [string, number] = useLora ? ["2", 0] : ["1", 0];
  const clipSource: [string, number] = useLora ? ["2", 1] : ["1", 1];
  const steps = options.quality === "low" ? 18 : options.quality === "high" ? 32 : 25;
  const workflow: Record<string, unknown> = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: options.checkpoint } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: options.prompt, clip: clipSource } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: options.negativePrompt || DEFAULT_NEGATIVE, clip: clipSource } },
    "5": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "6": {
      class_type: "KSampler",
      inputs: {
        seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
        steps,
        cfg: 6.5,
        sampler_name: "euler_ancestral",
        scheduler: "normal",
        denoise: 1,
        model: modelSource,
        positive: ["3", 0],
        negative: ["4", 0],
        latent_image: ["5", 0],
      },
    },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "SaveImage", inputs: { filename_prefix: "CyreneStudio", images: ["7", 0] } },
  };
  if (useLora) {
    const strength = Math.max(0, Math.min(1.3, Number(options.loraStrength ?? 0.8)));
    workflow["2"] = {
      class_type: "LoraLoader",
      inputs: { lora_name: options.lora, strength_model: strength, strength_clip: strength, model: ["1", 0], clip: ["1", 1] },
    };
  }
  return workflow;
}

function findOutputImage(history: unknown, promptId: string): ComfyImageDescriptor | null {
  if (!history || typeof history !== "object") return null;
  const prompt = (history as Record<string, unknown>)[promptId];
  if (!prompt || typeof prompt !== "object") return null;
  const outputs = (prompt as { outputs?: Record<string, { images?: ComfyImageDescriptor[] }> }).outputs;
  if (!outputs) return null;
  for (const output of Object.values(outputs)) {
    const image = output.images?.[0];
    if (image?.filename) return image;
  }
  return null;
}

function findExecutionError(history: unknown, promptId: string): string | null {
  if (!history || typeof history !== "object") return null;
  const prompt = (history as Record<string, unknown>)[promptId];
  if (!prompt || typeof prompt !== "object") return null;
  const entry = prompt as {
    status?: { status_str?: string; messages?: Array<[string, Record<string, unknown>]> };
  };
  if (entry.status?.status_str !== "error") return null;
  const executionError = entry.status.messages?.find(([type]) => type === "execution_error")?.[1];
  return String(executionError?.exception_message || executionError?.exception_type || "ComfyUI 執行失敗。");
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function generateWithComfy(options: ComfyGenerateOptions, fetcher: typeof fetch = fetch): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetcher(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: buildComfyWorkflow(options), client_id: randomUUID() }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ComfyUI 無法接受工作流程：HTTP ${response.status}`);
  const queued = await response.json() as { prompt_id?: string; error?: { message?: string } };
  if (!queued.prompt_id) throw new Error(queued.error?.message || "ComfyUI 沒有回傳任務編號。");

  const deadline = Date.now() + 20 * 60_000;
  let descriptor: ComfyImageDescriptor | null = null;
  while (Date.now() < deadline) {
    await delay(1_000);
    const historyResponse = await fetcher(`${COMFY_URL}/history/${encodeURIComponent(queued.prompt_id)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (historyResponse.ok) {
      const history = await historyResponse.json();
      const executionError = findExecutionError(history, queued.prompt_id);
      if (executionError) throw new Error(`ComfyUI 生成失敗：${executionError}`);
      descriptor = findOutputImage(history, queued.prompt_id);
    }
    if (descriptor) break;
  }
  if (!descriptor) throw new Error("ComfyUI 生成逾時；可到 ComfyUI 查看佇列與錯誤訊息。");

  const query = new URLSearchParams({
    filename: descriptor.filename,
    subfolder: descriptor.subfolder || "",
    type: descriptor.type || "output",
  });
  const imageResponse = await fetcher(`${COMFY_URL}/view?${query.toString()}`, { signal: AbortSignal.timeout(30_000) });
  if (!imageResponse.ok) throw new Error(`無法從 ComfyUI 取回圖片：HTTP ${imageResponse.status}`);
  return {
    bytes: new Uint8Array(await imageResponse.arrayBuffer()),
    mimeType: imageResponse.headers.get("content-type") || "image/png",
  };
}

export const COMFYUI_URL = COMFY_URL;
