import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildIKConfig, buildVMDClip, type ParsedVMD, type RawPMXIKBone } from "./vmd-animation";
import type { PMXPhysicsSpace } from "./mmd-physics";

const SPACE: PMXPhysicsSpace = { scale: 0.075, centerX: 0, centerZ: 0, minY: 0 };

/** 一根根相連的骨架，名稱用 MMD 的日文標準骨名。 */
function makeMesh(names: string[]): THREE.SkinnedMesh {
  const bones = names.map((name, i) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(i * 0.1, i * 0.2, i * 0.3);
    return bone;
  });
  for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
  );
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.morphTargetDictionary = { まばたき: 0, あ: 1 };
  mesh.morphTargetInfluences = [0, 0];
  return mesh;
}

/** 一格關鍵格。插值資料 64 位元組，這裡填成線性（全 20/107 之類的都行）。 */
function frame(
  boneName: string,
  frameNum: number,
  position: number[],
  rotation: number[]
): ParsedVMD["motions"][number] {
  return {
    boneName,
    frameNum,
    position,
    rotation,
    interpolation: new Array(64).fill(64),
  };
}

function makeVMD(motions: ParsedVMD["motions"], morphs: ParsedVMD["morphs"] = []): ParsedVMD {
  return {
    metadata: { motionCount: motions.length, morphCount: morphs.length },
    motions,
    morphs,
  };
}

