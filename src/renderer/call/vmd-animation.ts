/**
 * VMD（MMD 動作檔）播放。
 *
 * 為什麼需要：程序化生成的手勢做即時互動的小動作很好用，但整段表演
 * （跳舞、唱歌的身體律動）永遠打不過人手 K 出來的動作 —— 那裡面有預備、
 * 有跟隨、有 overlap，是表演設計而不是插值。MMD 圈子累積了大量現成的 VMD，
 * 能吃這個格式等於直接接上那整個生態。
 *
 * 實作是 three.js r168 `MMDLoader.js` 裡 `AnimationBuilder` 與
 * `CubicBezierInterpolation` 的移植（r169 之後 three.js 移除了整套 MMD 支援）。
 *
 * ## 三個必要的改寫
 *
 * 1. **座標鏡射。** 官方 `MMDLoader` 不翻 Z，而 `pmx-loader.ts` 有翻。
 *    所以位移要 `(x, y, -z)`、旋轉四元數要 `(-x, -y, z, w)`。
 *
 * 2. **縮放。** VMD 的位移是 PMX 單位，骨架卻已經縮到場景單位（模型高 1.5），
 *    位移要乘上 `space.scale`。旋轉不用（角度無關尺度）。
 *
 * 3. **IK 角度限制也要鏡射。** 鏡射會把 X/Y 軸的角度取負，於是上下限互換：
 *    `lower' = -upper`、`upper' = -lower`。不換的話膝蓋會朝反方向折。
 */

import * as THREE from "three";
import { CCDIKSolver, type IK } from "three/examples/jsm/animation/CCDIKSolver.js";
import type { PMXPhysicsSpace } from "./mmd-physics";

/** VMD 的時間軸固定是 30fps。 */
const VMD_FPS = 30;

/** `mmd-parser` 解出來的 VMD 骨骼關鍵格。 */
export interface VMDBoneMotion {
  boneName: string;
  frameNum: number;
  /** PMX 單位的位移，相對骨頭的靜止位置。 */
  position: number[];
  /** 四元數 (x, y, z, w)。 */
  rotation: number[];
  /** 64 位元組的貝茲控制點。 */
  interpolation: number[];
}

export interface VMDMorphMotion {
  morphName: string;
  frameNum: number;
  weight: number;
}

export interface ParsedVMD {
  metadata: { motionCount: number; morphCount: number };
  motions: VMDBoneMotion[];
  morphs: VMDMorphMotion[];
}

export interface BuildVMDClipOptions {
  /**
   * 是否把表情（morph）軌道也建進去。預設 **false**。
   *
   * 昔漣的表情是由 `updateExpressions` 每幀主動寫入的（說話嘴型、眨眼、
   * 手勢自帶表情）。把 VMD 的表情軌一起放進 mixer，兩邊會在同一批 morph
   * 上互相覆蓋，結果是表情高頻閃爍。要用 VMD 表情就得先把程序化那層關掉。
   */
  includeMorphs?: boolean;
  /** 動畫名稱，方便在 mixer 裡辨識。 */
  name?: string;
}

/**
 * MMD 的貝茲插值。
 *
 * three.js 內建的插值器只有線性與 Catmull-Rom；MMD 每個關鍵格自帶四個貝茲
 * 控制點，不照著算的話動作的加減速完全不對 —— 原本設計成「慢起快收」的
 * 動作會變成等速，整段表演的節奏就散了。
 */
