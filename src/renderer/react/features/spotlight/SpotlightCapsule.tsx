import React, { useEffect, useRef, useState } from "react";
import { DEFAULT_SPOTLIGHT_COMMANDS, type SpotlightCommand } from "../../../../shared/spotlight-types";
import "./SpotlightCapsule.css";

export interface SpotlightCapsuleProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCopilot: () => void;
  onOpenAlbum: () => void;
  onOpenPodcast: () => void;
  onOpenTrpg: () => void;
  onStartFocus: () => void;
  onSendQuery?: (query: string) => void;
}

export function SpotlightCapsule({
  isOpen,
  onClose,
  onOpenCopilot,
  onOpenAlbum,
  onOpenPodcast,
  onOpenTrpg,
  onStartFocus,
  onSendQuery,
}: SpotlightCapsuleProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = DEFAULT_SPOTLIGHT_COMMANDS.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      cmd.subtitle.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExecute = (cmd: SpotlightCommand) => {
    onClose();
    switch (cmd.action) {
      case "copilot":
        onOpenCopilot();
        break;
      case "album":
        onOpenAlbum();
        break;
      case "podcast":
        onOpenPodcast();
        break;
      case "trpg":
        onOpenTrpg();
        break;
      case "pomodoro":
        onStartFocus();
        break;
      default:
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredCommands.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % (filteredCommands.length || 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands.length > 0 && selectedIndex < filteredCommands.length) {
        handleExecute(filteredCommands[selectedIndex]);
      } else if (query.trim() && onSendQuery) {
        onSendQuery(query.trim());
        onClose();
      }
    }
  };

  return (
    <div className="cy-spotlight-overlay" onClick={onClose}>
      <div className="cy-spotlight-box" onClick={(e) => e.stopPropagation()}>
        <div className="cy-spotlight-search-row">
          <span className="cy-spotlight-search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="cy-spotlight-input"
            placeholder="呼叫昔漣快捷指令，或直接輸入任何問題... (Esc 關閉)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <span className="cy-spotlight-badge">Cmd + K</span>
        </div>

        <div className="cy-spotlight-results">
          {filteredCommands.map((cmd, idx) => (
            <div
              key={cmd.id}
              className={`cy-spotlight-item ${idx === selectedIndex ? "is-selected" : ""}`}
              onClick={() => handleExecute(cmd)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span className="cy-spotlight-item-icon">{cmd.icon}</span>
              <div className="cy-spotlight-item-meta">
                <span className="cy-spotlight-item-title">{cmd.title}</span>
                <span className="cy-spotlight-item-subtitle">{cmd.subtitle}</span>
              </div>
              <span className="cy-spotlight-item-enter">⏎ 執行</span>
            </div>
          ))}

          {filteredCommands.length === 0 && query.trim() && (
            <div
              className="cy-spotlight-item is-selected"
              onClick={() => {
                if (onSendQuery) onSendQuery(query.trim());
                onClose();
              }}
            >
              <span className="cy-spotlight-item-icon">💬</span>
              <div className="cy-spotlight-item-meta">
                <span className="cy-spotlight-item-title">直接傳送給昔漣：「{query}」</span>
                <span className="cy-spotlight-item-subtitle">在主聊天對話中開啟此提問</span>
              </div>
              <span className="cy-spotlight-item-enter">⏎ 發送</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
