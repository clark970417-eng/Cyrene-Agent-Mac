/**
 * PMX 原生剛體＋關節物理（Bullet / ammo.js）。
 *
 * 為什麼需要這個：昔漣那顆模型（`星穹铁道—大昔涟 物理优化.pmx`）帶了
 * **447 個剛體與 639 個關節**，其中 548 個關節有角度限位、224 個有位移限位。
 * 先前的彈簧骨只吃得下其中 39 個「骨骼追隨」剛體當碰撞體，其餘 408 個動力學
 * 剛體與全部 639 個關節都被丟掉，再從骨骼端用單向彈簧鏈重新近似一遍。
 *
 * 彈簧鏈表達不了三件事，而這三件正是穿模的來源：
 *   1. **角度上下限** —— 裙片不能往內折超過某個角度
 *   2. **位移限制** —— 布料可以滑動但不能被拉開
 *   3. **鏈與鏈互相碰撞** —— 八層裙片彼此不穿插
 *
 * 這一版改成直接把 PMX 的剛體與關節餵進 Bullet，作者綁好的限位就直接生效。
 *
 * 實作是 three.js r168 `examples/jsm/animation/MMDPhysics.js` 的移植
 * （three.js 在 r169 把整套 MMD 支援移除了，所以只能自己帶一份）。
 * 幾個看起來像魔術數字的常數都照抄，它們是原始碼裡踩過坑留下的：
 *   - `unitStep = 1/65`，不是 1/60。原註解：「不知道為什麼，但 1/60 很容易讓模型爆開」
 *   - 重力 `-9.8 * 10`，MMD 的單位尺度是十倍
 *   - `setParam(2, 0.475, axis)` 六軸都設，讓約束的行為更接近 MMD
 *
 * ## 座標系
 *
 * 這裡有個容易踩的坑：three.js 官方的 `MMDLoader` **完全不翻 Z**，直接用 PMX
 * 原生座標；而 `pmx-loader.ts` 為了讓模型面向 +Z 有翻（`toSceneZ = -(z - cz) * S`）。
 * 兩邊的空間差一個 Z 鏡射。
 *
 * 所以物理世界建在 **PMX 原生空間**（照抄參考實作，數值範圍也對得上 Bullet 的
 * 預設碰撞邊界 0.04 —— 換算到場景空間之後半徑只剩 0.02 左右，比邊界還小，
 * 一定會出事），只在讀寫骨骼時做轉換：
 *
 *   位置  p_scene = ((x - cx)·S, (y - minY)·S, -(z - cz)·S)
 *   旋轉  q_scene = (-x, -y, z, w)      // Z 鏡射；自反，來回同一個函式
 *
 * 旋轉那條的推導：鏡射 M = diag(1,1,-1)，繞軸 n 轉 θ 的旋轉鏡射後是繞 M·n
 * 轉 -θ（鏡射會翻手性），代進四元數就是 (x,y,z,w) → (-x,-y,z,w)。
 * `pmx-loader.ts` 轉碰撞體軸向時用的是同一條式子。
 */

import * as THREE from "three";
import type AmmoNamespace from "ammojs-typed";

type AmmoLib = typeof AmmoNamespace;

/** PMX 剛體。`position` 已由載入端換算成「相對所屬骨頭」的偏移。 */
export interface PMXRigidBodyParams {
  name: string;
  boneIndex: number;
  /** 0=骨骼追隨（kinematic）1=物理 2=物理＋骨位置對齊 */
  type: number;
  /** 0=球 1=盒 2=膠囊 */
  shapeType: number;
  width: number;
  height: number;
  depth: number;
  /** 相對骨頭的偏移，PMX 空間。 */
  position: number[];
  /** PMX 空間尤拉角（弧度）。 */
  rotation: number[];
  weight: number;
  positionDamping: number;
  rotationDamping: number;
  friction: number;
  restitution: number;
  groupIndex: number;
  groupTarget: number;
}

/** PMX 關節（6DOF 彈簧約束）。 */
export interface PMXJointParams {
  name: string;
  rigidBodyIndex1: number;
  rigidBodyIndex2: number;
  /** PMX 世界座標。 */
  position: number[];
  rotation: number[];
  translationLimitation1: number[];
  translationLimitation2: number[];
  rotationLimitation1: number[];
  rotationLimitation2: number[];
  springPosition: number[];
  springRotation: number[];
}

/** PMX 空間 ↔ 場景空間的轉換常數，由 `pmx-loader` 產出。 */
export interface PMXPhysicsSpace {
  /** PMX → 場景的等比縮放。 */
  scale: number;
  centerX: number;
  centerZ: number;
  minY: number;
}

export interface MMDPhysicsPayload {
  rigidBodies: PMXRigidBodyParams[];
  joints: PMXJointParams[];
  /** 依 PMX 骨索引排列，索引對不上的位置是 undefined。 */
  boneList: (THREE.Bone | undefined)[];
  space: PMXPhysicsSpace;
}

/** `mmd-parser` 解出來的 PMX 裡，這個模組會用到的部分。 */
export interface RawPMXPhysicsSource {
  bones: Array<{ position: number[]; parentIndex: number }>;
  rigidBodies?: any[];
  constraints?: any[];
}

