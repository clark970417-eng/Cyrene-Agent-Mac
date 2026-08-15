import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type HttpRoute = {
  method: string;
  path: string;
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
};

export function startHealthServer(
  port: number,
  status: () => Record<string, unknown>,
  extraRoutes: HttpRoute[] = [],
): Server {
  return createServer((request, response) => {
    const route = extraRoutes.find((r) => r.method === request.method && r.path === request.url);
    if (route) {
      route.handle(request, response).catch((error) => {
        console.error(`[HTTP] 路由處理失敗：${route.method} ${route.path}`, error);
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "application/json" });
        }
        response.end(JSON.stringify({ error: "internal_error" }));
      });
      return;
    }
    if (request.url !== "/health") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: true, ...status() }));
  }).listen(port, "0.0.0.0");
}

/** 讀完整個請求 body（route handler 共用）。 */
export function readRequestBody(request: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
