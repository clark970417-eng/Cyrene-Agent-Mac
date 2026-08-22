import * as THREE from "three";
import type { PMXCollider } from "./pmx-loader";

/**
 * 彈簧骨物理 —— 讓頭髮、頭紗、裙襬、袖子跟著晃。
 *
 * 為什麼不是 MMD 原本的剛體物理：three.js 0.185 已經把 `MMDLoader` 和
 * `MMDPhysics` 一起移除了，要跑真的 Bullet 模擬得再拉一個 ammo.js（wasm）
 * 進來。對「視訊通話裡的一個立繪」來說，彈簧骨的視覺效果幾乎一樣，成本
 * 卻低一個數量級，也不必多一個依賴。
 *
 * 演算法是 VRM SpringBone 那一套 Verlet 積分：每個關節記住自己「尾端」的
 * 世界座標，每幀累加慣性、重力與回正力，再把尾端拉回固定長度，最後反推出
 * 骨頭該轉多少。
 */

/** 一條鏈的物理參數。數值是 units/秒，模型高度已正規化為 1.65。 */
export interface SpringChainParams {
  /** 回正力：越大越硬、越快回到原位。 */
  stiffness: number;
  /**
   * 阻尼 0~1：每幀保留的慣性是 `1 - drag`，所以越大越黏滯。
   *
   * 這個值曾經被設到 0.92~0.96 —— 只保留 4%~8% 的速度，等於布料完全沒有
   * 動量，裙襬像硬板一樣黏在身上。VRM SpringBone 的預設 dragForce 是 0.4
   * （保留 60%），本檔的數值以此為基準微調。
   */
  drag: number;
  /** 重力強度。 */
  gravityPower: number;
  /**
   * 單一關節相對綁定姿勢的最大偏轉（弧度）。
   *
   * 這是「裙子不會飄」的主因：先前是全域寫死 0.08 rad（4.58°），一條四節的
   * 裙襬最多只能彎 18°，肉眼看起來就是完全不動。它原本是為了壓住髮尾亂甩
   * 才加的，但真正的元凶是當時 5~14 的 stiffness，那個已經修掉了。
   */
  maxDeflection: number;
}

interface SpringJoint {
  bone: THREE.Bone;
  /** 在自身 local 空間中指向子節點的單位向量。 */
  boneAxis: THREE.Vector3;
  boneLength: number;
  /** 綁定姿勢下的 local 旋轉，回正力以此為基準。 */
  initialLocalRotation: THREE.Quaternion;
  /** 尾端的世界座標（目前 / 上一幀），Verlet 用。 */
  currentTail: THREE.Vector3;
  prevTail: THREE.Vector3;
  /**
   * 最近兩個**物理步**算出來的骨頭旋轉，給畫面插值用（見 applyInterpolated）。
   * 物理跑在自己的固定時間軸上，畫面在這兩個狀態之間取中間值。
   */
  stepRotation: THREE.Quaternion;
  previousStepRotation: THREE.Quaternion;
  /** PMX 碰撞遮罩：位元 N 代表會碰群組 N。0 表示完全不碰。 */
  collisionMask: number;
  /**
   * 對每個碰撞體允許的最小距離，長度與 colliders 相同。
   *
   * 一般是「碰撞體半徑 + 關節半徑」，但**綁定姿勢就已經在碰撞體內部的關節例外**：
   * 那種情形改用它綁定時的距離。裙子的骨架是一圈套在髖部外的籠子，前幾圈本來
   * 就位在下半身碰撞體（半徑 7.2cm）裡面；照一般規則每一幀都會被推出去，實測
   * 裙襬半徑從 0.228 被撐到 0.308（+35%）、整圈往上浮，裙子等於炸開。
   *
   * 碰撞體的職責是擋住**新的**侵入，不是驅逐一開始就設計在裡面的布料。
   */
  colliderLimits: Float32Array;
}

interface SpringChain {
  joints: SpringJoint[];
  params: SpringChainParams;
}

/**
 * 依骨名前綴挑參數。這個模型的作者把部位名稱編在骨名裡（裙_N_M、左长头纱、
 * zhhair、右上袖…），所以前綴比骨頭在骨架中的位置更能反映它該有的手感。
 */
