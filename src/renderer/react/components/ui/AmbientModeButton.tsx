interface AmbientModeButtonProps {
  active?: boolean;
  onClick?: () => void;
}

export function AmbientModeButton({ active = false, onClick }: AmbientModeButtonProps) {
  return (
    <button
      className={`cy-side-action ${active ? "is-active" : ""}`}
      onClick={onClick}
      type="button"
      title="伴侶生活與旗艦功能"
      aria-pressed={active}
    >
      <span className="cy-side-action-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      </span>
      <span className="cy-side-action-label">伴侶</span>
    </button>
  );
}