/**
 * 把 `mmd-parser` 的原始輸出整理成 `MMDPhysics` 吃的格式。
 *
 * 兩個必要的轉換，都照 three.js r168 `MMDLoader` 的作法：
 *
 * 1. **剛體位置改成相對骨頭的偏移。** PMX 存的是世界座標、PMD 存的是相對偏移，
 *    參考實作把兩者統一成後者，`MMDPhysics` 也假設拿到的是偏移。不減掉骨頭
 *    位置的話，剛體會被擺到「骨頭位置 + 世界座標」這個離譜的地方。
 *
 * 2. **關節帶動的剛體型別修正。** 若 A 不是骨骼追隨、B 是「物理＋骨位置對齊」，
 *    而且 B 的骨頭正好是 A 的骨頭的子骨，就把 B 改成純物理。不改的話 B 的位置
 *    每幀被拉回骨頭，整條鏈等於被釘死，關節限位算了也白算。
 *    出處見 http://www20.atpages.jp/katwat/wp/?p=4135
 *
 * @returns 沒有剛體或沒有關節時回傳 null（呼叫端應退回彈簧骨）。
 */
export function buildMMDPhysicsPayload(
  pmx: RawPMXPhysicsSource,
  boneList: (THREE.Bone | undefined)[],
  space: PMXPhysicsSpace
): { payload: MMDPhysicsPayload; retypedBodies: number } | null {
  const rawBodies = pmx.rigidBodies ?? [];
  const rawJoints = pmx.constraints ?? [];
  if (rawBodies.length === 0 || rawJoints.length === 0) return null;

  const boneCount = pmx.bones.length;

  const rigidBodies: PMXRigidBodyParams[] = rawBodies.map((rb: any) => {
    const position = [rb.position[0], rb.position[1], rb.position[2]];
    if (rb.boneIndex >= 0 && rb.boneIndex < boneCount) {
      const bp = pmx.bones[rb.boneIndex].position;
      position[0] -= bp[0];
      position[1] -= bp[1];
      position[2] -= bp[2];
    }
    return {
      name: rb.name,
      boneIndex: rb.boneIndex,
      type: rb.type,
      shapeType: rb.shapeType,
      width: rb.width,
      height: rb.height,
      depth: rb.depth,
      position,
      rotation: [rb.rotation[0], rb.rotation[1], rb.rotation[2]],
      weight: rb.weight,
      positionDamping: rb.positionDamping,
      rotationDamping: rb.rotationDamping,
      friction: rb.friction,
      restitution: rb.restitution,
      groupIndex: rb.groupIndex,
      groupTarget: rb.groupTarget,
    };
  });

  const joints: PMXJointParams[] = rawJoints.map((c: any) => ({
    name: c.name,
    rigidBodyIndex1: c.rigidBodyIndex1,
    rigidBodyIndex2: c.rigidBodyIndex2,
    position: [c.position[0], c.position[1], c.position[2]],
    rotation: [c.rotation[0], c.rotation[1], c.rotation[2]],
    translationLimitation1: c.translationLimitation1,
    translationLimitation2: c.translationLimitation2,
    rotationLimitation1: c.rotationLimitation1,
    rotationLimitation2: c.rotationLimitation2,
    springPosition: c.springPosition,
    springRotation: c.springRotation,
  }));

  let retypedBodies = 0;
  for (const joint of joints) {
    const a = rigidBodies[joint.rigidBodyIndex1];
    const b = rigidBodies[joint.rigidBodyIndex2];
    if (!a || !b) continue;
    if (a.type === 0 || b.type !== 2) continue;
    if (a.boneIndex < 0 || b.boneIndex < 0) continue;
    if (pmx.bones[b.boneIndex]?.parentIndex !== a.boneIndex) continue;
    b.type = 1;
    retypedBodies++;
  }

  return { payload: { rigidBodies, joints, boneList, space }, retypedBodies };
}

/** 骨頭在 PMX 空間的靜止位置，依 PMX 骨索引。 */
export function collectBoneRestPositions(pmx: RawPMXPhysicsSource): THREE.Vector3[] {
  return pmx.bones.map((b) => new THREE.Vector3(b.position[0], b.position[1], b.position[2]));
}

export interface MMDPhysicsOptions {
  /**
   * Bullet 的內部固定步長。預設 1/65。
   *
   * 不要改成 1/60：參考實作的原註解明講「不知道為什麼，但 1/60 很容易讓模型
   * 爆開」。推測是與 60Hz 畫面同頻造成的相位拍頻。
   */
  unitStep?: number;
  /** 一次 `stepSimulation` 最多補幾個內部子步。預設 3。 */
  maxStepNum?: number;
  /** PMX 空間的重力。預設 -9.8 * 10（MMD 是十倍尺度）。 */
  gravity?: number;
  /**
   * 讀剛體變換時要不要用 Bullet 的插值結果。預設 **false**。
   *
   * `getMotionState().getWorldTransform()` 給的是子步之間的插值／外插值，
   * 直覺上「比較平順」，但實機的幀時間是浮動的，插值比例每幀跳動，
   * 對關節密集的布料末端就是高頻抖動。參考實作（three.js r168 MMDPhysics）
   * 用的是未插值的 `getCenterOfMassTransform()`，這裡跟它一致。
   */
  interpolateTransforms?: boolean;
  /**
   * 6DOF 約束的 stop ERP（誤差修正比例）。預設見 `DEFAULT_STOP_ERP`。
   *
   * 開成參數是為了能實測掃描：這個值直接決定長鏈末端會不會抖。
   */
  stopERP?: number;
  /**
   * 額外的角阻尼，加在 PMX 原本的 `rotationDamping` 之上（上限 0.99）。
   *
   * 0 代表完全照作者的設定。長鏈（23~24 節的髮絲與頭紗）在持續的呼吸激勵下
   * 會一直共振不收斂，補一點阻尼可以壓下來。
   */
  extraAngularDamping?: number;
}

