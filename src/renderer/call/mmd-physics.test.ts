import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import { buildBones, computeSpace, loadPmx } from "./pmx-test-fixture";
import {
  MMDPhysics,
  buildMMDPhysicsPayload,
  collectBoneRestPositions,
  loadAmmo,
  pmxToScenePosition,
  sceneToPmxPosition,
  type PMXPhysicsSpace,
  type RawPMXPhysicsSource,
} from "./mmd-physics";

describe("座標轉換", () => {
  const space: PMXPhysicsSpace = { scale: 0.075, centerX: 0.5, centerZ: -1.25, minY: -0.5 };

  it("場景 → PMX → 場景 會回到原點", () => {
    const original = new THREE.Vector3(0.31, 1.24, -0.08);
    const v = original.clone();
    sceneToPmxPosition(v, space);
    pmxToScenePosition(v, space);
    expect(v.x).toBeCloseTo(original.x, 10);
    expect(v.y).toBeCloseTo(original.y, 10);
    expect(v.z).toBeCloseTo(original.z, 10);
  });

  it("Z 軸有鏡射（不是單純縮放平移）", () => {
    // PMX 的 +Z 應該映到場景的 -Z，這是 pmx-loader 的 toSceneZ 定下的慣例。
    const v = new THREE.Vector3(space.centerX, space.minY, space.centerZ + 1);
    pmxToScenePosition(v, space);
    expect(v.z).toBeLessThan(0);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBeCloseTo(0, 10);
  });
});

describe("buildMMDPhysicsPayload（用真的昔漣模型）", () => {
  let pmx: any;
  let space: PMXPhysicsSpace;

  beforeAll(() => {
    pmx = loadPmx();
    space = computeSpace(pmx);
  });

  it("模型確實帶著完整的剛體與關節", () => {
    expect(pmx.rigidBodies.length).toBe(447);
    expect(pmx.constraints.length).toBe(639);
  });

  it("剛體位置被換算成相對骨頭的偏移", () => {
    const { bones } = buildBones(pmx, space);
    const built = buildMMDPhysicsPayload(pmx, bones, space);
    expect(built).not.toBeNull();

    // 隨便挑一個掛在骨頭上的剛體，偏移必須等於「原始世界座標 − 骨頭位置」。
    const idx = pmx.rigidBodies.findIndex((rb: any) => rb.boneIndex >= 0);
    const raw = pmx.rigidBodies[idx];
    const bonePos = pmx.bones[raw.boneIndex].position;
    const got = built!.payload.rigidBodies[idx].position;
    expect(got[0]).toBeCloseTo(raw.position[0] - bonePos[0], 6);
    expect(got[1]).toBeCloseTo(raw.position[1] - bonePos[1], 6);
    expect(got[2]).toBeCloseTo(raw.position[2] - bonePos[2], 6);
  });

  it("偏移量遠小於原始世界座標（沒漏減）", () => {
    const { bones } = buildBones(pmx, space);
    const built = buildMMDPhysicsPayload(pmx, bones, space)!;
    const attached = built.payload.rigidBodies
      .map((b, i) => ({ b, raw: pmx.rigidBodies[i] }))
      .filter(({ b }) => b.boneIndex >= 0);

    // 世界座標的 Y 動輒是 8~18（頭在 18 左右）。偏移量的量級必須明顯更小，
    // 不然就是忘了減骨頭位置。用比值而不是絕對值，才不會綁死在某個模型上。
    const maxOffsetY = Math.max(...attached.map(({ b }) => Math.abs(b.position[1])));
    const maxRawY = Math.max(...attached.map(({ raw }) => Math.abs(raw.position[1])));
    expect(maxOffsetY).toBeLessThan(maxRawY * 0.3);
  });

  it("套用了關節帶動的剛體型別修正", () => {
    const { bones } = buildBones(pmx, space);
    const built = buildMMDPhysicsPayload(pmx, bones, space)!;
    expect(built.retypedBodies).toBeGreaterThan(0);

    // 修正過的那些剛體，型別必須從 2 變成 1。
    for (const joint of built.payload.joints) {
      const a = built.payload.rigidBodies[joint.rigidBodyIndex1];
      const b = built.payload.rigidBodies[joint.rigidBodyIndex2];
      if (!a || !b) continue;
      if (a.type === 0 || a.boneIndex < 0 || b.boneIndex < 0) continue;
      if (pmx.bones[b.boneIndex]?.parentIndex !== a.boneIndex) continue;
      expect(b.type).not.toBe(2);
    }
  });

  it("原始資料沒有被就地改壞（rigidBodies 仍是世界座標）", () => {
    const fresh = loadPmx();
    const { bones } = buildBones(pmx, space);
    buildMMDPhysicsPayload(pmx, bones, space);
    const idx = pmx.rigidBodies.findIndex((rb: any) => rb.boneIndex >= 0);
    expect(pmx.rigidBodies[idx].position[1]).toBeCloseTo(
      (fresh as any).rigidBodies[idx].position[1],
      6
    );
  });

  it("沒有剛體或沒有關節時回傳 null", () => {
    expect(buildMMDPhysicsPayload({ bones: [], rigidBodies: [], constraints: [] }, [], space))
      .toBeNull();
    expect(
      buildMMDPhysicsPayload(
        { bones: [{ position: [0, 0, 0], parentIndex: -1 }], rigidBodies: [{}], constraints: [] },
        [],
        space
      )
    ).toBeNull();
  });
});

