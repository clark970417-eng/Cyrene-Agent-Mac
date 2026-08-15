import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { voiceSamplePath } from "./xiaoai-voice.js";

test("聲音樣本路徑落在 DATA_DIR 底下，不是 repo 內建路徑", () => {
  assert.equal(voiceSamplePath({ dataDir: "/data" }), path.join("/data", "voice-sample.wav"));
});
