import * as THREE from "three";

/**
 * 身體上的定位點：手勢用「手要放到臉頰／髖部／頭頂」來描述，而不是寫死座標。
 *
 * 這些點掛在骨頭上，所以頭一轉、身體一傾，點就跟著走 —— 摀臉的手會跟著臉，
 * 而不是停在空中原本臉所在的位置。
 *
 * 數值是從這副骨架量出來的（單位：公尺，模型身高正規化為 1.65）：
 *   頭 y=1.405、眼 y=1.435、耳 (±0.040, 1.430, 0.261)、頭頂髮飾 y=1.553、
 *   肩 y=1.347、上臂根 (±0.055, 1.339, 0.254)、上半身2 y=1.265、下半身 y=1.196。
 *
 * 手臂總長只有 0.233（上臂 0.124 + 前臂 0.109），是這個模型最硬的限制：
 * 定位點離上臂根超過這個距離就永遠搆不到，IK 只會把手臂拉直、看起來像在
 * 用力伸卻碰不到。所有定位點都必須先過這個檢查（見 gesture-reach.test.ts）。
 */

export type AnchorName =
  | "eyes" | "mouth" | "chin" | "foreheadC"
  | "cheekL" | "cheekR"
  | "templeL" | "templeR"
  | "earL" | "earR"
  | "topHeadL" | "topHeadR"
  | "backHeadL" | "backHeadR"
  | "besideHeadL" | "besideHeadR"
  | "aboveHeadL" | "aboveHeadR"
  | "chestFront" | "clapCenter" | "prayCenter"
  | "frontL" | "frontR"
  | "hipL" | "hipR"
  | "buttocksL" | "buttocksR";

interface AnchorSpec {
  /** 掛在哪根骨頭上。 */
  bone: string;
  /**
   * 綁定姿勢下的位置，**以站立高度為單位**（不是公尺）。
   *
   * y 從地板算起（0 = 腳底、1 = 頭頂含髮飾），x/z 同樣除以站立高度。
   *
   * 為什麼不用絕對座標：原本這裡寫的是場景公尺數（眼睛 y=1.435）。
   * 後來 `pmx-loader` 把高度基準從「幾何最低點」改成「腳底」——
   * 模型原點下移、整體放大 1.62 倍——這整張表就一次全部歪掉：
   * 眼睛的定位點跑到頭頂上方 14 公分、髖部高了 27 公分，
   * 所有靠手部目標的動作（叉腰、托腮、拍手、祈禱、摸頭）全部瞄錯位置。
   *
   * 改成比例之後，尺度再怎麼變都不用重調。
   */
  at: [number, number, number];
}

