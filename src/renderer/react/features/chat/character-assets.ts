import { getCharacterAgentProfile } from "../../../../shared/character-agents";
import cyrene from "../../assets/avatars/avatar-light.png";
import fengjin from "../../../tast/风堇.png";
import cerdella from "../../../tast/刻律德菈.png";
import evernight from "../../../tast/长夜月.png";
import castorice from "../../../tast/遐蝶.png";
import tribbie from "../../../tast/缇宝.png";
import aglaea from "../../../tast/阿格莱雅.png";
import phainon from "../../../tast/白厄.png";
import danHeng from "../../../tast/丹恒.png";
import hysilens from "../../../tast/海瑟音.png";
import anaxa from "../../../tast/那刻夏.png";
import cipher from "../../../tast/赛飞儿.png";
import mydei from "../../../tast/万敌.png";

const avatarById: Readonly<Record<string, string>> = {
  cyrene,
  fengjin,
  cerdella,
  evernight,
  castorice,
  tribbie,
  aglaea,
  phainon,
  dan_heng: danHeng,
  hysilens,
  anaxa,
  cipher,
  mydei,
};

export function resolveConversationCharacter(identityId: string | null | undefined) {
  const profile = getCharacterAgentProfile(identityId);
  if (!profile) return undefined;
  return { ...profile, avatarUrl: avatarById[profile.id] };
}
