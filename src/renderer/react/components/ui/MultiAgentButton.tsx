interface MultiAgentButtonProps {
  onClick?: () => void;
}

export function MultiAgentButton({ onClick }: MultiAgentButtonProps) {
  return (
    <button className="cy-multi-agent-button" type="button" onClick={onClick}>
      <span className="cy-multi-agent-button__avatars" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span>多人對話</span>
      <span className="cy-multi-agent-button__count">3</span>
    </button>
  );
}
