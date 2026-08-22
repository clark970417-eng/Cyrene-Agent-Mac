import * as THREE from "three";

/**
 * 手指與前臂扭轉的姿勢層。
 *
 * 為什麼不是直接寫每根指骨的 euler：這個 PMX 在載入時經過鏡像座標轉換，
 * 而所有骨頭的綁定姿勢旋轉都是單位四元數 —— 也就是說指骨的「本地軸」其實
 * 就是模型空間的軸，跟手指自己的方向沒有關係。手寫 euler 等於在猜一個
 * 跟解剖無關的座標系，左右手還會互相鏡像，完全沒辦法調。
 *
 * 這裡改成從骨架本身量出旋轉軸：掌心法線由「拇指在哪一側」決定，彎曲軸由
 * 「指節方向 × 掌心法線」決定。同一套規則對左右手都成立（模型是鏡像對稱的，
 * 量出來的軸自然也會鏡像），所以沒有任何寫死的左右正負號。
 */

export type FingerName = "thumb" | "index" | "middle" | "ring" | "little";
export type HandSide = "left" | "right";

/** 一隻手的姿勢。全部是 0~1 的抽象量，不是角度。 */
export interface HandPose {
  /** 每指彎曲：0 伸直、1 完全握起。未列出的手指視為 0。 */
  curl?: Partial<Record<FingerName, number>>;
  /** 五指開合：-1 併攏、0 自然、1 張開。 */
  spread?: number;
}

export type HandShapeName =
  | "relaxed"
  | "open"
  | "flat"
  | "cover"
  | "fist"
  | "point"
  | "peace"
  | "ok"
  | "pinch"
  | "claw"
  | "prayer"
  | "fingerHeart";

/**
 * 常用手型。
 *
 * `relaxed` 是預設待機手型：真人的手垂著時本來就是微彎的，綁定姿勢那種
 * 五指全直的手看起來像假肢，所以待機也要給一點彎曲，而且由食指往小指
 * 遞增（小指彎得最多）才自然。
 */
export const HAND_SHAPES: Record<HandShapeName, HandPose> = {
  relaxed: { curl: { thumb: 0.22, index: 0.30, middle: 0.36, ring: 0.44, little: 0.52 }, spread: 0 },
  // 張開的手不是海星：真人的手指張開時彎曲量由食指往小指遞增，開度也只有
  // 一點點。原本 spread 0.75 + 幾乎全直，揮手看起來像交通警察在比停。
  open: { curl: { thumb: 0.18, index: 0.12, middle: 0.14, ring: 0.19, little: 0.26 }, spread: 0.32 },
  // 攤平的手也不是一塊板子：真人把手攤開時指節仍有 5~10 度的自然彎，
  // 拇指也不會跟四指共面。全部給 0 的話從側面看就是一片紙。
  flat: { curl: { thumb: 0.20, index: 0.06, middle: 0.07, ring: 0.10, little: 0.14 }, spread: 0.12 },
  // 掩嘴：五指併攏、整隻手輕輕內扣成一個淺罩子。真人遮嘴打哈欠不會把
  // 手指張開（那是「停」的手勢），也不會握成拳。
  cover: { curl: { thumb: 0.34, index: 0.26, middle: 0.28, ring: 0.33, little: 0.41 }, spread: -0.55 },
  fist: { curl: { thumb: 0.85, index: 1, middle: 1, ring: 1, little: 1 }, spread: -0.5 },
  point: { curl: { thumb: 0.55, index: 0.02, middle: 1, ring: 1, little: 1 }, spread: -0.2 },
  peace: { curl: { thumb: 0.8, index: 0.03, middle: 0.03, ring: 1, little: 1 }, spread: 0.3 },
  ok: { curl: { thumb: 0.75, index: 0.8, middle: 0.18, ring: 0.22, little: 0.28 }, spread: 0.35 },
  pinch: { curl: { thumb: 0.6, index: 0.62, middle: 0.35, ring: 0.4, little: 0.45 }, spread: 0.1 },
  claw: { curl: { thumb: 0.5, index: 0.55, middle: 0.55, ring: 0.55, little: 0.6 }, spread: 0.55 },
  prayer: { curl: { thumb: 0.15, index: 0.05, middle: 0.05, ring: 0.06, little: 0.08 }, spread: -0.7 },
  /**
   * 單手比心。原本「單眼比心」用的是 `peace`（比 V），跟名字對不上。
   *
   * 但這裡有個做不到的極限：手指只有「彎曲程度」一個自由度，沒有側偏，
   * 所以拇指與食指**沒辦法真的交叉成一個環**。第一版把兩指都彎到 0.6~0.75，
   * 近距離看就是一個拳頭。
   *
   * 折衷是讓拇指與食指都只彎一半、其餘三指收好、再把食指往外撥開 ——
   * 側面看是一個張開的 C，比拳頭接近比心，但它終究不是真的愛心。
   * 要做出真的比心得先讓手指支援側偏（PMX 的指骨有那個軸，是 `applyHandPose`
   * 只寫了彎曲）。
   */
  fingerHeart: { curl: { thumb: 0.34, index: 0.5, middle: 0.95, ring: 1, little: 1 }, spread: 0.22 },
};

