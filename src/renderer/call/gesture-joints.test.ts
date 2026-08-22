/**
 * 手勢的**關節姿態**驗收。
 *
 * `gesture-reach.test.ts` 量的是「手有沒有到位」。手到位不代表好看 ——
 * 同一個手部位置，手肘可以往前折、上臂可以扭 120 度，位置一樣對，
 * 但畫面上是肩膀凹一塊、袖子擰成麻花。使用者回報的「揮手時這裡怪怪的」
 * 就是這一類：不是搆不到，是**中間那幾節的解很醜**。
 *
 * 這裡量三件事，都是能決定畫面好不好看、而且在程式碼裡看不出來的：
 *
 * 1. **手肘不能反折**。人的肘關節只往一個方向彎；解算器不知道，
 *    它只在乎手腕落點。反折的手臂一眼就看得出來壞掉。
 * 2. **上臂沿骨軸的扭轉要有上限**。超過大約 90 度，蒙皮就會把袖子擰成
 *    糖果紙。模型有 `腕捩` 分散骨可以分擔，但分散骨只能柔化，
 *    不能救「上臂本身就轉了 120 度」。
 * 3. **肩膀不能自己飛出去**。抬手主要靠上臂，肩膀跟著聳一點就好。
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadSkeletonFixture, type SkeletonFixture } from "./skeleton-fixture";
import { buildHandRig, buildTwistRig } from "./hand-pose";
import { buildArmChain } from "./arm-ik";
import { buildBodyAnchors } from "./body-anchors";
import { applyArmPose, applyLegPose, REST_ARM_POSE, type PoseRigs } from "./pose-composer";
import { GESTURE_CONFIGS, sampleGestureOffsets, type CyreneGestureName } from "./gestures";

function makeRigs(fx: SkeletonFixture): PoseRigs {
  return {
    hands: { left: buildHandRig(fx.bones, "left"), right: buildHandRig(fx.bones, "right") },
    twists: {
      leftArm: buildTwistRig(fx.bones, "左腕捩", "左腕", "左ひじ"),
      rightArm: buildTwistRig(fx.bones, "右腕捩", "右腕", "右ひじ"),
      leftForearm: buildTwistRig(fx.bones, "左手捩", "左ひじ", "左手首"),
      rightForearm: buildTwistRig(fx.bones, "右手捩", "右ひじ", "右手首"),
    },
    arms: { left: buildArmChain(fx.bones, "left"), right: buildArmChain(fx.bones, "right") },
    anchors: buildBodyAnchors(fx.bones, 1.65),
    updateWorld: () => fx.update(),
  };
}

const BASE_ARM = {
  left: { ...REST_ARM_POSE },
  right: { x: REST_ARM_POSE.x, y: -REST_ARM_POSE.y, z: -REST_ARM_POSE.z },
};

const ALL_GESTURES = Object.keys(GESTURE_CONFIGS) as CyreneGestureName[];

/** 沿骨頭自身軸向的扭轉量（度）。swing-twist 分解的 twist 部分。 */
function twistDegrees(bone: THREE.Bone, rest: THREE.Quaternion): number {
  const child = bone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
  if (!child) return 0;
  const axis = child.position.clone().normalize();
  const delta = bone.quaternion.clone().multiply(rest.clone().invert());
  const v = new THREE.Vector3(delta.x, delta.y, delta.z);
  const projected = axis.clone().multiplyScalar(v.dot(axis));
  const twist = new THREE.Quaternion(projected.x, projected.y, projected.z, delta.w).normalize();
  return (2 * Math.acos(Math.min(1, Math.abs(twist.w))) * 180) / Math.PI;
}

