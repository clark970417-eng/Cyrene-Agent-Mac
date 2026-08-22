import * as THREE from "three";
import type { TwistRig } from "./hand-pose";

/**
 * 手臂 IK：把「手要放到哪裡」解成肩、上臂、前臂該轉多少。
 *
 * 為什麼需要它：手勢原本是直接寫每根骨頭的 euler 偏移，而要讓手碰到臉頰，
 * 得同時猜對三根骨頭 × 三個軸的複合旋轉 —— 實測結果是幾乎每個動作的手都停在
 * 胸腹高度（摀臉停在 y=1.19，臉頰在 y=1.50），拍手與祈禱的兩隻手甚至交叉穿過
 * 對方。這種東西沒辦法用手調，只能解。
 *
 * 演算法是 CCD（Cyclic Coordinate Descent）：從最靠近手的關節往肩膀方向逐一
 * 旋轉，每次都讓「關節→手腕」轉向「關節→目標」，來回幾輪就會收斂。
 *
 * 種子姿勢用的是原本手寫的 euler 偏移：那些數值決定手臂的「風格」（手肘往內
 * 收還是往外開、手臂從哪一側繞上去），是有意義的；IK 只負責把手最後放到對的
 * 位置。從零開始解會得到姿勢正確但很機械的結果。
 */

export interface ArmIKChain {
  /** 由肩往手方向排列：肩、上臂、前臂。 */
  joints: THREE.Bone[];
  /** 末端：手腕。目標是讓它的世界座標對到 target。 */
  effector: THREE.Bone;
  /**
   * 每節相對種子姿勢的最大偏轉（弧度）。
   *
   * 肩膀給得很小：真人抬手主要靠上臂，肩膀只跟著聳一點；放寬會得到「整個
   * 肩胛骨飛出去」的解，位置對了但看起來像脫臼。
   */
  limits: number[];
  /**
   * 上一幀解出來的姿勢，當作下一幀的起點（warm start）。
   *
   * CCD 是逐幀從頭解的，同一個目標可能收斂到不只一個姿勢；種子姿勢隨著淡入
   * 權重在變，解就會在兩個姿勢之間跳 —— 實測揮手淡入到一半時手腕單幀位移
   * 14cm，手臂等於瞬間換邊。從上一幀的解接下去就不會有這個問題，而且因為
   * 起點已經很接近，需要的迭代次數也少。
   *
   * `anchor` 記錄上一幀解的是哪個定位點：換動作時不能沿用，否則會從一個
   * 不相干的姿勢開始解。
   */
  previous?: { rotations: THREE.Quaternion[]; anchor: string };
}

const ARM_BONES: Record<"left" | "right", string[]> = {
  left: ["左肩", "左腕", "左ひじ"],
  right: ["右肩", "右腕", "右ひじ"],
};

const DEFAULT_LIMITS = [0.38, 2.30, 2.40];

/**
 * 肩膀相對種子姿勢的**總**偏轉上限（弧度，0.56 ≈ 32 度）。
 *
 * 先前沒有總量的概念：`preLiftShoulder` 自己夾在 `limits[0]`（21.8°），
 * 然後 `solveArmIK` 以**抬完之後**的姿勢當新種子，再給一次 21.8° ——
 * 兩段相加最壞會到 43°，實測 `salute` 的右肩就疊到 46.4°，看起來像脫臼。
 *
 * 32 度是照真人的肩胛節律取的：肩胛大約分擔整體抬臂角度的三分之一，
 * 手完全舉高時肩帶轉 30 度上下是正常的，再多就不是聳肩而是關節錯位。
 */
export const SHOULDER_TOTAL_LIMIT = 0.56;

export function buildArmChain(
  bones: Map<string, THREE.Bone>,
  side: "left" | "right"
): ArmIKChain | null {
  const joints = ARM_BONES[side].map((name) => bones.get(name));
  const effector = bones.get(side === "left" ? "左手首" : "右手首");
  if (!effector || joints.some((b) => !b)) return null;
  return {
    joints: joints as THREE.Bone[],
    effector,
    limits: [...DEFAULT_LIMITS],
  };
}

