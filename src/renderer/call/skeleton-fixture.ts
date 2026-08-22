import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { Parser } from "mmd-parser";
import { applyAppendTransforms, type AppendTransformEntry } from "./append-transform";

/**
 * 測試用的骨架夾具：直接從硬碟讀真的 PMX，只建骨頭，不建網格也不碰 WebGL。
 *
 * 為什麼要用真模型而不是合成骨架：手勢的角度值只有放在這副骨架的實際比例上
 * 才有意義（手臂多長、下巴在哪、額頭多高）。合成骨架能驗數學，驗不了「手到底
 * 有沒有比到臉旁邊」。
 *
 * 座標轉換與骨階層的建法必須跟 pmx-loader 完全一致，否則量出來的位置是另一
 * 個模型的。這裡刻意重寫而不是重用 loader：loader 綁在 fetch、貼圖與
 * SkinnedMesh 上，在 node 裡跑不起來。
 */

const MODEL_RELATIVE_PATH =
  "src/renderer/public/models/pmx/cyrene/星穹铁道—大昔涟 物理优化.pmx";

export interface SkeletonFixture {
  bones: Map<string, THREE.Bone>;
  roots: THREE.Bone[];
  appendTransforms: AppendTransformEntry[];
  /** 更新世界矩陣並套用付与。擺完姿勢後、量位置前呼叫。 */
  update(): void;
  /** 骨頭的世界座標。 */
  worldOf(boneName: string): THREE.Vector3;
  /** 把所有骨頭拉回綁定姿勢。 */
  reset(): void;
}

interface ParsedPmx {
  bones: Array<{
    name: string;
    position: number[];
    parentIndex: number;
    grant?: {
      parentIndex: number;
      ratio: number;
      affectRotation: boolean;
      affectPosition: boolean;
    };
  }>;
  vertices: Array<{ position: number[] }>;
}

let cachedPmx: ParsedPmx | null = null;

function parseModel(): ParsedPmx {
  if (cachedPmx) return cachedPmx;
  const file = path.resolve(process.cwd(), MODEL_RELATIVE_PATH);
  const buffer = fs.readFileSync(file);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  cachedPmx = new Parser().parsePmx(arrayBuffer) as ParsedPmx;
  return cachedPmx;
}

export function loadSkeletonFixture(): SkeletonFixture {
  const pmx = parseModel();

  // 與 pmx-loader 相同的正規化：把**站立高度**（腳底到頭頂）縮到 1.65、
  // X/Z 置中、腳底貼 0。
  //
  // 地板基準一定要用腳尖／腳踝骨，不能用幾何最低點 —— 這顆模型的裙子有兩片
  // 長拖襬垂到比腳底還低，拿幾何最低點當基準會讓模型浮起來 0.63、尺度也錯
  // （詳見 pmx-loader 的說明）。這裡跟那邊漂掉的話，body-anchors 的定位點
  // 就會對不上骨架，手勢驗收會整批誤判。
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of pmx.vertices) {
    if (v.position[0] < minX) minX = v.position[0];
    if (v.position[0] > maxX) maxX = v.position[0];
    if (v.position[1] < minY) minY = v.position[1];
    if (v.position[1] > maxY) maxY = v.position[1];
    if (v.position[2] < minZ) minZ = v.position[2];
    if (v.position[2] > maxZ) maxZ = v.position[2];
  }
  const footBoneY: number[] = [];
  for (const b of pmx.bones as Array<{ name: string; position: number[] }>) {
    if (/つま先|足首/.test(b.name)) footBoneY.push(b.position[1]);
  }
  const groundRawY = footBoneY.length > 0 ? Math.min(...footBoneY) : minY;

  const scale = 1.65 / (maxY - groundRawY || 35.0);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const toScene = (p: number[]): THREE.Vector3 =>
    new THREE.Vector3(
      (p[0] - centerX) * scale,
      (p[1] - groundRawY) * scale,
      -(p[2] - centerZ) * scale
    );

  const boneCount = pmx.bones.length;
  const bones: THREE.Bone[] = [];
  const world: THREE.Vector3[] = [];
  const byName = new Map<string, THREE.Bone>();

  for (let i = 0; i < boneCount; i++) {
    const bone = new THREE.Bone();
    bone.name = pmx.bones[i].name;
    bones.push(bone);
    world.push(toScene(pmx.bones[i].position));
    if (!byName.has(bone.name)) byName.set(bone.name, bone);
  }

  const roots: THREE.Bone[] = [];
  for (let i = 0; i < boneCount; i++) {
    const parentIndex = pmx.bones[i].parentIndex;
    if (parentIndex >= 0 && parentIndex < boneCount && parentIndex !== i) {
      bones[parentIndex].add(bones[i]);
      bones[i].position.copy(world[i]).sub(world[parentIndex]);
    } else {
      roots.push(bones[i]);
      bones[i].position.copy(world[i]);
    }
  }

  const appendTransforms: AppendTransformEntry[] = [];
  for (let i = 0; i < boneCount; i++) {
    const grant = pmx.bones[i].grant;
    if (!grant) continue;
    if (grant.parentIndex < 0 || grant.parentIndex >= boneCount) continue;
    if (!grant.affectRotation && !grant.affectPosition) continue;
    if (!Number.isFinite(grant.ratio) || grant.ratio === 0) continue;
    appendTransforms.push({
      bone: bones[i],
      source: bones[grant.parentIndex],
      ratio: grant.ratio,
      affectRotation: grant.affectRotation,
      affectPosition: grant.affectPosition,
      bindRotation: bones[i].quaternion.clone(),
      bindPosition: bones[i].position.clone(),
      sourceBindPosition: bones[grant.parentIndex].position.clone(),
    });
  }

  const bindPositions = bones.map((b) => b.position.clone());

  const update = (): void => {
    for (const root of roots) root.updateMatrixWorld(true);
    applyAppendTransforms(appendTransforms);
    for (const root of roots) root.updateMatrixWorld(true);
  };

  update();

  return {
    bones: byName,
    roots,
    appendTransforms,
    update,
    worldOf(boneName: string): THREE.Vector3 {
      const bone = byName.get(boneName);
      if (!bone) throw new Error(`骨頭不存在：${boneName}`);
      return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    },
    reset(): void {
      for (let i = 0; i < bones.length; i++) {
        bones[i].quaternion.identity();
        bones[i].position.copy(bindPositions[i]);
      }
      update();
    },
  };
}