// 剛性是「每秒推進的場景單位數」，直接加在尾端位置上。模型高度正規化為
// 1.65（約等於公尺），單節骨頭只有 0.03~0.10 長，所以合理區間是 0.5~2：
// 取 1.0 時每幀推進 1/60 ≈ 0.017，約為骨長的兩成，是穩定的彈簧。
//
// 先前這裡是 5~14，每幀推進 0.08~0.23 —— 大於骨長本身，等於每幀都過衝，
// 再被長度約束彈回、慣性又帶過頭，裙子就變成持續亂飛。
const PARAM_PRESETS: { match: RegExp; params: SpringChainParams }[] = [
  // 胸：幅度要小，過大就變成滑稽的彈跳。
  { match: /胸/, params: { stiffness: 4.0, drag: 0.70, gravityPower: 0.02, maxDeflection: 0.10 } },
  // 裙身與後中裙帶。
  //
  // 這裡的參數跟其他布料的取向相反：**重力壓到 0.03**（其他布料是 0.06~0.10）。
  // 傘狀的蓬裙靠模型本身的造型撐出體積，物理只負責「腿一動裙子跟著讓開」
  // 這種二次擺動。實測給它一般布料的參數（重力 0.10、上限 25 度）之後，
  // 每一節都往內垂，沿著 4~5 節的鏈累加起來整片前裙直接塌貼在腿上，
  // 裙子消失、腿露出來 —— 那不是被碰撞體頂開，是被自己的重力收掉的。
  //
  // 偏轉上限維持 0.30：這是傘狀蓬裙，靠模型造型撐體積，物理只加二次擺動。
  { match: /裙|裙角|下半身|後中裙/, params: { stiffness: 5.0, drag: 0.60, gravityPower: 0.01, maxDeflection: 0.30 } },
  // 後長紗帶、頭紗與長飄帶：最輕，飄得最開。
  { match: /带|帶|条|條|后纱|後紗|長紗|长头纱/, params: { stiffness: 2.4, drag: 0.50, gravityPower: 0.09, maxDeflection: 0.55 } },
  // 長髮與瀏海：鏈最長（6~11 節），偏轉與慣性都會一路累加到髮尾。
  //
  // 甩尾是用**阻尼**收的，不是用偏轉上限掐的：drag 0.55 時最長那條（zhair）
  // 甩頭後要 71 幀才停，0.74 之後剩 40 幀，其他鏈本來就只要 23 幀。
  //
  // maxDeflection 維持 0.40：曾經為了壓抖動放寬到 0.85，結果髮絲會翹出來、
  // 姿態變得不自然。抖動的真兇是時間步進（見 update 裡的 dtRatio 與呼叫端的
  // 註解），跟這個上限無關，放寬只是把姿態弄壞。
  { match: /hair|刘海|发饰|髪|头发/, params: { stiffness: 2.8, drag: 0.74, gravityPower: 0.07, maxDeflection: 0.40 } },
  // 手腕緞帶：綁在手腕上的蝴蝶結，不是自由飄動的布。
  //
  // 它的骨頭掛在前臂扭轉骨底下，網格同時吃手腕的權重。一旦讓它像布料那樣
  // 擺開，兩端就被拉開 —— 實測揮手時整個蝴蝶結被甩成一個橫跨手臂的大圈。
  // 幾乎完全跟著骨頭走、只留一點點延遲才是對的。
  { match: /手环|手環/, params: { stiffness: 9.0, drag: 0.58, gravityPower: 0.01, maxDeflection: 0.06 } },
  // 肩帶與上袖（肩甲）：這是硬質護甲，不是布。
  //
  // 交回物理之後如果套用一般布料參數（重力 0.06、偏轉上限 20 度），手一舉起來
  // 整片肩甲就從肩膀脫離、浮在腋下跟手臂之間留一道縫。護甲該做的是「幾乎完全
  // 跟著骨頭走，只帶一點點延遲」，所以剛性拉高、重力歸零、偏轉壓到 4 度。
  //
  // 放在 `袖` 規則之前：`上袖` 兩邊都match得到，要讓這條先命中。
  { match: /肩带|肩帶|上袖/, params: { stiffness: 9.0, drag: 0.55, gravityPower: 0, maxDeflection: 0.07 } },
  // 袖子：布料較挺，擺幅比裙子小。
  { match: /袖/, params: { stiffness: 3.0, drag: 0.55, gravityPower: 0.06, maxDeflection: 0.35 } },
  // 小飾品（耳環、手環、頸花）：短、硬、幾乎不受重力。
  { match: /环|環|花|饰|飾|穗|坠/, params: { stiffness: 4.0, drag: 0.60, gravityPower: 0.04, maxDeflection: 0.25 } },
];

