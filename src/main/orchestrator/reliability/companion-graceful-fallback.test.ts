import { describe, it, expect } from "vitest";
import { CompanionGracefulFallback } from "./companion-graceful-fallback";

describe("CompanionGracefulFallback", () => {
  const fallback = new CompanionGracefulFallback();

  it("handles timeout gracefully with worried character response", () => {
    const err = new Error("Request timed out after 30000ms (ETIMEDOUT)");
    const res = fallback.generateFallback(err);

    expect(res.reason).toBe("timeout");
    expect(res.isDegraded).toBe(true);
    expect(res.expression).toBe("worried");
    expect(res.spokenText).toContain("網路連線好像稍微花了一點時間呢");
  });

  it("handles rate limit (429) with gentle cooldown explanation", () => {
    const err = new Error("Rate limit exceeded 429: Too Many Requests");
    const res = fallback.generateFallback(err);

    expect(res.reason).toBe("rate_limit");
    expect(res.expression).toBe("gentle_smile");
    expect(res.spokenText).toContain("思考核心稍微需要喘口氣");
  });

  it("handles TTS failure by switching to text-friendly message", () => {
    const err = new Error("MiniMax TTS synthesis failed: audio stream truncated");
    const res = fallback.generateFallback(err);

    expect(res.reason).toBe("tts_failure");
    expect(res.spokenText).toContain("文字這邊一直都很通暢喔");
  });

  it("handles network disconnection with warm companionship tone", () => {
    const err = new Error("fetch failed: ECONNREFUSED");
    const res = fallback.generateFallback(err);

    expect(res.reason).toBe("network_error");
    expect(res.spokenText).toContain("我會一直守在這裡等你的");
  });
});
