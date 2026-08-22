import React, { useState } from "react";
import type { VisionCopilotResponse } from "../../../../shared/copilot-types";
import "./VisionCopilotModal.css";

export interface VisionCopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VisionCopilotModal({ isOpen, onClose }: VisionCopilotModalProps) {
  const [question, setQuestion] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<VisionCopilotResponse | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    if (!window.visionCopilot) return;
    setAnalyzing(true);
    setResult(null);
    try {
      const res = await window.visionCopilot.analyzeScreen({
        question: question.trim() || undefined,
        autoSpeak,
      });
      setResult(res);
    } catch (err) {
      console.error("[VisionCopilot] Analysis error:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="cy-copilot-overlay" onClick={onClose}>
      <div className="cy-copilot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cy-copilot-header">
          <div className="cy-copilot-title-group">
            <h2 className="cy-copilot-title">👁️ 昔漣 Vision Co-pilot 視覺輔助</h2>
            <span className="cy-copilot-subtitle">即時截取並分析當前螢幕畫面，為你提供解答與建議</span>
          </div>
          <button className="cy-copilot-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cy-copilot-body">
          <div className="cy-copilot-input-section">
            <label className="cy-copilot-label">想請昔漣注意什麼？（可選）</label>
            <input
              className="cy-copilot-input"
              type="text"
              placeholder="例：幫我看看這段程式碼哪裡有 Bug？/ 遊戲這關怎麼過？"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={analyzing}
            />
            <div className="cy-copilot-options">
              <label className="cy-copilot-checkbox-label">
                <input
                  type="checkbox"
                  checked={autoSpeak}
                  onChange={(e) => setAutoSpeak(e.target.checked)}
                />
                用語音朗讀分析摘要 🎙️
              </label>
              <button
                className="cy-copilot-trigger-btn"
                onClick={handleAnalyze}
                disabled={analyzing}
              >
                {analyzing ? "昔漣正在仔細觀察畫面..." : "📸 截取螢幕並分析"}
              </button>
            </div>
          </div>

          {analyzing && (
            <div className="cy-copilot-loading">
              <div className="cy-copilot-spinner" />
              <p>昔漣正在閱讀畫面中的細節，請稍候...</p>
            </div>
          )}

          {result && (
            <div className="cy-copilot-result-box">
              <h3>✨ 昔漣的畫面分析與建議</h3>
              <div className="cy-copilot-analysis-text">{result.analysis}</div>
              {result.suggestions && result.suggestions.length > 0 && (
                <div className="cy-copilot-suggestions">
                  <div className="cy-copilot-suggestions-title">💡 行動建議：</div>
                  <ul>
                    {result.suggestions.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
