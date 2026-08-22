import React, { useEffect, useState } from "react";
import type { ProactiveNotification } from "../../../../shared/proactive-types";
import "./ProactiveAssistantModal.css";

export interface ProactiveAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActionClick?: (actionLabel: string) => void;
}

export function ProactiveAssistantModal({ isOpen, onClose, onActionClick }: ProactiveAssistantModalProps) {
  const [notifications, setNotifications] = useState<ProactiveNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = async () => {
    if (!window.proactive) return;
    setLoading(true);
    try {
      await window.proactive.triggerCheck();
      const list = await window.proactive.getNotifications();
      setNotifications(list);
    } catch (err) {
      console.error("[Proactive] Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchNotifications();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDismiss = async (id: string) => {
    if (!window.proactive) return;
    await window.proactive.dismissNotification(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="cy-proactive-overlay" onClick={onClose}>
      <div className="cy-proactive-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cy-proactive-header">
          <div className="cy-proactive-title-group">
            <h2 className="cy-proactive-title">⚡ 昔漣主動生活秘書 (Proactive Assistant)</h2>
            <span className="cy-proactive-subtitle">智慧日程提醒、專注疲勞關懷與健康作息守護</span>
          </div>
          <button className="cy-proactive-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cy-proactive-body">
          {notifications.length === 0 && (
            <div className="cy-proactive-empty">
              <span className="cy-proactive-empty-icon">☕</span>
              <h3>目前沒有待處理的生活提醒</h3>
              <p>昔漣會在適當的時候（如連續工作過久或深夜時分）主動為你送上關懷與提示喔～</p>
            </div>
          )}

          {notifications.length > 0 && (
            <div className="cy-proactive-list">
              {notifications.map((n) => (
                <div className={`cy-proactive-card is-${n.type}`} key={n.id}>
                  <div className="cy-proactive-card-icon">{n.icon}</div>
                  <div className="cy-proactive-card-content">
                    <div className="cy-proactive-card-header">
                      <strong>{n.title}</strong>
                      <span className="cy-proactive-card-time">
                        {new Date(n.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="cy-proactive-card-msg">{n.message}</p>
                    <div className="cy-proactive-card-actions">
                      {n.actionLabel && (
                        <button
                          className="cy-proactive-btn-action"
                          onClick={() => {
                            onClose();
                            if (onActionClick) onActionClick(n.actionLabel!);
                          }}
                        >
                          ✨ {n.actionLabel}
                        </button>
                      )}
                      <button className="cy-proactive-btn-dismiss" onClick={() => void handleDismiss(n.id)}>
                        標記已知
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
