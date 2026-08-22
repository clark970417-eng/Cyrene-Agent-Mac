import React, { useEffect, useState } from "react";
import type { TrpgSessionState } from "../../../../shared/trpg-types";
import "./TrpgGameModal.css";

export interface TrpgGameModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TrpgGameModal({ isOpen, onClose }: TrpgGameModalProps) {
  const [session, setSession] = useState<TrpgSessionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [rollingDice, setRollingDice] = useState(false);
  const [lastDice, setLastDice] = useState<number | null>(null);

  const initOrFetch = async () => {
    if (!window.trpg) return;
    setLoading(true);
    try {
      const existing = await window.trpg.getState();
      if (existing) {
        setSession(existing);
      } else {
        const started = await window.trpg.startSession({
          characterName: "星之旅人",
          className: "逐光遊俠",
        });
        setSession(started);
      }
    } catch (err) {
      console.error("[TRPG] Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void initOrFetch();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChoice = async (choiceId: string) => {
    if (!window.trpg || !session) return;
    setRollingDice(true);
    // Simulate dice roll visual
    const rollInterval = setInterval(() => {
      setLastDice(Math.floor(Math.random() * 20) + 1);
    }, 60);

    setTimeout(async () => {
      clearInterval(rollInterval);
      setRollingDice(false);
      try {
        const next = await window.trpg.sendAction({ choiceId });
        setSession(next);
      } catch (err) {
        console.error("[TRPG] Action error:", err);
      }
    }, 600);
  };

  const handleRestart = async () => {
    if (!window.trpg) return;
    setLoading(true);
    try {
      const started = await window.trpg.startSession({
        characterName: "星之旅人",
        className: "逐光遊俠",
      });
      setSession(started);
    } catch (err) {
      console.error("[TRPG] Restart error:", err);
    } finally {
      setLoading(false);
    }
  };

  const char = session?.character;
  const hpPercent = char ? Math.max(0, Math.min(100, (char.hp / char.maxHp) * 100)) : 100;

  return (
    <div className="cy-trpg-overlay" onClick={onClose}>
      <div className="cy-trpg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cy-trpg-header">
          <div className="cy-trpg-title-group">
            <h2 className="cy-trpg-title">🎲 昔漣 TRPG 跑團冒險房</h2>
            <span className="cy-trpg-subtitle">{session?.scenarioTitle ?? "古老遺跡的呼喚"}</span>
          </div>
          <div className="cy-trpg-header-actions">
            <button className="cy-trpg-restart-btn" onClick={handleRestart}>
              🔄 重新開局
            </button>
            <button className="cy-trpg-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {char && (
          <div className="cy-trpg-character-hud">
            <div className="cy-trpg-hud-avatar">
              <span className="cy-trpg-avatar-icon">🏹</span>
              <div className="cy-trpg-char-name">
                <strong>{char.name}</strong> · {char.className}
              </div>
            </div>
            <div className="cy-trpg-hud-stats">
              <div className="cy-trpg-hp-bar-wrapper">
                <span className="cy-trpg-hud-label">HP {char.hp}/{char.maxHp}</span>
                <div className="cy-trpg-hp-bar">
                  <div className="cy-trpg-hp-fill" style={{ width: `${hpPercent}%` }} />
                </div>
              </div>
              <div className="cy-trpg-stat-badges">
                <span className="cy-trpg-stat">力量 +{char.stats.str}</span>
                <span className="cy-trpg-stat">敏捷 +{char.stats.agi}</span>
                <span className="cy-trpg-stat">智力 +{char.stats.int}</span>
                <span className="cy-trpg-stat">魅力 +{char.stats.cha}</span>
                <span className="cy-trpg-stat is-gold">💰 {char.gold} G</span>
              </div>
            </div>
          </div>
        )}

        <div className="cy-trpg-body">
          <div className="cy-trpg-log-scroll">
            {session?.logs.map((log) => (
              <div className={`cy-trpg-log-item is-${log.speaker}`} key={log.id}>
                <div className="cy-trpg-log-speaker">
                  {log.speaker === "GM" ? "昔漣 (GM) 🌸" : log.speaker === "player" ? "冒險者 🗡️" : "系統 ⚙️"}
                </div>
                <div className="cy-trpg-log-bubble">
                  {log.message}
                  {log.diceRoll && (
                    <div className={`cy-trpg-dice-badge ${log.diceRoll.passed ? "is-pass" : "is-fail"}`}>
                      🎲 擲骰檢定: D20 ({log.diceRoll.d20}) + 修正 ({log.diceRoll.bonus}) = {log.diceRoll.total} · DC {log.diceRoll.dc} ({log.diceRoll.passed ? "成功 ✔️" : "失誤 ❌"})
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="cy-trpg-choices-panel">
            <div className="cy-trpg-choices-title">請做出你的決策：</div>
            {rollingDice && (
              <div className="cy-trpg-rolling-banner">
                <span className="cy-trpg-d20-icon">🎲</span>
                <span>正在擲出 D20 命運之骰... [{lastDice}]</span>
              </div>
            )}
            <div className="cy-trpg-choices-list">
              {session?.choices.map((c) => (
                <button
                  key={c.id}
                  className="cy-trpg-choice-btn"
                  onClick={() => handleChoice(c.id)}
                  disabled={rollingDice}
                >
                  <span className="cy-trpg-choice-text">{c.text}</span>
                  {c.check && (
                    <span className="cy-trpg-check-badge">
                      {c.check.stat.toUpperCase()} DC {c.check.dc}
                    </span>
                  )}
                </button>
              ))}
              {session?.choices.length === 0 && (
                <div className="cy-trpg-end-notice">
                  {session.isVictory ? "🎉 恭喜達成探索冒險勝利！" : "冒險告一段落。"}
                  <button className="cy-trpg-choice-btn is-restart" onClick={handleRestart}>
                    ✨ 開啟新的冒險篇章
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