const DEFAULT_UNIT_STEP = 1 / 65;
const DEFAULT_MAX_STEP_NUM = 3;
const DEFAULT_GRAVITY = -9.8 * 10;

/** 單幀 delta 上限。分頁切回來的第一幀可能是好幾秒，直接餵給 Bullet 會炸。 */
const MAX_DELTA = 1 / 20;

/**
 * 判定「發散」的距離門檻（PMX 單位）。
 *
 * 模型高度約 20 PMX 單位，所有剛體都該待在身體附近。跑到 500 以外只可能是
 * 約束解崩了 —— 那時畫面上會看到布料像爆炸一樣射出去。
 */
const DIVERGENCE_LIMIT = 500;

/** 每幀抽查幾顆剛體。全查 447 顆太浪費，輪流抽查一樣抓得到。 */
const HEALTH_SAMPLE_SIZE = 12;

/**
 * 物理輸出的微抖過濾。
 *
 * 使用者回報「袖套、頭飾、髮尾有輕微抖動，像是有風在吹」。實測靜止時
 * `後紗`／`长头纱`／`erhuan2` 這幾條長鏈每幀平均位移 0.4~0.76 mm、峰值 2.5 mm，
 * 而骨架本身只有 0.01~0.14 mm —— 也就是**呼吸的微動被 20 幾節的長鏈放大**了。
 *
 * 查過但不是元凶（別再重查）：
 * - **substep 節奏**：unitStep 從 1/65 改成 1/120、1/240 反而更抖
 *   （0.47 → 1.01 → 0.98 mm），小步只是讓鏈子更自由地振。
 * - **阻尼**：模型本身已經是 0.9，再加 0.15/0.35/0.6 沒有趨勢。
 *
 * 所以濾在輸出端：**變化越小、平滑越重**。
 *
 * 門檻是照實測的分佈挑的。靜止時每幀的局部旋轉變化（度）：
 *   `erhuan2` 2.46（最大 7.29）、`erhuan1` 1.48、髮尾與 `右上袖` 0.36~0.48。
 * 這些全部落在 `JITTER_MAX`（12.6°／幀）以下，會吃到明顯的平滑；
 * 而甩頭、揮手時髮尾單幀轉十幾度，會直接放行、沒有延遲。
 *
 * `JITTER_FLOOR_ALPHA` 0.28 是「就算變化極小也還是跟 28%」—— 這是一階低通，
 * 大約三幀走到 63%、六幀 88%，慢速漂移一定會到位，不會有布料卡住的問題。
 */
const JITTER_MIN = 0.002;
const JITTER_MAX = 0.22;
const JITTER_FLOOR_ALPHA = 0.28;

/** 依這一幀的變化量算出要跟多少（0=完全不跟，1=完全跟上）。 */
function jitterAlpha(delta: number): number {
  if (delta >= JITTER_MAX) return 1;
  const t = Math.max(0, (delta - JITTER_MIN) / (JITTER_MAX - JITTER_MIN));
  return JITTER_FLOOR_ALPHA + (1 - JITTER_FLOOR_ALPHA) * t;
}

const COLLISION_FLAG_KINEMATIC = 2;
const ACTIVATION_STATE_DISABLE_DEACTIVATION = 4;
/** `btConstraintParams::BT_CONSTRAINT_STOP_ERP` */
const BT_CONSTRAINT_STOP_ERP = 2;
/**
 * 6DOF 約束的 stop ERP（誤差修正比例）。
 *
 * **刻意不照參考實作。** three.js r168 的 MMDPhysics 寫死 0.475 並註明
 * 「行為會更像 MMD」，這裡改用 Bullet 自己的預設 0.2。
 *
 * 原因是實測：0.475 等於每一步就把違反的約束修掉將近一半。對短鏈沒問題，
 * 對這顆模型的長鏈（`zhhair` 23 節、`长头纱` 24 節）就是過度修正 ——
 * 修過頭、下一步再往回修，末端在那邊高頻來回。使用者的回報是
 * 「袖套跟頭髮尾有震動」。
 *
 * 量法是錄一段真實的驅動骨運動（`updateMotions` 的呼吸與待機噪聲），
 * 再對每個設定重播同一段，量末端速度的**方向反轉率**（平順擺動 0~3%）：
 *
 *   骨頭              ERP 0.475   ERP 0.20   ERP 0.10
 *   zhhair3-1（髮尾）    38%         8~11%      19%
 *   发饰长穗3            13%          2~4%       1%
 *   右长头纱2-9           4%          1~2%       1%
 *   右上袖3錘             8%          8%        19%
 *
 * 0.475 那個 38% 正好就是先前彈簧骨時代記錄下來的「壞掉」數值。
 * 再往下調到 0.10 反而讓袖子與髮尾變差（約束太鬆，改成低頻晃動）。
 *
 * 另外試過在這之上補角阻尼（+0.02 / +0.05），沒有可辨識的改善，所以不加。
 *
 * **沒有自動化測試守著這個值。** 試過用合成的正弦激勵在 node 裡重現，數字
 * 亂跳、方向甚至相反 —— 差異只在真實的 `updateMotions`（含帶隨機的重心轉移、
 * 眨眼計時）驅動下才穩定浮現，那寫成測試只會是不穩定的測試。要重新量的話：
 * 在 dev 的頁面裡先錄一段真實驅動（每幀存下所有非物理骨的 local transform
 * 與 root），再對每個設定 `physics.reset()` 後重播同一段，量末端的方向反轉率。
 */
