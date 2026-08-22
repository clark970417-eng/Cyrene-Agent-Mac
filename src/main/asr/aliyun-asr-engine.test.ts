import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// vitest 會把 vi.mock 提升到 import 之上，所以這裡用一般的靜態 import 即可。
import { AliyunAsrStream, clearAsrTokenCache } from "./aliyun-asr-engine";

const { FakeSocket, sockets } = vi.hoisted(() => {
  const sockets: FakeSocketInstance[] = [];

  interface FakeSocketInstance {
    readyState: number;
    sent: Array<{ data: unknown; binary: boolean }>;
    handlers: Map<string, (arg: unknown) => void>;
    on(event: string, handler: (arg: unknown) => void): FakeSocketInstance;
    send(data: unknown, options?: { binary?: boolean }): void;
    close(): void;
    connect(): void;
    receive(message: unknown): void;
    binaryFrames(): Buffer[];
  }

  class FakeSocket implements FakeSocketInstance {
    readyState = 0;
    sent: Array<{ data: unknown; binary: boolean }> = [];
    handlers = new Map<string, (arg: unknown) => void>();

    constructor(public url: string) {
      sockets.push(this);
    }

    on(event: string, handler: (arg: unknown) => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    send(data: unknown, options?: { binary?: boolean }): void {
      this.sent.push({ data, binary: Boolean(options?.binary) });
    }

    close(): void {
      this.readyState = 3;
    }

    /** 模擬握手完成。 */
    connect(): void {
      this.readyState = 1;
      this.handlers.get("open")?.(undefined);
    }

    /** 模擬服務端推一則 JSON 訊息。 */
    receive(message: unknown): void {
      this.handlers.get("message")?.(Buffer.from(JSON.stringify(message)));
    }

    binaryFrames(): Buffer[] {
      return this.sent.filter(f => f.binary).map(f => f.data as Buffer);
    }
  }

  return { FakeSocket, sockets };
});

vi.mock("ws", () => ({ WebSocket: Object.assign(FakeSocket, { OPEN: 1 }) }));

const STARTED = { header: { name: "TranscriptionStarted", status: 20000000 } };

function mockTokenEndpoint(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      Token: { Id: "token-abc", ExpireTime: Math.floor(Date.now() / 1000) + 86400 },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 建一個已連上、且服務端已回 TranscriptionStarted 的串流。 */
async function connectedStream() {
  const onPartial = vi.fn();
  const onFinal = vi.fn();
  const onError = vi.fn();
  const stream = new AliyunAsrStream(onPartial, onFinal, onError);
  await stream.start("app-key", "ak-id", "ak-secret", "zh");
  const socket = sockets[sockets.length - 1];
  socket.connect();
  return { stream, socket, onPartial, onFinal, onError };
}

describe("AliyunAsrStream", () => {
  beforeEach(() => {
    sockets.length = 0;
    clearAsrTokenCache();
    mockTokenEndpoint();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("連線期間的音訊", () => {
    it("holds audio sent before TranscriptionStarted and flushes it afterwards", async () => {
      const { stream, socket } = await connectedStream();

      // 服務端還沒說「可以開始送了」——這時候丟掉的就是使用者接話的開頭。
      stream.sendAudio(Buffer.alloc(6400, 1));
      expect(socket.binaryFrames()).toHaveLength(0);

      socket.receive(STARTED);
      expect(socket.binaryFrames()).toHaveLength(1);
      expect(socket.binaryFrames()[0]).toHaveLength(6400);
    });

    it("keeps the buffered audio ahead of everything recorded later", async () => {
      const { stream, socket } = await connectedStream();

      stream.sendAudio(Buffer.alloc(6400, 0xaa));
      socket.receive(STARTED);
      stream.sendAudio(Buffer.alloc(6400, 0xbb));

      const frames = socket.binaryFrames();
      expect(frames).toHaveLength(2);
      expect(frames[0][0]).toBe(0xaa);
      expect(frames[1][0]).toBe(0xbb);
    });

    it("holds a whole WeChat-length voice message without truncating it", async () => {
      const { stream, socket } = await connectedStream();

      // 微信語音是一整條一次送進來的，30 秒必須完整留住。
      stream.sendAudio(Buffer.alloc(16000 * 2 * 30, 1));
      socket.receive(STARTED);

      const total = socket.binaryFrames().reduce((sum, f) => sum + f.length, 0);
      expect(total).toBe(16000 * 2 * 30);
    });

    it("caps how much it holds so a socket that never connects cannot grow without bound", async () => {
      const { stream, socket } = await connectedStream();

      // 上限是 60 秒（16kHz/16bit = 1920000 bytes）；送 90 秒進去。
      for (let i = 0; i < 90; i += 1) stream.sendAudio(Buffer.alloc(32000, 1));
      socket.receive(STARTED);

      const total = socket.binaryFrames().reduce((sum, f) => sum + f.length, 0);
      expect(total).toBeLessThanOrEqual(16000 * 2 * 60);
    });

    it("still sends what it held when the turn ends before the server ever started", async () => {
      const { stream, socket } = await connectedStream();

      stream.sendAudio(Buffer.alloc(1000, 7));
      stream.stop();

      const total = socket.binaryFrames().reduce((sum, f) => sum + f.length, 0);
      expect(total).toBe(1000);
    });
  });

  describe("token 快取", () => {
    it("reuses a cached token instead of paying an HTTP round trip every turn", async () => {
      const fetchMock = mockTokenEndpoint();

      await connectedStream();
      await connectedStream();
      await connectedStream();

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("fetches again once the cached token is close to expiring", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        // 只剩 60 秒，落在 5 分鐘的更新緩衝內。
        json: async () => ({ Token: { Id: "t", ExpireTime: Math.floor(Date.now() / 1000) + 60 } }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      await connectedStream();
      await connectedStream();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("失敗回報", () => {
    it("reports a token failure instead of failing silently", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));

      const onError = vi.fn();
      const stream = new AliyunAsrStream(vi.fn(), vi.fn(), onError);
      await stream.start("app-key", "ak-id", "ak-secret", "zh");

      expect(onError).toHaveBeenCalledOnce();
      expect(String(onError.mock.calls[0][0])).toContain("403");
    });

    it("reports a server-side error status", async () => {
      const { socket, onError } = await connectedStream();

      socket.receive({ header: { status: 40000004, status_text: "invalid appkey" } });

      expect(onError).toHaveBeenCalledOnce();
      expect(String(onError.mock.calls[0][0])).toContain("invalid appkey");
    });

    it("does not leave stopAndWaitFinal hanging when the token fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

      const stream = new AliyunAsrStream(vi.fn(), vi.fn(), vi.fn());
      await stream.start("app-key", "ak-id", "ak-secret", "zh");

      // 沒有 markCompleted 的話這裡會一路等到 1.8 秒逾時才回來。
      await expect(stream.stopAndWaitFinal(50)).resolves.toBeUndefined();
    });
  });

  describe("stopAndWaitFinal 的收尾等待", () => {
    /** 這一步卡在每一輪的正中間，多等的每一毫秒都是使用者盯著畫面乾等。 */
    it("returns almost immediately when the server already settled the sentence", async () => {
      vi.useFakeTimers();
      const { stream, socket } = await connectedStream();
      socket.receive(STARTED);
      socket.receive({ header: { name: "TranscriptionResultChanged", status: 20000000 }, payload: { result: "今天" } });
      socket.receive({ header: { name: "SentenceEnd", status: 20000000 }, payload: { result: "今天天氣真好。" } });

      let settled = false;
      const pending = stream.stopAndWaitFinal().then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(250);
      await pending;
      expect(settled).toBe(true);
    });

    it("still waits out a late SentenceEnd when a partial is left hanging", async () => {
      vi.useFakeTimers();
      const { stream, socket, onFinal } = await connectedStream();
      socket.receive(STARTED);
      // 中間結果來了但還沒結算：這時候不等，最後一句就直接吃掉。
      socket.receive({ header: { name: "TranscriptionResultChanged", status: 20000000 }, payload: { result: "我剛剛想說" } });

      let settled = false;
      const pending = stream.stopAndWaitFinal().then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(300);
      expect(settled).toBe(false);

      socket.receive({ header: { name: "SentenceEnd", status: 20000000 }, payload: { result: "我剛剛想說的是這個。" } });
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      expect(settled).toBe(true);
      expect(onFinal).toHaveBeenCalledWith("我剛剛想說的是這個。");
    });
  });

  describe("辨識結果", () => {
    it("hands every SentenceEnd up untouched, leaving accumulation to the caller", async () => {
      const { socket, onFinal } = await connectedStream();

      socket.receive({ header: { name: "SentenceEnd", status: 20000000 }, payload: { result: "第一句。" } });
      socket.receive({ header: { name: "SentenceEnd", status: 20000000 }, payload: { result: "第二句。" } });

      expect(onFinal.mock.calls.map(c => c[0])).toEqual(["第一句。", "第二句。"]);
    });
  });
});
