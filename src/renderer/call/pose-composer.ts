import * as THREE from "three";
import type { GestureBoneOffsets, HandTarget } from "./gestures";
import {
  applyHandPose,
  applyTwist,
  blendHandPose,
  HAND_SHAPES,
  type HandRig,
  type TwistRig,
} from "./hand-pose";
import {
  aimHand,
  aimPalm,
  applyElbowPole,
  deferTwistToChild,
  preLiftShoulder,
  redistributeTwist,
  SHOULDER_TOTAL_LIMIT,
  solveArmIK,
  type ArmIKChain,
} from "./arm-ik";
import type { BodyAnchors } from "./body-anchors";

/**
 * 把手勢偏移寫進骨架。
 *
 * 從 vrm-viewer 拆出來的原因：手勢的角度值好不好，唯一的判準是「手最後落在
 * 哪裡」，而那要拿真骨架量。量測若自己重寫一套「怎麼把偏移套到骨頭上」，
 * 量的就是另一個東西了。這裡是唯一的一份，畫面與測試都走它。
 *
 * 持續性的微動（呼吸、視線追蹤、情緒姿態）留在 vrm-viewer：那些是「隨時都在
 * 發生的背景動態」，不屬於某一個手勢，而且幅度都在 0.02 rad 以內，不影響手
 * 到底比到哪裡。
 */

/** 手臂自然垂放的基準姿勢（左手；右手的 y / z 取負）。 */
export const REST_ARM_POSE = { x: 0.16, y: 0.12, z: -0.48 } as const;

/**
 * 右手相對於「左手的鏡像」再加的一點差異。
 *
 * 人不會左右完全對稱地站著 —— 慣用手那側的肩膀通常略低、手臂略往前、
 * 手肘鬆一點。原本兩隻手臂是精確鏡像（0.16, ±0.12, ∓0.48），從正面看
 * 就是一具立正的人偶，這是待機時「像機器人」最直接的來源。
 *
 * 幅度只有 1~3 度：要的是「不完全一樣」，不是歪一邊。
 */
const RIGHT_ARM_ASYMMETRY = { x: 0.030, y: -0.018, z: 0.022 } as const;
/** 手肘的左右差異，同理。 */
const RIGHT_ELBOW_ASYMMETRY = { x: -0.018, y: 0.020, z: -0.015 } as const;
/** 手肘的基準彎曲（左手；右手的 y / z 取負）。 */
export const REST_ELBOW_POSE = { x: 0.08, y: 0.16, z: -0.14 } as const;

export interface PoseRigs {
  hands: { left: HandRig | null; right: HandRig | null };
  twists: {
    leftArm: TwistRig | null;
    rightArm: TwistRig | null;
    leftForearm: TwistRig | null;
    rightForearm: TwistRig | null;
  };
  /** 有這些才會跑 IK；缺任何一項就退回純 euler 偏移。 */
  arms?: { left: ArmIKChain | null; right: ArmIKChain | null };
  anchors?: BodyAnchors;
  /**
   * 把整棵骨架的世界矩陣更新到最新。
   *
   * IK 與定位點都吃世界座標：手勢已經改過脊椎與頭的旋轉，這裡不重算一次
   * 的話，臉頰的位置會是上一幀的，手就永遠落後臉一格。
   */
  updateWorld?: () => void;
  /** 模型根節點，用來把「模型空間的掌心朝向」換算成世界方向。 */
  root?: THREE.Object3D;
  /** 頭骨。手勢指定 `orientTo: "head"` 時，掌心與指尖方向跟著它轉。 */
  headBone?: THREE.Object3D | null;
}

/** 呼吸與擺動這類背景微動，測試時全給 0。 */
export interface IdleArmTerms {
  leftArmLift: number;
  rightArmLift: number;
  leftArmSway: number;
  rightArmSway: number;
  leftElbowFollow: number;
  rightElbowFollow: number;
  /** 待機手型的漂移量（0~1，往攤平方向）。 */
  leftHandDrift: number;
  rightHandDrift: number;
}

