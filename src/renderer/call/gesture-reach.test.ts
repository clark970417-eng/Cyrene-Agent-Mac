import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadSkeletonFixture, type SkeletonFixture } from "./skeleton-fixture";
import { buildHandRig, buildTwistRig } from "./hand-pose";
import { buildArmChain } from "./arm-ik";
import { buildBodyAnchors, type BodyAnchors } from "./body-anchors";
import { applyArmPose, applyLegPose, REST_ARM_POSE, type PoseRigs } from "./pose-composer";
import { GESTURE_CONFIGS, sampleGestureOffsets, type CyreneGestureName } from "./gestures";

/**
 * 手勢驗收：在真骨架上擺出每個動作，量手最後落在哪裡。
 *
 * 為什麼需要這一整套：手勢原本是手寫每根骨頭的 euler 偏移，沒人量過結果。
 * 實際量出來是「摀臉」的手停在胸口（y=1.19，臉頰在 y=1.42）、「拍手」的兩隻手
 * 交叉穿過對方、「歡呼」的手比肩膀還低。這種錯誤在程式碼裡看不出來，只有
 * 量位置才看得到。
 */

/**
 * 手臂長度從骨架量，不要寫死。
 *
 * 原本寫死 0.233（「上臂 0.124 + 前臂 0.109」）。後來 pmx-loader 把高度基準
 * 從幾何最低點改成腳底，模型整體放大 1.62 倍，這個常數就過時了 ——
 * 所有「搆不搆得到」的判斷會全部誤判成搆不到。
 */
function measureArmLength(fx: SkeletonFixture): number {
  const p = (n: string): THREE.Vector3 | null => {
    const b = fx.bones.get(n);
    return b ? b.getWorldPosition(new THREE.Vector3()) : null;
  };
  const shoulder = p("左腕");
  const elbow = p("左ひじ");
  const wrist = p("左手首");
  if (!shoulder || !elbow || !wrist) return 0.38;
  return shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
}

function makeRigs(fx: SkeletonFixture): { rigs: PoseRigs; anchors: BodyAnchors } {
  // 骨架 fixture 的身高與 pmx-loader 的 TARGET_HEIGHT 一致。
  const anchors = buildBodyAnchors(fx.bones, 1.65);
  const rigs: PoseRigs = {
    hands: { left: buildHandRig(fx.bones, "left"), right: buildHandRig(fx.bones, "right") },
    twists: {
      leftArm: buildTwistRig(fx.bones, "左腕捩", "左腕", "左ひじ"),
      rightArm: buildTwistRig(fx.bones, "右腕捩", "右腕", "右ひじ"),
      leftForearm: buildTwistRig(fx.bones, "左手捩", "左ひじ", "左手首"),
      rightForearm: buildTwistRig(fx.bones, "右手捩", "右ひじ", "右手首"),
    },
    arms: { left: buildArmChain(fx.bones, "left"), right: buildArmChain(fx.bones, "right") },
    anchors,
    updateWorld: () => fx.update(),
  };
  return { rigs, anchors };
}

const BASE_ARM = {
  left: { ...REST_ARM_POSE },
  right: { x: REST_ARM_POSE.x, y: -REST_ARM_POSE.y, z: -REST_ARM_POSE.z },
};

function poseGesture(
  fx: SkeletonFixture,
  rigs: PoseRigs,
  name: CyreneGestureName,
  time: number
): ReturnType<typeof sampleGestureOffsets> {
  const offsets = sampleGestureOffsets(name, time);
  fx.reset();
  applyLegPose(fx.bones, offsets);
  applyArmPose(fx.bones, rigs, offsets, BASE_ARM);
  fx.update();
  return offsets;
}

const ALL_GESTURES = Object.keys(GESTURE_CONFIGS) as CyreneGestureName[];

