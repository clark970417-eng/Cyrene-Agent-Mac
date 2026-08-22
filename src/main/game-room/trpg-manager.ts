// TRPG Manager -- 掌管跑團冒險世界、D20 骰子判定與劇本狀態機

import { randomUUID } from "node:crypto";
import type {
  DiceRollResult,
  SendTrpgActionPayload,
  StartTrpgPayload,
  TrpgCharacter,
  TrpgChoice,
  TrpgLog,
  TrpgSessionState,
  TrpgStatKey,
} from "../../shared/trpg-types";

export class TrpgManager {
  private currentState: TrpgSessionState | null = null;

  rollDice(d20Value?: number, bonus = 0, dc = 10): DiceRollResult {
    const d20 = d20Value ?? Math.floor(Math.random() * 20) + 1;
    const total = d20 + bonus;
    const passed = d20 === 20 ? true : d20 === 1 ? false : total >= dc;
    return { d20, bonus, total, dc, passed };
  }

  startSession(payload: StartTrpgPayload = {}): TrpgSessionState {
    const character: TrpgCharacter = {
      name: payload.characterName || "冒險者",
      className: payload.className || "逐光遊俠",
      hp: 20,
      maxHp: 20,
      stats: {
        str: 3,
        agi: 4,
        int: 2,
        cha: 2,
      },
      gold: 50,
      inventory: ["精鋼短劍", "輕型皮甲", "微光藥水 x1"],
    };

    const scenarioTitle = payload.scenarioTitle || "古老星語遺跡的探索";
    const initialScene =
      "【昔漣 GM】各位請就位～迷霧在古老的神廟前緩緩散開，厚重的石門上刻滿了閃爍微光的符文。\n" +
      "空氣中飄散著遠古魔法的氣息，兩側的石像鬼彷彿正悄悄注視著你們。眼前的石門緊閉，旁邊有一條被藤蔓掩蓋的低矮暗道。你們打算怎麼做？";

    const choices: TrpgChoice[] = [
      { id: "c1", text: "用力推開沉重的石門", check: { stat: "str", dc: 12 } },
      { id: "c2", text: "敏捷地穿過藤蔓暗道", check: { stat: "agi", dc: 10 } },
      { id: "c3", text: "仔細辨識石門上的神秘符文", check: { stat: "int", dc: 11 } },
      { id: "c4", text: "向周圍的高等靈魂發起溝通", check: { stat: "cha", dc: 10 } },
    ];

    const initialLog: TrpgLog = {
      id: randomUUID(),
      speaker: "GM",
      message: initialScene,
      timestamp: Date.now(),
    };

    this.currentState = {
      id: randomUUID(),
      scenarioTitle,
      character,
      currentSceneText: initialScene,
      choices,
      logs: [initialLog],
      isGameOver: false,
      isVictory: false,
    };

    return { ...this.currentState };
  }

  sendAction(payload: SendTrpgActionPayload): TrpgSessionState {
    if (!this.currentState) {
      return this.startSession();
    }

    const state = this.currentState;
    const now = Date.now();

    const selectedChoice = state.choices.find((c) => c.id === payload.choiceId);
    const actionText = selectedChoice ? selectedChoice.text : payload.customText || "環顧四周並尋找線索";

    // 1. 記錄玩家行動
    state.logs.push({
      id: randomUUID(),
      speaker: "player",
      message: `${state.character.name} 選擇了：「${actionText}」`,
      timestamp: now,
    });

    // 2. 進行 D20 檢定（若有需要）
    let rollResult: DiceRollResult | undefined;
    if (selectedChoice?.check) {
      const statBonus = state.character.stats[selectedChoice.check.stat] || 0;
      rollResult = this.rollDice(undefined, statBonus, selectedChoice.check.dc);
    }

    // 3. GM 回應與劇情分支推進
    let gmReply = "";
    if (rollResult) {
      if (rollResult.passed) {
        gmReply =
          `【昔漣 GM】🎲 擲骰成功（D20: ${rollResult.d20} + ${rollResult.bonus} = ${rollResult.total} >= DC ${rollResult.dc}）！\n` +
          `伴隨著一陣清脆的機關解鎖聲，你俐落地突破了障礙！殿堂內部展現出一片純淨的星光水池，池中央漂浮著一把散發溫暖光芒的「星之晨曦權杖」。你感到一股純淨的力量融入體內！`;
        state.character.gold += 30;
        state.character.inventory.push("星之晨曦權杖");
        state.isVictory = true;
        state.choices = [];
      } else {
        gmReply =
          `【昔漣 GM】🎲 擲骰失誤（D20: ${rollResult.d20} + ${rollResult.bonus} = ${rollResult.total} < DC ${rollResult.dc}）！\n` +
          `機關被不小心觸發了！一道微弱的電光閃過，你受到了 4 點擦傷傷害，但你也藉此看清了機關的破綻。`;
        state.character.hp = Math.max(1, state.character.hp - 4);
        state.choices = [
          { id: "c_retry", text: "服下微光藥水並重新調整姿勢突破", check: { stat: "agi", dc: 9 } },
          { id: "c_cast", text: "呼喚昔漣施放防護結界掩護", check: { stat: "int", dc: 8 } },
        ];
      }
    } else {
      gmReply = `【昔漣 GM】你在四周仔細搜索，發現了刻在石板上的古老提示，似乎對接下來的行動大有幫助！`;
    }

    state.currentSceneText = gmReply;
    state.logs.push({
      id: randomUUID(),
      speaker: "GM",
      message: gmReply,
      diceRoll: rollResult,
      timestamp: now + 1,
    });

    return { ...this.currentState };
  }

  getState(): TrpgSessionState | null {
    return this.currentState ? { ...this.currentState } : null;
  }
}
