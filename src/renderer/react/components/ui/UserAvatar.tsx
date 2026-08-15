import { useUserAvatar } from "../../hooks/useUserAvatar";
import { useUserNickname } from "../../hooks/useUserNickname";

interface UserAvatarProps {
  label?: string;
}

export function UserAvatar({ label }: UserAvatarProps) {
  const avatarUrl = useUserAvatar();
  const nickname = useUserNickname();
  const displayLabel = (label ?? nickname) || "User";

  return (
    <div className="cy-user-avatar">
      <div className="cy-user-avatar-circle">
        {avatarUrl
          ? <img src={avatarUrl} alt="使用者" draggable={false} />
          : <span>U</span>}
      </div>
      <span className="cy-user-avatar-label">{displayLabel}</span>
    </div>
  );
}
