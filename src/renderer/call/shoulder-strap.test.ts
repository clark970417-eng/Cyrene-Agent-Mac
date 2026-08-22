/**
 * 前肩帶跟隨上臂的比例。
 *
 * 問題：`右前肩带1` 這根骨頭的**父骨是 `右腕`（上臂）**，而它掛著 44 個
 * 前肩甲的頂點。骨架階層讓它 100% 繼承上臂的旋轉 —— 手一抬，那片肩甲就整片
 * 翻上去、從肩膀滑脫。
 *
 * 模型本身沒有給它任何補償：這 8 根肩帶骨**沒有剛體、沒有關節、也沒有付与**，
 * 所以既不是物理布料，也沒有反向抵銷。`pmx-loader` 舊註解說「交回彈簧骨處理」
 * 其實從來沒生效過 —— 沒有剛體就進不了 `physicsBoneSet`。
 *
 * 修法：補一筆比例為負的付与（PMX 自己就用這招做 `肩C`、`腰キャンセル`），
 * 抵掉一部分繼承來的旋轉。
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyAppendTransforms } from "./append-transform";
import { buildBones, computeSpace, loadPmx } from "./pmx-test-fixture";
import {
  SHOULDER_STRAP_FOLLOW_RATIO,
  buildSyntheticAppendTransforms,
} from "./shoulder-strap";

/** 把上臂轉一個角度，量前肩帶相對肩膀的世界旋轉差。 */
function measureStrapLag(
  bones: THREE.Bone[],
  roots: THREE.Bone[],
  armAngle: number,
  appendEntries: ReturnType<typeof buildSyntheticAppendTransforms>
): number {
  const arm = bones.find((b) => b.name === "右腕")!;
  const strap = bones.find((b) => b.name === "右前肩带1")!;
  const shoulder = bones.find((b) => b.name === "右肩")!;

  arm.quaternion.identity();
  strap.quaternion.identity();
  for (const r of roots) r.updateMatrixWorld(true);

  // 把手往上抬（繞 Z 軸）。
  arm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), armAngle);
  applyAppendTransforms(appendEntries);
  for (const r of roots) r.updateMatrixWorld(true);

  const strapQuat = new THREE.Quaternion();
  const shoulderQuat = new THREE.Quaternion();
  strap.getWorldQuaternion(strapQuat);
  shoulder.getWorldQuaternion(shoulderQuat);
  return shoulderQuat.angleTo(strapQuat);
}

describe("前肩帶的跟隨比例", () => {
  const pmx = loadPmx();
  const space = computeSpace(pmx);

  it("模型本身沒有給肩帶任何補償（問題的來源）", () => {
    const strapNames = [
      "右前肩带1", "右前肩带2", "右后肩带1", "右后肩带2",
      "左前肩带1", "左前肩带2", "左后肩带1", "左后肩带2",
    ];
    const byName = new Map<string, any>();
    pmx.bones.forEach((b: any, i: number) => byName.set(b.name, { ...b, index: i }));

    for (const name of strapNames) {
      const bone = byName.get(name);
      expect(bone, `${name} 應該存在`).toBeDefined();
      expect(bone.grant, `${name} 不該有付与`).toBeFalsy();
    }

    // 也沒有任何剛體掛在這些骨頭上 —— 所以它們不是物理布料。
    const strapIndices = new Set(strapNames.map((n) => byName.get(n).index));
    const withBody = (pmx.rigidBodies ?? []).filter((r: any) => strapIndices.has(r.boneIndex));
    expect(withBody).toEqual([]);
  });

  it("前肩帶的父骨是上臂，所以會整段繼承上臂旋轉", () => {
    const byIndex = pmx.bones;
    const strap = byIndex.find((b: any) => b.name === "右前肩带1")!;
    expect(byIndex[strap.parentIndex].name).toBe("右腕");
  });

  it("沒有補償時，肩甲跟著上臂轉滿角度", () => {
    const { bones, roots } = buildBones(pmx, space);
    const angle = 1.0; // 約 57 度
    const lag = measureStrapLag(bones, roots, angle, []);
    // 完全跟隨 → 相對肩膀的旋轉差就等於上臂轉的角度
    expect(lag).toBeCloseTo(angle, 2);
  });

  it("補上反向付与之後，跟隨量降到設定的比例", () => {
    const { bones, roots } = buildBones(pmx, space);
    const entries = buildSyntheticAppendTransforms(bones);
    expect(entries.length).toBe(2); // 左右各一

    const angle = 1.0;
    const lag = measureStrapLag(bones, roots, angle, entries);
    expect(lag).toBeCloseTo(angle * SHOULDER_STRAP_FOLLOW_RATIO, 2);
  });

  it("跟隨比例落在合理區間", () => {
    // 0 = 肩甲完全不動（手臂穿過去），1 = 原本的壞行為。
    expect(SHOULDER_STRAP_FOLLOW_RATIO).toBeGreaterThan(0.15);
    expect(SHOULDER_STRAP_FOLLOW_RATIO).toBeLessThan(0.6);
  });

  it("找不到對應骨頭時安靜略過，不丟例外", () => {
    expect(buildSyntheticAppendTransforms([])).toEqual([]);
  });
});