const DEFAULT_PARAMS: SpringChainParams = {
  stiffness: 3.2, drag: 0.58, gravityPower: 0.06, maxDeflection: 0.35,
};

/**
 * 單幀位移上限，以骨長為單位。
 *
 * 這是防發散的保險，不該拿來當「讓它不要動」的手段——先前設成 0.05
 * （骨長的 5%）時，它和 4.58° 的偏轉上限一起把布料釘死了。
 */
const MAX_STEP_PER_BONE_LENGTH = 0.3;

/**
 * 參數的基準更新率。
 *
 * 所有 stiffness / gravityPower 的數值都是以「每 1/60 秒推進多少」寫的，
 * 而力在積分裡要乘 dt²，所以換算時要再乘上這個基準率——這樣 60fps 下的
 * 行為與改動前完全相同，預設參數不必重新調校。
 */
const REFERENCE_RATE = 60;

/**
 * 單步回正推進量的上限，以骨長為單位。
 *
 * 回正力原本是寫死的「每秒 N 個場景單位」，隱含假設骨長 0.03~0.10。實際上這個
 * 模型的骨頭短得多——zhair 一節只有 0.0155~0.0292，颈花只有 0.0063——所以
 * stiffness=2.8 每步要推 0.0467，是整根骨長的 1.6~7 倍。尾端於是每步都衝過頭，
 * 被 MAX_STEP_PER_BONE_LENGTH 砍成 30% 後又被慣性帶過頭，變成 bang-bang 震盪：
 * 肉眼看到的就是髮尾一直抖。
 *
 * 把推進量綁在骨長上，短骨頭就不會被過度驅動；長骨頭維持原本的手感。
 */
const MAX_RESTORE_PER_BONE_LENGTH = 0.18;

/**
 * 碰撞推出量刻意**不設上限**。
 *
 * 曾經試過限制單步只能推出骨長的 25%，想藉此壓掉髮尾鑽進細剛體時的跳動，
 * 結果反而更糟（尾端單幀尖峰從 0.9mm 惡化到 6.4mm）：推不乾淨的關節會一直
 * 卡在碰撞體裡，每一幀都被推一次，變成持續的接觸顫振。一次推到位才能形成
 * 穩定的靜止接觸。
 */

/**
 * 關節本身的碰撞半徑。
 *
 * 2mm 幾乎等於一個點，布料要刺進碰撞體很深才會被推回來，看起來就是穿模。
 * 15mm 約等於一層布的厚度，能在貼身與穿透之間站住。
 */
const JOINT_RADIUS = 0.015;

/**
 * 查不到 PMX 碰撞遮罩時要用的預設。
 *
 * 先前是 0 —— 也就是「完全不碰任何東西」。PMX 的 groupTarget 只掛在剛體上，
 * 而一條骨鏈裡常有幾節沒有對應剛體（作者只在關鍵節點放剛體），那幾節就完全
 * 失去碰撞，裙襬於是直接穿過大腿。改成全開：寧可多擋也不要穿出來。
 */
const DEFAULT_COLLISION_MASK = 0xffff;

function pickParams(chainRootName: string): SpringChainParams {
  for (const preset of PARAM_PRESETS) {
    if (preset.match.test(chainRootName)) return preset.params;
  }
  return DEFAULT_PARAMS;
}

export class SpringBoneSystem {
  private chains: SpringChain[] = [];
  private gravityDir = new THREE.Vector3(0, -1, 0);
  /** 上一步的步長，供 Verlet 的慣性項做時間修正（見 update）。 */
  private previousDt = 1 / 60;

  /** 暫存向量，避免每幀在迴圈裡配置物件。 */
  private readonly tmpWorldPos = new THREE.Vector3();
  private readonly tmpParentRot = new THREE.Quaternion();
  private readonly tmpParentRotInv = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpDecomposePos = new THREE.Vector3();
  private readonly tmpRestDir = new THREE.Vector3();
  private readonly tmpNextTail = new THREE.Vector3();
  private readonly tmpInertia = new THREE.Vector3();
  private readonly tmpLocalDir = new THREE.Vector3();
  private readonly tmpRestLocalDir = new THREE.Vector3();
  private readonly tmpClampAxis = new THREE.Vector3();
  private readonly tmpClampedTail = new THREE.Vector3();
  private readonly tmpDelta = new THREE.Quaternion();

