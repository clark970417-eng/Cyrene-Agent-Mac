import { useEffect, useState } from "react";
import type { AmbientState } from "../../../../shared/ambient-types";

interface CharacterStatusPillProps {
  avatarPath: string;
  avatarPaths?: string[];
  name?: string;
  status?: string;
  onClick?: () => void;
}

export function CharacterStatusPill({
  avatarPath,
  avatarPaths,
  name = "Cyrene",
  status = "模型未連線",
  onClick,
}: CharacterStatusPillProps) {
  const [ambientState, setAmbientState] = useState<AmbientState | null>(null);

  useEffect(() => {
    if (!window.ambient) return;
    void window.ambient.getState().then((state) => {
      setAmbientState(state);
    });
    return window.ambient.onStateChanged((state) => {
      setAmbientState(state);
    });
  }, []);

  const isFocusing = Boolean(ambientState?.focus?.isActive);
  const displayStatus = isFocusing
    ? ambientState?.statusText
    : status;

  return (
    <div
      className={`cy-status-pill ${onClick ? "is-clickable" : ""} ${isFocusing ? "is-focusing" : ""}`}
      onClick={onClick}
      title={ambientState ? `${ambientState.periodLabel} · ${ambientState.statusText}` : undefined}
    >
      <span className={`cy-status-avatars ${(avatarPaths?.length ?? 0) > 1 ? "is-group" : ""}`}>
        {(avatarPaths?.length ? avatarPaths.slice(0, 3) : [avatarPath]).map((path, index) => (
          <img className="cy-status-avatar" src={path} alt="" key={`${path}-${index}`} />
        ))}
      </span>
      <span className="cy-status-name">{name}</span>
      <span className="cy-status-divider">·</span>
      <span className="cy-status-text">{displayStatus}</span>
    </div>
  );
}
