// TRPG 跑團冒險 共享型別定義

export type TrpgStatKey = "str" | "agi" | "int" | "cha";

export interface TrpgStats {
  str: number; // 力量
  agi: number; // 敏捷
  int: number; // 智力
  cha: number; // 魅力
}

export interface TrpgCharacter {
  name: string;
  className: string;
  hp: number;
  maxHp: number;
  stats: TrpgStats;
  gold: number;
  inventory: string[];
}

export interface TrpgCheckReq {
  stat: TrpgStatKey;
  dc: number; // 難度檢定值 Difficulty Class
}

export interface TrpgChoice {
  id: string;
  text: string;
  check?: TrpgCheckReq;
}

export interface DiceRollResult {
  d20: number;
  bonus: number;
  total: number;
  dc: number;
  passed: boolean;
}

export interface TrpgLog {
  id: string;
  speaker: "GM" | "player" | "system";
  message: string;
  diceRoll?: DiceRollResult;
  timestamp: number;
}

export interface TrpgSessionState {
  id: string;
  scenarioTitle: string;
  character: TrpgCharacter;
  currentSceneText: string;
  choices: TrpgChoice[];
  logs: TrpgLog[];
  isGameOver: boolean;
  isVictory: boolean;
}

export interface StartTrpgPayload {
  scenarioTitle?: string;
  characterName?: string;
  className?: string;
}

export interface SendTrpgActionPayload {
  choiceId?: string;
  customText?: string;
}
