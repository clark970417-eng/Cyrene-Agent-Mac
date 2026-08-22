import { describe, expect, it } from "vitest";
import { accompanimentAlignment } from "./singing-service";

function patternedPcm(seconds: number): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate * seconds;
  const output = Buffer.alloc(samples * 2);
  const hop = sampleRate * 0.02;
  for (let i = 0; i < samples; i += 1) {
    const frame = Math.floor(i / hop);
    const amplitude = 0.08 + ((frame * 73 + frame * frame * 17) % 700) / 1000;
    const sample = Math.round(Math.sin(i * 0.31) * amplitude * 32767);
    output.writeInt16LE(sample, i * 2);
  }
  return output;
}

describe("accompanimentAlignment", () => {
  it("找出 Bilibili 音軌前面多出的編碼空白", () => {
    const reference = patternedPcm(12);
    const leadingMs = 420;
    const candidate = Buffer.concat([Buffer.alloc(8_000 * 2 * leadingMs / 1000), reference]);
    const result = accompanimentAlignment(reference, candidate);
    expect(result.offsetMs).toBe(leadingMs);
    expect(result.confidence).toBeGreaterThan(0.95);
  });
});