const DEFAULT_STOP_ERP = 0.2;

let ammoPromise: Promise<AmmoLib> | null = null;

/**
 * 載入 ammo.js。
 *
 * 這包是 1.8MB 的 asm.js，只在真的要用 3D 通話時才載，不進主 bundle。
 * 重複呼叫共用同一個 Promise。
 *
 * ## 為什麼瀏覽器端要用 script 標籤而不是 `import`
 *
 * ammo.js 是 emscripten 產的 UMD，開頭大致是
 * `(function(root){ root.Ammo = ... })(this)`。ESM 模組是嚴格模式，頂層的
 * `this` 是 `undefined`，於是它會炸在 `Cannot set properties of undefined
 * (setting 'Ammo')`。Vite 的 CJS interop 也救不了，因為問題出在 `this` 的值
 * 而不是匯出格式。
 *
 * 用 `<script>` 載進來就是傳統腳本，`this === window`，工廠函式會正常掛到
 * `window.Ammo`。`@yohawing/three-mmd-loader` 載它自己的 Bullet WASM 時
 * 也是這個作法。
 *
 * Node（vitest）沒有 document，那邊走一般的動態 import 就好 ——
 * CommonJS 在 Node 下 `this` 是 `module.exports`，不會有這個問題。
 */
export function loadAmmo(): Promise<AmmoLib> {
  if (!ammoPromise) ammoPromise = initAmmo();
  return ammoPromise;
}

async function initAmmo(): Promise<AmmoLib> {
  if (typeof document === "undefined") {
    const mod = await import("ammojs-typed");
    const factory = (mod.default ?? mod) as unknown as () => Promise<AmmoLib>;
    return factory();
  }

  const existing = (globalThis as { Ammo?: () => Promise<AmmoLib> }).Ammo;
  if (typeof existing === "function") return existing();

  // `?url` 讓 Vite 把它當靜態資產：開發時直接餵原檔、打包時複製過去，
  // 兩邊都不會去轉譯它的模組格式。
  const { default: url } = await import("ammojs-typed/ammo/ammo.js?url");

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`ammo.js 載入失敗：${url}`));
    document.head.appendChild(script);
  });

  const factory = (globalThis as { Ammo?: () => Promise<AmmoLib> }).Ammo;
  if (typeof factory !== "function") {
    throw new Error("ammo.js 已載入，但 globalThis.Ammo 不是函式");
  }
  return factory();
}

/**
 * Z 鏡射四元數。場景空間 ↔ PMX 空間共用同一個函式（自反）。
 */
function mirrorZ(q: THREE.Quaternion): THREE.Quaternion {
  return q.set(-q.x, -q.y, q.z, q.w);
}

class PhysicsBody {
  public readonly body: AmmoNamespace.btRigidBody;
  public readonly bone: THREE.Bone | undefined;

  /** 剛體相對骨頭的偏移（PMX 空間）。 */
  private readonly offsetPos: THREE.Vector3;
  private readonly offsetQuat: THREE.Quaternion;
  private readonly offsetPosInv: THREE.Vector3;
  private readonly offsetQuatInv: THREE.Quaternion;
  /** 見 MMDPhysicsOptions.interpolateTransforms。 */
  public interpolate = false;

  constructor(
    private readonly ammo: AmmoLib,
    world: AmmoNamespace.btDiscreteDynamicsWorld,
    public readonly params: PMXRigidBodyParams,
    bone: THREE.Bone | undefined,
    /** 骨頭在 PMX 空間的靜止位置。 */
    boneRestPosition: THREE.Vector3,
    private readonly scratch: Scratch
  ) {
    this.bone = bone;

    this.offsetPos = new THREE.Vector3(
      params.position[0],
      params.position[1],
      params.position[2]
    );
    this.offsetQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(params.rotation[0], params.rotation[1], params.rotation[2], "YXZ")
    );
    this.offsetQuatInv = this.offsetQuat.clone().invert();
    this.offsetPosInv = this.offsetPos.clone().negate().applyQuaternion(this.offsetQuatInv);

    const shape = this.createShape();
    // type 0 是骨骼追隨：質量 0，Bullet 才會把它當 kinematic 而不是自由落體。
    const mass = params.type === 0 ? 0 : params.weight;

    const inertia = new ammo.btVector3(0, 0, 0);
    if (mass !== 0) shape.calculateLocalInertia(mass, inertia);

