import { describe, expect, it } from "vitest";
import { TraceCollector } from "./trace-exporter";

describe("Trace Exporter & Observability (Langfuse & OTel)", () => {
  it("collects turn trace, records spans and computes durations", () => {
    const collector = new TraceCollector();
    collector.startTurn("trace-001", "conv-100", "帮我重构代码");
    collector.setRouteDecision("coding");
    collector.setTokenUsage(500, 200);

    collector.recordSpan({
      id: "span-1",
      name: "search_code",
      kind: "tool",
      startTimeMs: 1000,
      endTimeMs: 1250,
      status: "success",
    });

    collector.recordSpan({
      id: "span-2",
      name: "apply_patch",
      kind: "tool",
      startTimeMs: 1260,
      endTimeMs: 1400,
      status: "success",
    });

    const finalized = collector.endTurn();
    expect(finalized).toBeDefined();
    expect(finalized?.traceId).toBe("trace-001");
    expect(finalized?.spans.length).toBe(2);
    expect(finalized?.spans[0].durationMs).toBe(250);
    expect(finalized?.tokenUsage?.totalTokens).toBe(700);

    // Export to Langfuse
    const langfuse = collector.exportToLangfuse(finalized!);
    expect(langfuse.id).toBe("trace-001");
    expect((langfuse.metadata as any).routeDecision).toBe("coding");

    // Export to OpenTelemetry
    const otel: any = collector.exportToOpenTelemetry(finalized!);
    expect(otel.resourceSpans[0].scopeSpans[0].spans.length).toBe(2);
  });
});