describe("手勢的手實際落點", () => {
  const fx = loadSkeletonFixture();
  const { rigs, anchors } = makeRigs(fx);
  const point = new THREE.Vector3();
  const armLength = measureArmLength(fx);

  it("每個定位點都在手臂搆得到的範圍內", () => {
    fx.reset();
    for (const name of ALL_GESTURES) {
      const offsets = poseGesture(fx, rigs, name, GESTURE_CONFIGS[name].duration * 0.5);
      for (const side of ["left", "right"] as const) {
        const target = side === "left" ? offsets?.leftHandTarget : offsets?.rightHandTarget;
        if (!target) continue;
        fx.reset();
        anchors.resolve(target.anchor, point);
        const shoulder = fx.worldOf(side === "left" ? "左腕" : "右腕");
        // 伸懶腰刻意讓手臂拉到極限，允許略超過。
        expect(point.distanceTo(shoulder), `${name}/${side}/${target.anchor}`)
          .toBeLessThan(armLength * 1.12);
      }
    }
  });

  it("有指定目標的手都真的到得了（誤差 3cm 內）", () => {
    for (const name of ALL_GESTURES) {
      const offsets = poseGesture(fx, rigs, name, GESTURE_CONFIGS[name].duration * 0.5);
      for (const side of ["left", "right"] as const) {
        const target = side === "left" ? offsets?.leftHandTarget : offsets?.rightHandTarget;
        if (!target) continue;
        anchors.resolve(target.anchor, point);
        point.x += target.offset?.x ?? 0;
        point.y += target.offset?.y ?? 0;
        point.z += target.offset?.z ?? 0;
        const wrist = fx.worldOf(side === "left" ? "左手首" : "右手首");
        expect(wrist.distanceTo(point), `${name}/${side}`).toBeLessThan(0.03);
      }
    }
  });

  it("兩隻手不會交叉穿過對方", () => {
    for (const name of ALL_GESTURES) {
      poseGesture(fx, rigs, name, GESTURE_CONFIGS[name].duration * 0.5);
      const left = fx.worldOf("左手首");
      const right = fx.worldOf("右手首");
      // 左手屬於 +x 側。合十與拍手會靠到中線，但不該越過去。
      expect(left.x, `${name} 左手越過中線`).toBeGreaterThan(-0.005);
      expect(right.x, `${name} 右手越過中線`).toBeLessThan(0.005);
    }
  });

  it("手的朝向對得上指定方向（20 度內）", () => {
    const palmWorld = new THREE.Vector3();
    const fingerWorld = new THREE.Vector3();
    const wantPalm = new THREE.Vector3();
    const wantFinger = new THREE.Vector3();
    const angleTo = (a: THREE.Vector3, b: THREE.Vector3): number =>
      (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;

    for (const name of ALL_GESTURES) {
      const offsets = poseGesture(fx, rigs, name, GESTURE_CONFIGS[name].duration * 0.5);
      for (const side of ["left", "right"] as const) {
        const target = side === "left" ? offsets?.leftHandTarget : offsets?.rightHandTarget;
        const rig = side === "left" ? rigs.hands.left : rigs.hands.right;
        if (!target?.palm || !rig) continue;
        const wrist = fx.bones.get(side === "left" ? "左手首" : "右手首")!;
        palmWorld.copy(rig.palmNormal).transformDirection(wrist.matrixWorld).normalize();
        wantPalm.set(target.palm.x, target.palm.y, target.palm.z).normalize();

        if (target.fingers) {
          // 兩個軸一起解的時候，掌心只保證「垂直於指尖方向的那個分量」對得上：
          // 呼叫端給的掌心方向不必自己算垂直，會先被正交化（見 aimHand）。
          fingerWorld.copy(rig.fingerDir).transformDirection(wrist.matrixWorld).normalize();
          wantFinger.set(target.fingers.x, target.fingers.y, target.fingers.z).normalize();
          expect(angleTo(fingerWorld, wantFinger), `${name}/${side} 指尖`).toBeLessThan(20);
          wantPalm.addScaledVector(wantFinger, -wantPalm.dot(wantFinger)).normalize();
        }

        expect(angleTo(palmWorld, wantPalm), `${name}/${side} 掌心`).toBeLessThan(20);
      }
    }
  });

  it("拍手時兩掌真的碰到，但不互相穿插", () => {
    // 兩個失敗方向都發生過：掌根 3.3cm 時掌面之間還隔著 1.3cm 空氣（看起來是
    // 「快碰到」）；收到 1.3cm 又變成掌面互穿 0.7cm。骨頭在手掌中間、單手厚
    // 約 1cm，所以掌根落在 1.8~3.0cm 才是「剛好貼上」。
    const { duration } = GESTURE_CONFIGS.clap;
    let closest = Infinity;
    for (let t = 0.5; t <= duration - 0.4; t += 1 / 60) {
      poseGesture(fx, rigs, "clap", t);
      closest = Math.min(closest, fx.worldOf("左中指１").distanceTo(fx.worldOf("右中指１")));
    }
    expect(closest, "兩掌沒有真的碰到").toBeLessThan(0.030);
    expect(closest, "兩掌互相穿插").toBeGreaterThan(0.018);
  });

  it("手不會穿進頭裡", () => {
    for (const name of ALL_GESTURES) {
      poseGesture(fx, rigs, name, GESTURE_CONFIGS[name].duration * 0.5);
      const head = fx.worldOf("頭");
      for (const wristName of ["左手首", "右手首"]) {
        const wrist = fx.worldOf(wristName);
        // 頭骨中心到臉皮大約 6cm；手腕比這更近就是穿模。
        expect(wrist.distanceTo(head), `${name}/${wristName}`).toBeGreaterThan(0.055);
      }
    }
  });

  it("動作結束後手回到身體兩側", () => {
    const restLeft = (() => {
      fx.reset();
      applyArmPose(fx.bones, rigs, null, BASE_ARM);
      fx.update();
      return fx.worldOf("左手首").clone();
    })();

    for (const name of ALL_GESTURES) {
      poseGesture(fx, rigs, name, GESTURE_CONFIGS[name].duration + 0.2);
      expect(fx.worldOf("左手首").distanceTo(restLeft), `${name} 收尾`).toBeLessThan(0.01);
    }
  });

  it("起手到收尾之間手的移動是連續的", () => {
    // 抽查揮手：IK 是逐幀重解的，同一個目標可能有多個解，解一跳手臂就瞬移。
    // 修掉之前實測單幀位移 14cm —— 手在兩個姿勢之間閃現。
    let previous: THREE.Vector3 | null = null;
    let maxStep = 0;
    let maxSustainStep = 0;
    const { duration, attack, release } = GESTURE_CONFIGS.wave;

    for (let t = 0; t <= duration; t += 1 / 60) {
      poseGesture(fx, rigs, "wave", t);
      const wrist = fx.worldOf("右手首").clone();
      if (previous) {
        const step = wrist.distanceTo(previous);
        maxStep = Math.max(maxStep, step);
        // 起手與收尾本來就在快速移動（手從腰際到頭側約 45cm、只花 0.4 秒），
        // 中段維持期才是「應該幾乎不動」的階段，跳動在那裡最明顯。
        if (t > attack + 0.1 && t < duration - release - 0.1) {
          maxSustainStep = Math.max(maxSustainStep, step);
        }
      }
      previous = wrist;
    }

    expect(maxStep, "起手/收尾").toBeLessThan(0.06);
    expect(maxSustainStep, "維持期").toBeLessThan(0.02);
  });
});

describe("摸摸頭反應", () => {
  const fx = loadSkeletonFixture();
  const { rigs } = makeRigs(fx);

  it("頭會迎上去而不是低下去", () => {
    const offsets = poseGesture(fx, rigs, "headPat", 1.2);
    // 頭往上抬（x 正是仰頭），肩膀縮起
    expect(offsets?.head?.x ?? 0).toBeGreaterThan(0.05);
    expect(Math.abs(offsets?.leftShoulder?.z ?? 0)).toBeGreaterThan(0.03);
  });

  it("手收在胸前，不會擋住臉", () => {
    poseGesture(fx, rigs, "headPat", 1.2);
    const head = fx.worldOf("頭");
    for (const wristName of ["左手首", "右手首"]) {
      const wrist = fx.worldOf(wristName);
      expect(wrist.y, `${wristName} 高過下巴`).toBeLessThan(head.y - 0.05);
    }
  });
});