const FINGER_ORDER: FingerName[] = ["thumb", "index", "middle", "ring", "little"];

/** PMX 標準指骨名（去掉左右前綴）。拇指多一節 `親指０`（掌骨）。 */
const FINGER_BONE_SUFFIX: Record<FingerName, string[]> = {
  thumb: ["親指０", "親指１", "親指２"],
  index: ["人指１", "人指２", "人指３"],
  middle: ["中指１", "中指２", "中指３"],
  ring: ["薬指１", "薬指２", "薬指３"],
  little: ["小指１", "小指２", "小指３"],
};

/**
 * 各節的最大彎曲角（弧度），對應 `curl = 1`。
 *
 * 依真手的關節活動度：掌指關節約 90°、近端指節約 100°、遠端約 60°。
 * 拇指整體活動度小得多，而且第一節（掌骨）主要負責開合而不是彎曲。
 */
const CURL_LIMIT: Record<FingerName, number[]> = {
  thumb: [0.40, 0.75, 0.85],
  index: [1.50, 1.72, 1.02],
  middle: [1.50, 1.72, 1.02],
  ring: [1.50, 1.72, 1.02],
  little: [1.50, 1.72, 1.02],
};

/**
 * 掌弓：手掌本身是拱的，不是平面。
 *
 * 真手的掌骨由食指往小指逐漸往掌心捲，所以五根手指的根部不共面 —— 這是
 * 「手看起來像一塊板子」與「看起來像手」最大的差別。這一份額外彎曲加在
 * 根節上，對所有手型一律生效（連攤平的手都有拱度）。
 *
 * 拇指不列入：它的掌骨走的是完全不同的方向，由 spread 那條路處理。
 */
const PALM_ARCH = 0.20;
const ARCH_FACTOR: Record<FingerName, number> = {
  thumb: 0, index: 0.10, middle: 0.26, ring: 0.52, little: 0.78,
};

/** 開合只發生在根節（掌指關節），指節本身不會左右擺。 */
const SPREAD_LIMIT: Record<FingerName, number> = {
  thumb: 0.42, index: 0.20, middle: 0.06, ring: 0.18, little: 0.26,
};

interface FingerJointRig {
  bone: THREE.Bone;
  /** 父空間中的彎曲軸：正角度會把指尖往掌心帶。 */
  curlAxis: THREE.Vector3;
  /** 父空間中的開合軸（掌心法線）。 */
  spreadAxis: THREE.Vector3;
  curlLimit: number;
  /** 這一節的開合量，已含方向正負號；非根節為 0。 */
  spreadFactor: number;
  bindRotation: THREE.Quaternion;
}

export interface HandRig {
  side: HandSide;
  /** 掌心朝向（模型空間單位向量），除錯與外部對位用。 */
  palmNormal: THREE.Vector3;
  /**
   * 手指伸出的方向（模型空間單位向量）：由手腕指向中指根。
   *
   * 只對準掌心法線是不夠的：法線對了，手還能繞著法線轉一整圈 —— 實測合十時
   * 掌心確實互相對著，指尖卻是朝前平伸的，看起來像在推東西而不是在拜。
   * 有了第二個軸才能把手的朝向完全定下來。
   */
  fingerDir: THREE.Vector3;
  fingers: Map<FingerName, FingerJointRig[]>;
}

/**
 * 骨頭在綁定姿勢下的模型空間位置。
 *
 * 直接把自己到根為止的 `position` 累加起來：綁定姿勢的旋轉全是單位四元數，
 * 所以這個和就是綁定位置，而且不受目前姿勢或 root 變換影響 —— 隨時呼叫
 * 都會拿到同一個值，不必挑在擺姿勢之前建 rig。
 */
export function bindPosition(bone: THREE.Object3D): THREE.Vector3 {
  const out = new THREE.Vector3();
  let current: THREE.Object3D | null = bone;
  while (current && (current as THREE.Bone).isBone === true) {
    out.add(current.position);
    current = current.parent;
  }
  return out;
}

