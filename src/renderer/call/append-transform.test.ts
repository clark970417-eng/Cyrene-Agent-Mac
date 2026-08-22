import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyAppendTransforms, type AppendTransformEntry } from "./append-transform";

function entry(
  source: THREE.Bone,
  bone: THREE.Bone,
  ratio: number,
  options: { rotation?: boolean; position?: boolean } = {}
): AppendTransformEntry {
  return {
    bone,
    source,
    ratio,
    affectRotation: options.rotation ?? true,
    affectPosition: options.position ?? false,
    bindRotation: bone.quaternion.clone(),
    bindPosition: bone.position.clone(),
    sourceBindPosition: source.position.clone(),
  };
}

describe("applyAppendTransforms", () => {
  it("比例是旋轉角度的縮放", () => {
    const source = new THREE.Bone();
    const follower = new THREE.Bone();
    source.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.0);

    applyAppendTransforms([entry(source, follower, 0.5)]);

    expect(follower.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0.5, 5);
  });

  it("比例 1 就是完全跟隨（腿的 D 骨靠這個）", () => {
    const source = new THREE.Bone();
    const follower = new THREE.Bone();
    source.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7);

    applyAppendTransforms([entry(source, follower, 1)]);

    expect(follower.quaternion.angleTo(source.quaternion)).toBeLessThan(1e-6);
  });

  it("比例 -1 是反向抵銷（肩C / 腰キャンセル）", () => {
    const source = new THREE.Bone();
    const follower = new THREE.Bone();
    source.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6);

    applyAppendTransforms([entry(source, follower, -1)]);

    // 兩者相乘要回到單位四元數。
    const combined = source.quaternion.clone().multiply(follower.quaternion);
    expect(combined.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it("每幀重算，不會把上一幀的結果疊上去", () => {
    const source = new THREE.Bone();
    const follower = new THREE.Bone();
    source.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    const list = [entry(source, follower, 1)];

    applyAppendTransforms(list);
    applyAppendTransforms(list);
    applyAppendTransforms(list);

    expect(follower.quaternion.angleTo(source.quaternion)).toBeLessThan(1e-6);
  });

  it("來源回到原位時跟隨骨也回到綁定姿勢", () => {
    const source = new THREE.Bone();
    const follower = new THREE.Bone();
    const list = [entry(source, follower, 0.75)];

    source.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9);
    applyAppendTransforms(list);
    source.quaternion.identity();
    applyAppendTransforms(list);

    expect(follower.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it("串接的付与在同一趟裡算完（足 → 足D → ひざD）", () => {
    const leg = new THREE.Bone();
    const knee = new THREE.Bone();
    const legD = new THREE.Bone();
    const kneeD = new THREE.Bone();
    leg.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
    knee.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    legD.add(kneeD);

    applyAppendTransforms([entry(leg, legD, 1), entry(knee, kneeD, 1)]);

    legD.updateMatrixWorld(true);
    // 兩節都跟上了：世界旋轉是 0.5 + 0.3。
    const world = new THREE.Quaternion();
    kneeD.getWorldQuaternion(world);
    expect(world.angleTo(new THREE.Quaternion())).toBeCloseTo(0.8, 5);
  });

  it("位移付与只搬相對綁定位置的差值", () => {
    const source = new THREE.Bone();
    const follower = new THREE.Bone();
    source.position.set(1, 0, 0);
    follower.position.set(0, 2, 0);
    const list = [entry(source, follower, 0.5, { rotation: false, position: true })];

    source.position.set(1.4, 0, 0);
    applyAppendTransforms(list);

    expect(follower.position.x).toBeCloseTo(0.2, 6);
    expect(follower.position.y).toBeCloseTo(2, 6);
  });

  it("不受影響的通道原封不動", () => {
    const source = new THREE.Bone();
    const follower = new THREE.Bone();
    follower.position.set(0, 1, 0);
    source.position.set(5, 5, 5);
    source.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2);

    applyAppendTransforms([entry(source, follower, 1, { rotation: true, position: false })]);

    expect(follower.position.y).toBeCloseTo(1, 6);
  });
});