export const NO_IDLE: IdleArmTerms = {
  leftArmLift: 0, rightArmLift: 0,
  leftArmSway: 0, rightArmSway: 0,
  leftElbowFollow: 0, rightElbowFollow: 0,
  leftHandDrift: 0, rightHandDrift: 0,
};

type Vec3Like = { x: number; y: number; z: number };

function setRotation(
  bone: THREE.Bone | undefined,
  x: number,
  y: number,
  z: number
): void {
  if (bone) bone.rotation.set(x, y, z);
}

/**
 * 肩、臂、肘、腕、扭轉骨與手指。
 *
 * @param baseArm 手臂的基準姿勢（情緒姿態會改它），左右各一。
 */
export function applyArmPose(
  bones: Map<string, THREE.Bone>,
  rigs: PoseRigs,
  offsets: GestureBoneOffsets | null,
  baseArm: { left: Vec3Like; right: Vec3Like },
  idle: IdleArmTerms = NO_IDLE
): void {
  setRotation(
    bones.get("左肩"),
    offsets?.leftShoulder?.x ?? 0,
    offsets?.leftShoulder?.y ?? 0,
    offsets?.leftShoulder?.z ?? 0
  );
  setRotation(
    bones.get("右肩"),
    offsets?.rightShoulder?.x ?? 0,
    offsets?.rightShoulder?.y ?? 0,
    offsets?.rightShoulder?.z ?? 0
  );

  setRotation(
    bones.get("左腕"),
    baseArm.left.x + idle.leftArmLift + (offsets?.leftArm?.x ?? 0),
    baseArm.left.y + (offsets?.leftArm?.y ?? 0),
    baseArm.left.z + idle.leftArmSway + (offsets?.leftArm?.z ?? 0)
  );
  setRotation(
    bones.get("右腕"),
    baseArm.right.x + RIGHT_ARM_ASYMMETRY.x + idle.rightArmLift + (offsets?.rightArm?.x ?? 0),
    baseArm.right.y + RIGHT_ARM_ASYMMETRY.y + (offsets?.rightArm?.y ?? 0),
    baseArm.right.z + RIGHT_ARM_ASYMMETRY.z - idle.rightArmSway + (offsets?.rightArm?.z ?? 0)
  );

  setRotation(
    bones.get("左ひじ"),
    REST_ELBOW_POSE.x + idle.leftElbowFollow * 0.4 + (offsets?.leftElbow?.x ?? 0),
    REST_ELBOW_POSE.y + idle.leftElbowFollow + (offsets?.leftElbow?.y ?? 0),
    REST_ELBOW_POSE.z + (offsets?.leftElbow?.z ?? 0)
  );
  setRotation(
    bones.get("右ひじ"),
    REST_ELBOW_POSE.x + RIGHT_ELBOW_ASYMMETRY.x + idle.rightElbowFollow * 0.4 + (offsets?.rightElbow?.x ?? 0),
    -REST_ELBOW_POSE.y + RIGHT_ELBOW_ASYMMETRY.y - idle.rightElbowFollow + (offsets?.rightElbow?.y ?? 0),
    -REST_ELBOW_POSE.z + RIGHT_ELBOW_ASYMMETRY.z + (offsets?.rightElbow?.z ?? 0)
  );

  setRotation(
    bones.get("左手首"),
    offsets?.leftWrist?.x ?? 0,
    offsets?.leftWrist?.y ?? 0,
    offsets?.leftWrist?.z ?? 0
  );
  setRotation(
    bones.get("右手首"),
    offsets?.rightWrist?.x ?? 0,
    offsets?.rightWrist?.y ?? 0,
    offsets?.rightWrist?.z ?? 0
  );

  if (rigs.twists.leftArm) applyTwist(rigs.twists.leftArm, offsets?.leftArmTwist ?? 0);
  if (rigs.twists.rightArm) applyTwist(rigs.twists.rightArm, offsets?.rightArmTwist ?? 0);
  if (rigs.twists.leftForearm) applyTwist(rigs.twists.leftForearm, offsets?.leftForearmTwist ?? 0);
  if (rigs.twists.rightForearm) applyTwist(rigs.twists.rightForearm, offsets?.rightForearmTwist ?? 0);

  // IK：把手拉到目標位置。放在扭轉骨與手指之前 —— 那兩者掛在手腕以下，
  // 手腕位置還在動的時候先擺它們沒有意義。
  if (offsets && rigs.arms && rigs.anchors) {
    rigs.updateWorld?.();
    if (offsets.leftHandTarget && rigs.arms.left) {
      solveHandTarget(rigs, rigs.arms.left, rigs.hands.left, offsets.leftHandTarget);
    } else if (rigs.arms.left) {
      delete rigs.arms.left.previous;
    }
    if (offsets.rightHandTarget && rigs.arms.right) {
      solveHandTarget(rigs, rigs.arms.right, rigs.hands.right, offsets.rightHandTarget);
    } else if (rigs.arms.right) {
      delete rigs.arms.right.previous;
    }
  } else if (rigs.arms) {
    if (rigs.arms.left) delete rigs.arms.left.previous;
    if (rigs.arms.right) delete rigs.arms.right.previous;
  }

  // 手指。沒有手勢時也要擺 —— 綁定姿勢的五指全直看起來像假肢。
  if (rigs.hands.left) {
    applyHandPose(
      rigs.hands.left,
      offsets?.leftHand ?? blendHandPose(HAND_SHAPES.relaxed, HAND_SHAPES.flat, idle.leftHandDrift)
    );
  }
  if (rigs.hands.right) {
    applyHandPose(
      rigs.hands.right,
      offsets?.rightHand ?? blendHandPose(HAND_SHAPES.relaxed, HAND_SHAPES.flat, idle.rightHandDrift)
    );
  }
}

