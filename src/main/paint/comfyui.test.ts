import { describe, expect, it, vi } from "vitest";
import { buildComfyWorkflow, dimensionsForAspect, getComfyInventory } from "./comfyui";

describe("ComfyUI SDXL integration", () => {
  it("uses Apple Silicon-friendly SDXL dimensions", () => {
    expect(dimensionsForAspect("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(dimensionsForAspect("9:16")).toEqual({ width: 768, height: 1344 });
    expect(dimensionsForAspect("16:9")).toEqual({ width: 1344, height: 768 });
    expect(dimensionsForAspect("1:1", "low")).toEqual({ width: 768, height: 768 });
    expect(dimensionsForAspect("9:16", "low")).toEqual({ width: 576, height: 1024 });
  });

  it("connects the selected LoRA to model and text encoders", () => {
    const workflow = buildComfyWorkflow({
      checkpoint: "animagine-xl-4.0.safetensors",
      lora: "cyrene.safetensors",
      loraStrength: 0.8,
      prompt: "cyrene_hsr, portrait",
      aspectRatio: "3:4",
      quality: "high",
    }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(workflow["2"]).toMatchObject({
      class_type: "LoraLoader",
      inputs: { lora_name: "cyrene.safetensors", strength_model: 0.8, strength_clip: 0.8 },
    });
    expect(workflow["3"].inputs.clip).toEqual(["2", 1]);
    expect(workflow["6"].inputs.model).toEqual(["2", 0]);
    expect(workflow["5"].inputs).toMatchObject({ width: 896, height: 1152 });
  });

  it("reads checkpoint and LoRA options from object_info", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["base.safetensors"]] } } },
      LoraLoader: { input: { required: { lora_name: [["cyrene.safetensors"]] } } },
    }), { status: 200 })) as unknown as typeof fetch;
    await expect(getComfyInventory(fetcher)).resolves.toEqual({
      connected: true,
      checkpoints: ["base.safetensors"],
      loras: ["cyrene.safetensors"],
    });
  });
});
