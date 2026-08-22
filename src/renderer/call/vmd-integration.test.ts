/**
 * VMD 端到端：真的昔漣模型 + 真的 VMD 二進位檔，跑完
 * `parseVmd → buildVMDClip → AnimationMixer → CCDIKSolver → MMDPhysics`。
 *
 * 單元測試（vmd-animation.test.ts）驗的是轉換數學；這一支驗的是「整條路真的會動」，
 * 特別是兩件單元測試看不出來的事：
 *   1. IK 解算真的把膝蓋彎起來（VMD 舞蹈動的是 `足ＩＫ`，腿是被解出來的）
 *   2. VMD 與 Bullet 物理同時跑不會互相打爆
 */

import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import { Parser } from "mmd-parser";
import {
  MMDPhysics,
  buildMMDPhysicsPayload,
  collectBoneRestPositions,
  loadAmmo,
} from "./mmd-physics";
import { VMDPlayer, type ParsedVMD } from "./vmd-animation";
import {
  buildBones,
  buildMesh,
  buildVMDBuffer,
  computeSpace,
  loadPmx,
  walkCycleFrames,
} from "./pmx-test-fixture";
import type { PMXPhysicsSpace } from "./mmd-physics";

describe("VMD 端到端", () => {
  let pmx: any;
  let space: PMXPhysicsSpace;
  let bones: THREE.Bone[];
  let roots: THREE.Bone[];
  let mesh: THREE.SkinnedMesh;
  let vmd: ParsedVMD;

  beforeAll(() => {
    pmx = loadPmx();
    space = computeSpace(pmx);
    const built = buildBones(pmx, space);
    bones = built.bones;
    roots = built.roots;
    mesh = buildMesh(bones, roots);
    mesh.updateMatrixWorld(true);

    const buffer = buildVMDBuffer(walkCycleFrames());
    vmd = new Parser().parseVmd(buffer) as ParsedVMD;
  });

  it("合成的 VMD 是合法的二進位檔，解得回來", () => {
    expect(vmd.metadata.motionCount).toBe(38);
    const names = new Set(vmd.motions.map((m) => m.boneName));
    // Shift_JIS 的全形英數（ＩＫ）最容易編碼錯，特別確認。
    expect(names.has("左足ＩＫ")).toBe(true);
    expect(names.has("センター")).toBe(true);
    expect(names.has("上半身")).toBe(true);
  });

  it("VMD 的骨頭名稱都對得上模型", () => {
    const known = new Set(bones.map((b) => b.name));
    const unmatched = [...new Set(vmd.motions.map((m) => m.boneName))].filter(
      (n) => !known.has(n)
    );
    expect(unmatched).toEqual([]);
  });

  it("播放之後骨頭真的被動畫驅動", () => {
    const player = new VMDPlayer(mesh, {
      space,
      pmxBones: pmx.bones,
      boneList: bones,
    });
    expect(player.ikChainCount).toBe(4);

    const center = bones.find((b) => b.name === "センター")!;
    const upper = bones.find((b) => b.name === "上半身")!;
    const beforeCenter = center.position.clone();
    const beforeUpper = upper.quaternion.clone();

    player.play(vmd, { loop: true });
    for (let i = 0; i < 40; i++) player.update(1 / 60);

    expect(center.position.distanceTo(beforeCenter)).toBeGreaterThan(1e-3);
    expect(upper.quaternion.angleTo(beforeUpper)).toBeGreaterThan(1e-2);
    player.dispose();
  });

  it("位移套用了場景縮放（不是直接吃 PMX 單位）", () => {
    const player = new VMDPlayer(mesh, { space });
    const center = bones.find((b) => b.name === "センター")!;
    const rest = center.position.clone();

    player.play(vmd, { loop: true });
    let maxOffset = 0;
    for (let i = 0; i < 120; i++) {
      player.update(1 / 60);
      maxOffset = Math.max(maxOffset, center.position.distanceTo(rest));
    }

    // 動作裡最大的位移量是 PMX 單位下的 ~2.7。乘上 scale（約 0.075）
    // 應該落在 0.2 上下；若忘了縮放就會是 2.7 那個量級，模型會飛出畫面。
    expect(maxOffset).toBeGreaterThan(0.05);
    expect(maxOffset).toBeLessThan(0.6);
    player.dispose();
  });

  it("IK 解算讓膝蓋跟著 足ＩＫ 彎起來", () => {
    const knee = bones.find((b) => b.name === "左ひざ");
    expect(knee, "模型應該有 左ひざ 這根骨頭").toBeDefined();

    // 先量沒有 IK 的情況：只給 space，不給 pmxBones → 不建解算器
    const withoutIK = new VMDPlayer(mesh, { space });
    const restKnee = knee!.quaternion.clone();
    withoutIK.play(vmd, { loop: true });
    let maxWithoutIK = 0;
    for (let i = 0; i < 120; i++) {
      withoutIK.update(1 / 60);
      maxWithoutIK = Math.max(maxWithoutIK, restKnee.angleTo(knee!.quaternion));
    }
    withoutIK.dispose();
    knee!.quaternion.copy(restKnee);

    // 再量有 IK 的情況
    const withIK = new VMDPlayer(mesh, { space, pmxBones: pmx.bones, boneList: bones });
    withIK.play(vmd, { loop: true });
    let maxWithIK = 0;
    for (let i = 0; i < 120; i++) {
      withIK.update(1 / 60);
      maxWithIK = Math.max(maxWithIK, restKnee.angleTo(knee!.quaternion));
    }
    withIK.dispose();

    // VMD 裡完全沒有 左ひざ 的軌道，膝蓋的角度只可能來自 IK 解算。
    expect(vmd.motions.some((m) => m.boneName === "左ひざ")).toBe(false);
    expect(maxWithoutIK).toBeLessThan(1e-6);
    expect(maxWithIK).toBeGreaterThan(0.05);
  });

  it("膝蓋只往一個方向彎（角度限位有生效）", () => {
    const knee = bones.find((b) => b.name === "左ひざ")!;
    const player = new VMDPlayer(mesh, { space, pmxBones: pmx.bones, boneList: bones });
    player.play(vmd, { loop: true });

    const euler = new THREE.Euler();
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60);
      euler.setFromQuaternion(knee.quaternion, "XYZ");
      minX = Math.min(minX, euler.x);
      maxX = Math.max(maxX, euler.x);
    }
    player.dispose();

    // 先確認這一段真的有在動，否則下面的限位判斷會變成空測。
    expect(maxX - minX).toBeGreaterThan(0.05);
    // PMX 給 左ひざ 的限位是 X ∈ [-π, -0.0087]，鏡射後是 [0.0087, π]。
    // 膝蓋只能往同一側折；跨過 0 就代表限位沒生效（會看到反折的腿）。
    expect(minX).toBeGreaterThan(-0.05);
    expect(maxX).toBeLessThan(Math.PI + 0.05);
  });

  it("VMD 與 Bullet 物理同時跑不會爆", async () => {
    const ammo = await loadAmmo();
    const payload = buildMMDPhysicsPayload(pmx, bones, space)!.payload;
    const physics = new MMDPhysics(ammo, payload, collectBoneRestPositions(pmx));
    const player = new VMDPlayer(mesh, { space, pmxBones: pmx.bones, boneList: bones });

    player.play(vmd, { loop: true });
    for (let i = 0; i < 180; i++) {
      player.update(1 / 60);
      for (const r of roots) r.updateMatrixWorld(true);
      physics.update(1 / 60);
    }

    const world = new THREE.Vector3();
    for (const bone of bones) {
      expect(Number.isFinite(bone.position.x)).toBe(true);
      expect(Number.isFinite(bone.quaternion.w)).toBe(true);
      expect(bone.quaternion.length()).toBeCloseTo(1, 3);
      bone.getWorldPosition(world);
      expect(world.length()).toBeLessThan(10);
    }

    player.dispose();
    physics.dispose();
  }, 60_000);

  it("stop 之後骨頭不再被動畫改動（交還給程序化手勢）", () => {
    const player = new VMDPlayer(mesh, { space, pmxBones: pmx.bones, boneList: bones });
    const center = bones.find((b) => b.name === "センター")!;

    player.play(vmd, { loop: true });
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    expect(player.playing).toBe(true);

    player.stop();
    expect(player.playing).toBe(false);

    const frozen = center.position.clone();
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    expect(center.position.distanceTo(frozen)).toBeLessThan(1e-9);
    player.dispose();
  });
});
