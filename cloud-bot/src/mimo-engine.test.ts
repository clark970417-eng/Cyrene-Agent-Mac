import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { synthesize } from "./mimo-engine.js";

test("可要求 MiMo 回傳 xiaogpt/tetos 能解析的 MP3", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cyrene-mimo-test-"));
  const voiceAudioPath = path.join(directory, "sample.wav");
  await writeFile(voiceAudioPath, Buffer.from("voice sample"));
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { audio: { data: Buffer.from("mp3 bytes").toString("base64") } } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await synthesize({
      apiKey: "test-key",
      text: "早安",
      voiceAudioPath,
      outputFormat: "mp3",
    });
    assert.equal((requestBody?.audio as { format?: string }).format, "mp3");
    assert.equal(result.format, "mp3");
    assert.deepEqual(result.audio, Buffer.from("mp3 bytes"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
