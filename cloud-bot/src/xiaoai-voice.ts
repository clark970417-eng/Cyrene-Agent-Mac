// 小愛音箱（xiaogpt tts:openai）語音入口 —— 對外偽裝成標準 OpenAI /v1/audio/speech，
// 內部用 MiMo 聲音克隆合成，讓音箱念出來的是昔漣本人的聲音而不是內建語音。
// 另外提供一個一次性上傳端點，把克隆參考音檔存進 Render 的持久化磁碟（DATA_DIR），
// 刻意不放進 git repo —— 那等於把使用者的聲紋樣本永久留在版本控制歷史裡。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HttpRoute } from "./health.js";
import { readRequestBody } from "./health.js";
import { isAuthorizedDevice } from "./xiaoai-auth.js";
import type { CloudBotConfig } from "./config.js";
import { synthesize as mimoSynthesize } from "./mimo-engine.js";

const MAX_VOICE_SAMPLE_BYTES = 20 * 1024 * 1024;

export function voiceSamplePath(config: Pick<CloudBotConfig, "dataDir">): string {
  return path.join(config.dataDir, "voice-sample.wav");
}

type OpenAiSpeechRequest = { input?: unknown };

export function createXiaoAiSpeechRoute(deps: { config: CloudBotConfig }): HttpRoute {
  return {
    method: "POST",
    path: "/v1/audio/speech",
    async handle(request, response) {
      if (!isAuthorizedDevice(request, deps.config.xiaoaiDeviceToken)) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "unauthorized" } }));
        return;
      }
      if (!deps.config.mimoApiKey) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "mimo_not_configured" } }));
        return;
      }

      let body: OpenAiSpeechRequest;
      try {
        body = JSON.parse((await readRequestBody(request)).toString("utf8")) as OpenAiSpeechRequest;
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid_json" } }));
        return;
      }
      const text = typeof body.input === "string" ? body.input.trim() : "";
      if (!text) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "missing_input" } }));
        return;
      }

      try {
        const result = await mimoSynthesize({
          apiKey: deps.config.mimoApiKey,
          text,
          voiceAudioPath: voiceSamplePath(deps.config),
          // xiaogpt 3.23/tetos writes the response to a .mp3 file and then
          // unconditionally parses it as MP3 to calculate playback duration.
          outputFormat: "mp3",
        });
        response.writeHead(200, { "Content-Type": "audio/mpeg" });
        response.end(result.audio);
      } catch (error) {
        console.error("[XiaoAI] MiMo 合成失敗", error);
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "synthesis_failed" } }));
      }
    },
  };
}

export function createVoiceSampleUploadRoute(deps: { config: CloudBotConfig }): HttpRoute {
  return {
    method: "PUT",
    path: "/admin/voice-sample",
    async handle(request, response) {
      if (!isAuthorizedDevice(request, deps.config.xiaoaiDeviceToken)) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "unauthorized" } }));
        return;
      }
      let audio: Buffer;
      try {
        audio = await readRequestBody(request, MAX_VOICE_SAMPLE_BYTES);
      } catch (error) {
        response.writeHead(413, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "upload_failed" } }));
        return;
      }
      if (audio.length === 0) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "empty_body" } }));
        return;
      }
      const target = voiceSamplePath(deps.config);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, audio, { mode: 0o600 });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, bytes: audio.length }));
    },
  };
}
