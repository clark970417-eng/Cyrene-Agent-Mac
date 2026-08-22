interface CharacterStatusPillProps {
  avatarPath: string;
  avatarPaths?: string[];
  name?: string;
  status?: string;
}

export function CharacterStatusPill({
  avatarPath,
  avatarPaths,
  name = "Cyrene",
  status = "模型未連線",
}: CharacterStatusPillProps) {
  return (
    <div className="cy-status-pill">
      <span className={`cy-status-avatars ${(avatarPaths?.length ?? 0) > 1 ? "is-group" : ""}`}>
        {(avatarPaths?.length ? avatarPaths.slice(0, 3) : [avatarPath]).map((path, index) => (
          <img className="cy-status-avatar" src={path} alt="" key={`${path}-${index}`} />
        ))}
      </span>
      <span className="cy-status-name">{name}</span>
      <span className="cy-status-divider">·</span>
      <span className="cy-status-text">{status}</span>
    </div>
  );
}
