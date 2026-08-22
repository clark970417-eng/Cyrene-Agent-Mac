import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

const SELECTED_FRAMES = [14, 18, 21, 22, 28, 33, 36, 37, 44, 59, 60, 61, 66, 88, 89] as const;
const TRIGGER = "cyrene_hsr";

const CAPTION_DETAILS: Record<number, string> = {
  14: "close-up, looking at viewer, reaching toward viewer, gentle smile",
  18: "upper body, three-quarter view, reaching outward, white lavender dress, garden",
  21: "back detail, long pink hair, flowing hair, white lavender dress",
  22: "upper body, eyes closed, both hands raised, serene expression, dark background",
  28: "extreme close-up, closed eye, pink eyelashes",
  33: "face close-up, three-quarter view, open eyes, dark starry background",
  36: "medium shot, front view, white lavender dress, crystal wing, cool lighting",
  37: "medium shot, front view, white lavender dress, warm lighting",
  44: "face close-up, smiling, monochrome dramatic lighting",
  59: "face close-up, serious expression, monochrome lighting",
  60: "upper body, looking down, emotional expression, pink dramatic lighting",
  61: "face close-up, three-quarter view, diamond pupils, pink dramatic lighting",
  66: "upper body, side view, holding a crystal, long pink hair",
  88: "profile, eyes closed, hand near face, blue rose ornament, starry background",
  89: "back three-quarter view, braided long pink hair, translucent veil, starry background",
};

export interface TrainingKitStatus {
  kitPath: string;
  kitReady: boolean;
  starterImageCount: number;
}

function kitRoot(): string {
  return path.join(app.getPath("documents"), "Cyrene Studio", "LoRA Training");
}

function sourceRoot(): string {
  return path.join(app.getPath("documents"), "ChatGPT", "New project", "cyrene-lora-source", "candidates");
}

async function countImages(directory: string): Promise<number> {
  try {
    return (await fs.readdir(directory)).filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name)).length;
  } catch {
    return 0;
  }
}

export async function getTrainingKitStatusAt(root: string): Promise<TrainingKitStatus> {
  const dataset = path.join(root, "dataset", "10_cyrene");
  const starterImageCount = await countImages(dataset);
  const required = ["cyrene_lora_kaggle.ipynb", "README.md", "training-config.txt"];
  const checks = await Promise.all(required.map(async (name) => {
    try { await fs.access(path.join(root, name)); return true; } catch { return false; }
  }));
  return { kitPath: root, kitReady: starterImageCount >= 10 && checks.every(Boolean), starterImageCount };
}

export async function getTrainingKitStatus(): Promise<TrainingKitStatus> {
  return getTrainingKitStatusAt(kitRoot());
}

function notebook(): Record<string, unknown> {
  const code = (source: string) => ({
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: source.replace(/\n\+/g, "\n").split("\n").map((line) => `${line}\n`),
  });
  const markdown = (source: string) => ({ cell_type: "markdown", metadata: {}, source: source.split("\n").map((line) => `${line}\n`) });
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python", version: "3.10" } },
    cells: [
      markdown("# 昔漣角色 LoRA v2 · Kaggle 免費 P100 訓練\n底模：`cagliostrolab/animagine-xl-4.0`（SDXL / fp16）。v2 使用平衡的臉部、正側背與全身官方素材；請先在 Notebook Settings 開啟 GPU，確認顯示 Tesla P100。"),
      code("!nvidia-smi\nimport torch\nassert torch.cuda.is_available(), '請在 Kaggle Notebook Settings 開啟 GPU'\nprint(torch.cuda.get_device_name(0))"),
      markdown("## 1. 找到上傳的資料集\n先把本訓練包的 `dataset` 資料夾建立成私人 Kaggle Dataset，再 Attach 到 Notebook。若自動找到多個資料夾，請手動修改 `DATASET_DIR`。"),
      code("from pathlib import Path\ncandidates = list(Path('/kaggle/input').glob('**/10_cyrene_v2')) or list(Path('/kaggle/input').glob('**/10_cyrene'))\nassert candidates, '找不到 10_cyrene_v2；請 Attach v2 私人 Dataset'\nDATASET_DIR = str(candidates[0].parent)\nprint('Training data:', DATASET_DIR)\nprint('Images:', len(list(candidates[0].glob('*.jpg'))))"),
      markdown("## 2. 安裝訓練工具\n這一步需要 Kaggle Internet 開啟，通常約 5–10 分鐘。"),
      code("%cd /kaggle/working\n!git clone --depth 1 https://github.com/kohya-ss/sd-scripts.git\n%cd /kaggle/working/sd-scripts\n!pip install -q -r requirements.txt\n!pip install -q bitsandbytes==0.45.5"),
      markdown("## 3. 訓練\nP100 16GB 採 fp16、batch 1、gradient checkpointing。v2 會輸出 400/800/1200/1600 steps 四個檢查點；不要盲目只用最後一個，先比較臉與換裝測試。"),
      code("import os\nos.makedirs('/kaggle/working/output', exist_ok=True)\n!accelerate launch --num_cpu_threads_per_process=2 sdxl_train_network.py \\\n+  --pretrained_model_name_or_path='cagliostrolab/animagine-xl-4.0' \\\n+  --train_data_dir=\"{DATASET_DIR}\" \\\n+  --output_dir='/kaggle/working/output' \\\n+  --output_name='cyrene_hsr_animagine_xl4_v2' \\\n+  --caption_extension='.txt' --shuffle_caption --keep_tokens=2 --caption_dropout_rate=0.05 \\\n+  --resolution='1024,1024' --enable_bucket --min_bucket_reso=512 --max_bucket_reso=1536 \\\n+  --network_module=networks.lora --network_dim=64 --network_alpha=32 \\\n+  --train_batch_size=1 --gradient_accumulation_steps=4 --max_train_steps=1600 \\\n+  --learning_rate=7e-5 --unet_lr=7e-5 --text_encoder_lr=5e-6 \\\n+  --lr_scheduler='cosine_with_restarts' --lr_warmup_steps=100 \\\n+  --optimizer_type='AdamW8bit' --mixed_precision='fp16' --save_precision='fp16' \\\n+  --cache_latents --cache_latents_to_disk --gradient_checkpointing \\\n+  --min_snr_gamma=5 --noise_offset=0.03 \\\n+  --save_model_as='safetensors' --save_every_n_steps=400 \\\n+  --seed=42".replace(/\\n\+/g, "\\n")),
      markdown("## 4. 下載 `.safetensors`\n左側 Files → `working/output` → 最新的 `.safetensors` → Download。回到昔漣創作工作臺的 LoRA 頁按「匯入」。"),
      code("from pathlib import Path\nfiles = sorted(Path('/kaggle/working/output').glob('*.safetensors'))\nfor f in files: print(f, f.stat().st_size / 1024 / 1024, 'MB')"),
    ],
  };
}

