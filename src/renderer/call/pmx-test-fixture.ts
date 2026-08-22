/**
 * 測試用：把真的昔漣 PMX 載成骨架，並合成 VMD 動作檔。
 *
 * 不是應用程式碼 —— 只給 `*.test.ts` 使用。放在這裡而不是各測試檔各寫一份，
 * 是因為「PMX → 場景空間」那組常數（scale / centerX / centerZ / minY）必須跟
 * `pmx-loader.ts` 完全一致；抄成兩份遲早會有一份漂掉，而漂掉的那份會安靜地
 * 讓測試繼續通過。
 */

import * as THREE from "three";
import fs from "node:fs";
import path from "node:path";
import { CharsetEncoder, Parser } from "mmd-parser";
import type { PMXPhysicsSpace } from "./mmd-physics";

export const MODEL_PATH = path.join(
  process.cwd(),
  "src/renderer/public/models/pmx/cyrene/星穹铁道—大昔涟 物理优化.pmx"
);

/** 與 `pmx-loader.ts` 的 TARGET_HEIGHT 相同。 */
const TARGET_HEIGHT = 1.65;

export function loadPmx(): any {
  const buf = fs.readFileSync(MODEL_PATH);
  return new Parser().parsePmx(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

/** 照 `pmx-loader.ts` 的方式算出 PMX → 場景的轉換常數。 */
export function computeSpace(pmx: any): PMXPhysicsSpace {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of pmx.vertices) {
    const [x, y, z] = v.position;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // 地板基準用腳尖／腳踝骨，跟 pmx-loader 一致（見那邊的說明：
  // 拿幾何最低點會被裙子的長拖襬拉低，模型會浮起來）。
  const footBoneY: number[] = [];
  for (const b of pmx.bones as Array<{ name: string; position: number[] }>) {
    if (/つま先|足首/.test(b.name)) footBoneY.push(b.position[1]);
  }
  const groundRawY = footBoneY.length > 0 ? Math.min(...footBoneY) : minY;

  return {
    scale: TARGET_HEIGHT / (maxY - groundRawY),
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    minY: groundRawY,
  };
}

/** 照 `pmx-loader.ts` 的方式建骨架（場景空間，Z 已鏡射）。 */
export function buildBones(
  pmx: any,
  space: PMXPhysicsSpace
): { bones: THREE.Bone[]; roots: THREE.Bone[] } {
  const toScene = (p: number[]): THREE.Vector3 =>
    new THREE.Vector3(
      (p[0] - space.centerX) * space.scale,
      (p[1] - space.minY) * space.scale,
      -(p[2] - space.centerZ) * space.scale
    );

  const bones: THREE.Bone[] = [];
  const world: THREE.Vector3[] = [];
  for (const b of pmx.bones) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bones.push(bone);
    world.push(toScene(b.position));
  }

  const roots: THREE.Bone[] = [];
  for (let i = 0; i < bones.length; i++) {
    const parent = pmx.bones[i].parentIndex;
    if (parent >= 0 && parent < bones.length && parent !== i) {
      bones[parent].add(bones[i]);
      bones[i].position.copy(world[i]).sub(world[parent]);
    } else {
      roots.push(bones[i]);
      bones[i].position.copy(world[i]);
    }
  }
  return { bones, roots };
}

/** 綁成 SkinnedMesh，VMD 的 AnimationMixer 需要真的骨架繫結。 */
export function buildMesh(
  bones: THREE.Bone[],
  roots: THREE.Bone[]
): THREE.SkinnedMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
  );
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  for (const r of roots) mesh.add(r);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return mesh;
}

// ---------------------------------------------------------------------------
// VMD 合成
// ---------------------------------------------------------------------------

/** `s2uTable` 是 sjis→unicode，反轉成 unicode→sjis 才能寫檔。 */
const u2s = (() => {
  const table = new CharsetEncoder().s2uTable as Record<string, number>;
  const map = new Map<number, number>();
  for (const key of Object.keys(table)) {
    const unicode = table[key];
    if (!map.has(unicode)) map.set(unicode, Number(key));
  }
  return map;
})();

function encodeSjis(text: string, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength); // 其餘補 0
  let p = 0;
  for (const ch of text) {
    const sjis = u2s.get(ch.codePointAt(0)!);
    if (sjis === undefined) throw new Error(`無法以 Shift_JIS 編碼: ${ch}`);
    if (sjis > 0xff) {
      out[p++] = (sjis >> 8) & 0xff;
      out[p++] = sjis & 0xff;
    } else {
      out[p++] = sjis & 0xff;
    }
    if (p > byteLength) throw new Error(`「${text}」超過 ${byteLength} 位元組`);
  }
  return out;
}