const tmpTargetPoint = new THREE.Vector3();
const tmpEffPos = new THREE.Vector3();
const tmpPalmDir = new THREE.Vector3();
const tmpFingerDir = new THREE.Vector3();
const tmpPivot = new THREE.Vector3();
const seedBuffer = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
const solvedBuffer = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];

/**
 * 解一隻手的目標位置與掌心朝向，並依權重與種子姿勢混合。
 *
 * 混合是在**旋轉**上做的，不是在目標位置上：手勢淡入時如果去插值目標點，
 * 手會沿著直線飄過去；插值旋轉才是手臂該有的圓弧軌跡。
 */
function solveHandTarget(
  rigs: PoseRigs,
  chain: ArmIKChain,
  hand: HandRig | null,
  target: HandTarget
): void {
  const weight = Math.min(Math.max(target.weight, 0), 1);
  if (weight <= 0.001 || !rigs.anchors) return;

  // 取得目標點的世界座標
  rigs.anchors.resolve(target.anchor, tmpTargetPoint);
  if (target.offset) {
    tmpTargetPoint.x += target.offset.x ?? 0;
    tmpTargetPoint.y += target.offset.y ?? 0;
    tmpTargetPoint.z += target.offset.z ?? 0;
  }

  // 位置跟著頭轉：繞身體的垂直軸把目標點轉過去。只轉一部分（見 followHead），
  // 完全跟著走會在轉頭幅度大時把手腕帶到手臂搆不到的地方。
  if (target.followHead && rigs.headBone) {
    const yaw = (rigs.headBone as THREE.Bone).rotation.y * target.followHead;
    if (Math.abs(yaw) > 1e-4) {
      const pivot = rigs.anchors ? rigs.anchors.resolve("chestFront", tmpPivot) : null;
      if (pivot) {
        const dx = tmpTargetPoint.x - pivot.x;
        const dz = tmpTargetPoint.z - pivot.z;
        const c = Math.cos(yaw), s2 = Math.sin(yaw);
        tmpTargetPoint.x = pivot.x + dx * c + dz * s2;
        tmpTargetPoint.z = pivot.z - dx * s2 + dz * c;
      }
    }
  }

  // 手勢淡入淡出時：沿著 3D 空間目標軌跡平滑過渡，避免四元數 180 度翻轉跳幀
  if (weight < 0.999) {
    tmpEffPos.setFromMatrixPosition(chain.effector.matrixWorld);
    tmpTargetPoint.lerp(tmpEffPos, 1 - weight);
  }

  // 肩胛節律要在記錄種子之前跑：抬起來的肩膀是這次解的新基準，
  // 不然 IK 的偏轉上限會把剛抬起的肩膀又壓回去。
  //
  // 但正因為種子被換掉了，IK 的肩膀上限必須扣掉節律已經用掉的角度，
  // 否則兩段各自合法、相加卻會脫臼（見 SHOULDER_TOTAL_LIMIT）。
  const liftUsed = preLiftShoulder(chain, tmpTargetPoint);
  chain.limits[0] = Math.max(0.05, SHOULDER_TOTAL_LIMIT - liftUsed);

  for (let i = 0; i < chain.joints.length; i++) seedBuffer[i].copy(chain.joints[i].quaternion);

  // 從上一幀的解接下去（warm start）
  if (chain.previous && chain.previous.anchor === target.anchor) {
    for (let i = 0; i < chain.joints.length; i++) {
      chain.joints[i].quaternion.copy(chain.previous.rotations[i]);
    }
    chain.joints[0].updateWorldMatrix(true, true);
  }

  solveArmIK(chain, tmpTargetPoint, seedBuffer);

  if (!chain.previous) {
    chain.previous = {
      rotations: chain.joints.map((joint) => joint.quaternion.clone()),
      anchor: target.anchor,
    };
  } else {
    chain.previous.anchor = target.anchor;
    for (let i = 0; i < chain.joints.length; i++) {
      chain.previous.rotations[i].copy(chain.joints[i].quaternion);
    }
  }

  // 手肘繞轉方向
  const side = chain.joints[0].name.startsWith("左") ? 1 : -1;
  tmpPalmDir.set(
    target.elbowPole?.x ?? side * 0.45,
    target.elbowPole?.y ?? -1,
    target.elbowPole?.z ?? -0.35
  );
  if (rigs.root) tmpPalmDir.transformDirection(rigs.root.matrixWorld);
  applyElbowPole(chain, tmpPalmDir, weight);
  chain.joints[0].updateWorldMatrix(false, true);

  if (target.palm && hand) {
    // 朝向的參考座標：預設是模型空間（方向固定），`head` 則跟著頭轉 ——
    // 她看哪邊，手就朝哪邊比。綁定姿勢下頭的本地軸就是模型軸，所以直接拿
    // 頭的世界矩陣換算即可。
    const frame =
      target.orientTo === "head" ? (rigs.headBone ?? rigs.root) : rigs.root;
    tmpPalmDir.set(target.palm.x, target.palm.y, target.palm.z);
    if (frame) tmpPalmDir.transformDirection(frame.matrixWorld);
    if (target.fingers) {
      // 兩個軸都給了才鎖得住手的朝向：只對掌心的話，手還能繞著掌心法線轉，
      // 合十會變成「掌心相對但指尖朝前平伸」。
      tmpFingerDir.set(target.fingers.x, target.fingers.y, target.fingers.z);
      if (frame) tmpFingerDir.transformDirection(frame.matrixWorld);
      aimHand(chain.effector, hand.fingerDir, hand.palmNormal, tmpFingerDir, tmpPalmDir, weight);
    } else {
      aimPalm(chain.effector, hand.palmNormal, tmpPalmDir, weight);
    }

    // 朝向解完之後，把扭轉分一部分回肢段的扭轉分散骨。全部壓在單一關節上
    // 會把那一圈的網格擰細（見 redistributeTwist）。
    //
    // 手肘要排在手腕前面：先把上臂那一段攤開，手腕再處理前臂那一段。
    const isLeft = chain.joints[0].name.startsWith("左");
    const armTwist = isLeft ? rigs.twists.leftArm : rigs.twists.rightArm;
    const forearmTwist = isLeft ? rigs.twists.leftForearm : rigs.twists.rightForearm;
    // 只對「扭轉骨正好是該關節父骨」的兩段做：`手捩`→`手首`、`腕捩`→`ひじ`。
    //
    // `腕` 自己的軸向扭轉要**往下**交給 `腕捩`（它是 `腕` 的子骨），
    // 補償方向跟 redistributeTwist 相反 —— 見 deferTwistToChild 的推導。
    // 先前那次失敗是把式子寫反了，不是這件事做不得：實測 `listen` 的上臂
    // 扭轉 101°、`headScratch` 102°，全壓在肩根那一圈，三角肌與袖口會被擰細。
    if (armTwist) deferTwistToChild(chain.joints[1], armTwist);
    if (armTwist) redistributeTwist(chain.joints[2], armTwist);
    if (forearmTwist) redistributeTwist(chain.effector, forearmTwist);
  }
}