const tmpJointPos = new THREE.Vector3();
const tmpEffPos = new THREE.Vector3();
const tmpToEff = new THREE.Vector3();
const tmpToTarget = new THREE.Vector3();
const tmpParentQuat = new THREE.Quaternion();
const tmpParentQuatInv = new THREE.Quaternion();
const tmpDelta = new THREE.Quaternion();
const tmpClampSource = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

/**
 * 把旋轉量縮到 `ratio` 倍。
 *
 * 不能寫成 `q.identity().slerp(q, ratio)` —— identity() 會先把 q 本身清成單位
 * 四元數，接著就變成「從單位插值到單位」，結果永遠是不轉。要先把來源存起來。
 */
function scaleRotation(target: THREE.Quaternion, ratio: number): void {
  tmpClampSource.copy(target);
  target.identity().slerp(tmpClampSource, Math.min(Math.max(ratio, 0), 1));
}

/**
 * 單步旋轉上限。
 *
 * 一次轉太多會在幾個解之間來回跳，收斂反而變慢；但太小就會在「手臂要大幅
 * 換位」的那幾幀跑不完 —— 實測 10 次迭代 × 0.45 上限時，揮手途中有幾幀停在
 * 半路，手腕單幀位移 14cm，看起來就是手臂瞬移。迭代次數與上限要一起夠。
 */
const MAX_STEP = 0.55;

/**
 * 把 `chain.effector` 解到 `target`（世界座標）。
 *
 * 呼叫前請先擺好種子姿勢，並確保骨架的世界矩陣是最新的。解完之後鏈上骨頭的
 * local 旋轉已經改好，鏈以下的世界矩陣也已更新。
 *
 * @param seedRotations 種子姿勢的 local 旋轉，用來限制每節的最大偏轉。
 */
export function solveArmIK(
  chain: ArmIKChain,
  target: THREE.Vector3,
  seedRotations: THREE.Quaternion[],
  iterations = 22
): void {
  const { joints, effector } = chain;

  for (let iter = 0; iter < iterations; iter++) {
    // 由手肘往肩膀回推：先動離手最近的關節，收斂比較快也比較自然
    //（大關節只在小關節搆不到時才出力）。
    for (let j = joints.length - 1; j >= 0; j--) {
      const joint = joints[j];
      joint.updateWorldMatrix(true, true);

      tmpJointPos.setFromMatrixPosition(joint.matrixWorld);
      tmpEffPos.setFromMatrixPosition(effector.matrixWorld);

      tmpToEff.copy(tmpEffPos).sub(tmpJointPos);
      tmpToTarget.copy(target).sub(tmpJointPos);
      if (tmpToEff.lengthSq() < 1e-12 || tmpToTarget.lengthSq() < 1e-12) continue;
      tmpToEff.normalize();
      tmpToTarget.normalize();

      const angle = Math.acos(Math.min(1, Math.max(-1, tmpToEff.dot(tmpToTarget))));
      if (angle < 1e-5) continue;

      tmpDelta.setFromUnitVectors(tmpToEff, tmpToTarget);
      // 一次只走一部分：轉太多會在幾個解之間來回跳，收斂反而變慢。
      if (angle > MAX_STEP) scaleRotation(tmpDelta, MAX_STEP / angle);

      // 世界空間的旋轉換算回這根骨頭的 local：local' = inv(Qp) · Δ · Qp · local
      const parent = joint.parent;
      if (parent) {
        parent.matrixWorld.decompose(tmpPos, tmpParentQuat, tmpScale);
      } else {
        tmpParentQuat.identity();
      }
      tmpParentQuatInv.copy(tmpParentQuat).invert();

      joint.quaternion.premultiply(tmpParentQuat).premultiply(tmpDelta).premultiply(tmpParentQuatInv);

      // 夾在允許的偏轉範圍內，避免解出脫臼般的姿勢。
      const limit = chain.limits[j];
      const deviation = joint.quaternion.angleTo(seedRotations[j]);
      if (deviation > limit) {
        joint.quaternion.copy(seedRotations[j]).slerp(joint.quaternion, limit / deviation);
      }
      joint.updateWorldMatrix(false, true);
    }
  }
}

