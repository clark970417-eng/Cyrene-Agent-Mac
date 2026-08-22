import React from "react";
import type { SimulationResult, VirtualTreeNode } from "../../../../../main/orchestrator/sandbox-simulation-canvas";

export interface SimulationCanvasViewProps {
  simulation: SimulationResult;
  onConfirmExecution: () => void;
  onCancel: () => void;
}

const renderTree = (node: VirtualTreeNode, depth = 0): React.ReactNode => {
  const statusColors = {
    added: "#10b981",
    modified: "#38bdf8",
    deleted: "#ef4444",
    renamed: "#f59e0b",
    unchanged: "#94a3b8",
  };

  const statusIcons = {
    added: "➕",
    modified: "✏️",
    deleted: "🗑️",
    renamed: "🔄",
    unchanged: "📁",
  };

  return (
    <div key={node.fullPath || node.name} style={{ marginLeft: `${depth * 16}px`, marginY: "2px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
        <span>{statusIcons[node.status]}</span>
        <span style={{ color: statusColors[node.status], fontWeight: node.isDirectory ? 600 : 400 }}>
          {node.name}
        </span>
        {node.mutation?.summary && (
          <span style={{ color: "#64748b", fontSize: "11px" }}>({node.mutation.summary})</span>
        )}
      </div>
      {node.children && node.children.map((c) => renderTree(c, depth + 1))}
    </div>
  );
};

export const SimulationCanvasView: React.FC<SimulationCanvasViewProps> = ({
  simulation,
  onConfirmExecution,
  onCancel,
}) => {
  const riskBadges = {
    low: { text: "🟢 低風險", color: "#10b981" },
    medium: { text: "🟡 中風險", color: "#f59e0b" },
    high: { text: "🔴 高風險", color: "#ef4444" },
  };

  const badge = riskBadges[simulation.riskLevel];

  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.95)",
        border: "1px solid #334155",
        borderRadius: "8px",
        padding: "16px",
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        margin: "12px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          borderBottom: "1px solid #334155",
          paddingBottom: "8px",
        }}
      >
        <div>
          <span style={{ fontWeight: 600, color: "#38bdf8" }}>🛡️ 沙盤推演與安全變更畫布</span>
          <span style={{ marginLeft: "12px", color: badge.color, fontSize: "12px", fontWeight: 600 }}>
            {badge.text}
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={onConfirmExecution}
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
            確認並執行寫入
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
            取消操作
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "16px", marginBottom: "12px", fontSize: "12px", color: "#94a3b8" }}>
        <span>受影響檔案: {simulation.totalAffectedFiles}</span>
        <span style={{ color: "#10b981" }}>新增: {simulation.addedCount}</span>
        <span style={{ color: "#38bdf8" }}>修改: {simulation.modifiedCount}</span>
        <span style={{ color: "#ef4444" }}>刪除: {simulation.deletedCount}</span>
        <span style={{ color: "#f59e0b" }}>重命名: {simulation.renamedCount}</span>
      </div>

      <div
        style={{
          background: "rgba(0, 0, 0, 0.4)",
          padding: "12px",
          borderRadius: "6px",
          maxHeight: "260px",
          overflowY: "auto",
        }}
      >
        {simulation.treeRoot.children && simulation.treeRoot.children.map((c) => renderTree(c, 0))}
      </div>
    </div>
  );
};
