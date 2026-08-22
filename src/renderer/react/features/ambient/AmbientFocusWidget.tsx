import React, { useEffect, useState } from "react";
import type { AmbientState } from "../../../../shared/ambient-types";
import "./AmbientFocusWidget.css";

export interface AmbientFocusWidgetProps {
  isOpen?: boolean;
  onClose?: () => void;
  onOpenAlbum?: () => void;
  onOpenCopilot?: () => void;
  onOpenPodcast?: () => void;
  onOpenTrpg?: () => void;
  onOpenAffection?: () => void;
  onOpenProactive?: () => void;
  onOpenSpotlight?: () => void;
}

export function AmbientFocusWidget({
  isOpen = false,
  onClose,
  onOpenAlbum,
  onOpenCopilot,
  onOpenPodcast,
  onOpenTrpg,
  onOpenAffection,
  onOpenProactive,
  onOpenSpotlight,
}: AmbientFocusWidgetProps) {
  const [state, setState] = useState<AmbientState | null>(null);
  const [topic, setTopic] = useState("專注工作與學習");

  useEffect(() => {
    if (!window.ambient) return;
    void window.ambient.getState().then((initialState) => {
      setState(initialState);
    });

    const unsubscribe = window.ambient.onStateChanged((nextState) => {
      setState(nextState);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (!isOpen && !state?.focus.isActive) {
    return null;
  }

  const focus = state?.focus;
  const isFocusActive = Boolean(focus?.isActive);
  const mins = focus ? Math.floor(focus.remainingSec / 60) : 25;
  const secs = focus ? focus.remainingSec % 60 : 0;
  const timeDisplay = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const totalTargetSec = focus?.targetDurationSec || 25 * 60;
  const progressPercent = focus ? Math.min(100, Math.max(0, ((totalTargetSec - focus.remainingSec) / totalTargetSec) * 100)) : 0;

  const handleStartFocus = (durationMinutes: number) => {
    void window.ambient?.startFocus({
      topic,
      durationMinutes,
      breakMinutes: 5,
    });
  };

  const handlePauseResume = () => {
    if (!focus) return;
    if (focus.isPaused) {
      void window.ambient?.resumeFocus();
    } else {
      void window.ambient?.pauseFocus();
    }
  };

  const handleStopFocus = () => {
    void window.ambient?.stopFocus();
  };

  const handleTriggerAction = (alias: string) => {
    void window.ambient?.triggerAction(alias);
  };

  return (
    <div className={`cy-ambient-widget ${isFocusActive ? "is-active" : ""} ${isOpen ? "is-open" : "is-compact"}`}>
      <div className="cy-ambient-header">
        <div className="cy-ambient-title-row">
          <span className="cy-ambient-badge">{state?.periodLabel ?? "伴讀"}</span>
          <span className="cy-ambient-status-text">{state?.statusText}</span>
        </div>
        {onClose && (
          <button className="cy-ambient-close-btn" onClick={onClose} title="收起">
            ✕
          </button>
        )}
      </div>

      {isFocusActive && focus ? (
        <div className="cy-ambient-focus-card">
          <div className="cy-ambient-phase-label">
            {focus.phase === "focus" ? "🎯 深度專注中" : "🍵 休息時段"}
            {focus.isPaused && <span className="cy-ambient-paused-tag">（已暫停）</span>}
          </div>

          <div className="cy-ambient-timer-display">{timeDisplay}</div>

          <div className="cy-ambient-progress-bar">
            <div className="cy-ambient-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="cy-ambient-topic-label">目標：{focus.topic}</div>

          <div className="cy-ambient-controls">
            <button className="cy-ambient-btn is-primary" onClick={handlePauseResume}>
              {focus.isPaused ? "▶ 繼續" : "⏸ 暫停"}
            </button>
            <button className="cy-ambient-btn is-danger" onClick={handleStopFocus}>
              ⏹ 結束伴讀
            </button>
          </div>

          {focus.completedPomodoros > 0 && (
            <div className="cy-ambient-stats">
              已累積完成 <strong>{focus.completedPomodoros}</strong> 個番茄鐘 🍅
            </div>
          )}
        </div>
      ) : (
        <div className="cy-ambient-idle-card">
          <div className="cy-ambient-whisper-quote">
            “{state?.ambientWhisper ?? "隨時準備好為你提供陪伴與協助~"}”
          </div>

          <div className="cy-ambient-quick-start">
            <div className="cy-ambient-section-title">開啟專注伴讀：</div>
            <input
              className="cy-ambient-topic-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="輸入當前專注目標..."
            />
            <div className="cy-ambient-preset-btns">
              <button className="cy-ambient-preset-btn" onClick={() => handleStartFocus(25)}>
                🍅 25 分鐘
              </button>
              <button className="cy-ambient-preset-btn" onClick={() => handleStartFocus(45)}>
                📖 45 分鐘
              </button>
              <button className="cy-ambient-preset-btn" onClick={() => handleStartFocus(15)}>
                ⚡ 15 分鐘
              </button>
            </div>
          </div>

          <div className="cy-ambient-interactions">
            <div className="cy-ambient-section-title">互動一下：</div>
            <div className="cy-ambient-action-chips">
              <button className="cy-ambient-chip" onClick={() => handleTriggerAction("笑一笑")}>
                😊 微笑
              </button>
              <button className="cy-ambient-chip" onClick={() => handleTriggerAction("眨眨眼")}>
                😉 眨眼
              </button>
              <button className="cy-ambient-chip" onClick={() => handleTriggerAction("可愛一下")}>
                ✨ 裝可愛
              </button>
              <button className="cy-ambient-chip" onClick={() => handleTriggerAction("星星眼")}>
                🤩 星星眼
              </button>
            </div>
            {onOpenAlbum && (
              <button className="cy-ambient-album-btn" onClick={onOpenAlbum}>
                📸 昔漣的時光回憶手帳
              </button>
            )}
            {onOpenCopilot && (
              <button className="cy-ambient-copilot-btn" onClick={onOpenCopilot}>
                👁️ Vision Co-pilot 視覺看螢幕
              </button>
            )}
            {onOpenPodcast && (
              <button className="cy-ambient-podcast-btn" onClick={onOpenPodcast}>
                📻 昔漣每日聲音電台
              </button>
            )}
            {onOpenTrpg && (
              <button className="cy-ambient-trpg-btn" onClick={onOpenTrpg}>
                🎲 昔漣 TRPG 跑團冒險
              </button>
            )}
            {onOpenAffection && (
              <button className="cy-ambient-affection-btn" onClick={onOpenAffection}>
                💖 昔漣羈絆與好感度成長樹
              </button>
            )}
            {onOpenProactive && (
              <button className="cy-ambient-proactive-btn" onClick={onOpenProactive}>
                ⚡ 昔漣主動生活秘書與提醒
              </button>
            )}
            {onOpenSpotlight && (
              <button className="cy-ambient-spotlight-btn" onClick={onOpenSpotlight}>
                🔍 開啟全域浮動 Spotlight 膠囊 (Cmd+K)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