const ANCHORS: Record<AnchorName, AnchorSpec> = {
  // ── 臉與頭（掛在「頭」上，跟著轉頭走） ──
  eyes: { bone: "頭", at: [0.0000, 0.7882, 0.2906] },
  mouth: { bone: "頭", at: [0.0000, 0.7586, 0.2956] },
  chin: { bone: "頭", at: [0.0000, 0.7389, 0.2906] },
  foreheadC: { bone: "頭", at: [0.0000, 0.8177, 0.2808] },
  cheekL: { bone: "頭", at: [0.0443, 0.7685, 0.2808] },
  cheekR: { bone: "頭", at: [-0.0443, 0.7685, 0.2808] },
  templeL: { bone: "頭", at: [0.0512, 0.8010, 0.2660] },
  templeR: { bone: "頭", at: [-0.0512, 0.8010, 0.2660] },
  earL: { bone: "頭", at: [0.0473, 0.7783, 0.2542] },
  earR: { bone: "頭", at: [-0.0473, 0.7783, 0.2542] },

  // ── 頭部周圍手勢空間（掛在「上半身2」，避免轉頭時手腕超出臂長脫臼） ──
  topHeadL: { bone: "上半身2", at: [0.0640, 0.8670, 0.2512] },
  topHeadR: { bone: "上半身2", at: [-0.0640, 0.8670, 0.2512] },
  backHeadL: { bone: "上半身2", at: [0.0739, 0.8227, 0.2118] },
  backHeadR: { bone: "上半身2", at: [-0.0739, 0.8227, 0.2118] },
  besideHeadL: { bone: "上半身2", at: [0.1429, 0.8177, 0.2808] },
  besideHeadR: { bone: "上半身2", at: [-0.1429, 0.8177, 0.2808] },
  // 舉高：手要**貼著頭側往上伸直**，不是往斜前方張開。
  //
  // 先前是 x=±0.1133、y=0.8670 —— 換算成公尺是手腕落在 (±0.19, 1.43)，
  // 肩膀在 y=1.14，等於手臂只抬到離水平 67 度，而這副模型的頭頂在 y≈1.50，
  // 手就跟頭頂齊平。畫面上讀起來是「手舉到一半」，不是歡呼。
  //
  // 手臂長度只有 0.38，肩膀 1.14 —— 手最高只能到 1.52，物理上就不可能
  // 「舉過頭」（動漫比例的頭太大）。所以改成把手收窄、貼著頭側伸直：
  // 手腕 (±0.125, 1.477)，仰角 84 度，這才是 banzai 的剪影。
  aboveHeadL: { bone: "上半身2", at: [0.0758, 0.8952, 0.2611] },
  aboveHeadR: { bone: "上半身2", at: [-0.0758, 0.8952, 0.2611] },

  // ── 軀幹（掛在「上半身2」上，跟著挺胸與前傾走） ──
  chestFront: { bone: "上半身2", at: [0.0000, 0.6601, 0.3300] },
  // 拍手要在身體前方看得見的空間裡發生：z=0.355 幾乎貼著胸前表面，
  // 兩隻手會埋進裙裝邊緣，看起來像手貼在胸口而不是在拍手。
  // 高度很敏感：相機在 y=1.38 略往下看，1.300 會被透視壓到畫面下緣、跟裙裝
  // 糊成一塊；抬到 1.332 又讓指尖頂到下巴（實測指尖 1.388、下巴 1.385）。
  // 1.310 是兩者中間，手在胸口前方、臉完全不被擋。
  clapCenter: { bone: "上半身2", at: [0.0000, 0.6650, 0.3803] },
  prayCenter: { bone: "上半身2", at: [0.0000, 0.6749, 0.3448] },
  frontL: { bone: "上半身2", at: [0.0837, 0.6404, 0.3399] },
  frontR: { bone: "上半身2", at: [-0.0837, 0.6404, 0.3399] },

  // ── 髖部與臀部（叉腰 / 雙手背身後屁股） ──
  // 叉腰：手要在**腰**上，不是大腿上。
  //
  // 先前 y=0.5419 換算是 0.89 公尺，而骨盆骨（`下半身`）在 1.196 ——
  // 手落在大腿中段，叉腰變成「手垂在身側微微外張」，很尷尬。
  // 真人叉腰的手在身高約 0.62 的位置，寬度要比骨盆再外開一點才搭得上腰線。
  hipL: { bone: "下半身", at: [0.1225, 0.6188, 0.2611] },
  hipR: { bone: "下半身", at: [-0.1225, 0.6188, 0.2611] },
  // 手背在身後：要**靠近中線**而且**明顯在身體後方**。
  //
  // 先前是 (±0.154, 0.853, 0.341) 公尺 —— 身體中心在 z≈0.42，所以手只退到
  // 背面往後 8 公分，還張開到左右各 15 公分。那個位置就是「手插在腰側」，
  // 使用者的原話是「很像插腰，但又不是叉腰的姿勢」，說得完全對。
  //
  // 現在收到離中線 5 公分、退到身後 16 公分、高度落在腰下 ——
  // 兩手在背後靠攏、手肘自然往外開，這才是害羞把手藏起來的樣子。
  buttocksL: { bone: "下半身", at: [0.0303, 0.5455, 0.1576] },
  buttocksR: { bone: "下半身", at: [-0.0303, 0.5455, 0.1576] },
};

interface ResolvedAnchor {
  bone: THREE.Bone;
  /** 定位點在該骨頭本地空間中的位移（綁定姿勢下所有骨頭旋轉皆為單位）。 */
  offset: THREE.Vector3;
}

export interface BodyAnchors {
  /** 取得定位點目前的世界座標。呼叫前骨架的世界矩陣要是最新的。 */
  resolve(name: AnchorName, out: THREE.Vector3): THREE.Vector3;
  has(name: AnchorName): boolean;
}

/** 骨頭在綁定姿勢下的模型空間位置（把 local position 沿著鏈累加）。 */
function bindPosition(bone: THREE.Object3D): THREE.Vector3 {
  const out = new THREE.Vector3();
  let current: THREE.Object3D | null = bone;
  while (current && (current as THREE.Bone).isBone === true) {
    out.add(current.position);
    current = current.parent;
  }
  return out;
}

/**
 * @param standingHeight 角色的站立高度（場景單位，腳底到頭頂）。
 *   `ANCHORS` 裡的數值都是這個高度的比例，在這裡才換算成實際座標。
 */
export function buildBodyAnchors(
  bones: Map<string, THREE.Bone>,
  standingHeight: number
): BodyAnchors {
  const resolved = new Map<AnchorName, ResolvedAnchor>();

  for (const [name, spec] of Object.entries(ANCHORS) as [AnchorName, AnchorSpec][]) {
    const bone = bones.get(spec.bone);
    if (!bone) continue;
    const offset = new THREE.Vector3(
      spec.at[0] * standingHeight,
      spec.at[1] * standingHeight,
      spec.at[2] * standingHeight
    ).sub(bindPosition(bone));
    resolved.set(name, { bone, offset });
  }

  return {
    has: (name) => resolved.has(name),
    resolve(name, out) {
      const anchor = resolved.get(name);
      if (!anchor) return out.set(0, 0, 0);
      return out.copy(anchor.offset).applyMatrix4(anchor.bone.matrixWorld);
    },
  };
}