  /** 碰撞用暫存。 */
  private colliders: PMXCollider[] = [];
  private readonly tmpColliderPos = new THREE.Vector3();
  private readonly tmpColliderTip = new THREE.Vector3();
  private readonly tmpColliderAxis = new THREE.Vector3();
  private readonly tmpSegment = new THREE.Vector3();
  private readonly tmpPush = new THREE.Vector3();

  /**
   * @param boneChains 由 loader 依 PMX 剛體標記組出的骨鏈，每條皆由根排到末端。
   *                   鏈的順序本身也有意義：分岔出去的支鏈一定排在其父鏈之後，
   *                   照陣列順序求解就能保證父關節先於子關節算完。
   * @param colliders  身體的碰撞形狀（PMX 的 kinematic 剛體）。省略則不做碰撞。
   * @param collisionMask 骨頭 → PMX 碰撞遮罩。查不到的骨頭套用全開遮罩
   *                      （見 DEFAULT_COLLISION_MASK）。
   */
  constructor(
    boneChains: THREE.Bone[][],
    colliders: PMXCollider[] = [],
    collisionMask: Map<THREE.Bone, number> = new Map()
  ) {
    this.colliders = colliders;

    // 用來判斷某根骨頭的子節點是否也在模擬範圍內（決定擺動方向與鏈的末端）。
    const boneSet = new Set<THREE.Bone>();
    for (const chain of boneChains) {
      for (const bone of chain) boneSet.add(bone);
    }

    for (const chainBones of boneChains) {
      if (chainBones.length === 0) continue;
      const joints = this.buildJoints(chainBones, boneSet, collisionMask);
      if (joints.length > 0) {
        this.chains.push({ joints, params: pickParams(chainBones[0].name) });
      }
    }

    this.measureBindClearances();
  }

  /**
   * 記下每個關節在綁定姿勢下與各碰撞體的距離。
   *
   * 一開始就在碰撞體裡面的關節（裙子的籠子就套在髖部碰撞體內），把允許距離
   * 降成它綁定時的距離：之後只擋得住「比原本更深的侵入」，不會每幀把它往外推。
   * 呼叫時機必須是模型剛載入、還沒擺任何姿勢的時候。
   */
  private measureBindClearances(): void {
    const count = this.colliders.length;
    if (count === 0) return;

    for (const chain of this.chains) {
      for (const joint of chain.joints) {
        for (let ci = 0; ci < count; ci++) {
          const collider = this.colliders[ci];
          const standard = collider.radius + JOINT_RADIUS;
          if ((joint.collisionMask & (1 << collider.group)) === 0) {
            joint.colliderLimits[ci] = standard;
            continue;
          }
          const bindDistance = this.distanceToCollider(joint.currentTail, collider);
          // 留 1mm 餘裕，免得剛好貼在表面的關節被判定成「在裡面」而失去碰撞。
          joint.colliderLimits[ci] =
            bindDistance < standard ? Math.max(0, bindDistance - 0.001) : standard;
        }
      }
    }
  }

  /** 點到碰撞體中心線（膠囊）或中心（球）的距離。 */
  private distanceToCollider(point: THREE.Vector3, collider: PMXCollider): number {
    this.tmpColliderPos.copy(collider.offset).applyMatrix4(collider.bone.matrixWorld);
    let closestX = this.tmpColliderPos.x;
    let closestY = this.tmpColliderPos.y;
    let closestZ = this.tmpColliderPos.z;

    if (collider.shape === "capsule" && collider.height > 0) {
      this.tmpColliderAxis
        .copy(collider.axis)
        .transformDirection(collider.bone.matrixWorld)
        .normalize();
      this.tmpSegment.copy(point).sub(this.tmpColliderPos);
      const half = collider.height * 0.5;
      const projected = Math.max(
        -half,
        Math.min(half, this.tmpSegment.dot(this.tmpColliderAxis))
      );
      closestX = this.tmpColliderPos.x + this.tmpColliderAxis.x * projected;
      closestY = this.tmpColliderPos.y + this.tmpColliderAxis.y * projected;
      closestZ = this.tmpColliderPos.z + this.tmpColliderAxis.z * projected;
    }

    return Math.hypot(point.x - closestX, point.y - closestY, point.z - closestZ);
  }

