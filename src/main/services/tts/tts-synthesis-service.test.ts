import { describe, expect, it } from "vitest";
import { resolveChannelTtsFormat } from "./tts-synthesis-service";

describe("channel TTS output format", () => {
  it("uses the configured GPT-SoVITS WAV format for Discord", () => {
    expect(resolveChannelTtsFormat("gptsovits", "wav", "discord")).toBe("wav");
  });

  it("keeps MP3 for Discord cloud engines", () => {
    expect(resolveChannelTtsFormat("minimax", "wav", "discord")).toBe("mp3");
  });

  it("always uses WAV for WeChat encoding", () => {
    expect(resolveChannelTtsFormat("minimax", "mp3", "wechat")).toBe("wav");
  });
});
