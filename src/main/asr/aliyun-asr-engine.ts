// 阿里云实时语音识别 ASR 引擎 —— WebSocket + JSON 协议。
//
// 文档：https://help.aliyun.com/zh/isi/developer-reference/websocket
// URL：wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1?token=<token>
// 鉴权：用 AccessKeyId + AccessKeySecret 获取临时 token，拼到 URL 里
// 协议：JSON 文本帧（StartTranscription/StopTranscription）+ 二进制帧（PCM 音频）
// 音频：PCM 16kHz/16bit/mono

import { WebSocket } from "ws";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";

const LOG_PREFIX = "[AliyunASR]";
const NLS_GATEWAY = "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1";
/** 16kHz/16bit → 200ms = 16000 * 0.2 * 2 = 6400 字节，阿里云建议的送包粒度。 */
const CHUNK_BYTES = 6400;
/** 连线还没谈好时先留住的音频上限。
 * 通话场景只需要覆盖取 token + 握手的几百毫秒，但微信语音是一整条消息一次
 * 塞进来的（channels/adapters/wechat），压太低会把长语音截断。60 秒 = 1.92MB，
 * 内存代价可以忽略，同时仍然挡住「socket 永远连不上」时的无限膨胀。 */
const MAX_PENDING_BYTES = 16000 * 2 * 60;

interface CachedToken {
  id: string;
  expiresAtMs: number;
}

/** token 效期 24 小时，每轮通话都重取一次是白白多一趟 HTTP，还会拖慢接话。 */
const tokenCache = new Map<string, CachedToken>();
/** 提早 5 分钟换新，避免刚好卡在过期边缘。 */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** 服务端自行结算一句话所需的静音时长。
 * 客户端 VAD 换手大约落在 320~600ms，这里压到 500ms，SentenceEnd 多半会在
 * 我们发 StopTranscription 之前就自己送到，让 stopAndWaitFinal 走快速路径。 */
const MAX_SENTENCE_SILENCE_MS = 500;

/** 服务端还有半句话没结算时，最多愿意等一趟往返的时间。 */
const FINAL_SETTLE_TIMEOUT_MS = 900;
/** 已经没有半句话悬着时，只留这点余裕接住迟到的 SentenceEnd。 */
const STRAGGLER_GRACE_MS = 80;

/** 空闲多久就补一帧静音，避免预热好的连线被网关按「无数据」掐断。 */
const KEEPALIVE_IDLE_MS = 3000;
/** 100ms 的 16kHz/16bit 静音。 */
const KEEPALIVE_SILENCE = Buffer.alloc(3200);

/** 测试用：清掉进程内的 token 快取。 */
export function clearAsrTokenCache(): void {
  tokenCache.clear();
}

/** 用 AccessKeyId + AccessKeySecret 获取阿里云临时 token（带进程内快取）。 */
async function fetchNlsToken(accessKeyId: string, accessKeySecret: string): Promise<string> {
  const cached = tokenCache.get(accessKeyId);
  if (cached && cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return cached.id;
  }

  // 阿里云 NLS token 获取：RPC 风格 API 签名
  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: "CreateToken",
    Format: "JSON",
    RegionId: "cn-shanghai",
    SignatureMethod: "HMAC-SHA256",
    SignatureNonce: randomUUID().replace(/-/g, ""),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    Version: "2019-02-28",
  };

  // 按字母序排列参数
  const sortedKeys = Object.keys(params).sort();
  const canonicalQuery = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");

  // 构建签名字符串
  const stringToSign = `GET&%2F&${encodeURIComponent(canonicalQuery)}`;

  // HMAC-SHA256 签名（阿里云签名附加 &）
  const signature = createHmac("sha256", accessKeySecret + "&")
    .update(stringToSign)
    .digest("base64");

  // 构建完整 URL
  const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${canonicalQuery}&Signature=${encodeURIComponent(signature)}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as { Token?: { Id?: string; ExpireTime?: number }; errmsg?: string };
  if (!data.Token?.Id) throw new Error(data.errmsg || "token 获取失败");

  // ExpireTime 是 unix 秒；服务端没给就保守地只用 1 小时。
  const expiresAtMs = typeof data.Token.ExpireTime === "number"
    ? data.Token.ExpireTime * 1000
    : Date.now() + 60 * 60 * 1000;
  tokenCache.set(accessKeyId, { id: data.Token.Id, expiresAtMs });
  return data.Token.Id;
}

/** 阿里云 ASR 流式识别会话 */
export class AliyunAsrStream {
  private ws: WebSocket | null = null;
  private stopped = false;
  private audioBuffer = Buffer.alloc(0);
  /** 服务端回 TranscriptionStarted 之前送音频是无效的，先攒着。 */
  private pendingAudio = Buffer.alloc(0);
  private started = false;
  private taskId = randomUUID().replace(/-/g, "");
  private appKey = "";
  private completed = false;
  private completionResolve: (() => void) | null = null;
  /** 服务端已经回过中间结果、但还没把这句结算掉。stopAndWaitFinal 靠它判断
   * 到底值不值得为了收尾多等一趟上海往返。 */
  private awaitingSentenceEnd = false;
  /** stopAndWaitFinal 期间等的那个「这句已经结算」信号。 */
  private settleResolve: (() => void) | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastSendAtMs = 0;