  public get colliderCount(): number {
    return this.colliders.length;
  }

  /**
   * 把尾端推出所有碰撞體外。
   *
   * 膠囊視為一段線段加上半徑：先求尾端到線段的最近點，再沿法線推開。
   * 球體就是線段長度為 0 的退化情形，兩者共用同一段程式。
   */
  private resolveCollisions(tail: THREE.Vector3, limits: Float32Array, mask: number): void {
    for (let ci = 0; ci < this.colliders.length; ci++) {
      const collider = this.colliders[ci];
      // MMD 的分組過濾：遮罩上對應的位元沒開就不碰。
      if ((mask & (1 << collider.group)) === 0) continue;
      // 碰撞體掛在骨頭上，骨頭動它就跟著動。
      this.tmpColliderPos
        .copy(collider.offset)
        .applyMatrix4(collider.bone.matrixWorld);

      let closestX = this.tmpColliderPos.x;
      let closestY = this.tmpColliderPos.y;
      let closestZ = this.tmpColliderPos.z;

      if (collider.shape === "capsule" && collider.height > 0) {
        this.tmpColliderAxis
          .copy(collider.axis)
          .transformDirection(collider.bone.matrixWorld)
          .normalize();

        // 把尾端投影到線段上並夾在兩端之間
        this.tmpSegment.copy(tail).sub(this.tmpColliderPos);
        const half = collider.height * 0.5;
        const projected = Math.max(
          -half,
          Math.min(half, this.tmpSegment.dot(this.tmpColliderAxis))
        );
        closestX = this.tmpColliderPos.x + this.tmpColliderAxis.x * projected;
        closestY = this.tmpColliderPos.y + this.tmpColliderAxis.y * projected;
        closestZ = this.tmpColliderPos.z + this.tmpColliderAxis.z * projected;
      }

      this.tmpPush.set(tail.x - closestX, tail.y - closestY, tail.z - closestZ);
      const minDistance = limits[ci];
      if (minDistance <= 0) continue;
      const distanceSq = this.tmpPush.lengthSq();
      if (distanceSq >= minDistance * minDistance) continue;

      const distance = Math.sqrt(distanceSq);
      if (distance < 1e-6) {
        // 尾端正好落在軸心上，沒有可用的法線；往上推開，避免除以零。
        this.tmpPush.set(0, 1, 0);
      } else {
        this.tmpPush.divideScalar(distance);
      }
      tail.copy(this.tmpPush).multiplyScalar(minDistance).add(
        this.tmpColliderTip.set(closestX, closestY, closestZ)
      );
    }
  }

  public get jointCount(): number {
    return this.chains.reduce((sum, c) => sum + c.joints.length, 0);
  }

  public get chainCount(): number {
    return this.chains.length;
  }

  private buildJoints(
    orderedBones: THREE.Bone[],
    boneSet: Set<THREE.Bone>,
    collisionMask: Map<THREE.Bone, number>
  ): SpringJoint[] {
    const joints: SpringJoint[] = [];

    for (const bone of orderedBones) {
      // 指向子節點的向量。子骨的 position 就是相對本骨的位移，直接可用。
      // 分岔時取第一個物理子骨當作擺動方向的代表。
      const child = bone.children.find(
        (c): c is THREE.Bone => c instanceof THREE.Bone && boneSet.has(c)
      );

      // 末端關節沒有子骨，就沿用「自己相對父骨的方向」把鏈延伸下去 ——
      // 綁定姿勢下所有骨頭都沒有旋轉，兩個空間的方向是一致的。
      const ownOffset = bone.position.clone().multiplyScalar(0.7);
      let toChild = child ? child.position.clone() : ownOffset.clone();

      // MMD 模型常見與父骨完全重合的輔助骨，這時子骨給不出方向，
      // 退回自身位移。若連自身位移都是零就真的無從定義，只能跳過 ——
      // 但不能連帶讓上一段可擺動的骨頭也失去模擬。
      if (toChild.lengthSq() < 1e-12) toChild = ownOffset;
      const boneLength = toChild.length();
      if (boneLength < 1e-6) continue;

      const boneAxis = toChild.divideScalar(boneLength);

      bone.updateWorldMatrix(true, false);
      const tail = boneAxis.clone().multiplyScalar(boneLength).applyMatrix4(bone.matrixWorld);

      joints.push({
        // 綁定期的碰撞距離稍後統一量（見 measureBindClearances），先給預設值。
        colliderLimits: new Float32Array(this.colliders.length).fill(Infinity),
        bone,
        boneAxis,
        boneLength,
        initialLocalRotation: bone.quaternion.clone(),
        currentTail: tail.clone(),
        prevTail: tail.clone(),
        stepRotation: bone.quaternion.clone(),
        previousStepRotation: bone.quaternion.clone(),
        collisionMask: collisionMask.get(bone) ?? DEFAULT_COLLISION_MASK,
      });
    }

    return joints;
  }

