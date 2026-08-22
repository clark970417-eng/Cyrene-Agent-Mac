import { app, safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface PaintLocalConfig {
  comfyRoot?: string;
  imageBackend?: "huggingface" | "comfyui";
  huggingFaceSpaceUrl?: string;
  huggingFaceToken?: string;
}

interface PaintLocalConfigOnDisk extends Omit<PaintLocalConfig, "huggingFaceToken"> {
  huggingFaceToken?: string;
  huggingFaceTokenEncrypted?: string;
}

function localConfigPath(): string {
  return path.join(app.getPath("userData"), "paint-local.json");
}

export async function loadPaintLocalConfig(): Promise<PaintLocalConfig> {
  try {
    const stored = JSON.parse(await fs.readFile(localConfigPath(), "utf8")) as PaintLocalConfigOnDisk;
    let token = stored.huggingFaceToken;
    if (stored.huggingFaceTokenEncrypted && safeStorage.isEncryptionAvailable()) {
      try {
        token = safeStorage.decryptString(Buffer.from(stored.huggingFaceTokenEncrypted, "base64"));
      } catch {
        token = undefined;
      }
    }
    if (stored.huggingFaceToken && !stored.huggingFaceTokenEncrypted && safeStorage.isEncryptionAvailable()) {
      try {
        const migrated: PaintLocalConfigOnDisk = {
          ...stored,
          huggingFaceToken: undefined,
          huggingFaceTokenEncrypted: safeStorage.encryptString(stored.huggingFaceToken).toString("base64"),
        };
        await fs.writeFile(localConfigPath(), `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
      } catch {
        // Keep the legacy value readable if macOS encryption is temporarily unavailable.
      }
    }
    return {
      comfyRoot: stored.comfyRoot,
      imageBackend: stored.imageBackend,
      huggingFaceSpaceUrl: stored.huggingFaceSpaceUrl,
      huggingFaceToken: token,
    };
  } catch {
    return {};
  }
}

export async function savePaintLocalConfig(config: PaintLocalConfig): Promise<void> {
  const filePath = localConfigPath();
  let previous: PaintLocalConfigOnDisk = {};
  try {
    previous = JSON.parse(await fs.readFile(filePath, "utf8")) as PaintLocalConfigOnDisk;
  } catch {
    // The file is created on first save.
  }
  const token = config.huggingFaceToken?.trim();
  const stored: PaintLocalConfigOnDisk = {
    comfyRoot: config.comfyRoot,
    imageBackend: config.imageBackend,
    huggingFaceSpaceUrl: config.huggingFaceSpaceUrl,
  };
  if (token) {
    if (safeStorage.isEncryptionAvailable()) {
      stored.huggingFaceTokenEncrypted = safeStorage.encryptString(token).toString("base64");
    } else {
      stored.huggingFaceToken = token;
    }
  } else if (previous.huggingFaceTokenEncrypted) {
    stored.huggingFaceTokenEncrypted = previous.huggingFaceTokenEncrypted;
  } else if (previous.huggingFaceToken) {
    stored.huggingFaceToken = previous.huggingFaceToken;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
}