/**
 * 骨盆與腿。
 *
 * 腿的網格權重掛在 `足D` 鏈上，所以這裡寫完之後一定要跑付与
 * （見 append-transform.ts），否則腿不會動。
 *
 * @param weightShift 站姿重心 -1（左腳）~ +1（右腳）。
 */
export function applyLegPose(
  bones: Map<string, THREE.Bone>,
  offsets: GestureBoneOffsets | null,
  weightShift = 0
): void {
  const lowerBody = bones.get("下半身") ?? bones.get("センター");
  if (lowerBody) {
    lowerBody.position.x = weightShift * 0.008;
    lowerBody.rotation.set(
      offsets?.lowerBody?.x ?? 0,
      offsets?.lowerBody?.y ?? 0,
      weightShift * -0.015 + (offsets?.lowerBody?.z ?? 0)
    );
  }

  setRotation(
    bones.get("左足"),
    offsets?.leftLeg?.x ?? 0,
    offsets?.leftLeg?.y ?? 0,
    weightShift * 0.012 + (offsets?.leftLeg?.z ?? 0)
  );
  setRotation(
    bones.get("右足"),
    offsets?.rightLeg?.x ?? 0,
    offsets?.rightLeg?.y ?? 0,
    weightShift * 0.012 + (offsets?.rightLeg?.z ?? 0)
  );
  setRotation(
    bones.get("左ひざ"),
    offsets?.leftKnee?.x ?? 0,
    offsets?.leftKnee?.y ?? 0,
    offsets?.leftKnee?.z ?? 0
  );
  setRotation(
    bones.get("右ひざ"),
    offsets?.rightKnee?.x ?? 0,
    offsets?.rightKnee?.y ?? 0,
    offsets?.rightKnee?.z ?? 0
  );
  // 膝蓋一彎腳掌就會跟著翹起來，這裡回正一半，維持腳底貼地。
  setRotation(
    bones.get("左足首"),
    (offsets?.leftFoot?.x ?? 0) - (offsets?.leftKnee?.x ?? 0) * 0.5,
    offsets?.leftFoot?.y ?? 0,
    offsets?.leftFoot?.z ?? 0
  );
  setRotation(
    bones.get("右足首"),
    (offsets?.rightFoot?.x ?? 0) - (offsets?.rightKnee?.x ?? 0) * 0.5,
    offsets?.rightFoot?.y ?? 0,
    offsets?.rightFoot?.z ?? 0
  );
}