  /**
   * 每幀呼叫一次。呼叫前請先確保骨架的 matrixWorld 已是最新
   * （例如先對模型的 root 呼叫 updateMatrixWorld(true)）。
   */
  public update(delta: number): void {
    // 分頁切回來或掉幀時 delta 會暴衝，不夾住的話彈簧會直接炸開。
    const dt = Math.min(Math.max(delta, 1e-4), 1 / 30);
    // 阻尼與單步位移上限原本都是「每步」定義的，步長一變手感就跟著變。
    // 以 1/60 為基準正規化之後，用任何步長跑出來的每秒行為都一致，
    // 這是「直接用實際幀時間步進」的前提（見 vrm-viewer 的呼叫端）。
    const stepScale = dt * 60;

    // Verlet 的慣性項是「上一步的位移」，代表的是速度 × 上一步的步長。
    // 步長一變就必須按 dt / 上一步dt 修正，否則長短步交替會直接變成位移交替：
    // 實測沒有這道修正時，長短步交替餵進去，髮尾速度的自相關 lag1 是 -0.96
    // （每幀反向），跟實機量到的 -0.78 是同一個病。
    const dtRatio = Math.min(Math.max(dt / this.previousDt, 0.5), 2);
    this.previousDt = dt;

    for (const chain of this.chains) {
      const { stiffness, drag, gravityPower, maxDeflection } = chain.params;

      // 由根往末端處理：父關節先更新，子關節才能讀到正確的 matrixWorld。
      for (let jIdx = 0; jIdx < chain.joints.length; jIdx++) {
        const joint = chain.joints[jIdx];
        const bone = joint.bone;
        // 骨頭上目前掛的可能是「畫面插值後」的姿勢（見 applyInterpolated），
        // 物理必須從自己上一步的結果接下去，否則兩條時間軸會互相污染。
        bone.quaternion.copy(joint.stepRotation);
        joint.previousStepRotation.copy(joint.stepRotation);
        // 隨關節深度（第 N 節）逐步增加回正約束與阻尼，防止 8~11 節超長骨鏈末端甩鞭過衝
        const isRoot = jIdx === 0;
        const depthRatio = Math.min(jIdx / 5, 1.0);
        const curStiffness = isRoot
          ? stiffness * 1.8
          : stiffness * (1.0 + depthRatio * 0.4);
        // 越靠末端阻尼越高，抑制長鏈累積出來的鞭尾效應。
        //
        // 上限原本是 0.85，長髮（drag 0.74）的末端一路就頂在那裡，甩頭之後要
        // 57 幀才停，短鏈只要 21 幀——差距就是使用者看到的「髮尾一直亂動」。
        // 放寬到 0.92 之後末端幾乎只剩跟隨、不再自己盪。
        const curDrag = Math.min(drag + depthRatio * 0.26, 0.92);
        const curGravity = isRoot
          ? gravityPower * 0.15
          : gravityPower * (1.0 - depthRatio * 0.3);

        // 偏轉上限沿著鏈往末端收緊。
        //
        // 每一節的偏轉是**相對父節**的，所以會一路累加：一條 10 節的頭髮
        // 若每節都允許 31.5°，尾端在世界空間裡的擺幅大到會亂甩。根部需要
        // 足夠的自由度才擺得起來，尾端則要收斂，髮絲才會是「甩尾」而不是
        // 「亂抖」。末端收到約 45%。
        const curMaxDeflection = maxDeflection * (1 - depthRatio * 0.55);

        // 父骨已在本迴圈稍早（或迴圈外的整體更新）算好，這裡不必回溯父鏈。
        bone.updateWorldMatrix(false, false);
        this.tmpWorldPos.setFromMatrixPosition(bone.matrixWorld);

        const parent = bone.parent;
        if (parent) {
          parent.matrixWorld.decompose(this.tmpDecomposePos, this.tmpParentRot, this.tmpScale);
        } else {
          this.tmpParentRot.identity();
        }

        // 回正方向：綁定姿勢下這根骨頭在世界空間中該指的方向。
        this.tmpRestDir
          .copy(joint.boneAxis)
          .applyQuaternion(joint.initialLocalRotation)
          .applyQuaternion(this.tmpParentRot)
          .normalize();

        // Verlet：慣性 + 回正 + 重力
        this.tmpInertia
          .copy(joint.currentTail)
          .sub(joint.prevTail)
          .multiplyScalar(Math.pow(1 - curDrag, stepScale) * dtRatio);

        // 回正推進量不得超過骨長的一定比例，否則短骨頭會被過度驅動而震盪。
        //
        // 力乘的是 dt²（加速度語意）而不是 dt。原本是 dt，等於把力當成「速度」，
        // 步長一變，平衡點就跟著變——長短步交替時尾端會在兩個平衡點之間來回跳。
        // 乘上 REFERENCE_RATE 讓 60fps 下的數值與改動前完全相同，
        // 所以預設參數不必重新調校。
        const restoreStep = Math.min(
          curStiffness * REFERENCE_RATE * dt * dt,
          joint.boneLength * MAX_RESTORE_PER_BONE_LENGTH * stepScale * stepScale
        );

        this.tmpNextTail
          .copy(joint.currentTail)
          .add(this.tmpInertia)
          .addScaledVector(this.tmpRestDir, restoreStep)
          .addScaledVector(this.gravityDir, curGravity * REFERENCE_RATE * dt * dt);

        // 穩定性保險：限制單幀位移，避免任何參數組合讓系統發散。
        const maxStep = joint.boneLength * MAX_STEP_PER_BONE_LENGTH * stepScale;
        this.tmpSegment.copy(this.tmpNextTail).sub(joint.currentTail);
        const stepLength = this.tmpSegment.length();
        if (stepLength > maxStep) {
          this.tmpNextTail
            .copy(joint.currentTail)
            .addScaledVector(this.tmpSegment, maxStep / stepLength);
        }

        // 長度約束：尾端必須維持在距骨頭原點 boneLength 的球面上。
        this.tmpNextTail
          .sub(this.tmpWorldPos)
          .normalize()
          .multiplyScalar(joint.boneLength)
          .add(this.tmpWorldPos);

        // 碰撞：把尾端推出身體外，再重新套一次長度約束。
        let hadCollision = false;
        if (this.colliders.length > 0 && joint.collisionMask !== 0) {
          const beforeColX = this.tmpNextTail.x;
          const beforeColY = this.tmpNextTail.y;
          const beforeColZ = this.tmpNextTail.z;
          this.resolveCollisions(this.tmpNextTail, joint.colliderLimits, joint.collisionMask);
          this.tmpNextTail
            .sub(this.tmpWorldPos)
            .normalize()
            .multiplyScalar(joint.boneLength)
            .add(this.tmpWorldPos);

          const pushedDist = Math.hypot(
            this.tmpNextTail.x - beforeColX,
            this.tmpNextTail.y - beforeColY,
            this.tmpNextTail.z - beforeColZ
          );
          if (pushedDist > 1e-4) hadCollision = true;
        }

        // 反推 local 旋轉：找出把「靜止方向」轉到「目前尾端方向」的差值旋轉。
        this.tmpParentRotInv.copy(this.tmpParentRot).invert();
        this.tmpLocalDir
          .copy(this.tmpNextTail)
          .sub(this.tmpWorldPos)
          .applyQuaternion(this.tmpParentRotInv)
          .normalize();
        this.tmpRestLocalDir
          .copy(joint.boneAxis)
          .applyQuaternion(joint.initialLocalRotation)
          .normalize();

        // 角度限制：長鏈的偏轉會逐節累加，這裡限制單節上限，避免髮尾翻捲或
        // 裙襬掀過頭。上限依部位而定（見 SpringChainParams.maxDeflection）。
        const deflection = this.tmpRestLocalDir.angleTo(this.tmpLocalDir);
        if (deflection > curMaxDeflection) {
          this.tmpClampAxis.crossVectors(this.tmpRestLocalDir, this.tmpLocalDir);
          if (this.tmpClampAxis.lengthSq() > 1e-12) {
            this.tmpClampAxis.normalize();
            this.tmpLocalDir
              .copy(this.tmpRestLocalDir)
              .applyAxisAngle(this.tmpClampAxis, curMaxDeflection);

            // 夾限之後把**尾端**也拉回同一個方向，並且把上一幀的位置一起平移
            // 同樣的量。
            //
            // 只改畫面用的方向、不動物理狀態：尾端會繼續往上限外面跑而骨頭卡
            // 在上限，那一節看起來就是「撞到牆黏住」（實測甩動時第二節之後固定
            // 在 0.4005 一動也不動）。
            //
            // 但完全拉回來會把擺幅砍掉一半（實測甩動的偏轉從 0.15 掉到 0.0875），
            // 布料變鈍。這裡每幀只修正四分之一：偏出去的那一節會被持續往回帶，
            // 不會永久卡在上限，擺幅也還在。
            //
            // 兩個位置一起平移是 Verlet 的位置修正手法 —— 位置往合法範圍靠，
            // 速度（兩者的差）不受影響。
            this.tmpClampedTail
              .copy(this.tmpLocalDir)
              .applyQuaternion(this.tmpParentRot)
              .multiplyScalar(joint.boneLength)
              .add(this.tmpWorldPos);
            this.tmpSegment.copy(this.tmpClampedTail).sub(this.tmpNextTail).multiplyScalar(0.25);
            this.tmpNextTail.add(this.tmpSegment);
            joint.currentTail.add(this.tmpSegment);
          }
        }

        if (hadCollision) {
          // 碰撞後消除由碰撞推開產生的虛假爆炸速度，徹底終結反覆彈跳與亂飛
          joint.prevTail.copy(this.tmpNextTail);
        } else {
          joint.prevTail.copy(joint.currentTail);
        }
        joint.currentTail.copy(this.tmpNextTail);

        this.tmpDelta.setFromUnitVectors(this.tmpRestLocalDir, this.tmpLocalDir);
        bone.quaternion.copy(this.tmpDelta).multiply(joint.initialLocalRotation);
        joint.stepRotation.copy(bone.quaternion);

        // 旋轉改完要立刻把世界矩陣更新掉：下一節骨頭是直接讀父骨的 matrixWorld
        // 來定位自己的，少了這一步，牠讀到的是父骨**上一步**的姿勢。
        // 這個一步延遲會沿著鏈一路累加，讓整條鏈在「追上」與「落後」之間交替，
        // 也就是實機量到的每幀反向（速度自相關 lag1 = -0.78）。
        bone.updateWorldMatrix(false, false);
      }
    }
  }