const tmpAxis = new THREE.Vector3();
const tmpElbowOffset = new THREE.Vector3();
const tmpPole = new THREE.Vector3();
const tmpShoulderPos = new THREE.Vector3();

/**
 * 把手肘繞著「上臂根 → 手腕」這條軸轉到指定方向。
 *
 * CCD 只管手腕落在哪裡，手肘可以繞著這條軸轉一整圈都不影響結果，收斂到哪個
 * 角度純看初始姿勢。實測結果是摸嘴、揮手這些動作的手肘會翹到肩膀上方 10cm ——
 * 位置對，但那是雞翅膀，人不是那樣動的。
 *
 * 繞的是通過肩與手腕的軸，所以手腕位置完全不受影響，只有手肘會滑動。
 *
 * @param pole 手肘希望指的方向（世界空間）。
 */
export function applyElbowPole(chain: ArmIKChain, pole: THREE.Vector3, weight = 1): void {
  const upperArm = chain.joints[1];
  const elbow = chain.joints[2];
  if (!upperArm || !elbow || weight <= 0) return;

  upperArm.updateWorldMatrix(true, true);
  tmpShoulderPos.setFromMatrixPosition(upperArm.matrixWorld);
  tmpJointPos.setFromMatrixPosition(elbow.matrixWorld);
  tmpEffPos.setFromMatrixPosition(chain.effector.matrixWorld);

  tmpAxis.copy(tmpEffPos).sub(tmpShoulderPos);
  if (tmpAxis.lengthSq() < 1e-10) return;
  tmpAxis.normalize();

  // 手肘與 pole 各自對軸取垂直分量，再把前者轉到後者。
  tmpElbowOffset.copy(tmpJointPos).sub(tmpShoulderPos);
  tmpElbowOffset.addScaledVector(tmpAxis, -tmpElbowOffset.dot(tmpAxis));
  tmpPole.copy(pole);
  tmpPole.addScaledVector(tmpAxis, -tmpPole.dot(tmpAxis));
  // 手臂伸直（手肘幾乎在軸上）或 pole 與軸平行時沒有可定義的方向，直接放棄。
  if (tmpElbowOffset.lengthSq() < 1e-8 || tmpPole.lengthSq() < 1e-6) return;
  tmpElbowOffset.normalize();
  tmpPole.normalize();

  const angle = Math.acos(Math.min(1, Math.max(-1, tmpElbowOffset.dot(tmpPole))));
  if (angle < 1e-4) return;

  tmpDelta.setFromUnitVectors(tmpElbowOffset, tmpPole);
  if (weight < 1) scaleRotation(tmpDelta, weight);

  const parent = upperArm.parent;
  if (parent) {
    parent.matrixWorld.decompose(tmpPos, tmpParentQuat, tmpScale);
  } else {
    tmpParentQuat.identity();
  }
  tmpParentQuatInv.copy(tmpParentQuat).invert();
  upperArm.quaternion.premultiply(tmpParentQuat).premultiply(tmpDelta).premultiply(tmpParentQuatInv);
  upperArm.updateWorldMatrix(false, true);
}

const tmpLiftFrom = new THREE.Vector3();
const tmpLiftTo = new THREE.Vector3();

/**
 * 肩胛節律：手抬得越高，肩膀先跟著上提一部分。
 *
 * 為什麼需要：CCD 會優先動離手最近的關節，結果抬手到頭側時整個角度都壓在
 * `腕` 上（上限 2.3 弧度），`肩` 幾乎不動。這個模型的蒙皮撐不住那種角度 ——
 * 實測揮手時肩甲整片從肩膀滑脫、腋下破一個洞、上臂被拉成細長條。
 *
 * 真人把手舉過肩時，肩胛骨會貢獻大約三分之一的仰角。這裡先讓肩膀走
 * `share` 比例的路，剩下的交給 CCD，`腕` 需要轉的角度就少掉那一截。
 *
 * 只在目標高於肩膀時作用：手垂在身側時肩膀不該動。
 */
