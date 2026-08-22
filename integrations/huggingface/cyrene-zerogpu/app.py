import random

import gradio as gr
import spaces
import torch
from diffusers import EulerAncestralDiscreteScheduler, StableDiffusionXLPipeline


MODEL_ID = "cagliostrolab/animagine-xl-4.0"
LORA_FILE = "cyrene_hsr_animagine_xl4.safetensors"
NEGATIVE_PROMPT = (
    "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, "
    "fewer digits, cropped, worst quality, low quality, low score, bad score, "
    "average score, signature, watermark, username, blurry, poorly drawn face, "
    "malformed eyes, asymmetrical eyes, mismatched eyes, cross-eyed, extra pupils, "
    "deformed iris, empty eyes, dull eyes, circular pupils, closed eyes, half-closed eyes, "
    "one eye closed, squinting, uneven eyelids, duplicate person, "
    "letters, words, fake text, gibberish text, typography, caption, title, artist name, "
    "signature, watermark, logo, user interface, character card, trading card, card layout, "
    "decorative frame, picture frame, border, panel, badge, 3d render, photorealistic"
)

QUALITY_SUFFIX = (
    ", (both eyes clearly open:1.5), (symmetrical detailed violet-pink gradient irises:1.35), "
    "(matching bright white diamond-shaped pupils:1.4), centered pupils, clear unobstructed face, "
    "single adult character, character fills the canvas, clean standalone borderless illustration, "
    "simple soft background, no text, no letters, no title, no logo, no frame, no border"
)

BLACK_HOSIERY_MARKERS = ("black pantyhose", "black tights", "black stockings", "black hosiery")
WHITE_HOSIERY_MARKERS = ("white pantyhose", "white tights", "white stockings", "white hosiery")


def negative_prompt_for(prompt: str) -> str:
    lowered = prompt.lower()
    if any(marker in lowered for marker in BLACK_HOSIERY_MARKERS):
        return (
            NEGATIVE_PROMPT
            + ", bare legs, bare thighs, exposed legs, skin-colored legs, "
            + "white pantyhose, white tights, white stockings, thighhighs, "
            + "garter straps, long skirt, floor-length dress, signature outfit"
        )
    if any(marker in lowered for marker in WHITE_HOSIERY_MARKERS):
        return (
            NEGATIVE_PROMPT
            + ", bare legs, bare thighs, exposed legs, skin-colored legs, "
            + "black pantyhose, black tights, black stockings, thighhighs, "
            + "garter straps, long skirt, floor-length dress, signature outfit"
        )
    return NEGATIVE_PROMPT


def enhance_prompt(prompt: str) -> str:
    return prompt + QUALITY_SUFFIX

DIMENSIONS = {
    "1:1": (1024, 1024),
    "3:4": (896, 1152),
    "9:16": (768, 1344),
    "4:3": (1152, 896),
    "16:9": (1344, 768),
}

# ZeroGPU emulates CUDA during module initialization and materializes it only
# while a @spaces.GPU function is executing. Loading here avoids a cold model
# transfer on every request.
pipe = StableDiffusionXLPipeline.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.float16,
    use_safetensors=True,
    custom_pipeline="lpw_stable_diffusion_xl",
    add_watermarker=False,
).to("cuda")
pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
pipe.load_lora_weights(".", weight_name=LORA_FILE, adapter_name="cyrene")
LORA_ADAPTER = pipe.get_active_adapters()[0]
pipe.set_progress_bar_config(disable=True)


@spaces.GPU(duration=90)
def generate(
    prompt: str,
    aspect_ratio: str = "9:16",
    steps: int = 28,
    lora_strength: float = 0.8,
    seed: int = -1,
):
    prompt = (prompt or "").strip()
    if not prompt:
        raise gr.Error("Prompt is required.")
    width, height = DIMENSIONS.get(aspect_ratio, DIMENSIONS["1:1"])
    seed = random.randint(0, 2**31 - 1) if seed < 0 else int(seed)
    steps = max(12, min(32, int(steps)))
    lora_strength = max(0.4, min(1.2, float(lora_strength)))
    pipe.set_adapters([LORA_ADAPTER], adapter_weights=[lora_strength])
    generator = torch.Generator(device="cuda").manual_seed(seed)
    enhanced_prompt = enhance_prompt(prompt)
    image = pipe(
        prompt=enhanced_prompt,
        negative_prompt=negative_prompt_for(prompt),
        width=width,
        height=height,
        num_inference_steps=steps,
        guidance_scale=5.0,
        generator=generator,
    ).images[0]
    return image, seed


with gr.Blocks(theme=gr.themes.Soft(primary_hue="purple", secondary_hue="pink")) as demo:
    gr.Markdown("# 🌸 昔漣 ZeroGPU 寫真室\nAnimagine XL 4.0 · Cyrene LoRA")
    with gr.Row():
        with gr.Column():
            prompt_input = gr.Textbox(label="Prompt", lines=6)
            aspect_input = gr.Dropdown(list(DIMENSIONS), value="9:16", label="Aspect ratio")
            steps_input = gr.Slider(12, 32, value=28, step=1, label="Steps")
            strength_input = gr.Slider(0.4, 1.2, value=0.65, step=0.05, label="LoRA strength")
            seed_input = gr.Number(value=-1, precision=0, label="Seed (-1 = random)")
            generate_button = gr.Button("Generate", variant="primary")
        with gr.Column():
            image_output = gr.Image(label="Cyrene", type="pil")
            seed_output = gr.Number(label="Seed", precision=0)
    generate_button.click(
        generate,
        inputs=[prompt_input, aspect_input, steps_input, strength_input, seed_input],
        outputs=[image_output, seed_output],
        api_name="generate",
    )

demo.queue(default_concurrency_limit=1).launch()