  /**
   * 把畫面姿勢設成最近兩個物理步之間的插值。每一幀繪製前呼叫一次。
   *
   * 為什麼需要：物理走固定步長（1/60），畫面更新率不見得整除它——累加器有時
   * 湊不滿一步、有時湊滿兩步，直接把物理姿勢畫出來就會變成「這幀不動、下幀走
   * 雙倍」。實機量到髮尾速度自相關 lag1 = -0.78（每幀反向的指紋）、方向反轉率
   * 38%，就是這個。改成在兩步之間插值，畫面上的運動與畫面更新率同步，物理則
   * 保持自己穩定的固定步長。
   *
   * @param alpha 距離下一個物理步的比例（0~1），即累加器餘量 / 步長。
   */
  public applyInterpolated(alpha: number): void {
    const t = Math.min(Math.max(alpha, 0), 1);
    for (const chain of this.chains) {
      for (const joint of chain.joints) {
        joint.bone.quaternion.slerpQuaternions(
          joint.previousStepRotation,
          joint.stepRotation,
          t
        );
      }
    }
  }

  /** 把所有關節拉回綁定姿勢（例如模型重新出場時，避免沿用舊的擺動狀態）。 */
  public reset(): void {
    for (const chain of this.chains) {
      for (const joint of chain.joints) {
        joint.bone.quaternion.copy(joint.initialLocalRotation);
        joint.stepRotation.copy(joint.initialLocalRotation);
        joint.previousStepRotation.copy(joint.initialLocalRotation);
        joint.bone.updateWorldMatrix(true, false);
        const tail = joint.boneAxis
          .clone()
          .multiplyScalar(joint.boneLength)
          .applyMatrix4(joint.bone.matrixWorld);
        joint.currentTail.copy(tail);
        joint.prevTail.copy(tail);
      }
    }
  }
}