export function preLiftShoulder(
  chain: ArmIKChain,
  target: THREE.Vector3,
  share = 0.34
): number {
  const shoulder = chain.joints[0];
  const upperArm = chain.joints[1];
  if (!shoulder || !upperArm) return 0;

  shoulder.updateWorldMatrix(true, true);
  tmpShoulderPos.setFromMatrixPosition(upperArm.matrixWorld);
  const lift = target.y - tmpShoulderPos.y;
  if (lift <= 0) return 0;

  tmpJointPos.setFromMatrixPosition(shoulder.matrixWorld);
  tmpLiftFrom.copy(tmpShoulderPos).sub(tmpJointPos);
  tmpLiftTo.copy(target).sub(tmpJointPos);
  if (tmpLiftFrom.lengthSq() < 1e-10 || tmpLiftTo.lengthSq() < 1e-10) return 0;
  tmpLiftFrom.normalize();
  tmpLiftTo.normalize();

  const angle = Math.acos(Math.min(1, Math.max(-1, tmpLiftFrom.dot(tmpLiftTo))));
  if (angle < 1e-4) return 0;

  const applied = Math.min(share, SHOULDER_TOTAL_LIMIT / angle);
  tmpDelta.setFromUnitVectors(tmpLiftFrom, tmpLiftTo);
  scaleRotation(tmpDelta, applied);

  const parent = shoulder.parent;
  if (parent) {
    parent.matrixWorld.decompose(tmpPos, tmpParentQuat, tmpScale);
  } else {
    tmpParentQuat.identity();
  }
  tmpParentQuatInv.copy(tmpParentQuat).invert();
  shoulder.quaternion.premultiply(tmpParentQuat).premultiply(tmpDelta).premultiply(tmpParentQuatInv);
  shoulder.updateWorldMatrix(false, true);
  return angle * applied;
}

const tmpTwistAxis = new THREE.Vector3();
const tmpTwistVec = new THREE.Vector3();
const tmpTwistQuat = new THREE.Quaternion();
const tmpTwistShare = new THREE.Quaternion();

/**
 * 把一個關節繞著自身肢段軸的扭轉，分一部分給上游的扭轉分散骨。
 *
 * 為什麼要分：扭轉如果全部壓在單一關節上，那一圈的頂點會被擰成一束 ——
 * 俗稱糖果紙效應，實測揮手時手腕左右擺會明顯變細。PMX 本來就準備了
 * `腕捩` 與 `手捩`，各自帶三根付与分散骨（比例 0.25/0.5/0.75）來把扭轉
 * 沿著肢段攤開，只是 IK 解完姿勢之後沒有人把扭轉交回去。
 *
 * 兩個適用的關節：
 * - 手腕（`手首`）→ 前臂扭轉骨（`手捩`）
 * - 手肘（`ひじ`）→ 上臂扭轉骨（`腕捩`）
 *
 * 兩者的扭轉骨都正好是該關節的父骨，所以「父骨多轉 R、子骨少轉 R」之後
 * 世界朝向完全不變，只是那段扭轉改由肢段分段承擔。
 *
 * @param share 交出去的比例。給 1 會讓關節完全不扭，看起來像黏死在肢段上。
 */
export function redistributeTwist(
  joint: THREE.Bone,
  twistBone: TwistRig,
  share = 0.6
): void {
  if (share <= 0) return;

  // 手腕的 local 旋轉是在扭轉骨的空間裡；扭轉軸在綁定姿勢下同屬模型座標軸，
  // 所以可以直接用 rig 量到的那條軸做分解。
  tmpTwistAxis.copy(twistBone.axis).normalize();
  const q = joint.quaternion;
  tmpTwistVec.set(q.x, q.y, q.z);
  const projection = tmpTwistVec.dot(tmpTwistAxis);
  tmpTwistQuat.set(
    tmpTwistAxis.x * projection,
    tmpTwistAxis.y * projection,
    tmpTwistAxis.z * projection,
    q.w
  );
  if (tmpTwistQuat.lengthSq() < 1e-10) return;
  tmpTwistQuat.normalize();

  // 只搬 share 的比例。
  tmpTwistShare.identity().slerp(tmpTwistQuat, share);

  // 父骨多轉、子骨少轉：世界朝向不變。
  twistBone.bone.quaternion.multiply(tmpTwistShare);
  joint.quaternion.premultiply(tmpTwistShare.invert());
  twistBone.bone.updateWorldMatrix(false, true);
}

