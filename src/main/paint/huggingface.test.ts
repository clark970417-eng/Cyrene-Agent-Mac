import { describe, expect, it, vi } from "vitest";
import { generateWithHuggingFace, getHuggingFaceStatus } from "./huggingface";

describe("Hugging Face ZeroGPU client", () => {
  it("queues a Gradio job, waits for completion, and downloads the image", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/gradio_api/call/generate")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer hf_private" });
        expect(JSON.parse(String(init?.body))).toEqual({
          data: ["cyrene portrait", "3:4", 24, 0.85, -1],
        });
        return new Response(JSON.stringify({ event_id: "event-123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/gradio_api/call/generate/event-123")) {
        return new Response(
          'event: complete\ndata: [{"url":"/gradio_api/file=portrait.png","mime_type":"image/png"}]\n\n',
          { status: 200 },
        );
      }
      expect(url).toBe(
        "https://yuying417-cyrene-lora-studio.hf.space/gradio_api/file=portrait.png",
      );
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;

    const result = await generateWithHuggingFace(
      {
        spaceUrl: "https://yuying417-cyrene-lora-studio.hf.space/",
        token: "hf_private",
        prompt: "cyrene portrait",
        aspectRatio: "3:4",
        quality: "low",
        loraStrength: 0.85,
      },
      fetcher,
    );

    expect([...result.bytes]).toEqual([137, 80, 78, 71]);
    expect(result.mimeType).toBe("image/png");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects non-Hugging Face Space URLs before making a request", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(
      generateWithHuggingFace(
        {
          spaceUrl: "https://example.com/not-a-space",
          prompt: "test",
          aspectRatio: "1:1",
          quality: "low",
        },
        fetcher,
      ),
    ).rejects.toThrow("Space URL 格式不正確");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports an authenticated private Space as connected", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer hf_read" });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      getHuggingFaceStatus("https://yuying417-cyrene-lora-studio.hf.space", "hf_read", fetcher),
    ).resolves.toMatchObject({ configured: true, connected: true });
  });
});