class CubicBezierInterpolation extends THREE.Interpolant {
  constructor(
    parameterPositions: THREE.TypedArray,
    sampleValues: THREE.TypedArray,
    sampleSize: number,
    resultBuffer: THREE.TypedArray,
    private readonly interpolationParams: Float32Array
  ) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
  }

  public interpolate_(i1: number, t0: number, t: number, t1: number): THREE.TypedArray {
    const result = this.resultBuffer;
    const values = this.sampleValues;
    const stride = this.valueSize;
    const params = this.interpolationParams;

    const offset1 = i1 * stride;
    const offset0 = offset1 - stride;

    // 下一格就在 30fps 的一格之內時不插值，直接跳 —— 這是 MMD 動畫規格。
    // 乘 1.5 是精度餘裕：three.js 的時間軸是 Float32。
    const weight1 = t1 - t0 < (1 / VMD_FPS) * 1.5 ? 0.0 : (t - t0) / (t1 - t0);

    if (stride === 4) {
      // 四元數
      const ratio = this.solve(
        params[i1 * 4 + 0],
        params[i1 * 4 + 1],
        params[i1 * 4 + 2],
        params[i1 * 4 + 3],
        weight1
      );
      THREE.Quaternion.slerpFlat(
        result as unknown as number[],
        0,
        values as unknown as number[],
        offset0,
        values as unknown as number[],
        offset1,
        ratio
      );
    } else if (stride === 3) {
      // 位移：三個軸各有自己的貝茲曲線
      for (let i = 0; i < stride; i++) {
        const ratio = this.solve(
          params[i1 * 12 + i * 4 + 0],
          params[i1 * 12 + i * 4 + 1],
          params[i1 * 12 + i * 4 + 2],
          params[i1 * 12 + i * 4 + 3],
          weight1
        );
        result[i] = values[offset0 + i] * (1 - ratio) + values[offset1 + i] * ratio;
      }
    } else {
      const ratio = this.solve(
        params[i1 * 4 + 0],
        params[i1 * 4 + 1],
        params[i1 * 4 + 2],
        params[i1 * 4 + 3],
        weight1
      );
      result[0] = values[offset0] * (1 - ratio) + values[offset1] * ratio;
    }

    return result;
  }

  /**
   * 給定 x 求貝茲曲線的 y。
   *
   * 三次貝茲的 x(t) 沒有解析反函式，用二分法逼近 t 再代回 y。
   * 15 次迭代對 30fps 的動畫綽綽有餘（誤差 < 2⁻¹⁵）。
   */
  private solve(x1: number, x2: number, y1: number, y2: number, x: number): number {
    let c = 0.5;
    let t = c;
    let s = 1.0 - t;
    let sst3 = 0;
    let stt3 = 0;
    let ttt = 0;

    for (let i = 0; i < 15; i++) {
      sst3 = 3.0 * s * s * t;
      stt3 = 3.0 * s * t * t;
      ttt = t * t * t;

      const ft = sst3 * x1 + stt3 * x2 + ttt - x;
      if (Math.abs(ft) < 1e-5) break;

      c /= 2.0;
      t += ft < 0 ? c : -c;
      s = 1.0 - t;
    }

    return sst3 * y1 + stt3 * y2 + ttt;
  }
}

/** 從 64 位元組的插值資料裡取出某一軸的四個控制點。 */
function pushInterpolation(out: number[], interpolation: number[], index: number): void {
  out.push((interpolation[index + 0] ?? 0) / 127); // x1
  out.push((interpolation[index + 8] ?? 0) / 127); // x2
  out.push((interpolation[index + 4] ?? 0) / 127); // y1
  out.push((interpolation[index + 12] ?? 0) / 127); // y2
}

/** three.js 的 KeyframeTrack 型別沒有把 createInterpolant 標成可覆寫。 */
type OverridableTrack = THREE.KeyframeTrack & {
  createInterpolant: (this: THREE.KeyframeTrack, result: THREE.TypedArray) => THREE.Interpolant;
};

function createTrack<T extends THREE.KeyframeTrack>(
  Track: new (name: string, times: number[], values: number[]) => T,
  name: string,
  times: number[],
  values: number[],
  interpolations: number[]
): T {
  const track = new Track(name, times, values);
  const params = new Float32Array(interpolations);
  // three.js 預設會自己挑插值器，這裡換成 MMD 的貝茲。
  (track as unknown as OverridableTrack).createInterpolant = function (result) {
    return new CubicBezierInterpolation(
      this.times,
      this.values,
      this.getValueSize(),
      result,
      params
    );
  };
  return track;
}

/**
 * 把解析好的 VMD 轉成 three.js 的 AnimationClip。
 *
 * 只會建出模型真的有的骨頭／表情的軌道；VMD 常常是為別的模型做的，
 * 對不上的名稱直接略過。
 */