/** MMD 預設的貝茲插值區塊（緩入緩出）。 */
const DEFAULT_INTERPOLATION = [
  20, 20, 0, 0, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 20,
  20, 20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 20, 0,
  20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 20, 0, 0,
  20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 20, 0, 0, 0,
];

export interface SyntheticFrame {
  boneName: string;
  frameNum: number;
  /** PMX 單位。 */
  position: [number, number, number];
  /** 四元數 (x, y, z, w)。 */
  rotation: [number, number, number, number];
}

/**
 * 產生一個真的 VMD 二進位檔。
 *
 * 手上沒有現成 VMD 也要能端到端驗證：合成的檔案會走完
 * `parseVmd → buildVMDClip → AnimationMixer → CCDIKSolver` 整條路，
 * 跟真檔唯一的差別只是動作內容是算出來的。
 */
export function buildVMDBuffer(frames: SyntheticFrame[], modelName = "昔漣テスト"): ArrayBuffer {
  const BONE_FRAME_SIZE = 111;
  const total = 30 + 20 + 4 + frames.length * BONE_FRAME_SIZE + 4 * 5;
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;

  // 30 位元組簽章
  const signature = "Vocaloid Motion Data 0002";
  for (let i = 0; i < signature.length; i++) bytes[i] = signature.charCodeAt(i);
  offset += 30;

  bytes.set(encodeSjis(modelName, 20), offset);
  offset += 20;

  view.setUint32(offset, frames.length, true);
  offset += 4;

  for (const frame of frames) {
    bytes.set(encodeSjis(frame.boneName, 15), offset);
    view.setUint32(offset + 15, frame.frameNum, true);
    view.setFloat32(offset + 19, frame.position[0], true);
    view.setFloat32(offset + 23, frame.position[1], true);
    view.setFloat32(offset + 27, frame.position[2], true);
    view.setFloat32(offset + 31, frame.rotation[0], true);
    view.setFloat32(offset + 35, frame.rotation[1], true);
    view.setFloat32(offset + 39, frame.rotation[2], true);
    view.setFloat32(offset + 43, frame.rotation[3], true);
    bytes.set(DEFAULT_INTERPOLATION, offset + 47);
    offset += BONE_FRAME_SIZE;
  }

  // 表情 / 相機 / 燈光 / 自影 / IK可視，全部 0 筆（欄位已經是 0）
  return buffer;
}

const quatX = (angle: number): [number, number, number, number] => [
  Math.sin(angle / 2), 0, 0, Math.cos(angle / 2),
];
const quatY = (angle: number): [number, number, number, number] => [
  0, Math.sin(angle / 2), 0, Math.cos(angle / 2),
];

/**
 * 一段會踩到所有轉換路徑的測試動作：
 *   - `センター` 平移 → 位移縮放與 Z 鏡射
 *   - `上半身` 繞 Y 轉 → 四元數鏡射
 *   - `左腕 / 右腕` 繞 X 轉 → 一般骨骼旋轉
 *   - `左足ＩＫ / 右足ＩＫ` 上下踏步 → **IK 解算**（膝蓋必須跟著彎）
 */
export function walkCycleFrames(): SyntheticFrame[] {
  const frames: SyntheticFrame[] = [];
  const still: [number, number, number] = [0, 0, 0];

  for (let i = 0; i <= 4; i++) {
    frames.push({
      boneName: "センター",
      frameNum: i * 15,
      position: [Math.sin(i) * 2, Math.abs(Math.sin(i)) * 1.5, Math.cos(i) * 1.5],
      rotation: [0, 0, 0, 1],
    });
    frames.push({
      boneName: "上半身",
      frameNum: i * 15,
      position: still,
      rotation: quatY(Math.sin(i) * 0.5),
    });
    for (const arm of ["左腕", "右腕"]) {
      frames.push({
        boneName: arm,
        frameNum: i * 15,
        position: still,
        rotation: quatX(Math.sin(i) * 0.6),
      });
    }
  }

  for (const leg of ["左足ＩＫ", "右足ＩＫ"]) {
    const phase = leg.startsWith("左") ? 0 : Math.PI;
    for (let i = 0; i <= 8; i++) {
      frames.push({
        boneName: leg,
        frameNum: i * 8,
        position: [
          0,
          Math.max(0, Math.sin(i * 0.8 + phase)) * 2.5,
          Math.cos(i * 0.8 + phase) * 1.5,
        ],
        rotation: [0, 0, 0, 1],
      });
    }
  }

  return frames;
}
