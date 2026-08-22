/**
 * 前肩帶的跟隨修正。
 *
 * ## 問題
 *
 * `右前肩带1` / `左前肩带1` 這兩根骨頭掛著前肩甲的 44 個頂點，而它們的
 * **父骨是 `右腕` / `左腕`（上臂）**。骨架階層讓它們 100% 繼承上臂的旋轉：
 * 手一抬，那片肩甲就整片翻上去、從肩膀滑脫。
 *
 * 模型本身沒有給任何補償 —— 這 8 根肩帶骨（前後、左右各兩節）
 * **沒有剛體、沒有關節、也沒有付与**：
 *
 *   右前肩带1  父:右腕   剛體:無  關節:無  付与:無  蒙皮頂點:44
 *   右前肩带2  父:右肩   ...
 *   右后肩带1  父:右肩   ...
 *   右后肩带2  父:右后肩带1
 *
 * 所以它們既不是物理布料（`pmx-loader` 舊註解說「交回彈簧骨處理」其實從來
 * 沒生效過 —— 沒有剛體就進不了 `physicsBoneSet`），也沒有反向抵銷骨。
 *
 * 只有 `前肩带1` 需要修：`前肩带2` 與 `后肩带1` 的父骨是 `肩`，而肩膀的
 * 轉動幅度本來就小得多；`后肩带2` 又是 `后肩带1` 的子骨，跟著上一層就好。
 *
 * ## 修法
 *
 * 補一筆**比例為負的付与**。這不是自創的招式 —— PMX 自己就用它做 `肩C`、
 * `腰キャンセル` 這類反向抵銷骨（比例 -1 代表完全抵掉父骨的旋轉）。
 * 這裡用 -0.65，抵掉 65%、留下 35% 的跟隨，肩甲會像真的披掛物那樣
 * 稍微被帶起來，但不會整片翻走。
 */

import * as THREE from "three";
import type { AppendTransformEntry } from "./append-transform";

/**
 * 前肩帶實際跟隨上臂的比例。
 *
 * 0 = 完全不動（手臂會從肩甲裡穿出去），1 = 原本那個壞掉的行為。
 * 0.35 是「看起來像被帶了一下的披掛物」。
 */
export const SHOULDER_STRAP_FOLLOW_RATIO = 0.35;

/** 付与的比例 = 要抵掉的量，取負。 */
const CANCEL_RATIO = -(1 - SHOULDER_STRAP_FOLLOW_RATIO);

/** 要修的骨頭與它要抵銷的來源。 */
const STRAP_FIXES: ReadonlyArray<{ bone: string; source: string }> = [
  { bone: "右前肩带1", source: "右腕" },
  { bone: "左前肩带1", source: "左腕" },
];

/**
 * 產生補償用的付与項目。
 *
 * 回傳的項目要接在 PMX 原生的付与清單**後面**（這兩根骨頭的索引 136 / 153
 * 都大於 `腕`，順序上本來就該排在來源之後），一起交給
 * `applyAppendTransforms`。
 *
 * 骨架裡找不到對應骨頭時安靜略過 —— 這份修正是針對昔漣那顆模型的，
 * 換模型不該讓載入流程掛掉。
 */
export function buildSyntheticAppendTransforms(
  bones: readonly THREE.Bone[]
): AppendTransformEntry[] {
  const byName = new Map<string, THREE.Bone>();
  for (const bone of bones) {
    if (!byName.has(bone.name)) byName.set(bone.name, bone);
  }

  const entries: AppendTransformEntry[] = [];
  for (const fix of STRAP_FIXES) {
    const bone = byName.get(fix.bone);
    const source = byName.get(fix.source);
    if (!bone || !source) continue;

    entries.push({
      bone,
      source,
      ratio: CANCEL_RATIO,
      affectRotation: true,
      affectPosition: false,
      bindRotation: bone.quaternion.clone(),
      bindPosition: bone.position.clone(),
      sourceBindPosition: source.position.clone(),
    });
  }
  return entries;
}