function readme(): string {
  return `# 昔漣角色 LoRA 免費訓練包

僅供個人、非商業用途。v2 來源為官方 PV、官方角色立繪與遊戲素材；請勿散布原始資料集或將成品用於冒充官方素材。

## 操作順序

1. 登入 Kaggle，建立 Private Dataset，上傳整個 \`dataset-v2\` 資料夾。
2. 新建 Notebook，Attach 該 Dataset，將 Accelerator 設為 GPU P100 並開啟 Internet。
3. 上傳並開啟 \`cyrene_lora_kaggle.ipynb\`，由上到下執行。
4. 比較 400/800/1200/1600 steps 的測試圖，下載臉最像且換裝最穩定的 \`cyrene_hsr_animagine_xl4_v2*.safetensors\`。
5. 回到昔漣創作工作臺 → LoRA → 匯入。

訓練底模為 \`cagliostrolab/animagine-xl-4.0\`。Notebook 會在 Kaggle 執行下載與訓練，本機不需要 NVIDIA GPU，也不會假裝已完成遠端訓練；Kaggle 登入、手機驗證與 GPU 配額由你本人處理。v2 特別平衡臉部、正側背、全身與替換服裝，降低舊版把角色與原服裝綁死的問題。
`;
}

export async function prepareTrainingKitAt(root: string, framesSourceRoot: string): Promise<TrainingKitStatus> {
  const dataset = path.join(root, "dataset", "10_cyrene");
  await fs.mkdir(dataset, { recursive: true });
  for (const frame of SELECTED_FRAMES) {
    const filename = `frame-${String(frame).padStart(3, "0")}`;
    const source = path.join(framesSourceRoot, `${filename}.jpg`);
    const destination = path.join(dataset, `${filename}.jpg`);
    try {
      await fs.access(source);
    } catch {
      throw new Error(`找不到官方候選影格：${source}`);
    }
    await fs.copyFile(source, destination);
    const caption = `${TRIGGER}, 1girl, solo, Cyrene from Honkai Star Rail, pastel pink hair, violet diamond-shaped pupils, pointed ears, blue rose hair ornament, white laurel ornament, ${CAPTION_DETAILS[frame]}`;
    await fs.writeFile(path.join(dataset, `${filename}.txt`), `${caption}\n`, "utf8");
  }
  await fs.writeFile(path.join(root, "cyrene_lora_kaggle.ipynb"), `${JSON.stringify(notebook(), null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(root, "README.md"), readme(), "utf8");
  await fs.writeFile(path.join(root, "training-config.txt"), [
    "base_model=cagliostrolab/animagine-xl-4.0",
    "architecture=SDXL LoRA",
    "trigger_word=cyrene_hsr",
    "network_dim=64",
    "network_alpha=32",
    "max_train_steps=1600",
    "mixed_precision=fp16",
    "recommended_strength=0.55-0.8",
  ].join("\n") + "\n", "utf8");
  return getTrainingKitStatusAt(root);
}

export async function prepareTrainingKit(): Promise<TrainingKitStatus> {
  return prepareTrainingKitAt(kitRoot(), sourceRoot());
}