function prefixOf(side: HandSide): string {
  return side === "left" ? "左" : "右";
}

/**
 * 求掌心法線。
 *
 * 先用「指尖方向 × 掌面橫向」得到一條垂直掌面的線，再決定它朝哪一面：
 * 拇指根一定長在掌心那一側，拿它定號最穩（實測這個模型的投影量 0.217，
 * 而備援的「中指自然彎曲方向」只有 0.028，差一個數量級）。
 */
function resolvePalmNormal(
  bones: Map<string, THREE.Bone>,
  side: HandSide
): THREE.Vector3 | null {
  const p = prefixOf(side);
  const middle1 = bones.get(`${p}中指１`);
  const middle2 = bones.get(`${p}中指２`);
  const middle3 = bones.get(`${p}中指３`);
  const index1 = bones.get(`${p}人指１`);
  const little1 = bones.get(`${p}小指１`);
  if (!middle1 || !middle2 || !middle3 || !index1 || !little1) return null;

  const m1 = bindPosition(middle1);
  const across = bindPosition(index1).sub(bindPosition(little1));
  const fingerDir = bindPosition(middle3).sub(m1);
  const normal = new THREE.Vector3().crossVectors(fingerDir, across);
  if (normal.lengthSq() < 1e-12) return null;
  normal.normalize();

  const thumb0 = bones.get(`${p}親指０`) ?? bones.get(`${p}親指１`);
  if (thumb0) {
    const toThumb = bindPosition(thumb0).sub(bindPosition(index1));
    if (toThumb.dot(normal) < 0) normal.negate();
    return normal;
  }

  // 沒有拇指骨時的備援：手指在綁定姿勢本來就微微朝掌心彎，用這個彎曲方向定號。
  const d1 = bindPosition(middle2).sub(m1).normalize();
  const d2 = bindPosition(middle3).sub(bindPosition(middle2)).normalize();
  const curvature = d2.sub(d1);
  if (curvature.dot(normal) < 0) normal.negate();
  return normal;
}

/** 這根骨頭在綁定姿勢下指向哪（模型空間）。取第一個子骨的位移。 */
function restDirection(bone: THREE.Bone): THREE.Vector3 | null {
  const child = bone.children.find(
    (c): c is THREE.Bone => (c as THREE.Bone).isBone === true
  );
  const dir = child ? child.position.clone() : bone.position.clone();
  if (dir.lengthSq() < 1e-12) return null;
  return dir.normalize();
}

/**
 * 從骨架量出一隻手的旋轉軸。找不到標準指骨就回 null（模型沒有手指骨）。
 */
export function buildHandRig(
  bones: Map<string, THREE.Bone>,
  side: HandSide
): HandRig | null {
  const palmNormal = resolvePalmNormal(bones, side);
  if (!palmNormal) return null;

  const p = prefixOf(side);
  const middleRoot = bones.get(`${p}中指１`);
  if (!middleRoot) return null;
  const wristBone = bones.get(`${p}手首`);
  const fingerDir = bindPosition(middleRoot)
    .sub(bindPosition(wristBone ?? middleRoot))
    .normalize();
  const palmCenter = bindPosition(middleRoot);

  // 開合幅度按「離中指多遠」分配：中指幾乎不動，小指張得最開。
  const outwardByFinger = new Map<FingerName, THREE.Vector3>();
  let maxOutward = 1e-6;
  for (const finger of FINGER_ORDER) {
    const root = bones.get(`${p}${FINGER_BONE_SUFFIX[finger][0]}`);
    if (!root) continue;
    const outward = bindPosition(root).sub(palmCenter);
    outwardByFinger.set(finger, outward);
    maxOutward = Math.max(maxOutward, outward.length());
  }

  const fingers = new Map<FingerName, FingerJointRig[]>();

  for (const finger of FINGER_ORDER) {
    const joints: FingerJointRig[] = [];
    const suffixes = FINGER_BONE_SUFFIX[finger];

    for (let i = 0; i < suffixes.length; i++) {
      const bone = bones.get(`${p}${suffixes[i]}`);
      if (!bone) continue;
      const dir = restDirection(bone);
      if (!dir) continue;

      // 繞這條軸轉正角度時，指尖會朝掌心走（(dir × palm) × dir = palm）。
      const curlAxis = new THREE.Vector3().crossVectors(dir, palmNormal);
      if (curlAxis.lengthSq() < 1e-12) continue;
      curlAxis.normalize();

      let spreadFactor = 0;
      if (i === 0) {
        const outward = outwardByFinger.get(finger);
        if (outward && outward.lengthSq() > 1e-12) {
          // 繞掌心法線轉正角度時指尖往哪走；跟「遠離中指」同向才算張開。
          const swing = new THREE.Vector3().crossVectors(palmNormal, dir);
          const sign = swing.dot(outward) >= 0 ? 1 : -1;
          spreadFactor = sign * Math.min(1, outward.length() / maxOutward);
        }
      }

      joints.push({
        bone,
        curlAxis,
        spreadAxis: palmNormal.clone(),
        curlLimit: CURL_LIMIT[finger][i] ?? CURL_LIMIT[finger][CURL_LIMIT[finger].length - 1],
        spreadFactor: spreadFactor * SPREAD_LIMIT[finger],
        bindRotation: bone.quaternion.clone(),
      });
    }

    if (joints.length > 0) fingers.set(finger, joints);
  }

  if (fingers.size === 0) return null;
  if (fingerDir.lengthSq() < 0.5) fingerDir.set(0, -1, 0);
  return { side, palmNormal, fingerDir, fingers };
}