    // 初始位置＝骨頭靜止位置 ∘ 剛體偏移。
    const startPos = boneRestPosition.clone().add(this.offsetPos);
    const form = scratch.transform;
    form.setIdentity();
    scratch.vec.setValue(startPos.x, startPos.y, startPos.z);
    form.setOrigin(scratch.vec);
    scratch.quat.setValue(
      this.offsetQuat.x,
      this.offsetQuat.y,
      this.offsetQuat.z,
      this.offsetQuat.w
    );
    form.setRotation(scratch.quat);

    const motionState = new ammo.btDefaultMotionState(form);
    const info = new ammo.btRigidBodyConstructionInfo(mass, motionState, shape, inertia);
    info.set_m_friction(params.friction);
    info.set_m_restitution(params.restitution);

    const body = new ammo.btRigidBody(info);

    if (params.type === 0) {
      body.setCollisionFlags(body.getCollisionFlags() | COLLISION_FLAG_KINEMATIC);
      body.setActivationState(ACTIVATION_STATE_DISABLE_DEACTIVATION);
    }

    body.setDamping(params.positionDamping, params.rotationDamping);
    // 永不休眠。布料靜止一會兒就被 Bullet 睡掉的話，下次身體一動它不會醒。
    body.setSleepingThresholds(0, 0);

    // PMX 的 groupIndex 是「我屬於哪一群」（0~15），groupTarget 是
    // 「我會跟哪些群碰撞」的位元遮罩。Bullet 的 addRigidBody 剛好就吃這兩個。
    world.addRigidBody(body, 1 << params.groupIndex, params.groupTarget);

    this.body = body;

    ammo.destroy(inertia);
    ammo.destroy(info);
  }

  private createShape(): AmmoNamespace.btCollisionShape {
    const { shapeType, width, height, depth } = this.params;
    switch (shapeType) {
      case 0:
        return new this.ammo.btSphereShape(width);
      case 1: {
        const half = new this.ammo.btVector3(width, height, depth);
        const box = new this.ammo.btBoxShape(half);
        this.ammo.destroy(half);
        return box;
      }
      case 2:
        return new this.ammo.btCapsuleShape(width, height);
      default:
        // 未知形狀退化成球，至少不會整個載入失敗。
        return new this.ammo.btSphereShape(Math.max(width, 0.01));
    }
  }

  /** 骨 → 剛體。只有 type 0（骨骼追隨）需要。 */
  public updateFromBone(space: PMXPhysicsSpace): void {
    if (!this.bone || this.params.type !== 0) return;
    this.writeTransformFromBone(space);
  }

  /** 剛體 → 骨。type 0 不做（它是被骨頭驅動的那一邊）。 */
  public updateBone(space: PMXPhysicsSpace): void {
    if (!this.bone || this.params.type === 0) return;

    const { pos, quat } = this.readWorldTransformForBone(space);

    // 旋轉：照參考實作用「世界差量」的寫法。
    // 新的本地旋轉 = (目前世界旋轉⁻¹ · 目標世界旋轉) · 目前本地旋轉。
    const s = this.scratch;
    s.qA.setFromRotationMatrix(this.bone.matrixWorld).conjugate().multiply(quat);
    s.qB.setFromRotationMatrix(this.bone.matrix);
    // 連續相乘會累積浮點誤差，久了會溢位（three.js #15335），每次都正規化。
    s.qA.multiply(s.qB).normalize();

    // 微抖過濾：變化很小的時候只跟一點點（見 jitterAlpha）。
    const rotDelta = this.bone.quaternion.angleTo(s.qA);
    this.bone.quaternion.slerp(s.qA, jitterAlpha(rotDelta));

    if (this.params.type === 1) {
      // type 1：位置也由物理決定。
      s.vA.copy(pos);
      if (this.bone.parent) this.bone.parent.worldToLocal(s.vA);
      // 位置用同一條曲線，門檻換算成長度（PMX 單位，大約 1 單位 = 8 公分）。
      const posDelta = this.bone.position.distanceTo(s.vA);
      this.bone.position.lerp(s.vA, jitterAlpha(posDelta));
    }

    this.bone.updateMatrixWorld(true);

    if (this.params.type === 2) {
      // type 2：旋轉聽物理、位置對齊骨頭。要在骨頭矩陣更新之後把剛體拉回來。
      this.writePositionFromBone(space);
    }
  }

  /** 重設到目前骨骼姿勢，用於載入完成與暫停恢復。 */
  public reset(space: PMXPhysicsSpace): void {
    if (!this.bone) return;
    this.writeTransformFromBone(space);
    const zero = this.scratch.vec;
    zero.setValue(0, 0, 0);
    this.body.setLinearVelocity(zero);
    this.body.setAngularVelocity(zero);
  }

  /** 把骨頭目前的世界變換（場景空間）換算成 PMX 空間並寫進剛體。 */
  private writeTransformFromBone(space: PMXPhysicsSpace): void {
    const s = this.scratch;
    this.bone!.matrixWorld.decompose(s.vA, s.qA, s.vB);

    sceneToPmxPosition(s.vA, space);
    mirrorZ(s.qA);

    // 剛體世界變換 = 骨頭世界變換 ∘ 剛體偏移。
    s.vB.copy(this.offsetPos).applyQuaternion(s.qA).add(s.vA);
    s.qB.copy(s.qA).multiply(this.offsetQuat);

    const form = s.transform;
    form.setIdentity();
    s.vec.setValue(s.vB.x, s.vB.y, s.vB.z);
    form.setOrigin(s.vec);
    s.quat.setValue(s.qB.x, s.qB.y, s.qB.z, s.qB.w);
    form.setRotation(s.quat);

    this.body.setCenterOfMassTransform(form);
    this.body.getMotionState().setWorldTransform(form);
  }

  /** 只把位置對齊骨頭，旋轉留給物理（type 2）。 */
  private writePositionFromBone(space: PMXPhysicsSpace): void {
    const s = this.scratch;
    this.bone!.matrixWorld.decompose(s.vA, s.qA, s.vB);
    sceneToPmxPosition(s.vA, space);
    mirrorZ(s.qA);
    s.vB.copy(this.offsetPos).applyQuaternion(s.qA).add(s.vA);

    const form = s.transform;
    this.body.getMotionState().getWorldTransform(form);
    s.vec.setValue(s.vB.x, s.vB.y, s.vB.z);
    form.setOrigin(s.vec);

    this.body.setCenterOfMassTransform(form);
    this.body.getMotionState().setWorldTransform(form);
  }

  /**
   * 讀剛體目前的世界變換，扣掉剛體偏移，換算回場景空間。
   *
   * 預設讀 `getCenterOfMassTransform()`（未插值），跟 three.js r168 的參考
   * 實作一致。曾經改讀 motion state 想換取「更平順」，實際相反：實機幀時間
   * 是浮動的，Bullet 的插值比例每幀跳動，關節密集的布料末端（袖套、髮尾）
   * 就會看到高頻抖動。
   */
  private readWorldTransformForBone(space: PMXPhysicsSpace): {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
  } {
    const s = this.scratch;
    const form = s.transform;
    if (this.interpolate) {
      this.body.getMotionState().getWorldTransform(form);
    } else {
      // 這個回傳的是 Bullet 內部的暫存物件，讀完立刻用掉，不留參考。
      const com = this.body.getCenterOfMassTransform();
      form.setOrigin(com.getOrigin());
      form.setRotation(com.getRotation());
    }

    const o = form.getOrigin();
    const r = form.getRotation();
    s.vC.set(o.x(), o.y(), o.z());
    s.qC.set(r.x(), r.y(), r.z(), r.w());

    // 扣掉剛體相對骨頭的偏移，得到骨頭本身的世界變換。
    s.vC.add(s.vD.copy(this.offsetPosInv).applyQuaternion(s.qC));
    s.qC.multiply(this.offsetQuatInv);

    pmxToScenePosition(s.vC, space);
    mirrorZ(s.qC);

    return { pos: s.vC, quat: s.qC };
  }
}