/**
 * 把一個關節自己的扭轉**往下**交給它的子扭轉骨。
 *
 * `redistributeTwist` 處理的是「扭轉骨正好是該關節父骨」的情形（`腕捩`→`ひじ`、
 * `手捩`→`手首`）。上臂（`腕`）不一樣：它的扭轉骨 `腕捩` 是它的**子骨**，
 * 上面沒有東西可以接手。結果 IK 解出來的軸向扭轉全部壓在 `腕` 這一個關節上，
 * 三角肌與袖口那一圈頂點被擰成一束 —— 使用者回報「揮手時肩膀這裡怪怪的」
 * 就是這個（實測 `listen` 101°、`headScratch` 102°）。
 *
 * 方向要反過來推才對。設父骨局部旋轉 J、子骨 C，要搬的扭轉量 S：
 *
 *     J' = J · S⁻¹ ,  C' = S · C   ⇒   J'·C' = J · S⁻¹ · S · C = J·C
 *
 * 下游的世界朝向完全不變，只是「上臂根部整段一起扭」變成「從 `腕捩` 之後
 * 才開始扭」，再由 `腕捩1/2/3` 三根付与分散骨沿著上臂攤開。
 *
 * 先前試過用 `redistributeTwist` 同一套補償（父骨多轉、子骨少轉）套在 `腕` 上，
 * 那是把式子寫反了，手會整個偏掉 —— 落點與掌心朝向的測試當場抓到。
 *
 * @param share 交出去的比例。1 會讓上臂根部完全不扭，看起來像上臂黏死在肩上。
 */
export function deferTwistToChild(
  joint: THREE.Bone,
  twistBone: TwistRig,
  share = 0.75
): void {
  if (share <= 0) return;

  tmpTwistAxis.copy(twistBone.axis).normalize();
  const q = joint.quaternion;
  tmpTwistVec.set(q.x, q.y, q.z);
  const projection = tmpTwistVec.dot(tmpTwistAxis);
  tmpTwistQuat.set(
    tmpTwistAxis.x * projection,
    tmpTwistAxis.y * projection,
    tmpTwistAxis.z * projection,
    q.w
  );
  if (tmpTwistQuat.lengthSq() < 1e-10) return;
  tmpTwistQuat.normalize();

  tmpTwistShare.identity().slerp(tmpTwistQuat, share);

  // 父骨少轉、子骨多轉 —— 跟 redistributeTwist 相反的那一邊
  joint.quaternion.multiply(tmpTwistShare.clone().invert());
  twistBone.bone.quaternion.premultiply(tmpTwistShare);
  joint.updateWorldMatrix(false, true);
}

const tmpCurF = new THREE.Vector3();
const tmpCurP = new THREE.Vector3();
const tmpCurC = new THREE.Vector3();
const tmpDesF = new THREE.Vector3();
const tmpDesP = new THREE.Vector3();
const tmpDesC = new THREE.Vector3();
const tmpBasisCur = new THREE.Matrix4();
const tmpBasisDes = new THREE.Matrix4();
const tmpQCur = new THREE.Quaternion();
const tmpQDes = new THREE.Quaternion();

/**
 * 用兩個軸把手的朝向完全定下來：指尖朝哪、掌心朝哪。
 *
 * 為什麼不能只對掌心：法線只鎖一個自由度，手還能繞著法線轉一整圈。實測合十
 * 時掌心確實互相對著，指尖卻是朝正前方平伸的 —— 看起來像在推東西，不是在拜。
 *
 * 作法是各自建一組正交基底（指尖、掌心、兩者外積），求把「目前的基底」轉到
 * 「目標基底」的旋轉。`desiredPalm` 會先對 `desiredFinger` 正交化，所以呼叫端
 * 給大概的方向就行，不必自己算垂直。
 */
