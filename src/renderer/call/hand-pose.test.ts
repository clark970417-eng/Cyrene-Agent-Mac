import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyHandPose,
  applyTwist,
  bindPosition,
  blendHandPose,
  buildHandRig,
  buildTwistRig,
  HAND_SHAPES,
  type HandSide,
  type TwistRig,
} from "./hand-pose";
import { redistributeTwist } from "./arm-ik";

/**
 * 造一隻合成的手，骨頭排法照 PMX 標準命名。
 *
 * 幾何刻意跟真模型無關：手指沿 +X 伸出、指節沿 +Z 排開、拇指擺在 -Y 側，
 * 所以「掌心」朝 -Y。`mirror` 會把 Z 與拇指側一起翻過去造出另一隻手 ——
 * 這是在驗「旋轉軸完全從骨架量出來、沒有寫死左右正負號」。
 */
function makeHand(side: HandSide, mirror = false): Map<string, THREE.Bone> {
  const p = side === "left" ? "左" : "右";
  const s = mirror ? -1 : 1;
  const bones = new Map<string, THREE.Bone>();
  const root = new THREE.Bone();
  root.name = `${p}手首`;
  bones.set(root.name, root);

  const addFinger = (suffixes: string[], knuckle: THREE.Vector3, lengths: number[]): void => {
    let parent: THREE.Bone = root;
    let offset = knuckle;
    for (let i = 0; i < suffixes.length; i++) {
      const bone = new THREE.Bone();
      bone.name = `${p}${suffixes[i]}`;
      bone.position.copy(offset);
      parent.add(bone);
      bones.set(bone.name, bone);
      parent = bone;
      offset = new THREE.Vector3(lengths[i], 0, 0);
    }
    // 指尖骨：讓最後一節也量得出方向。
    const tip = new THREE.Bone();
    tip.name = `${p}${suffixes[suffixes.length - 1]}先`;
    tip.position.set(lengths[lengths.length - 1], 0, 0);
    parent.add(tip);
    bones.set(tip.name, tip);
  };

  addFinger(["人指１", "人指２", "人指３"], new THREE.Vector3(0.10, 0, 0.03 * s), [0.04, 0.03, 0.02]);
  addFinger(["中指１", "中指２", "中指３"], new THREE.Vector3(0.10, 0, 0), [0.045, 0.032, 0.02]);
  addFinger(["薬指１", "薬指２", "薬指３"], new THREE.Vector3(0.10, 0, -0.03 * s), [0.042, 0.030, 0.02]);
  addFinger(["小指１", "小指２", "小指３"], new THREE.Vector3(0.095, 0, -0.058 * s), [0.035, 0.024, 0.018]);
  addFinger(["親指０", "親指１", "親指２"], new THREE.Vector3(0.03, -0.02, 0.05 * s), [0.03, 0.025, 0.02]);

  root.updateMatrixWorld(true);
  return bones;
}

function worldTip(bones: Map<string, THREE.Bone>, name: string): THREE.Vector3 {
  const bone = bones.get(name);
  if (!bone) throw new Error(`no bone ${name}`);
  bones.get([...bones.keys()][0])!.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
}

function refreshWorld(bones: Map<string, THREE.Bone>): void {
  for (const bone of bones.values()) {
    if (!bone.parent) bone.updateMatrixWorld(true);
  }
}

describe("buildHandRig", () => {
  it("五指三節都建得起來", () => {
    const rig = buildHandRig(makeHand("left"), "left");
    expect(rig).not.toBeNull();
    expect(rig!.fingers.size).toBe(5);
    for (const joints of rig!.fingers.values()) {
      expect(joints).toHaveLength(3);
    }
  });

  it("掌心法線指向拇指那一側", () => {
    const rig = buildHandRig(makeHand("left"), "left")!;
    // 這副合成骨架的拇指擺在 -Y，掌心就該朝 -Y。
    expect(rig.palmNormal.y).toBeLessThan(-0.9);
  });

  it("沒有手指骨時回 null", () => {
    const bones = new Map<string, THREE.Bone>();
    const wrist = new THREE.Bone();
    wrist.name = "左手首";
    bones.set(wrist.name, wrist);
    expect(buildHandRig(bones, "left")).toBeNull();
  });
});