/** 每幀重複使用的暫存物件，避免在熱路徑上配置。 */
interface Scratch {
  vec: AmmoNamespace.btVector3;
  quat: AmmoNamespace.btQuaternion;
  transform: AmmoNamespace.btTransform;
  vA: THREE.Vector3;
  vB: THREE.Vector3;
  vC: THREE.Vector3;
  vD: THREE.Vector3;
  qA: THREE.Quaternion;
  qB: THREE.Quaternion;
  qC: THREE.Quaternion;
}

/** 場景空間 → PMX 空間，就地改寫。 */
export function sceneToPmxPosition(v: THREE.Vector3, space: PMXPhysicsSpace): THREE.Vector3 {
  return v.set(
    v.x / space.scale + space.centerX,
    v.y / space.scale + space.minY,
    -v.z / space.scale + space.centerZ
  );
}

/** PMX 空間 → 場景空間，就地改寫。 */
export function pmxToScenePosition(v: THREE.Vector3, space: PMXPhysicsSpace): THREE.Vector3 {
  return v.set(
    (v.x - space.centerX) * space.scale,
    (v.y - space.minY) * space.scale,
    -(v.z - space.centerZ) * space.scale
  );
}

export class MMDPhysics {
  private readonly world: AmmoNamespace.btDiscreteDynamicsWorld;
  private readonly bodies: PhysicsBody[] = [];
  private readonly constraints: AmmoNamespace.btGeneric6DofSpringConstraint[] = [];
  private readonly scratch: Scratch;
  private readonly space: PMXPhysicsSpace;
  private readonly unitStep: number;
  private readonly maxStepNum: number;
  private readonly stopERP: number;
  private readonly extraAngularDamping: number;
  private disposed = false;
  /** 健康檢查的輪詢游標。 */
  private healthCursor = 0;
  /** 偵測到發散並自動重置的次數，方便在 console 看出有沒有在反覆發生。 */
  private recoveries = 0;