export function aimHand(
  wrist: THREE.Bone,
  fingerDirLocal: THREE.Vector3,
  palmNormalLocal: THREE.Vector3,
  desiredFinger: THREE.Vector3,
  desiredPalm: THREE.Vector3,
  weight = 1
): void {
  if (weight <= 0) return;
  wrist.updateWorldMatrix(true, false);

  tmpCurF.copy(fingerDirLocal).transformDirection(wrist.matrixWorld).normalize();
  tmpCurP.copy(palmNormalLocal).transformDirection(wrist.matrixWorld);
  tmpCurP.addScaledVector(tmpCurF, -tmpCurP.dot(tmpCurF));
  if (tmpCurP.lengthSq() < 1e-10) return;
  tmpCurP.normalize();
  tmpCurC.crossVectors(tmpCurF, tmpCurP);

  tmpDesF.copy(desiredFinger);
  if (tmpDesF.lengthSq() < 1e-10) return;
  tmpDesF.normalize();
  tmpDesP.copy(desiredPalm);
  tmpDesP.addScaledVector(tmpDesF, -tmpDesP.dot(tmpDesF));
  // 指尖與掌心給成平行時定義不出朝向；這是呼叫端寫錯了，安靜跳過比亂轉好。
  if (tmpDesP.lengthSq() < 1e-8) return;
  tmpDesP.normalize();
  tmpDesC.crossVectors(tmpDesF, tmpDesP);

  tmpBasisCur.makeBasis(tmpCurF, tmpCurP, tmpCurC);
  tmpBasisDes.makeBasis(tmpDesF, tmpDesP, tmpDesC);
  tmpQCur.setFromRotationMatrix(tmpBasisCur);
  tmpQDes.setFromRotationMatrix(tmpBasisDes);
  tmpDelta.copy(tmpQDes).multiply(tmpQCur.invert());
  if (weight < 1) scaleRotation(tmpDelta, weight);

  const parent = wrist.parent;
  if (parent) {
    parent.matrixWorld.decompose(tmpPos, tmpParentQuat, tmpScale);
  } else {
    tmpParentQuat.identity();
  }
  tmpParentQuatInv.copy(tmpParentQuat).invert();
  wrist.quaternion.premultiply(tmpParentQuat).premultiply(tmpDelta).premultiply(tmpParentQuatInv);
  wrist.updateWorldMatrix(false, true);
}

/**
 * 把手腕轉到讓掌心朝向指定方向。
 *
 * IK 只決定手腕**在哪裡**，不決定手掌**朝哪邊**；而「揮手時掌心朝鏡頭」「摀臉
 * 時掌心朝自己」正是這些動作看不看得懂的關鍵。
 *
 * @param palmNormalLocal 掌心法線在手腕本地空間中的方向（由 hand rig 量出）。
 * @param desiredWorld    掌心希望朝向的世界方向。
 * @param weight          0~1，淡入用。
 */
export function aimPalm(
  wrist: THREE.Bone,
  palmNormalLocal: THREE.Vector3,
  desiredWorld: THREE.Vector3,
  weight = 1
): void {
  if (weight <= 0 || desiredWorld.lengthSq() < 1e-12) return;
  wrist.updateWorldMatrix(true, false);

  const currentWorld = tmpToEff.copy(palmNormalLocal).transformDirection(wrist.matrixWorld).normalize();
  const desired = tmpToTarget.copy(desiredWorld).normalize();
  const angle = Math.acos(Math.min(1, Math.max(-1, currentWorld.dot(desired))));
  if (angle < 1e-4) return;

  tmpDelta.setFromUnitVectors(currentWorld, desired);
  if (weight < 1) scaleRotation(tmpDelta, weight);

  const parent = wrist.parent;
  if (parent) {
    parent.matrixWorld.decompose(tmpPos, tmpParentQuat, tmpScale);
  } else {
    tmpParentQuat.identity();
  }
  tmpParentQuatInv.copy(tmpParentQuat).invert();
  wrist.quaternion.premultiply(tmpParentQuat).premultiply(tmpDelta).premultiply(tmpParentQuatInv);
  wrist.updateWorldMatrix(false, true);
}