describe("applyHandPose", () => {
  it("彎曲會把指尖帶往掌心那一側", () => {
    const bones = makeHand("left");
    const rig = buildHandRig(bones, "left")!;
    const before = worldTip(bones, "左中指３先");

    applyHandPose(rig, HAND_SHAPES.fist);
    refreshWorld(bones);
    const after = worldTip(bones, "左中指３先");

    const moved = after.clone().sub(before);
    // 位移必須有很大一部分是朝著掌心方向，而不是往手背翻。
    expect(moved.dot(rig.palmNormal)).toBeGreaterThan(0.02);
  });

  it("鏡像的另一隻手同樣往掌心彎（沒有寫死左右正負號）", () => {
    const bones = makeHand("right", true);
    const rig = buildHandRig(bones, "right")!;
    const before = worldTip(bones, "右中指３先");

    applyHandPose(rig, HAND_SHAPES.fist);
    refreshWorld(bones);
    const after = worldTip(bones, "右中指３先");

    expect(after.clone().sub(before).dot(rig.palmNormal)).toBeGreaterThan(0.02);
  });

  it("握拳比放鬆彎，放鬆比攤平彎；攤平仍帶掌弓不是一塊板子", () => {
    const bones = makeHand("left");
    const rig = buildHandRig(bones, "left")!;
    const knuckle = bones.get("左中指１")!;

    applyHandPose(rig, HAND_SHAPES.flat);
    const flatAngle = knuckle.quaternion.angleTo(new THREE.Quaternion());
    applyHandPose(rig, HAND_SHAPES.relaxed);
    const relaxedAngle = knuckle.quaternion.angleTo(new THREE.Quaternion());
    applyHandPose(rig, HAND_SHAPES.fist);
    const fistAngle = knuckle.quaternion.angleTo(new THREE.Quaternion());

    // 攤平不是零：手掌本身是拱的（見 PALM_ARCH），全直的手從側面看是一片紙。
    expect(flatAngle).toBeGreaterThan(0.02);
    expect(flatAngle).toBeLessThan(0.35);
    expect(relaxedAngle).toBeGreaterThan(flatAngle + 0.2);
    expect(fistAngle).toBeGreaterThan(relaxedAngle + 0.5);
  });

  it("權重 0 等於綁定姿勢", () => {
    const bones = makeHand("left");
    const rig = buildHandRig(bones, "left")!;
    applyHandPose(rig, HAND_SHAPES.fist, 0);
    expect(bones.get("左人指２")!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it("張開會把食指與小指的指尖拉遠", () => {
    const bones = makeHand("left");
    const rig = buildHandRig(bones, "left")!;

    applyHandPose(rig, { spread: 0 });
    refreshWorld(bones);
    const closed = worldTip(bones, "左人指３先").distanceTo(worldTip(bones, "左小指３先"));

    applyHandPose(rig, { spread: 1 });
    refreshWorld(bones);
    const opened = worldTip(bones, "左人指３先").distanceTo(worldTip(bones, "左小指３先"));

    expect(opened).toBeGreaterThan(closed);
  });

  it("併攏（負的 spread）會把指尖收近", () => {
    const bones = makeHand("left");
    const rig = buildHandRig(bones, "left")!;

    applyHandPose(rig, { spread: 0 });
    refreshWorld(bones);
    const neutral = worldTip(bones, "左人指３先").distanceTo(worldTip(bones, "左小指３先"));

    applyHandPose(rig, { spread: -1 });
    refreshWorld(bones);
    const together = worldTip(bones, "左人指３先").distanceTo(worldTip(bones, "左小指３先"));

    expect(together).toBeLessThan(neutral);
  });
});

describe("blendHandPose", () => {
  // 用明確的兩端值測混合本身，不綁定任何手型的實際數字。
  const OPEN_ZERO = { curl: { index: 0 }, spread: 0 };
  const CLOSED_ONE = { curl: { index: 1 }, spread: -0.5 };

  it("中點是兩端的平均", () => {
    const mid = blendHandPose(OPEN_ZERO, CLOSED_ONE, 0.5);
    expect(mid.curl?.index).toBeCloseTo(0.5, 5);
    expect(mid.spread).toBeCloseTo(-0.25, 5);
  });

  it("t 會被夾在 0~1", () => {
    expect(blendHandPose(OPEN_ZERO, CLOSED_ONE, 3).curl?.index).toBeCloseTo(1, 5);
    expect(blendHandPose(OPEN_ZERO, CLOSED_ONE, -2).curl?.index).toBeCloseTo(0, 5);
  });
});

describe("buildTwistRig", () => {
  it("扭轉軸就是骨頭自己的方向", () => {
    const bones = new Map<string, THREE.Bone>();
    const arm = new THREE.Bone();
    arm.name = "左腕";
    const twist = new THREE.Bone();
    twist.name = "左腕捩";
    twist.position.set(0.1, 0, 0);
    const elbow = new THREE.Bone();
    elbow.name = "左ひじ";
    elbow.position.set(0.2, 0, 0);
    arm.add(twist);
    arm.add(elbow);
    for (const b of [arm, twist, elbow]) bones.set(b.name, b);

    const rig = buildTwistRig(bones, "左腕捩", "左腕", "左ひじ")!;
    expect(rig.axis.x).toBeCloseTo(1, 6);

    applyTwist(rig, 0.5);
    expect(twist.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0.5, 5);
  });

  it("缺骨頭時回 null", () => {
    expect(buildTwistRig(new Map(), "左腕捩", "左腕", "左ひじ")).toBeNull();
  });
});

describe("bindPosition", () => {
  it("沿著骨鏈累加本地位移，與目前姿勢無關", () => {
    const bones = makeHand("left");
    const before = bindPosition(bones.get("左中指３")!);
    const rig = buildHandRig(bones, "left")!;
    applyHandPose(rig, HAND_SHAPES.fist);
    const after = bindPosition(bones.get("左中指３")!);
    expect(after.distanceTo(before)).toBeLessThan(1e-9);
  });
});

describe("redistributeTwist", () => {
  /** 造一段「扭轉骨 → 關節」的父子鏈，跟 `手捩 → 手首` 同構。 */
  function makeForearm(): {
    root: THREE.Bone;
    twist: TwistRig;
    joint: THREE.Bone;
    tip: THREE.Bone;
  } {
    const root = new THREE.Bone();
    root.name = "左ひじ";
    const twistBone = new THREE.Bone();
    twistBone.name = "左手捩";
    twistBone.position.set(0.1, 0, 0);
    const joint = new THREE.Bone();
    joint.name = "左手首";
    joint.position.set(0.1, 0, 0);
    const tip = new THREE.Bone();
    tip.name = "左中指１";
    tip.position.set(0.05, 0, 0);
    root.add(twistBone);
    twistBone.add(joint);
    joint.add(tip);
    root.updateMatrixWorld(true);
    return {
      root,
      twist: { bone: twistBone, axis: new THREE.Vector3(1, 0, 0), bindRotation: new THREE.Quaternion() },
      joint,
      tip,
    };
  }

  it("扭轉搬到上游之後，手的世界朝向完全不變", () => {
    const { root, twist, joint, tip } = makeForearm();
    // 手腕同時有彎折（繞 Z）與扭轉（繞前臂軸 X）。
    joint.quaternion.setFromEuler(new THREE.Euler(0.9, 0, 0.5));
    root.updateMatrixWorld(true);
    const before = new THREE.Quaternion();
    tip.getWorldQuaternion(before);
    const beforePos = new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld);

    redistributeTwist(joint, twist, 0.6);
    root.updateMatrixWorld(true);

    const after = new THREE.Quaternion();
    tip.getWorldQuaternion(after);
    expect(after.angleTo(before)).toBeLessThan(1e-6);
    expect(new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld).distanceTo(beforePos))
      .toBeLessThan(1e-6);
  });

  it("關節自己的扭轉確實變少，扭轉骨接手", () => {
    const { root, twist, joint } = makeForearm();
    joint.quaternion.setFromEuler(new THREE.Euler(1.2, 0, 0.3));
    root.updateMatrixWorld(true);

    const twistOf = (q: THREE.Quaternion): number => {
      // 取繞 X 軸的扭轉分量角度。
      const t = new THREE.Quaternion(q.x, 0, 0, q.w).normalize();
      return 2 * Math.acos(Math.min(1, Math.abs(t.w)));
    };
    const jointBefore = twistOf(joint.quaternion);

    redistributeTwist(joint, twist, 0.6);

    expect(twistOf(joint.quaternion)).toBeLessThan(jointBefore * 0.75);
    expect(twistOf(twist.bone.quaternion)).toBeGreaterThan(jointBefore * 0.4);
  });

  it("share 給 0 時什麼都不動", () => {
    const { root, twist, joint } = makeForearm();
    joint.quaternion.setFromEuler(new THREE.Euler(0.8, 0, 0.2));
    root.updateMatrixWorld(true);
    const before = joint.quaternion.clone();

    redistributeTwist(joint, twist, 0);

    expect(joint.quaternion.angleTo(before)).toBeLessThan(1e-9);
    expect(twist.bone.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });
});
