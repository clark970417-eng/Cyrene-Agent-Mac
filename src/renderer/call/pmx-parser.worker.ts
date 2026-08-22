import { Parser } from "mmd-parser";

interface ParseRequest {
  buffer: ArrayBuffer;
  /** 預設 pmx，保留舊呼叫端的行為。 */
  kind?: "pmx" | "vmd";
}

type ParseResponse =
  | { ok: true; pmx: unknown }
  | { ok: false; error: string };

/** 欄位名沿用 `pmx`，兩種格式共用同一條回傳通道。 */

interface ParserWorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage: (message: ParseResponse) => void;
}

const workerScope = globalThis as unknown as ParserWorkerScope;

workerScope.onmessage = (event): void => {
  try {
    const parser = new Parser();
    const pmx =
      event.data.kind === "vmd"
        ? parser.parseVmd(event.data.buffer)
        : parser.parsePmx(event.data.buffer);
    workerScope.postMessage({ ok: true, pmx });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
