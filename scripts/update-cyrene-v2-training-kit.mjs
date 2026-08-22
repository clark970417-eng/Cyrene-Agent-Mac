import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.argv[2] || path.join(os.homedir(), "Documents", "Cyrene Studio", "LoRA Training");
const notebookPath = path.join(root, "cyrene_lora_kaggle.ipynb");

const asLines = (value) => value.split("\n").map((line) => `${line}\n`);
const sourceText = (cell) => Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "");

const notebook = JSON.parse(await fs.readFile(notebookPath, "utf8"));
for (const cell of notebook.cells || []) {
  const text = sourceText(cell);
  if (text.includes("昔漣角色 LoRA") && text.includes("Kaggle 免費 P100")) {
    cell.source = asLines(
      "# 昔漣角色 LoRA v2 · Kaggle 免費 P100 訓練\n" +
      "底模：`cagliostrolab/animagine-xl-4.0`（SDXL / fp16）。v2 使用平衡的臉部、正側背、全身與替換服裝官方素材。",
    );
  } else if (text.includes("candidates = list(Path('/kaggle/input')")) {
    cell.source = asLines(
      "from pathlib import Path\n" +
      "candidates = list(Path('/kaggle/input').glob('**/10_cyrene_v2'))\n" +
      "assert candidates, '找不到 10_cyrene_v2；請 Attach v2 私人 Dataset'\n" +
      "DATASET_DIR = str(candidates[0].parent)\n" +
      "print('Training data:', DATASET_DIR)\n" +
      "print('Images:', len(list(candidates[0].glob('*.jpg'))))",
    );
  } else if (text.includes("P100 16GB") && text.includes("gradient checkpointing")) {
    cell.source = asLines(
      "## 3. 訓練\nP100 16GB 採 fp16、batch 1、gradient checkpointing。" +
      "v2 會保留 400/800/1200/1600 steps 四個檢查點；先比較臉、眼睛和換裝，不要盲目只用最後一個。",
    );
  } else if (text.includes("accelerate launch") && text.includes("sdxl_train_network.py")) {
    cell.source = asLines(
      "import os\n" +
      "os.makedirs('/kaggle/working/output', exist_ok=True)\n" +
      "!accelerate launch --num_cpu_threads_per_process=2 sdxl_train_network.py \\\n" +
      "  --pretrained_model_name_or_path='cagliostrolab/animagine-xl-4.0' \\\n" +
      "  --train_data_dir=\"{DATASET_DIR}\" \\\n" +
      "  --output_dir='/kaggle/working/output' \\\n" +
      "  --output_name='cyrene_hsr_animagine_xl4_v2' \\\n" +
      "  --caption_extension='.txt' --shuffle_caption --keep_tokens=2 --caption_dropout_rate=0.05 \\\n" +
      "  --resolution='1024,1024' --enable_bucket --min_bucket_reso=512 --max_bucket_reso=1536 \\\n" +
      "  --network_module=networks.lora --network_dim=64 --network_alpha=32 \\\n" +
      "  --train_batch_size=1 --gradient_accumulation_steps=4 --max_train_steps=1600 \\\n" +
      "  --learning_rate=7e-5 --unet_lr=7e-5 --text_encoder_lr=5e-6 \\\n" +
      "  --lr_scheduler='cosine_with_restarts' --lr_warmup_steps=100 \\\n" +
      "  --optimizer_type='AdamW8bit' --mixed_precision='fp16' --save_precision='fp16' \\\n" +
      "  --cache_latents --cache_latents_to_disk --gradient_checkpointing \\\n" +
      "  --min_snr_gamma=5 --noise_offset=0.03 \\\n" +
      "  --save_model_as='safetensors' --save_every_n_steps=400 \\\n" +
      "  --seed=42",
    );
  } else if (text.includes("下載 `.safetensors`")) {
    cell.source = asLines(
      "## 4. 比較並下載 `.safetensors`\n" +
      "先用相同 seed 比較 400/800/1200/1600 steps；下載臉最像、眼睛正常且換裝最穩定的版本，再回昔漣寫真室匯入。",
    );
  }
}
await fs.writeFile(notebookPath, `${JSON.stringify(notebook, null, 2)}\n`, "utf8");

await fs.writeFile(path.join(root, "training-config.txt"), [
  "base_model=cagliostrolab/animagine-xl-4.0",
  "architecture=SDXL LoRA",
  "dataset=dataset-v2/10_cyrene_v2",
  "image_count=21",
  "trigger_word=cyrene_hsr",
  "network_dim=64",
  "network_alpha=32",
  "max_train_steps=1600",
  "checkpoints=400,800,1200,1600",
  "mixed_precision=fp16",
  "recommended_strength=0.55-0.8",
].join("\n") + "\n", "utf8");

await fs.writeFile(path.join(root, "README.md"), `# 昔漣角色 LoRA v2 免費訓練包

僅供個人、非商業用途。v2 使用官方 PV、官方角色立繪與遊戲素材；請勿散布原始資料集或將成品冒充官方素材。

## v2 改善

- 21 張平衡素材：臉部、正面、側面、背面、半身、全身與替換服裝。
- 排除幼年／NPC 三視圖、Q 版圖、重複宣傳排版與大面積文字。
- 強化紫粉漸層虹膜、白色菱形瞳孔、粉髮藍綠漸層髮尾與成年髮飾。
- 四個訓練檢查點，避免最後一步過度擬合原服裝。

## Kaggle 操作

1. 將 \`dataset-v2\` 建成新的 Private Kaggle Dataset。
2. 在 Notebook Attach 新的 v2 Dataset，GPU 選 P100，Internet 開啟。
3. 使用更新後的 \`cyrene_lora_kaggle.ipynb\` 由上到下執行。
4. 比較 400/800/1200/1600 steps 的固定 seed 測試圖。
5. 下載最好的 \`cyrene_hsr_animagine_xl4_v2*.safetensors\`，匯入昔漣寫真室。

底模為 \`cagliostrolab/animagine-xl-4.0\`。真正訓練在 Kaggle GPU 執行；登入、手機驗證與免費 GPU 配額仍由本人操作。
`, "utf8");

console.log(`Updated v2 Kaggle kit: ${root}`);