  constructor(
    private readonly onPartial: (text: string) => void,
    private readonly onFinal: (text: string) => void,
    /** 连不上／取不到 token 时回报，让上层能决定是要报错还是转本机备援。 */
    private readonly onError?: (message: string) => void,
  ) {}

  /** 开始识别会话：获取 token → 连 WebSocket → 发 StartTranscription */
  async start(appKey: string, accessKeyId: string, accessKeySecret: string, language: string): Promise<void> {
    this.appKey = appKey;
    console.log(LOG_PREFIX, `获取 token... appKey=${appKey}`);
    let token: string;
    try {
      token = await fetchNlsToken(accessKeyId, accessKeySecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(LOG_PREFIX, "获取 token 失败:", message);
      // 以前这里只是 return，整通电话就静默失灵：音频照送、一个字都不会回来，
      // 画面上也没有任何提示。至少要让上层知道这条路断了。
      this.onError?.(`取得阿里雲 token 失敗：${message}`);
      this.markCompleted();
      return;
    }
    console.log(LOG_PREFIX, "token 获取成功，连接 WebSocket...");

    const url = `${NLS_GATEWAY}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log(LOG_PREFIX, "WS 已连接，发送 StartTranscription");
      this.sendStartTranscription(appKey, language);
    });

    this.ws.on("message", (raw: Buffer) => this.handleMessage(raw));
    this.ws.on("error", (err) => {
      console.error(LOG_PREFIX, "WS 错误:", err.message);
      this.onError?.(`語音辨識連線錯誤：${err.message}`);
      this.markCompleted();
    });
    this.ws.on("close", (code) => {
      console.log(LOG_PREFIX, `WS 关闭: ${code}`);
      this.markCompleted();
    });
  }

  /** 发送 StartTranscription 指令（JSON 文本帧） */
  private sendStartTranscription(appKey: string, language: string): void {
    // 阿里云这个版本的 StartTranscription 没有语言字段——语种绑在 appkey 上，
    // 要换语言得换 appkey。language 留在签名里只为呼叫端一致，记进 log 备查。
    console.log(LOG_PREFIX, `StartTranscription appkey=${appKey} language=${language}`);
    const msg = {
      header: {
        message_id: randomUUID().replace(/-/g, ""),
        task_id: this.taskId,
        namespace: "SpeechTranscriber",
        name: "StartTranscription",
        appkey: appKey,
      },
      payload: {
        format: "pcm",
        sample_rate: 16000,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
        max_sentence_silence: MAX_SENTENCE_SILENCE_MS,
      },
    };
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch (err) {
      console.error(LOG_PREFIX, "发送 StartTranscription 失败:", err);
    }
  }

  /** 发送一帧 PCM 音频（攒够 200ms/6400 字节再发）。
   * 连线／StartTranscription 还没完成时不能丢帧：使用者接话的开头就在这几百
   * 毫秒里，丢掉就是吃字。先留在 pendingAudio，接通后原序补送。 */
  sendAudio(pcmFrame: Buffer): void {
    if (this.stopped) return;
    if (!this.isReady()) {
      const room = MAX_PENDING_BYTES - this.pendingAudio.length;
      if (room > 0) {
        this.pendingAudio = Buffer.concat([this.pendingAudio, pcmFrame.subarray(0, room)]);
      }
      return;
    }
    this.audioBuffer = Buffer.concat([this.audioBuffer, pcmFrame]);
    this.flushChunks();
  }

  private isReady(): boolean {
    return this.started && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** 把攒着的音频接到队首，然后照常按 200ms 粒度送出。 */
  private drainPending(): void {
    if (!this.pendingAudio.length) return;
    this.audioBuffer = Buffer.concat([this.pendingAudio, this.audioBuffer]);
    this.pendingAudio = Buffer.alloc(0);
  }

  private flushChunks(): void {
    if (!this.ws) return;
    while (this.audioBuffer.length >= CHUNK_BYTES) {
      const chunk = this.audioBuffer.subarray(0, CHUNK_BYTES);
      this.audioBuffer = this.audioBuffer.subarray(CHUNK_BYTES);
      this.ws.send(chunk, { binary: true });
      this.lastSendAtMs = Date.now();
    }
  }

  /** 这条连线可能在昔涟还在讲话时就先接起来（call-manager 的预热），期间一帧
   * 真实音频都不会送。网关看到长时间没有数据会直接断线，等使用者要接话时又得
   * 重新握手——预热就白做了。补静音把连线撑住。 */
  private startKeepAlive(): void {
    if (this.keepAliveTimer) return;
    this.lastSendAtMs = Date.now();
    this.keepAliveTimer = setInterval(() => {
      if (this.stopped || !this.isReady()) return;
      if (Date.now() - this.lastSendAtMs < KEEPALIVE_IDLE_MS) return;
      try {
        this.ws?.send(KEEPALIVE_SILENCE, { binary: true });
        this.lastSendAtMs = Date.now();
      } catch { /* ignore */ }
    }, KEEPALIVE_IDLE_MS);
    this.keepAliveTimer.unref?.();
  }

  private stopKeepAlive(): void {
    if (!this.keepAliveTimer) return;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  /** 结束识别：发剩余音频 + StopTranscription */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopKeepAlive();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 还没送出去的（含连线期间攒下的）全部补送，别让最后一句断在这里。
    this.drainPending();
    this.flushChunks();
    if (this.audioBuffer.length > 0) {
      try { this.ws.send(this.audioBuffer, { binary: true }); } catch { /* ignore */ }
      this.audioBuffer = Buffer.alloc(0);
    }

    // 发 StopTranscription 指令
    const msg = {
      header: {
        message_id: randomUUID().replace(/-/g, ""),
        task_id: this.taskId,
        namespace: "SpeechTranscriber",
        name: "StopTranscription",
        appkey: this.appKey,
      },
    };
    try { this.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }

    setTimeout(() => { try { this.ws?.close(); } catch { /* ignore */ } }, 2000);
  }

  /** 停止串流並短暫等待服務端送回最後一句，避免 VAD 結束時漏字。
   *
   * 這一步卡在每一輪的正中間：使用者話音剛落、昔漣還沒開始想，全靠它結束才往下
   * 走。以前不管三七二十一都等 TranscriptionCompleted（要多跑一趟上海往返），
   * 沒等到就賠掉 1.8 秒。現在分兩種情況：
   *   - 服務端還有半句沒結算（收過中間結果、或握手期間攢的音訊還沒送）：等
   *     SentenceEnd（比 Completed 早到），上限 900ms。
   *   - 已經結算完了：只留 220ms 接住遲到的結果，不再空等。 */
  async stopAndWaitFinal(timeoutMs = FINAL_SETTLE_TIMEOUT_MS): Promise<void> {
    if (this.completed) return;
    const hasUnsettledSpeech = this.awaitingSentenceEnd || this.pendingAudio.length > 0;
    const settled = new Promise<void>((resolve) => {
      this.settleResolve = resolve;
    });
    this.stop();
    const waitMs = hasUnsettledSpeech ? timeoutMs : STRAGGLER_GRACE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      settled,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); }),
    ]);
    if (timer) clearTimeout(timer);
    this.settleResolve = null;
  }

  /** 這一句已經有著落了（SentenceEnd 或整段轉寫結束），放行等待中的 stopAndWaitFinal。 */
  private markSentenceSettled(): void {
    this.awaitingSentenceEnd = false;
    this.settleResolve?.();
    this.settleResolve = null;
  }

  private markCompleted(): void {
    this.stopKeepAlive();
    this.markSentenceSettled();
    if (this.completed) return;
    this.completed = true;
    this.completionResolve?.();
    this.completionResolve = null;
  }

  /** 解析服务端 JSON 响应 */
  private handleMessage(raw: Buffer): void {
    try {
      const msg = JSON.parse(raw.toString()) as {
        header?: {
          status?: number;
          status_text?: string;
          task_id?: string;
          name?: string;
        };
        payload?: {
          result?: string;
          index?: number;
          time?: number;
          confidence?: number;
        };
      };

      const status = msg.header?.status;
      const eventName = msg.header?.name;

      if (status !== 20000000 && status !== undefined) {
        console.error(LOG_PREFIX, `ASR 错误: status=${status}, msg=${msg.header?.status_text}`);
        this.onError?.(`語音辨識服務回報錯誤（${status}）：${msg.header?.status_text ?? "未知原因"}`);
        return;
      }

      if (eventName === "TranscriptionStarted") {
        console.log(LOG_PREFIX, "转写已开始，可以发送音频");
        this.started = true;
        this.drainPending();
        this.flushChunks();
        this.startKeepAlive();
      } else if (eventName === "TranscriptionResultChanged") {
        // 中间结果
        const text = msg.payload?.result ?? "";
        if (text) {
          this.awaitingSentenceEnd = true;
          this.onPartial(text);
        }
      } else if (eventName === "SentenceEnd") {
        // 最终结果
        const text = msg.payload?.result ?? "";
        this.markSentenceSettled();
        if (text) {
          console.log(LOG_PREFIX, "最终识别:", text);
          this.onFinal(text);
        }
      } else if (eventName === "TranscriptionCompleted") {
        console.log(LOG_PREFIX, "转写已完成");
        this.markCompleted();
      }
    } catch (err) {
      console.error(LOG_PREFIX, "解析响应失败:", err);
    }
  }
}

// ── 配置注入 ──

export interface AsrConfig {
  appKey: string;
  accessKeyId: string;
  accessKeySecret: string;
  language: string;
  engine: string;
  fallbackToLocal?: boolean;
}

let asrConfigGetter: (() => AsrConfig | null) | null = null;

export function setAsrConfig(getter: () => AsrConfig | null): void {
  asrConfigGetter = getter;
}

export function getAsrConfig(): AsrConfig | null {
  return asrConfigGetter?.() ?? null;
}