/** 兩個向量的夾角（度）。 */
function angleBetween(a: THREE.Vector3, b: THREE.Vector3): number {
  return (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;
}

describe("手勢的關節姿態", () => {
  const fx = loadSkeletonFixture();
  const rigs = makeRigs(fx);

  /** 種子姿勢下每根骨頭的局部旋轉，量偏移用的基準。 */
  fx.reset();
  const restRotations = new Map<string, THREE.Quaternion>();
  for (const [name, bone] of fx.bones) restRotations.set(name, bone.quaternion.clone());

  const pose = (name: CyreneGestureName): void => {
    const offsets = sampleGestureOffsets(name, GESTURE_CONFIGS[name].duration * 0.5);
    fx.reset();
    applyLegPose(fx.bones, offsets);
    applyArmPose(fx.bones, rigs, offsets, BASE_ARM);
    fx.update();
  };

  /**
   * 手肘的彎曲方向。
   *
   * 取上臂向量與前臂向量的叉積，投影到「手肘該繞的軸」上。人的手肘只能往
   * 身體內側／後方折；解出反方向就是反折。這裡用種子姿勢下的彎曲方向當
   * 正方向 —— 模型的 T-pose 手臂本來就帶一點自然彎曲，方向是可靠的。
   */
  const elbowBendSign = (side: "left" | "right"): { angle: number; sign: number } => {
    const upper = fx.worldOf(side === "left" ? "左腕" : "右腕");
    const elbow = fx.worldOf(side === "left" ? "左ひじ" : "右ひじ");
    const wrist = fx.worldOf(side === "left" ? "左手首" : "右手首");
    const a = upper.clone().sub(elbow).normalize();
    const b = wrist.clone().sub(elbow).normalize();
    // 180 度 = 完全打直
    const angle = angleBetween(a, b);
    // 叉積方向：往身體前方（+z）為正
    const cross = new THREE.Vector3().crossVectors(a, b);
    const sign = side === "left" ? Math.sign(cross.y) : Math.sign(-cross.y);
    return { angle, sign };
  };

  it("手肘不會反折（夾角不小於 25 度，也就是不會折過頭）", () => {
    const bad: string[] = [];
    for (const name of ALL_GESTURES) {
      pose(name);
      for (const side of ["left", "right"] as const) {
        const { angle } = elbowBendSign(side);
        if (angle <= 25) bad.push(`${name}/${side} ${angle.toFixed(1)}°`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("上臂沿骨軸的扭轉不超過 95 度（超過袖子會擰成麻花）", () => {
    const bad: string[] = [];
    for (const name of ALL_GESTURES) {
      pose(name);
      for (const boneName of ["左腕", "右腕"]) {
        const bone = fx.bones.get(boneName);
        const rest = restRotations.get(boneName);
        if (!bone || !rest) continue;
        const twist = twistDegrees(bone, rest);
        if (twist >= 95) bad.push(`${name}/${boneName} ${twist.toFixed(1)}°`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("前臂沿骨軸的扭轉不超過 110 度", () => {
    const bad: string[] = [];
    for (const name of ALL_GESTURES) {
      pose(name);
      for (const boneName of ["左ひじ", "右ひじ"]) {
        const bone = fx.bones.get(boneName);
        const rest = restRotations.get(boneName);
        if (!bone || !rest) continue;
        const twist = twistDegrees(bone, rest);
        if (twist >= 110) bad.push(`${name}/${boneName} ${twist.toFixed(1)}°`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 上限取 38 度而不是 SHOULDER_TOTAL_LIMIT 的 32 度。
   *
   * 解算器夾的是「肩胛節律用掉的角度 + IK 再給的角度」，兩段繞的軸不同，
   * 四元數合成之後的總角度會略大於兩者相加 —— 實測最多超出約 10%。
   * 這裡要抓的是 `salute` 那種 46 度的脫臼，不是計較幾度的合成誤差。
   */
  it("肩膀不會自己飛出去（相對種子姿勢不超過 38 度）", () => {
    const bad: string[] = [];
    for (const name of ALL_GESTURES) {
      pose(name);
      for (const boneName of ["左肩", "右肩"]) {
        const bone = fx.bones.get(boneName);
        const rest = restRotations.get(boneName);
        if (!bone || !rest) continue;
        const delta = bone.quaternion.clone().multiply(rest.clone().invert());
        const deg = (2 * Math.acos(Math.min(1, Math.abs(delta.w))) * 180) / Math.PI;
        if (deg >= 38) bad.push(`${name}/${boneName} ${deg.toFixed(1)}°`);
      }
    }
    expect(bad).toEqual([]);
  });
});
