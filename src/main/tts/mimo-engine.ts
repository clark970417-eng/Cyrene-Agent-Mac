// 小米 MiMo TTS 引擎
// 官方接口：POST /v1/chat/completions，返回 choices[0].message.audio.data base64。

import * as fs from "fs";
import * as path from "path";

export interface MimoSynthesizeOptions {
  apiKey: string;
  text: string;
  voiceAudioPath?: string;
  stylePrompt?: string;
  model?: "mimo-v2.5-tts-voiceclone";
  endpointUrl?: string;
  debugLog?: (entry: Record<string, unknown>) => void;
}

export interface MimoSynthesizeResult {
  audio: Buffer;
  format: "wav";
}

const DEFAULT_ENDPOINT_URL = "https://api.xiaomimimo.com/v1/chat/completions";
const DEFAULT_MODEL: MimoSynthesizeOptions["model"] = "mimo-v2.5-tts-voiceclone";

function guessAudioMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a" || ext === ".mp4") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  return "audio/mpeg";
}

/** 克隆音频要随每次合成一起上传。通话把一轮回覆切成好几段、每段各发一次请求，
 * 于是同一个几百 KB 的档案在一轮里被重读、重编码好几遍——纯粹是主行程的白工。
 * 用 size + mtime 当版本键快取，换了音色档会自动失效。 */
const voiceDataUrlCache = new Map<string, { version: string; dataUrl: string }>();

function buildVoiceDataUrl(filePath: string): string {
  const stat = fs.statSync(filePath);
  const version = `${stat.size}:${stat.mtimeMs}`;
  const cached = voiceDataUrlCache.get(filePath);
  if (cached?.version === version) return cached.dataUrl;

  const audio = fs.readFileSync(filePath);
  if (audio.length === 0) {
    throw new Error("MiMo 克隆音频为空");
  }
  const dataUrl = `data:${guessAudioMime(filePath)};base64,${audio.toString("base64")}`;
  voiceDataUrlCache.set(filePath, { version, dataUrl });
  return dataUrl;
}

export async function synthesize(opts: MimoSynthesizeOptions): Promise<MimoSynthesizeResult> {
  const apiKey = opts.apiKey?.trim();
  const text = opts.text?.trim();
  const endpointUrl = opts.endpointUrl?.trim() || DEFAULT_ENDPOINT_URL;
  const voiceAudioPath = opts.voiceAudioPath?.trim();
  const stylePrompt = opts.stylePrompt?.trim();
  const requestId = `mimo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const log = (entry: Record<string, unknown>) => {
    try { opts.debugLog?.({ requestId, ts: new Date().toISOString(), ...entry }); } catch { /* ignore */ }
  };

  if (!apiKey) throw new Error("缺少 MiMo API Key");
  if (!text) throw new Error("缺少合成文本");
  if (!voiceAudioPath) throw new Error("缺少 MiMo 克隆音频");

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (stylePrompt) messages.push({ role: "user", content: stylePrompt });
  messages.push({ role: "assistant", content: text });
  const voice = buildVoiceDataUrl(voiceAudioPath);

  log({
    phase: "request.begin",
    endpoint: endpointUrl,
    model: opts.model ?? DEFAULT_MODEL,
    voiceAudioPath,
    textChars: Array.from(text).length,
    hasStylePrompt: Boolean(stylePrompt),
  });

  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        messages,
        audio: {
          format: "wav",
          voice,
        },
      }),
    });
  } catch (err) {
    log({ phase: "error", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startedAt });
    throw new Error(`MiMo TTS 请求失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const preview = (await response.text().catch(() => "")).slice(0, 200);
    log({ phase: "error", status: response.status, bodyPreview: preview, durationMs: Date.now() - startedAt });
    throw new Error(`MiMo TTS 合成失败: ${response.status} ${preview}`.trim());
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        audio?: {
          data?: unknown;
        };
      };
    }>;
  };
  const base64 = data.choices?.[0]?.message?.audio?.data;
  if (typeof base64 !== "string" || !base64.trim()) {
    throw new Error("MiMo TTS 响应缺少音频数据");
  }

  const audio = Buffer.from(base64, "base64");
  if (audio.length === 0) {
    throw new Error("MiMo TTS 返回空音频");
  }

  log({
    phase: "response.final",
    durationMs: Date.now() - startedAt,
    audioBytes: audio.length,
    format: "wav",
  });

  return { audio, format: "wav" };
}