describe("MMDPhysics 實跑（Bullet）", () => {
  let pmx: any;
  let space: PMXPhysicsSpace;
  let bones: THREE.Bone[];
  let roots: THREE.Bone[];
  let physics: MMDPhysics;

  beforeAll(async () => {
    pmx = loadPmx();
    space = computeSpace(pmx);
    const built = buildBones(pmx, space);
    bones = built.bones;
    roots = built.roots;
    for (const r of roots) r.updateMatrixWorld(true);

    const ammo = await loadAmmo();
    const payload = buildMMDPhysicsPayload(pmx, bones, space)!.payload;
    physics = new MMDPhysics(ammo, payload, collectBoneRestPositions(pmx));
  }, 60_000);

  it("剛體與關節全數建立起來", () => {
    expect(physics.bodyCount).toBe(447);
    // 兩端剛體都存在的關節才建得起來；這顆模型應該是全數建立。
    expect(physics.constraintCount).toBe(639);
  });

  it("跑 120 步之後所有骨頭仍是有限值（沒有爆開）", () => {
    for (let i = 0; i < 120; i++) {
      for (const r of roots) r.updateMatrixWorld(true);
      physics.update(1 / 60);
    }
    for (const bone of bones) {
      expect(Number.isFinite(bone.position.x)).toBe(true);
      expect(Number.isFinite(bone.position.y)).toBe(true);
      expect(Number.isFinite(bone.position.z)).toBe(true);
      expect(Number.isFinite(bone.quaternion.w)).toBe(true);
      // 四元數必須維持單位長度，累積誤差會在這裡先爆出來。
      expect(bone.quaternion.length()).toBeCloseTo(1, 3);
    }
  });

  it("骨頭沒有飄到離模型很遠的地方", () => {
    // 場景空間裡模型高度是 1.5，任何骨頭跑到 10 以外都代表約束解崩了。
    for (const r of roots) r.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    for (const bone of bones) {
      bone.getWorldPosition(world);
      expect(world.length()).toBeLessThan(10);
    }
  });

  it("布料骨在身體移動之後真的有動", () => {
    // 要挑「真的掛著動力學剛體」的骨頭。用名字比對會抓到裝飾骨
    // （像 `右側裙花1-1`），那種骨頭沒有剛體，永遠不會動。
    const payload = buildMMDPhysicsPayload(pmx, bones, space)!.payload;
    const clothBoneIndices = payload.rigidBodies
      .filter((b) => b.type !== 0 && b.boneIndex >= 0)
      .map((b) => b.boneIndex);
    expect(clothBoneIndices.length).toBeGreaterThan(100);

    physics.reset();
    for (const r of roots) r.updateMatrixWorld(true);
    const before = clothBoneIndices.map((i) => bones[i].quaternion.clone());

    // 把整個模型左右甩，布料應該跟著擺。
    for (let i = 0; i < 60; i++) {
      roots[0].position.x = Math.sin(i * 0.4) * 0.5;
      for (const r of roots) r.updateMatrixWorld(true);
      physics.update(1 / 60);
    }

    const moved = clothBoneIndices.filter(
      (boneIndex, k) => before[k].angleTo(bones[boneIndex].quaternion) > 1e-3
    ).length;
    // 不要求每一根都動（有些被關節鎖得很死），但絕大多數該有反應。
    expect(moved).toBeGreaterThan(clothBoneIndices.length * 0.5);
  });
});