  constructor(
    private readonly ammo: AmmoLib,
    payload: MMDPhysicsPayload,
    /** 骨頭在 PMX 空間的靜止位置，依 PMX 骨索引。 */
    boneRestPositions: THREE.Vector3[],
    options: MMDPhysicsOptions = {}
  ) {
    this.space = payload.space;
    this.unitStep = options.unitStep ?? DEFAULT_UNIT_STEP;
    this.maxStepNum = options.maxStepNum ?? DEFAULT_MAX_STEP_NUM;
    this.stopERP = options.stopERP ?? DEFAULT_STOP_ERP;
    this.extraAngularDamping = options.extraAngularDamping ?? 0;

    this.scratch = {
      vec: new ammo.btVector3(0, 0, 0),
      quat: new ammo.btQuaternion(0, 0, 0, 1),
      transform: new ammo.btTransform(),
      vA: new THREE.Vector3(),
      vB: new THREE.Vector3(),
      vC: new THREE.Vector3(),
      vD: new THREE.Vector3(),
      qA: new THREE.Quaternion(),
      qB: new THREE.Quaternion(),
      qC: new THREE.Quaternion(),
    };

    const config = new ammo.btDefaultCollisionConfiguration();
    const dispatcher = new ammo.btCollisionDispatcher(config);
    const broadphase = new ammo.btDbvtBroadphase();
    const solver = new ammo.btSequentialImpulseConstraintSolver();
    this.world = new ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, config);

    const gravity = options.gravity ?? DEFAULT_GRAVITY;
    const g = new ammo.btVector3(0, gravity, 0);
    this.world.setGravity(g);
    ammo.destroy(g);

    for (const params of payload.rigidBodies) {
      const bone = params.boneIndex >= 0 ? payload.boneList[params.boneIndex] : undefined;
      const rest = boneRestPositions[params.boneIndex] ?? new THREE.Vector3();
      const physicsBody = new PhysicsBody(ammo, this.world, params, bone, rest, this.scratch);
      physicsBody.interpolate = options.interpolateTransforms ?? false;
      if (this.extraAngularDamping > 0 && params.type !== 0) {
        physicsBody.body.setDamping(
          params.positionDamping,
          Math.min(0.99, params.rotationDamping + this.extraAngularDamping)
        );
      }
      this.bodies.push(physicsBody);
    }

