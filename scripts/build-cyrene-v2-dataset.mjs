import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const root = process.argv[2] || path.join(os.homedir(), "Documents", "Cyrene Studio", "LoRA Training");
const v1 = path.join(root, "dataset", "10_cyrene");
const sources = path.join(root, "v2-candidates", "official-source");
const output = path.join(root, "dataset-v2", "10_cyrene_v2");

const identity =
  "cyrene_hsr, 1girl, solo, Cyrene from Honkai Star Rail, adult woman, " +
  "very long flowing pastel pink hair with aqua blue gradient tips, vivid violet-pink gradient eyes, " +
  "bright white diamond-shaped pupils, pointed elf ears";

const pv = {
  "frame-014": "face close-up, looking at viewer, gentle smile, official 3d game cutscene",
  "frame-018": "upper body, three-quarter view, reaching outward, signature white lavender dress, garden",
  "frame-021": "back view, long gradient hair, flowing hair, signature white lavender dress",
  "frame-033": "face close-up, three-quarter view, open eyes, dark starry background",
  "frame-036": "medium shot, front view, signature white lavender dress, crystal wing, cool lighting",
  "frame-037": "medium shot, front view, signature white lavender dress, warm lighting",
  "frame-061": "face close-up, three-quarter view, clearly visible diamond pupils, pink dramatic lighting",
  "frame-066": "upper body, side view, holding a crystal, long gradient hair",
  "frame-088": "profile view, eyes closed, hand near face, blue rose ornament, starry background",
  "frame-089": "back three-quarter view, braided long gradient hair, translucent veil, starry background",
};

const generated = [
  {
    name: "official-portrait-full",
    source: "cyrene-portrait.png",
    fit: "contain",
    caption: "full body, front view, signature pearl-white and lavender dress, blue rose hair ornament, white laurel ornament, iridescent fabric, official game render",
  },
  {
    name: "official-illustration-full",
    source: "cyrene-full-art.jpg",
    fit: "contain",
    caption: "full body, dynamic standing pose, signature pearl-white and lavender dress, blue rose hair ornament, white laurel ornament, official 2d character illustration",
  },
  {
    name: "official-game-face",
    source: "cyrene-game-face.png",
    crop: { left: 400, top: 0, width: 1152, height: 1152 },
    caption: "extreme face close-up, looking at viewer, symmetrical eyes, vivid violet-pink irises, bright white diamond-shaped pupils, official 3d game cutscene",
  },
  {
    name: "official-splash-face",
    source: "cyrene-full-art.jpg",
    crop: { left: 330, top: 0, width: 540, height: 540 },
    caption: "face and shoulders, gentle smile, vivid violet-pink eyes, diamond-shaped pupils, blue rose hair ornament, white laurel ornament, official 2d character illustration",
  },
  {
    name: "official-preview-upper",
    source: "01-hoyolab-character-preview.jpg",
    crop: { left: 900, top: 0, width: 1020, height: 1080 },
    caption: "upper body, looking at viewer, smiling, signature pearl-white and lavender dress, blue rose hair ornament, white laurel ornament, official 2d character illustration",
  },
  {
    name: "official-quest-side",
    source: "07-official-quest-art.webp",
    fit: "contain",
    caption: "side view, seated pose, reading a memory, long pink-to-blue gradient hair, signature white lavender dress, official 2d game illustration",
  },
  {
    name: "official-modern-outfit",
    source: "cyrene-modern-outfit.jpg",
    crop: { left: 150, top: 150, width: 3100, height: 3600 },
    caption: "three-quarter body, casual alternate outfit, white iridescent jacket, black short skirt, twin braids, looking at viewer, official modern anime illustration",
  },
  {
    name: "official-modern-face",
    source: "cyrene-modern-outfit.jpg",
    crop: { left: 650, top: 250, width: 1900, height: 1900 },
    caption: "face close-up, casual alternate hairstyle, looking at viewer, vivid violet-pink eyes, bright diamond-shaped pupils, official modern anime illustration",
  },
  {
    name: "model-front",
    source: "08-character-model-sheet.jpg",
    crop: { left: 105, top: 65, width: 190, height: 360 },
    caption: "full body model sheet, front view, neutral pose, signature pearl-white and lavender dress, long pink-to-blue gradient hair",
  },
  {
    name: "model-side",
    source: "08-character-model-sheet.jpg",
    crop: { left: 315, top: 65, width: 190, height: 360 },
    caption: "full body model sheet, side view, neutral pose, signature pearl-white and lavender dress, long pink-to-blue gradient hair",
  },
  {
    name: "model-back",
    source: "08-character-model-sheet.jpg",
    crop: { left: 505, top: 65, width: 190, height: 360 },
    caption: "full body model sheet, back view, neutral pose, signature pearl-white and lavender dress, long pink-to-blue gradient hair",
  },
];

async function assertReadable(file) {
  try {
    await fs.access(file);
  } catch {
    throw new Error(`Missing v2 source: ${file}`);
  }
}

async function writeCaption(name, details) {
  await fs.writeFile(path.join(output, `${name}.txt`), `${identity}, ${details}\n`, "utf8");
}

async function build() {
  await fs.mkdir(output, { recursive: true });

  for (const [name, details] of Object.entries(pv)) {
    const source = path.join(v1, `${name}.jpg`);
    await assertReadable(source);
    await fs.copyFile(source, path.join(output, `${name}.jpg`));
    await writeCaption(name, details);
  }

  for (const item of generated) {
    const source = path.join(sources, item.source);
    await assertReadable(source);
    let pipeline = sharp(source, { failOn: "none" }).rotate();
    if (item.crop) pipeline = pipeline.extract(item.crop);
    pipeline = pipeline.flatten({ background: "#f7f2fb" }).resize(1024, 1024, {
      fit: item.fit || "cover",
      position: "centre",
      withoutEnlargement: false,
    });
    await pipeline.jpeg({ quality: 96, chromaSubsampling: "4:4:4" }).toFile(path.join(output, `${item.name}.jpg`));
    await writeCaption(item.name, item.caption);
  }

  const manifest = {
    version: 2,
    purpose: "Personal, non-commercial Cyrene character LoRA training",
    trigger: "cyrene_hsr",
    imageCount: Object.keys(pv).length + generated.length,
    balance: {
      pvFrames: Object.keys(pv).length,
      officialStaticReferences: generated.length,
      excluded: [
        "child/NPC Cyrene 10000x4000 model sheet (different identity and costume)",
        "chibi promotional art",
        "duplicate promotional layouts containing large text/logos",
      ],
    },
  };
  await fs.writeFile(path.join(root, "dataset-v2-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Cyrene v2 dataset ready: ${output}`);
  console.log(`Images: ${manifest.imageCount}`);
}

await build();
