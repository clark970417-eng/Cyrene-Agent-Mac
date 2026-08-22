import React, { useEffect, useState } from "react";
import type { AffectionState } from "../../../../shared/affection-types";
import "./AffectionModal.css";

export interface AffectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTriggerAction?: (actionName: string) => void;
}

export function AffectionModal({ isOpen, onClose, onTriggerAction }: AffectionModalProps) {
  const [state, setState] = useState<AffectionState | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAffection = async () => {
    if (!window.affection) return;
    setLoading(true);
    try {
      const current = await window.affection.getState();
      setState(current);
    } catch (err) {
      console.error("[Affection] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchAffection();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="cy-affection-overlay" onClick={onClose}>
      <div className="cy-affection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cy-affection-header">
          <div className="cy-affection-title-group">
            <h2 className="cy-affection-title">🌸 昔漣的羈絆成長樹 (Bonding Tree)</h2>
            <span className="cy-affection-subtitle">見證每一次對話、專注與冒險累積的心靈共鳴</span>
          </div>
          <button className="cy-affection-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {state && (
          <div className="cy-affection-body">
            {/* Level Banner */}
            <div className="cy-affection-hero-card">
              <div className="cy-affection-level-badge">Lv.{state.level}</div>
              <div className="cy-affection-hero-info">
                <h3>{state.levelTitle}</h3>
                <div className="cy-affection-exp-bar-wrapper">
                  <div className="cy-affection-exp-meta">
                    <span>親密共鳴值 {state.exp} EXP</span>
                    <span>下一階段 {state.nextLevelExp} EXP ({state.progressPercent}%)</span>
                  </div>
                  <div className="cy-affection-exp-bar">
                    <div
                      className="cy-affection-exp-fill"
                      style={{ width: `${state.progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Statistics */}
            <div className="cy-affection-stats-grid">
              <div className="cy-affection-stat-card">
                <span className="cy-affection-stat-num">{state.totalDays}</span>
                <span className="cy-affection-stat-label">🗓️ 陪伴天數</span>
              </div>
              <div className="cy-affection-stat-card">
                <span className="cy-affection-stat-num">{state.totalChats}</span>
                <span className="cy-affection-stat-label">💬 深度對話</span>
              </div>
              <div className="cy-affection-stat-card">
                <span className="cy-affection-stat-num">{state.focusMinutes}m</span>
                <span className="cy-affection-stat-label">⏳ 專注伴讀</span>
              </div>
            </div>

            {/* Unlocked Live2D actions */}
            <div className="cy-affection-section">
              <h4 className="cy-affection-section-title">✨ 已解鎖的專屬 Live2D 微動作與互動</h4>
              <div className="cy-affection-chips">
                {state.unlockedActions.map((action, idx) => (
                  <button
                    key={idx}
                    className="cy-affection-chip"
                    onClick={() => onTriggerAction && onTriggerAction(action)}
                    title="點擊讓昔漣立即表演"
                  >
                    💖 {action}
                  </button>
                ))}
              </div>
            </div>

            {/* Badges / Achievements */}
            <div className="cy-affection-section">
              <h4 className="cy-affection-section-title">🏆 紀念徽章牆</h4>
              <div className="cy-affection-badges-grid">
                {state.badges.map((badge) => (
                  <div className="cy-affection-badge-card" key={badge.id}>
                    <span className="cy-affection-badge-icon">{badge.icon}</span>
                    <div className="cy-affection-badge-text">
                      <strong>{badge.name}</strong>
                      <p>{badge.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