    for (const joint of payload.joints) {
      const constraint = this.createConstraint(joint);
      if (constraint) this.constraints.push(constraint);
    }
  }

  private createConstraint(
    joint: PMXJointParams
  ): AmmoNamespace.btGeneric6DofSpringConstraint | null {
    const a = this.bodies[joint.rigidBodyIndex1];
    const b = this.bodies[joint.rigidBodyIndex2];
    if (!a || !b) return null;

    const ammo = this.ammo;
    const s = this.scratch;

    // 關節的世界座標（PMX 空間）。
    const jointPos = new THREE.Vector3(
      joint.position[0],
      joint.position[1],
      joint.position[2]
    );
    const jointQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(joint.rotation[0], joint.rotation[1], joint.rotation[2], "YXZ")
    );

    // 換算成兩個剛體各自的本地座標。
    const frameA = this.worldToBodyLocal(a, jointPos, jointQuat);
    const frameB = this.worldToBodyLocal(b, jointPos, jointQuat);

    const constraint = new ammo.btGeneric6DofSpringConstraint(
      a.body,
      b.body,
      frameA,
      frameB,
      true
    );

    const setLimit = (
      apply: (v: AmmoNamespace.btVector3) => void,
      values: number[]
    ): void => {
      s.vec.setValue(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
      apply(s.vec);
    };

    setLimit((v) => constraint.setLinearLowerLimit(v), joint.translationLimitation1);
    setLimit((v) => constraint.setLinearUpperLimit(v), joint.translationLimitation2);
    setLimit((v) => constraint.setAngularLowerLimit(v), joint.rotationLimitation1);
    setLimit((v) => constraint.setAngularUpperLimit(v), joint.rotationLimitation2);

    // 位移彈簧走 0~2 軸、旋轉彈簧走 3~5 軸。剛度 0 代表作者沒開這一軸。
    for (let i = 0; i < 3; i++) {
      const k = joint.springPosition?.[i] ?? 0;
      if (k !== 0) {
        constraint.enableSpring(i, true);
        constraint.setStiffness(i, k);
      }
    }
    for (let i = 0; i < 3; i++) {
      const k = joint.springRotation?.[i] ?? 0;
      if (k !== 0) {
        constraint.enableSpring(i + 3, true);
        constraint.setStiffness(i + 3, k);
      }
    }

    // 參考實作：六軸都設這個 ERP，行為會更接近 MMD。
    // 官方 ammo.js 的 idl 曾經沒有匯出 setParam，這包（ammojs-typed 1.0.6）有。
    if (typeof constraint.setParam === "function") {
      for (let i = 0; i < 6; i++) {
        constraint.setParam(BT_CONSTRAINT_STOP_ERP, this.stopERP, i);
      }
    }

    this.world.addConstraint(constraint, true);

    ammo.destroy(frameA);
    ammo.destroy(frameB);

    return constraint;
  }

  /** 把關節的世界座標換算成某個剛體的本地座標系。 */
  private worldToBodyLocal(
    body: PhysicsBody,
    worldPos: THREE.Vector3,
    worldQuat: THREE.Quaternion
  ): AmmoNamespace.btTransform {
    const s = this.scratch;
    const form = s.transform;
    body.body.getMotionState().getWorldTransform(form);

    const o = form.getOrigin();
    const r = form.getRotation();
    const bodyPos = s.vA.set(o.x(), o.y(), o.z());
    const bodyQuat = s.qA.set(r.x(), r.y(), r.z(), r.w());

    const invQuat = s.qB.copy(bodyQuat).invert();
    const localPos = s.vB.copy(worldPos).sub(bodyPos).applyQuaternion(invQuat);
    const localQuat = s.qC.copy(invQuat).multiply(worldQuat);

    const out = new this.ammo.btTransform();
    out.setIdentity();
    s.vec.setValue(localPos.x, localPos.y, localPos.z);
    out.setOrigin(s.vec);
    s.quat.setValue(localQuat.x, localQuat.y, localQuat.z, localQuat.w);
    out.setRotation(s.quat);
    return out;
  }

  public get bodyCount(): number {
    return this.bodies.length;
  }

  /**
   * 底層的 Bullet 世界。
   *
   * 給 `InteractiveWorld` 用：地板與道具要跟角色在**同一個**世界裡，
   * 分開兩個世界的話她的身體推不動任何東西。
   */
  public get bulletWorld(): AmmoNamespace.btDiscreteDynamicsWorld {
    return this.world;
  }

  /**
   * 「骨骼追隨」剛體（PMX type 0）—— 也就是角色的身體形狀。
   *
   * `InteractiveWorld` 需要它們來補碰撞遮罩，讓道具碰得到人。
   */
  public get kinematicBodies(): AmmoNamespace.btRigidBody[] {
    return this.bodies.filter((b) => b.params.type === 0).map((b) => b.body);
  }

  public get constraintCount(): number {
    return this.constraints.length;
  }

  /**
   * 推進一幀。
   *
   * 這裡**不需要**外層的固定步長排程器：`stepSimulation` 本身就是一個固定
   * 步長累加器（第二、三個參數），而且會在子步之間做插值。再套一層外部
   * 累加器只會讓兩個累加器互相打拍子。
   */
  public update(deltaSeconds: number): void {
    if (this.disposed) return;
    const delta = Math.min(Math.max(deltaSeconds, 0), MAX_DELTA);
    if (delta <= 0) return;

    for (const body of this.bodies) body.updateFromBone(this.space);
    this.world.stepSimulation(delta, this.maxStepNum, this.unitStep);
    for (const body of this.bodies) body.updateBone(this.space);

    if (this.hasDiverged()) {
      this.recoveries++;
      console.warn(
        `[MMDPhysics] 偵測到約束解發散，已重置（第 ${this.recoveries} 次）。` +
          "若頻繁發生，代表 unitStep 或關節參數需要調整。"
      );
      this.reset();
    }
  }

  /**
   * 抽查剛體有沒有跑掉。
   *
   * Bullet 的接觸處理順序會受記憶體位址影響，同一份輸入在不同執行環境下
   * 未必走完全相同的路徑；模型的關節又多（639 個），偶發的數值發散不是
   * 不可能。真的發生時整片布料會像爆炸一樣射出去，非常明顯 ——
   * 與其讓使用者看到那個畫面，不如自己抓到並復位。
   *
   * 只抽查不全查：447 顆全掃每幀太貴，而發散從來不是單一剛體的事，
   * 輪流抽 12 顆幾幀之內一定抓得到。
   */
  private hasDiverged(): boolean {
    const total = this.bodies.length;
    if (total === 0) return false;

    const form = this.scratch.transform;
    for (let i = 0; i < HEALTH_SAMPLE_SIZE; i++) {
      const body = this.bodies[this.healthCursor];
      this.healthCursor = (this.healthCursor + 1) % total;
      if (body.params.type === 0) continue; // 骨骼驅動的不會自己跑掉

      body.body.getMotionState().getWorldTransform(form);
      const o = form.getOrigin();
      const x = o.x();
      const y = o.y();
      const z = o.z();
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return true;
      if (
        Math.abs(x) > DIVERGENCE_LIMIT ||
        Math.abs(y) > DIVERGENCE_LIMIT ||
        Math.abs(z) > DIVERGENCE_LIMIT
      ) {
        return true;
      }
    }
    return false;
  }

  /** 偵測到發散並自動復位的次數。 */
  public get recoveryCount(): number {
    return this.recoveries;
  }

  /** 把所有剛體拉回目前骨骼姿勢並清掉速度。 */
  public reset(): void {
    if (this.disposed) return;
    for (const body of this.bodies) body.reset(this.space);
  }

  /**
   * 空跑幾步讓布料落定。
   *
   * 不做的話載入後第一秒裙襬會從綁定姿勢「掉」下來，很明顯。
   *
   * 分段讓出主執行緒：實測 447 剛體 / 639 關節跑滿 60 步要 415ms，一次做完
   * 會讓畫面凍住將近半秒。剛開始的幾步特別貴（所有關節都還在違反狀態，
   * solver 迭代最多），所以每 `chunk` 步就 yield 一次。
   */
  public async warmup(steps = 60, chunk = 10): Promise<void> {
    for (let i = 0; i < steps; i++) {
      if (this.disposed) return;
      this.update(this.unitStep);
      if ((i + 1) % chunk === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.constraints) {
      this.world.removeConstraint(c);
      this.ammo.destroy(c);
    }
    this.constraints.length = 0;
    for (const b of this.bodies) {
      this.world.removeRigidBody(b.body);
      this.ammo.destroy(b.body);
    }
    this.bodies.length = 0;
    this.ammo.destroy(this.scratch.vec);
    this.ammo.destroy(this.scratch.quat);
    this.ammo.destroy(this.scratch.transform);
    this.ammo.destroy(this.world);
  }
}