export function buildVMDClip(
  vmd: ParsedVMD,
  mesh: THREE.SkinnedMesh,
  space: PMXPhysicsSpace,
  options: BuildVMDClipOptions = {}
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const scale = space.scale;

  const skeleton = mesh.skeleton;
  const knownBones = new Set(skeleton.bones.map((b) => b.name));

  const byBone = new Map<string, VMDBoneMotion[]>();
  for (const motion of vmd.motions ?? []) {
    if (!knownBones.has(motion.boneName)) continue;
    const list = byBone.get(motion.boneName);
    if (list) list.push(motion);
    else byBone.set(motion.boneName, [motion]);
  }

  for (const [boneName, frames] of byBone) {
    frames.sort((a, b) => a.frameNum - b.frameNum);

    const bone = skeleton.getBoneByName(boneName);
    if (!bone) continue;
    const base = bone.position;

    const times: number[] = [];
    const positions: number[] = [];
    const rotations: number[] = [];
    const posInterp: number[] = [];
    const rotInterp: number[] = [];

    for (const frame of frames) {
      times.push(frame.frameNum / VMD_FPS);

      // 位移：PMX 單位 → 場景單位，並鏡射 Z。基準是骨頭的靜止位置。
      const p = frame.position;
      positions.push(base.x + (p[0] ?? 0) * scale);
      positions.push(base.y + (p[1] ?? 0) * scale);
      positions.push(base.z - (p[2] ?? 0) * scale);

      // 旋轉：Z 鏡射，與 mmd-physics 的 mirrorZ 同一條式子。
      const r = frame.rotation;
      rotations.push(-(r[0] ?? 0), -(r[1] ?? 0), r[2] ?? 0, r[3] ?? 1);

      const interp = frame.interpolation ?? [];
      for (let axis = 0; axis < 3; axis++) pushInterpolation(posInterp, interp, axis);
      pushInterpolation(rotInterp, interp, 3);
    }

    const target = `.bones[${boneName}]`;
    tracks.push(
      createTrack(THREE.VectorKeyframeTrack, `${target}.position`, times, positions, posInterp)
    );
    tracks.push(
      createTrack(
        THREE.QuaternionKeyframeTrack,
        `${target}.quaternion`,
        times,
        rotations,
        rotInterp
      )
    );
  }

  if (options.includeMorphs) {
    const dictionary = mesh.morphTargetDictionary ?? {};
    const byMorph = new Map<string, VMDMorphMotion[]>();
    for (const morph of vmd.morphs ?? []) {
      if (dictionary[morph.morphName] === undefined) continue;
      const list = byMorph.get(morph.morphName);
      if (list) list.push(morph);
      else byMorph.set(morph.morphName, [morph]);
    }

    for (const [morphName, frames] of byMorph) {
      frames.sort((a, b) => a.frameNum - b.frameNum);
      tracks.push(
        new THREE.NumberKeyframeTrack(
          `.morphTargetInfluences[${dictionary[morphName]}]`,
          frames.map((f) => f.frameNum / VMD_FPS),
          frames.map((f) => f.weight)
        )
      );
    }
  }

  // 長度給 -1 讓 three.js 自己從軌道推算。
  return new THREE.AnimationClip(options.name ?? "vmd", -1, tracks);
}

/** `mmd-parser` 解出來的 PMX 骨頭裡，IK 會用到的部分。 */
export interface RawPMXIKBone {
  name: string;
  ik?: {
    effector: number;
    iteration: number;
    maxAngle: number;
    links: Array<{
      index: number;
      angleLimitation: number;
      lowerLimitationAngle?: number[];
      upperLimitationAngle?: number[];
    }>;
  };
}

/**
 * 從 PMX 的 IK 資料建出 `CCDIKSolver` 吃的設定。
 *
 * 昔漣那顆模型有 4 條：兩腳的 `足ＩＫ`（2 節，40 次迭代）與 `つま先ＩＫ`
 * （1 節，3 次迭代）。這是 MMD 的標準腿部 IK —— VMD 舞蹈動作幾乎都是靠
 * 移動 `足ＩＫ` 骨來帶腿的，沒有解算器的話腳會整條僵在原地。
 *
 * 角度限制要跟著座標鏡射一起翻：X／Y 軸取負之後上下限互換。
 */
