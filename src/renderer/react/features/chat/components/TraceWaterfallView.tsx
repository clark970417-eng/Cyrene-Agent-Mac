import React from "react";

export interface WaterfallSpanItem {
  id: string;
  name: string;
  kind: "llm" | "tool" | "subagent" | "planning" | "router";
  startTimeMs: number;
  durationMs: number;
  status: "success" | "error" | "cancelled";
}

export interface TraceWaterfallViewProps {
  traceId: string;
  totalDurationMs: number;
  spans: WaterfallSpanItem[];
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export const TraceWaterfallView: React.FC<TraceWaterfallViewProps> = ({
  traceId,
  totalDurationMs,
  spans,
  tokenUsage,
}) => {
  const minStart = spans.length > 0 ? Math.min(...spans.map((s) => s.startTimeMs)) : 0;
  const maxTotal = totalDurationMs > 0 ? totalDurationMs : 1;

  const kindColors: Record<string, string> = {
    llm: "#6366f1",
    tool: "#10b981",
    subagent: "#f59e0b",
    planning: "#8b5cf6",
    router: "#06b6d4",
  };

  return (
    <div
      style={{
        padding: "16px",
        background: "rgba(15, 23, 42, 0.85)",
        borderRadius: "8px",
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          paddingBottom: "8px",
        }}
      >
        <div>
          <span style={{ fontWeight: 600, color: "#38bdf8" }}>Trace ID:</span> {traceId}
        </div>
        <div>
          <span style={{ fontWeight: 600, color: "#a78bfa" }}>总耗时:</span> {totalDurationMs}ms
          {tokenUsage && (
            <span style={{ marginLeft: "16px", color: "#34d399" }}>
              Tokens: {tokenUsage.totalTokens} (P: {tokenUsage.promptTokens} / C:{" "}
              {tokenUsage.completionTokens})
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {spans.map((span) => {
          const offsetPercent =
            minStart > 0 ? Math.max(0, ((span.startTimeMs - minStart) / maxTotal) * 100) : 0;
          const widthPercent = Math.max(2, (span.durationMs / maxTotal) * 100);
          const color = kindColors[span.kind] || "#94a3b8";

          return (
            <div key={span.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "140px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={span.name}
              >
                [{span.kind}] {span.name}
              </div>
              <div
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.05)",
                  height: "20px",
                  borderRadius: "4px",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: `${offsetPercent}%`,
                    width: `${widthPercent}%`,
                    height: "100%",
                    background: span.status === "error" ? "#ef4444" : color,
                    borderRadius: "3px",
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: "4px",
                    fontSize: "10px",
                    color: "#fff",
                  }}
                >
                  {span.durationMs}ms
                </div>
              </div>
              <div style={{ width: "60px", textAlign: "right" }}>
                {span.status === "error" ? (
                  <span style={{ color: "#ef4444" }}>FAIL</span>
                ) : (
                  <span style={{ color: "#10b981" }}>OK</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
