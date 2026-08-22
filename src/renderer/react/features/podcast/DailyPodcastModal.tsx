import React, { useEffect, useState } from "react";
import type { DailyPodcastScript, PodcastType } from "../../../../shared/podcast-types";
import "./DailyPodcastModal.css";

export interface DailyPodcastModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DailyPodcastModal({ isOpen, onClose }: DailyPodcastModalProps) {
  const [podcast, setPodcast] = useState<DailyPodcastScript | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentIdx, setCurrentSegmentIdx] = useState<number | null>(null);

  const fetchTodayOrGenerate = async (type?: PodcastType) => {
    if (!window.podcast) return;
    setLoading(true);
    try {
      if (!type) {
        const existing = await window.podcast.getToday();
        if (existing) {
          setPodcast(existing);
          setLoading(false);
          return;
        }
      }
      const generated = await window.podcast.generate({ type });
      setPodcast(generated);
    } catch (err) {
      console.error("[DailyPodcast] Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchTodayOrGenerate();
    } else {
      setIsPlaying(false);
      setCurrentSegmentIdx(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePlayVoice = (text: string, index?: number) => {
    if (index !== undefined) setCurrentSegmentIdx(index);
    setIsPlaying(true);
    // 透過 TTS 或語音播放
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-TW";
      utterance.onend = () => {
        setIsPlaying(false);
        setCurrentSegmentIdx(null);
      };
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleStopVoice = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setCurrentSegmentIdx(null);
  };

  return (
    <div className="cy-podcast-overlay" onClick={onClose}>
      <div className="cy-podcast-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cy-podcast-header">
          <div className="cy-podcast-title-group">
            <h2 className="cy-podcast-title">📻 昔漣的每日聲音電台 (Daily Podcast)</h2>
            <span className="cy-podcast-subtitle">專屬於你的晨光簡報與星空晚安廣播</span>
          </div>
          <button className="cy-podcast-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cy-podcast-toolbar">
          <div className="cy-podcast-type-selector">
            <button
              className={`cy-podcast-type-btn ${podcast?.type === "morning" ? "is-active" : ""}`}
              onClick={() => void fetchTodayOrGenerate("morning")}
              disabled={loading}
            >
              🌅 晨光早報
            </button>
            <button
              className={`cy-podcast-type-btn ${podcast?.type === "evening" ? "is-active" : ""}`}
              onClick={() => void fetchTodayOrGenerate("evening")}
              disabled={loading}
            >
              🌙 星空晚安
            </button>
          </div>
          <div className="cy-podcast-play-controls">
            {isPlaying ? (
              <button className="cy-podcast-btn-stop" onClick={handleStopVoice}>
                ⏹ 停止播報
              </button>
            ) : (
              <button
                className="cy-podcast-btn-play-all"
                onClick={() => podcast && handlePlayVoice(podcast.fullText)}
                disabled={loading || !podcast}
              >
                ▶ 完整朗讀今日節目
              </button>
            )}
          </div>
        </div>

        <div className="cy-podcast-body">
          {loading && (
            <div className="cy-podcast-loading">
              <div className="cy-podcast-spinner" />
              <p>昔漣正在為你整理今日廣播講稿...</p>
            </div>
          )}

          {!loading && podcast && (
            <div className="cy-podcast-content">
              <div className="cy-podcast-banner">
                <h3>{podcast.title}</h3>
                <span className="cy-podcast-date">{podcast.dateStr}</span>
              </div>

              <div className="cy-podcast-segments">
                {podcast.segments.map((segment, idx) => (
                  <div
                    className={`cy-podcast-segment-card ${currentSegmentIdx === idx ? "is-playing" : ""}`}
                    key={idx}
                  >
                    <div className="cy-podcast-segment-header">
                      <span className="cy-podcast-segment-tag">段落 {idx + 1} · {segment.name}</span>
                      <button
                        className="cy-podcast-segment-play-btn"
                        onClick={() => handlePlayVoice(segment.text, idx)}
                        title="單段朗讀"
                      >
                        🎙️ 播放這段
                      </button>
                    </div>
                    <p className="cy-podcast-segment-text">{segment.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