export function buildIKConfig(
  pmxBones: RawPMXIKBone[],
  boneList: (THREE.Bone | undefined)[],
  skeletonBones: THREE.Bone[]
): IK[] {
  const indexInSkeleton = new Map<THREE.Bone, number>();
  skeletonBones.forEach((bone, i) => indexInSkeleton.set(bone, i));

  const resolve = (pmxIndex: number): number | undefined => {
    const bone = boneList[pmxIndex];
    return bone ? indexInSkeleton.get(bone) : undefined;
  };

  const iks: IK[] = [];

  for (let i = 0; i < pmxBones.length; i++) {
    const ik = pmxBones[i].ik;
    if (!ik) continue;

    const target = resolve(i);
    const effector = resolve(ik.effector);
    if (target === undefined || effector === undefined) continue;

    const links = [];
    let broken = false;
    for (const link of ik.links) {
      const index = resolve(link.index);
      if (index === undefined) {
        broken = true;
        break;
      }
      const entry: IK["links"][number] = { index };
      if (link.angleLimitation === 1) {
        const lower = link.lowerLimitationAngle ?? [0, 0, 0];
        const upper = link.upperLimitationAngle ?? [0, 0, 0];
        // Z 鏡射把 X／Y 的角度取負，所以上下限要交換再取負；Z 軸不動。
        entry.limitation = undefined;
        entry.rotationMin = new THREE.Vector3(-upper[0], -upper[1], lower[2]);
        entry.rotationMax = new THREE.Vector3(-lower[0], -lower[1], upper[2]);
      }
      links.push(entry);
    }
    if (broken) continue;

    iks.push({
      target,
      effector,
      links,
      iteration: ik.iteration,
      minAngle: undefined,
      maxAngle: ik.maxAngle,
    });
  }

  return iks;
}

export interface VMDPlayerOptions {
  space: PMXPhysicsSpace;
  /** PMX 原始骨頭資料，用來建 IK。省略就不做 IK 解算。 */
  pmxBones?: RawPMXIKBone[];
  /** 依 PMX 骨索引的骨頭表，配合 `pmxBones` 使用。 */
  boneList?: (THREE.Bone | undefined)[];
}

/**
 * VMD 播放器：把 clip 餵給 mixer，每幀順便跑 IK。
 *
 * 呼叫端要注意：播放期間程序化手勢必須讓位，否則兩邊會在同一批骨頭上打架。
 */
export class VMDPlayer {
  private readonly mixer: THREE.AnimationMixer;
  private readonly ikSolver: CCDIKSolver | null;
  private action: THREE.AnimationAction | null = null;
  private readonly ikCount: number;

  constructor(
    private readonly mesh: THREE.SkinnedMesh,
    private readonly options: VMDPlayerOptions
  ) {
    this.mixer = new THREE.AnimationMixer(mesh);

    const { pmxBones, boneList } = options;
    if (pmxBones && boneList) {
      const iks = buildIKConfig(pmxBones, boneList, mesh.skeleton.bones);
      this.ikCount = iks.length;
      this.ikSolver = iks.length > 0 ? new CCDIKSolver(mesh, iks) : null;
    } else {
      this.ikCount = 0;
      this.ikSolver = null;
    }
  }

  /** 建起來的 IK 鏈數量。昔漣那顆模型應該是 4（兩腳的足ＩＫ與つま先ＩＫ）。 */
  public get ikChainCount(): number {
    return this.ikCount;
  }

  public get playing(): boolean {
    return this.action !== null && this.action.isRunning();
  }

  /** 播放一段 VMD。會停掉前一段。 */
  public play(
    vmd: ParsedVMD,
    options: BuildVMDClipOptions & { loop?: boolean } = {}
  ): THREE.AnimationAction {
    this.stop();
    const clip = buildVMDClip(vmd, this.mesh, this.options.space, options);
    const action = this.mixer.clipAction(clip);
    action.setLoop(options.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !options.loop;
    action.play();
    this.action = action;
    return action;
  }

  public stop(): void {
    if (!this.action) return;
    this.action.stop();
    this.mixer.uncacheClip(this.action.getClip());
    this.action = null;
  }

  /**
   * 推進一幀。
   *
   * IK 要排在 mixer 之後：VMD 動的是 `足ＩＫ` 這種控制骨，解算器再據此把
   * 大腿與小腿轉到位。順序反過來的話 IK 會拿到上一幀的目標。
   *
   * 中間那行 `updateMatrixWorld` 不能省：`CCDIKSolver.updateOne` 是用
   * `setFromMatrixPosition(target.matrixWorld)` 取目標位置的（註解寫明為了
   * 效能刻意不呼叫 `getWorldPosition`），而 mixer 只寫 `bone.position`。
   * 不先把矩陣更新到最新，解算器每一幀拿到的都是上一幀的目標 —— 起始姿勢
   * 下就是「目標剛好在原位」，於是完全不解算，腿整條僵著不動。
   */
  public update(deltaSeconds: number): void {
    this.mixer.update(deltaSeconds);
    if (this.ikSolver) {
      this.mesh.updateMatrixWorld(true);
      this.ikSolver.update();
    }
  }

  public dispose(): void {
    this.stop();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mesh);
  }
}
