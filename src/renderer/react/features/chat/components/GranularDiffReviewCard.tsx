import React, { useState } from "react";
import type { ParsedDiffHunk } from "../../../../../main/orchestrator/granular-diff-applier";

export interface GranularDiffReviewCardProps {
  initialHunks: ParsedDiffHunk[];
  onConfirmApply: (selectedHunks: ParsedDiffHunk[]) => void;
  onCancel: () => void;
}

export const GranularDiffReviewCard: React.FC<GranularDiffReviewCardProps> = ({
  initialHunks,
  onConfirmApply,
  onCancel,
}) => {
  const [hunks, setHunks] = useState<ParsedDiffHunk[]>(initialHunks);

  const toggleHunk = (id: string) => {
    setHunks((prev) =>
      prev.map((h) => (h.id === id ? { ...h, accepted: !h.accepted } : h)),
    );
  };

  const selectedCount = hunks.filter((h) => h.accepted).length;

  return (
    <div
      style={{
        background: "rgba(30, 41, 59, 0.95)",
        border: "1px solid #334155",
        borderRadius: "8px",
        padding: "16px",
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "13px",
        margin: "12px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          borderBottom: "1px solid #475569",
          paddingBottom: "8px",
        }}
      >
        <span style={{ fontWeight: 600, color: "#38bdf8" }}>
          📝 代碼變更審批 (已勾選 {selectedCount}/{hunks.length} 個區塊)
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => onConfirmApply(hunks)}
            style={{
              background: "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              padding: "4px 12px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            套用所選變更
          </button>
          <button
            onClick={onCancel}
            style={{
              background: "#64748b",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              padding: "4px 12px",
              cursor: "pointer",
            }}
          >
            取消
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {hunks.map((hunk) => (
          <div
            key={hunk.id}
            style={{
              background: "rgba(15, 23, 42, 0.6)",
              border: `1px solid ${hunk.accepted ? "#38bdf8" : "#475569"}`,
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 10px",
                background: "rgba(255,255,255,0.05)",
                cursor: "pointer",
              }}
              onClick={() => toggleHunk(hunk.id)}
            >
              <input
                type="checkbox"
                checked={hunk.accepted}
                onChange={() => toggleHunk(hunk.id)}
              />
              <span style={{ color: "#94a3b8" }}>{hunk.file}</span>
              <span style={{ color: "#64748b", fontSize: "11px" }}>{hunk.header}</span>
            </div>

            <div style={{ padding: "8px", fontSize: "12px", lineHeight: "1.4" }}>
              {hunk.lines.map((line, idx) => {
                const bg =
                  line.type === "addition"
                    ? "rgba(16, 185, 129, 0.15)"
                    : line.type === "deletion"
                    ? "rgba(239, 68, 68, 0.15)"
                    : "transparent";
                const color =
                  line.type === "addition"
                    ? "#34d399"
                    : line.type === "deletion"
                    ? "#f87171"
                    : "#cbd5e1";

                return (
                  <div
                    key={idx}
                    style={{
                      background: bg,
                      color,
                      padding: "1px 6px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {line.type === "addition" ? "+ " : line.type === "deletion" ? "- " : "  "}
                    {line.text}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