const tmpCurl = new THREE.Quaternion();
const tmpSpread = new THREE.Quaternion();

/**
 * 把手型寫進骨頭。`weight` 是整體權重，手勢淡入淡出時直接乘在上面。
 */
export function applyHandPose(rig: HandRig, pose: HandPose, weight = 1): void {
  const w = Math.min(Math.max(weight, 0), 1);
  const spread = pose.spread ?? 0;

  for (const [finger, joints] of rig.fingers) {
    const curl = Math.min(Math.max(pose.curl?.[finger] ?? 0, 0), 1);
    const arch = PALM_ARCH * ARCH_FACTOR[finger] * w;
    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];
      // 掌弓只加在根節（掌指關節），那才是掌骨拱起來的地方。
      const angle = curl * joint.curlLimit * w + (i === 0 ? arch : 0);
      tmpCurl.setFromAxisAngle(joint.curlAxis, angle);
      joint.bone.quaternion.copy(joint.bindRotation).premultiply(tmpCurl);
      if (joint.spreadFactor !== 0 && spread !== 0) {
        tmpSpread.setFromAxisAngle(joint.spreadAxis, spread * joint.spreadFactor * w);
        joint.bone.quaternion.premultiply(tmpSpread);
      }
    }
  }
}

/** 把手指拉回綁定姿勢。 */
export function resetHandPose(rig: HandRig): void {
  for (const joints of rig.fingers.values()) {
    for (const joint of joints) joint.bone.quaternion.copy(joint.bindRotation);
  }
}

/** 兩個手型之間插值（0 = from、1 = to）。 */
export function blendHandPose(from: HandPose, to: HandPose, t: number): HandPose {
  const k = Math.min(Math.max(t, 0), 1);
  const curl: Partial<Record<FingerName, number>> = {};
  for (const finger of FINGER_ORDER) {
    const a = from.curl?.[finger] ?? 0;
    const b = to.curl?.[finger] ?? 0;
    curl[finger] = a + (b - a) * k;
  }
  const sa = from.spread ?? 0;
  const sb = to.spread ?? 0;
  return { curl, spread: sa + (sb - sa) * k };
}

/**
 * 前臂／上臂的扭轉骨（`腕捩`、`手捩`）。
 *
 * 這兩根骨頭的作用是讓「手掌翻面」時肌肉是漸進扭轉而不是在手腕處硬折。
 * 它們的旋轉軸就是骨頭自己的方向，同樣從骨架量出來。
 */
export interface TwistRig {
  bone: THREE.Bone;
  axis: THREE.Vector3;
  bindRotation: THREE.Quaternion;
}

export function buildTwistRig(
  bones: Map<string, THREE.Bone>,
  twistBoneName: string,
  fromBoneName: string,
  toBoneName: string
): TwistRig | null {
  const bone = bones.get(twistBoneName);
  const from = bones.get(fromBoneName);
  const to = bones.get(toBoneName);
  if (!bone || !from || !to) return null;
  const axis = bindPosition(to).sub(bindPosition(from));
  if (axis.lengthSq() < 1e-12) return null;
  return { bone, axis: axis.normalize(), bindRotation: bone.quaternion.clone() };
}

export function applyTwist(rig: TwistRig, radians: number): void {
  rig.bone.quaternion.setFromAxisAngle(rig.axis, radians).multiply(rig.bindRotation);
}
