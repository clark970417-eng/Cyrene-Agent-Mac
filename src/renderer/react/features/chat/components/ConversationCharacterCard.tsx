import type { CharacterAgentProfile } from "../../../../../shared/character-agents";

interface ConversationCharacterCardProps {
  characters: Array<CharacterAgentProfile & { avatarUrl: string }>;
}

export function ConversationCharacterCard({ characters }: ConversationCharacterCardProps) {
  const primary = characters[0];
  const isGroup = characters.length >= 2;
  return (
    <section className="cy-character-contract" aria-label={`本對話固定角色：${characters.map((character) => character.name).join("、")}`}>
      <div className={`cy-character-contract__portrait-wrap ${isGroup ? "is-group" : ""}`}>
        <span className="cy-character-contract__orbit" aria-hidden="true" />
        {characters.slice(0, 3).map((character) => (
          <img className="cy-character-contract__portrait" src={character.avatarUrl} alt={character.name} key={character.id} />
        ))}
        <span className="cy-character-contract__lock" title="角色已固定" aria-label="角色已固定">✓</span>
      </div>
      <div className="cy-character-contract__eyebrow">{isGroup ? "多人對話 · 固定陣容" : "本對話的固定角色"}</div>
      <h1>{characters.map((character) => character.name).join(" · ")}</h1>
      <div className="cy-character-contract__tags" aria-label="外觀標籤">
        {(isGroup ? characters.map((character) => character.name) : primary.appearanceTags)
          .map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <p>
        {isGroup
          ? "三位角色已綁定此聊天室，會使用各自的 Gemini 對話記憶依序回覆。"
          : `已綁定此對話。${primary.name}會保留自己的語氣與 Gemini 對話記憶；只有建立新對話時才會抽選其他角色。`}
      </p>
    </section>
  );
}
