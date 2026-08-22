export interface HuggingFaceGenerateOptions {
  spaceUrl: string;
  token?: string;
  prompt: string;
  aspectRatio: string;
  quality: "auto" | "low" | "medium" | "high";
  loraStrength?: number;
}

interface GradioFileData {
  url?: string;
  path?: string;
  mime_type?: string;
}

function normalizeSpaceUrl(value: string): string {
  const url = value.trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.hf\.space$/i.test(url)) {
    throw new Error("Hugging Face Space URL 格式不正確，應為 https://帳號-Space.hf.space");
  }
  return url;
}

function headers(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
}

function parseCompleteEvent(body: string): unknown[] {
  const blocks = body.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.some((line) => line.trim() === "event: error")) {
      const detail = lines
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      throw new Error(`Hugging Face ZeroGPU 生成失敗${detail ? `：${detail}` : ""}`);
    }
    if (!lines.some((line) => line.trim() === "event: complete")) continue;
    const data = lines
      .find((line) => line.startsWith("data:"))
      ?.slice(5)
      .trim();
    if (!data) break;
    const parsed = JSON.parse(data) as unknown;
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error("Hugging Face ZeroGPU 沒有回傳完成結果。");
}

export async function generateWithHuggingFace(
  options: HuggingFaceGenerateOptions,
  fetcher: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const baseUrl = normalizeSpaceUrl(options.spaceUrl);
  const steps = options.quality === "low" ? 24 : options.quality === "high" ? 32 : 28;
  const authHeaders = headers(options.token);
  const queued = await fetcher(`${baseUrl}/gradio_api/call/generate`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      data: [options.prompt, options.aspectRatio, steps, options.loraStrength ?? 0.8, -1],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!queued.ok) {
    throw new Error(`Hugging Face ZeroGPU 無法接受任務：HTTP ${queued.status}`);
  }
  const eventId = String(((await queued.json()) as { event_id?: string }).event_id || "");
  if (!eventId) throw new Error("Hugging Face ZeroGPU 沒有回傳任務編號。");

  const resultResponse = await fetcher(
    `${baseUrl}/gradio_api/call/generate/${encodeURIComponent(eventId)}`,
    {
      headers: authHeaders,
      signal: AbortSignal.timeout(10 * 60_000),
    },
  );
  if (!resultResponse.ok) {
    throw new Error(`Hugging Face ZeroGPU 任務查詢失敗：HTTP ${resultResponse.status}`);
  }
  const result = parseCompleteEvent(await resultResponse.text());
  const file = result[0] as GradioFileData | undefined;
  const imageUrl = typeof file?.url === "string" ? file.url : "";
  if (!imageUrl) throw new Error("Hugging Face ZeroGPU 回應中沒有圖片網址。");
  const downloaded = await fetcher(new URL(imageUrl, baseUrl), {
    headers: options.token?.trim() ? { Authorization: `Bearer ${options.token.trim()}` } : {},
    signal: AbortSignal.timeout(60_000),
  });
  if (!downloaded.ok) throw new Error(`Hugging Face 圖片下載失敗：HTTP ${downloaded.status}`);
  return {
    bytes: new Uint8Array(await downloaded.arrayBuffer()),
    mimeType: downloaded.headers.get("content-type") || file?.mime_type || "image/png",
  };
}

export async function getHuggingFaceStatus(
  spaceUrl: string | undefined,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<{ configured: boolean; connected: boolean; spaceUrl?: string }> {
  if (!spaceUrl?.trim()) return { configured: false, connected: false };
  try {
    const baseUrl = normalizeSpaceUrl(spaceUrl);
    const response = await fetcher(`${baseUrl}/gradio_api/openapi.json`, {
      headers: token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    return { configured: true, connected: response.ok, spaceUrl: baseUrl };
  } catch {
    return { configured: true, connected: false, spaceUrl: spaceUrl.trim() };
  }
}
