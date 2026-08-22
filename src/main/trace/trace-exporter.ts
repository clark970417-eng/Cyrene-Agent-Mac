// Trace Exporter & Observability -- 链路可观测性与 Trace 导出
//
// 记录 Agent 每轮执行完整 Trace：
// - traceId, conversationId, userQuery, routeDecision
// - promptTokens, completionTokens, totalTokens
// - Waterfall Spans（各 Tool、LLM、Subagent 的耗时与成功状态）
// - 支持导出为标准 JSON、OpenTelemetry Span 格式与 Langfuse 格式。

export interface TraceSpan {
  id: string;
  name: string;
  kind: "llm" | "tool" | "subagent" | "planning" | "router";
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: "success" | "error" | "cancelled";
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface AgentTurnTrace {
  traceId: string;
  conversationId: string;
  userQuery: string;
  routeDecision?: string;
  startTimeMs: number;
  endTimeMs: number;
  totalDurationMs: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  spans: TraceSpan[];
}

export class TraceCollector {
  private currentTrace: AgentTurnTrace | null = null;
  private readonly traces: AgentTurnTrace[] = [];

  startTurn(traceId: string, conversationId: string, userQuery: string): AgentTurnTrace {
    const now = Date.now();
    this.currentTrace = {
      traceId,
      conversationId,
      userQuery,
      startTimeMs: now,
      endTimeMs: now,
      totalDurationMs: 0,
      spans: [],
    };
    return this.currentTrace;
  }

  recordSpan(span: Omit<TraceSpan, "durationMs">): void {
    if (!this.currentTrace) return;
    const durationMs = Math.max(0, span.endTimeMs - span.startTimeMs);
    this.currentTrace.spans.push({
      ...span,
      durationMs,
    });
  }

  setRouteDecision(route: string): void {
    if (this.currentTrace) {
      this.currentTrace.routeDecision = route;
    }
  }

  setTokenUsage(promptTokens: number, completionTokens: number): void {
    if (this.currentTrace) {
      this.currentTrace.tokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
    }
  }

  endTurn(): AgentTurnTrace | null {
    if (!this.currentTrace) return null;
    const now = Date.now();
    this.currentTrace.endTimeMs = now;
    this.currentTrace.totalDurationMs = Math.max(0, now - this.currentTrace.startTimeMs);

    const finalized = { ...this.currentTrace };
    this.traces.push(finalized);
    if (this.traces.length > 200) {
      this.traces.shift();
    }
    this.currentTrace = null;
    return finalized;
  }

  getRecentTraces(limit = 50): AgentTurnTrace[] {
    return this.traces.slice(-limit);
  }

  /** 导出为 Langfuse 兼容格式 */
  exportToLangfuse(trace: AgentTurnTrace): Record<string, unknown> {
    return {
      id: trace.traceId,
      name: `Cyrene-Agent-Turn`,
      sessionId: trace.conversationId,
      input: { query: trace.userQuery },
      metadata: {
        routeDecision: trace.routeDecision,
      },
      usage: trace.tokenUsage
        ? {
            input: trace.tokenUsage.promptTokens,
            output: trace.tokenUsage.completionTokens,
            total: trace.tokenUsage.totalTokens,
          }
        : undefined,
      latency: trace.totalDurationMs / 1000,
      observations: trace.spans.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.kind === "llm" ? "GENERATION" : "SPAN",
        startTime: new Date(s.startTimeMs).toISOString(),
        endTime: new Date(s.endTimeMs).toISOString(),
        statusMessage: s.status,
        input: s.input,
        output: s.output,
        level: s.status === "error" ? "ERROR" : "DEFAULT",
      })),
    };
  }

  /** 导出为 OpenTelemetry 兼容 Trace 结构 */
  exportToOpenTelemetry(trace: AgentTurnTrace): Record<string, unknown> {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "cyrene-agent" } },
              { key: "conversation.id", value: { stringValue: trace.conversationId } },
            ],
          },
          scopeSpans: [
            {
              spans: trace.spans.map((s) => ({
                traceId: trace.traceId,
                spanId: s.id,
                name: s.name,
                startTimeUnixNano: s.startTimeMs * 1_000_000,
                endTimeUnixNano: s.endTimeMs * 1_000_000,
                status: {
                  code: s.status === "error" ? 2 : 1,
                  message: s.error,
                },
                attributes: [
                  { key: "span.kind", value: { stringValue: s.kind } },
                  { key: "span.duration_ms", value: { intValue: s.durationMs } },
                ],
              })),
            },
          ],
        },
      ],
    };
  }
}

export const traceCollector = new TraceCollector();