describe("buildVMDClip", () => {
  it("時間軸用 30fps 換算", () => {
    const mesh = makeMesh(["センター", "上半身"]);
    const clip = buildVMDClip(
      makeVMD([
        frame("上半身", 0, [0, 0, 0], [0, 0, 0, 1]),
        frame("上半身", 30, [0, 0, 0], [0, 0, 0, 1]),
        frame("上半身", 45, [0, 0, 0], [0, 0, 0, 1]),
      ]),
      mesh,
      SPACE
    );
    const track = clip.tracks.find((t) => t.name.endsWith(".position"))!;
    expect(Array.from(track.times)).toEqual([0, 1, 1.5]);
  });

  it("位移換算成場景單位並鏡射 Z", () => {
    const mesh = makeMesh(["センター"]);
    const base = mesh.skeleton.bones[0].position.clone();

    const clip = buildVMDClip(
      makeVMD([
        frame("センター", 0, [0, 0, 0], [0, 0, 0, 1]),
        frame("センター", 30, [4, 8, 12], [0, 0, 0, 1]),
      ]),
      mesh,
      SPACE
    );

    const track = clip.tracks.find((t) => t.name.endsWith(".position"))!;
    const v = track.values;
    // 第一格是靜止位置本身
    expect(v[0]).toBeCloseTo(base.x, 6);
    expect(v[1]).toBeCloseTo(base.y, 6);
    expect(v[2]).toBeCloseTo(base.z, 6);
    // 第二格：X/Y 加上「PMX 位移 × scale」，Z 要多一個負號
    expect(v[3]).toBeCloseTo(base.x + 4 * SPACE.scale, 6);
    expect(v[4]).toBeCloseTo(base.y + 8 * SPACE.scale, 6);
    expect(v[5]).toBeCloseTo(base.z - 12 * SPACE.scale, 6);
  });

  it("旋轉四元數做 Z 鏡射", () => {
    const mesh = makeMesh(["センター"]);
    const clip = buildVMDClip(
      makeVMD([
        frame("センター", 0, [0, 0, 0], [0.1, 0.2, 0.3, 0.9]),
        frame("センター", 10, [0, 0, 0], [0.1, 0.2, 0.3, 0.9]),
      ]),
      mesh,
      SPACE
    );
    const track = clip.tracks.find((t) => t.name.endsWith(".quaternion"))!;
    const v = track.values;
    expect(v[0]).toBeCloseTo(-0.1, 6);
    expect(v[1]).toBeCloseTo(-0.2, 6);
    expect(v[2]).toBeCloseTo(0.3, 6);
    expect(v[3]).toBeCloseTo(0.9, 6);
  });

  it("略過模型沒有的骨頭", () => {
    const mesh = makeMesh(["センター"]);
    const clip = buildVMDClip(
      makeVMD([
        frame("センター", 0, [0, 0, 0], [0, 0, 0, 1]),
        frame("這根骨頭不存在", 0, [0, 0, 0], [0, 0, 0, 1]),
      ]),
      mesh,
      SPACE
    );
    expect(clip.tracks.every((t) => !t.name.includes("不存在"))).toBe(true);
    // 一根骨頭 → 位移 + 旋轉兩條軌
    expect(clip.tracks.length).toBe(2);
  });

  it("預設不建表情軌（避免與程序化表情互相覆蓋）", () => {
    const mesh = makeMesh(["センター"]);
    const morphs = [
      { morphName: "まばたき", frameNum: 0, weight: 0 },
      { morphName: "まばたき", frameNum: 15, weight: 1 },
    ];
    const without = buildVMDClip(
      makeVMD([frame("センター", 0, [0, 0, 0], [0, 0, 0, 1])], morphs),
      mesh,
      SPACE
    );
    expect(without.tracks.some((t) => t.name.includes("morphTargetInfluences"))).toBe(false);

    const withMorphs = buildVMDClip(
      makeVMD([frame("センター", 0, [0, 0, 0], [0, 0, 0, 1])], morphs),
      mesh,
      SPACE,
      { includeMorphs: true }
    );
    expect(withMorphs.tracks.some((t) => t.name === ".morphTargetInfluences[0]")).toBe(true);
  });

  it("關鍵格未依時間排序時會先排好", () => {
    const mesh = makeMesh(["センター"]);
    const clip = buildVMDClip(
      makeVMD([
        frame("センター", 60, [0, 0, 0], [0, 0, 0, 1]),
        frame("センター", 0, [0, 0, 0], [0, 0, 0, 1]),
        frame("センター", 30, [0, 0, 0], [0, 0, 0, 1]),
      ]),
      mesh,
      SPACE
    );
    const times = Array.from(clip.tracks[0].times);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("插值器換成 MMD 的貝茲，不是 three.js 預設", () => {
    const mesh = makeMesh(["センター"]);
    const clip = buildVMDClip(
      makeVMD([
        frame("センター", 0, [0, 0, 0], [0, 0, 0, 1]),
        frame("センター", 30, [10, 0, 0], [0, 0, 0, 1]),
      ]),
      mesh,
      SPACE
    );
    const track = clip.tracks.find((t) => t.name.endsWith(".position"))!;
    // createInterpolant 在 three 的型別裡沒宣告，但執行期一定在。
    const create = (track as unknown as {
      createInterpolant: (r: Float32Array) => THREE.Interpolant;
    }).createInterpolant;
    expect(create.call(track, new Float32Array(3)).constructor.name).toBe(
      "CubicBezierInterpolation"
    );
  });
});

describe("buildIKConfig", () => {
  /** 兩節腿部 IK：ＩＫ骨 → 足首，經過 ひざ 與 足。 */
  function legSetup(): {
    pmxBones: RawPMXIKBone[];
    boneList: THREE.Bone[];
    skeleton: THREE.Bone[];
  } {
    const names = ["足", "ひざ", "足首", "足ＩＫ"];
    const mesh = makeMesh(names);
    const boneList = mesh.skeleton.bones;
    const pmxBones: RawPMXIKBone[] = [
      { name: "足" },
      { name: "ひざ" },
      { name: "足首" },
      {
        name: "足ＩＫ",
        ik: {
          effector: 2,
          iteration: 40,
          maxAngle: 2,
          links: [
            {
              index: 1,
              angleLimitation: 1,
              lowerLimitationAngle: [-Math.PI, 0, 0],
              upperLimitationAngle: [-0.0087, 0, 0],
            },
            { index: 0, angleLimitation: 0 },
          ],
        },
      },
    ];
    return { pmxBones, boneList, skeleton: boneList };
  }

  it("建出對應的 IK 鏈", () => {
    const { pmxBones, boneList, skeleton } = legSetup();
    const iks = buildIKConfig(pmxBones, boneList, skeleton);
    expect(iks.length).toBe(1);
    expect(iks[0].target).toBe(3);
    expect(iks[0].effector).toBe(2);
    expect(iks[0].links.map((l) => l.index)).toEqual([1, 0]);
    expect(iks[0].iteration).toBe(40);
  });

  it("角度上下限跟著 Z 鏡射一起翻（取負並互換）", () => {
    const { pmxBones, boneList, skeleton } = legSetup();
    const knee = buildIKConfig(pmxBones, boneList, skeleton)[0].links[0];

    // 原本 X 是 [-π, -0.0087]；鏡射後應該是 [0.0087, π]。
    // 不翻的話膝蓋會往反方向折。
    expect(knee.rotationMin!.x).toBeCloseTo(0.0087, 4);
    expect(knee.rotationMax!.x).toBeCloseTo(Math.PI, 4);
    // Z 軸不受鏡射影響，維持原樣。
    expect(knee.rotationMin!.z).toBeCloseTo(0, 6);
    expect(knee.rotationMax!.z).toBeCloseTo(0, 6);
  });

  it("沒有角度限制的節點不設限位", () => {
    const { pmxBones, boneList, skeleton } = legSetup();
    const thigh = buildIKConfig(pmxBones, boneList, skeleton)[0].links[1];
    expect(thigh.rotationMin).toBeUndefined();
    expect(thigh.rotationMax).toBeUndefined();
  });

  it("骨頭對不上時跳過整條鏈，不會建出半條", () => {
    const { pmxBones, boneList, skeleton } = legSetup();
    // 讓其中一個連結指向不存在的骨頭
    pmxBones[3].ik!.links[0].index = 99;
    expect(buildIKConfig(pmxBones, boneList, skeleton).length).toBe(0);
  });
});
