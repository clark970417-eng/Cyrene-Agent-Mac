import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SpringBoneSystem } from "./spring-bones";
import { FixedStepScheduler } from "./render-performance";

/**
 * 建一條往下垂的骨鏈，模擬頭髮／裙襬。
 * 靜止方向刻意設成 -Y，與重力同向，這樣「沒有外力時不該動」的斷言才乾淨。
 */
function makeChain(jointCount: number, name = "髪"): { root: THREE.Object3D; bones: THREE.Bone[] } {
  const root = new THREE.Object3D();
  const bones: THREE.Bone[] = [];
  let parent: THREE.Object3D = root;

  for (let i = 0; i < jointCount; i++) {
    const bone = new THREE.Bone();
    bone.name = `${name}_${i}`;
    bone.position.set(0, -0.1, 0);
    parent.add(bone);
    bones.push(bone);
    parent = bone;
  }

  root.updateMatrixWorld(true);
  return { root, bones };
}

/** 該關節偏離綁定姿勢的角度（弧度）。 */
function deviation(bone: THREE.Bone): number {
  return bone.quaternion.angleTo(new THREE.Quaternion());
}

function simulate(root: THREE.Object3D, system: SpringBoneSystem, frames: number): void {
  for (let i = 0; i < frames; i++) {
    root.updateMatrixWorld(true);
    system.update(1 / 60);
  }
}

describe("SpringBoneSystem", () => {
  it("依鏈組出關節，末端關節也算在內", () => {
    const { root, bones } = makeChain(4);
    root.updateMatrixWorld(true);
    const system = new SpringBoneSystem([bones]);

    expect(system.chainCount).toBe(1);
    expect(system.jointCount).toBe(4);
  });

  it("靜止且重力與靜止方向同向時不該自己晃起來", () => {
    const { root, bones } = makeChain(4);
    const system = new SpringBoneSystem([bones]);

    simulate(root, system, 240);

    for (const bone of bones) {
      expect(deviation(bone)).toBeLessThan(1e-3);
    }
  });

  it("骨架被甩動時末端會落後，停下後會收斂回靜止姿勢", () => {
    const { root, bones } = makeChain(4);
    const system = new SpringBoneSystem([bones]);

    // 先讓系統穩定，排除初始化殘留
    simulate(root, system, 60);

    // 一幀之內橫向位移一大段：尾端還留在舊的世界座標，關節必須轉起來補償
    root.position.x += 0.5;
    simulate(root, system, 2);

    const swung = deviation(bones[0]);
    expect(swung).toBeGreaterThan(0.05);

    // 停住不動，回正力應該把它拉回綁定姿勢
    simulate(root, system, 600);
    expect(deviation(bones[0])).toBeLessThan(swung / 10);
  });

  it("長度約束成立：尾端始終維持在距關節原點固定距離", () => {
    const { root, bones } = makeChain(3);
    const system = new SpringBoneSystem([bones]);

    simulate(root, system, 30);
    root.position.x += 1.2;
    simulate(root, system, 5);

    // 骨鏈每節長 0.1，蒙皮後子骨與父骨的世界距離應該還是 0.1
    root.updateMatrixWorld(true);
    for (let i = 1; i < bones.length; i++) {
      const a = new THREE.Vector3().setFromMatrixPosition(bones[i - 1].matrixWorld);
      const b = new THREE.Vector3().setFromMatrixPosition(bones[i].matrixWorld);
      expect(b.distanceTo(a)).toBeCloseTo(0.1, 5);
    }
  });

  it("delta 暴衝時不會炸開（分頁切回來的情境）", () => {
    const { root, bones } = makeChain(4);
    const system = new SpringBoneSystem([bones]);

    root.updateMatrixWorld(true);
    system.update(5); // 模擬掉幀 5 秒

    for (const bone of bones) {
      expect(Number.isFinite(bone.quaternion.x)).toBe(true);
      expect(deviation(bone)).toBeLessThan(Math.PI);
    }
  });

  it("零長度骨頭會被跳過，不會產生 NaN 旋轉", () => {
    const root = new THREE.Object3D();
    const a = new THREE.Bone();
    a.name = "裙_0_0";
    a.position.set(0, -0.1, 0);
    const b = new THREE.Bone();
    b.name = "裙_0_1";
    b.position.set(0, 0, 0); // 與父骨重疊
    a.add(b);
    root.add(a);
    root.updateMatrixWorld(true);

    const system = new SpringBoneSystem([[a, b]]);
    simulate(root, system, 30);

    expect(system.jointCount).toBe(1);
    expect(Number.isNaN(a.quaternion.x)).toBe(false);
  });
});

/** 建一顆擋在骨鏈路徑上的球體碰撞體，模擬大腿。 */
function makeCollider(bone: THREE.Bone, radius: number) {
  return {
    bone,
    shape: "sphere" as const,
    radius,
    height: 0,
    offset: new THREE.Vector3(0, 0, 0),
    axis: new THREE.Vector3(0, 1, 0),
    group: 0,
  };
}

// 這一組是「裙子不會飄」的回歸防線。先前全域寫死 4.58° 的偏轉上限加上
// 0.92~0.96 的阻尼（只保留 4%~8% 動量），布料等同硬板黏在身上。
describe("布料要真的會動", () => {
  it("裙襬被甩動時偏轉幅度要看得出來", () => {
    const { root, bones } = makeChain(4, "裙_0");
    const system = new SpringBoneSystem([bones]);
    simulate(root, system, 60);

    root.position.x += 0.5;
    simulate(root, system, 6);

    // 舊參數在這個情境下最多只能到 0.08 rad（4.58°），肉眼等於沒動。
    expect(deviation(bones[0])).toBeGreaterThan(0.15);
  });

  it("停下後仍會擺盪一陣子，而不是瞬間僵住", () => {
    const { root, bones } = makeChain(4, "裙_0");
    const system = new SpringBoneSystem([bones]);
    simulate(root, system, 60);

    // 位移取骨長的 1.2 倍（0.12）：這是走動、轉身會產生的量級。
    // 先前用 0.4（骨長的 4 倍、單幀）會把整條鏈推進偏轉夾限裡，第二節之後
    // 每幀都被夾限重寫位置、動量歸零，量到的是「卡在上限」而不是「僵住」。
    root.position.x += 0.12;
    simulate(root, system, 4);
    root.updateMatrixWorld(true);

    // 外力停止後再跑幾幀：有動量的布料還在動，被掐死的布料早就靜止了。
    const before = deviation(bones[1]);
    simulate(root, system, 6);
    const after = deviation(bones[1]);
    expect(Math.abs(after - before)).toBeGreaterThan(1e-4);
  });

  it("最終仍然收斂，不會永遠震盪", () => {
    const { root, bones } = makeChain(4, "裙_0");
    const system = new SpringBoneSystem([bones]);
    simulate(root, system, 60);
    root.position.x += 0.5;
    simulate(root, system, 6);
    const swung = deviation(bones[0]);

    simulate(root, system, 900);
    expect(deviation(bones[0])).toBeLessThan(swung / 10);
  });

  // 髮尾抖動的回歸防線：長髮被重力拉到偏轉上限之後，姿勢應該停在上限不動。
  // 若夾限只作用在輸出的旋轉、沒有寫回積分器的尾端狀態，積分器每一步都會再
  // 往上限外衝、再被夾回來，肉眼看到的就是髮尾持續高頻抖動。
  it("頂到偏轉上限之後髮尾要靜止，不能持續抖動", () => {
    const { root, bones } = makeChain(10, "hair");
    const system = new SpringBoneSystem([bones]);

    // 把整條鏈傾斜，讓重力方向與靜止方向差很多，末端關節必定頂到上限。
    root.rotation.z = Math.PI / 3;
    simulate(root, system, 900);

    const tip = bones[bones.length - 1];
    let previous = deviation(tip);
    let maxFrameChange = 0;
    for (let i = 0; i < 180; i++) {
      root.updateMatrixWorld(true);
      system.update(1 / 60);
      const current = deviation(tip);
      maxFrameChange = Math.max(maxFrameChange, Math.abs(current - previous));
      previous = current;
    }

    expect(maxFrameChange).toBeLessThan(1e-4);
  });

  it("各部位的擺幅上限不同：紗帶比胸口鬆得多", () => {
    const build = (name: string) => {
      const { root, bones } = makeChain(3, name);
      const system = new SpringBoneSystem([bones]);
      simulate(root, system, 60);
      root.position.x += 0.6;
      simulate(root, system, 8);
      return deviation(bones[0]);
    };
    expect(build("帶_0")).toBeGreaterThan(build("胸_0"));
  });
});

// 這一組是「裙子刺進腿裡」的回歸防線。先前查不到 PMX 遮罩的骨頭一律套 0，
// 等於完全不做碰撞，而一條鏈裡常有好幾節沒有對應剛體。
describe("碰撞", () => {
  /**
   * 把一顆球擺在裙襬側面（模擬大腿），跑完之後回報末端骨頭與球心的距離。
   * mask 傳 undefined 代表「PMX 沒有這節的剛體紀錄」——正是先前會整節失去
   * 碰撞的情況。
   */
  function runWithBlocker(mask?: number): number {
    const { root, bones } = makeChain(3, "裙_0");
    const blocker = new THREE.Bone();
    // 綁定姿勢時球要在鏈的外面：一開始就包住骨頭的碰撞體會被視為
    // 「作者本來就把布料放在裡面」而不推開（見 measureBindClearances）。
    blocker.position.set(0.24, -0.2, 0);
    root.add(blocker);
    root.updateMatrixWorld(true);

    const collisionMask = new Map<THREE.Bone, number>();
    if (mask !== undefined) for (const b of bones) collisionMask.set(b, mask);

    const system = new SpringBoneSystem([bones], [makeCollider(blocker, 0.14)], collisionMask);

    // 建好之後才把球壓進來，等同大腿抬起來撞進裙子。
    blocker.position.set(0.06, -0.2, 0);
    root.updateMatrixWorld(true);
    expect(system.colliderCount).toBe(1);
    simulate(root, system, 180);
    root.updateMatrixWorld(true);

    const tail = new THREE.Vector3().setFromMatrixPosition(bones[2].matrixWorld);
    const centre = new THREE.Vector3().setFromMatrixPosition(blocker.matrixWorld);
    return tail.distanceTo(centre);
  }

  it("沒有遮罩紀錄的骨頭仍然會被碰撞體推開", () => {
    const withoutRecord = runWithBlocker(undefined);
    const explicitlyDisabled = runWithBlocker(0);

    // 查不到紀錄時要比「明確關閉碰撞」推得更開，否則就是又回到穿模的狀態。
    expect(withoutRecord).toBeGreaterThan(explicitlyDisabled);
  });

  it("明確關閉碰撞的骨頭仍然可以不碰（作者刻意的設定要被尊重）", () => {
    expect(runWithBlocker(0)).toBeLessThan(runWithBlocker(0xffff));
  });

  it("尾端持續壓在碰撞體上時不該走走停停地抖", () => {
    const { root, bones } = makeChain(6, "hair");
    // 把球放在鏈的正下方，讓髮尾一路垂下來就會壓在上面（持續接觸）
    const blocker = new THREE.Bone();
    blocker.position.set(0, -0.45, 0);
    root.add(blocker);
    root.updateMatrixWorld(true);

    const system = new SpringBoneSystem([bones], [makeCollider(blocker, 0.2)]);
    simulate(root, system, 300); // 先讓它落到接觸狀態並安定下來

    // 模擬頭部左右轉動
    const tip = bones[bones.length - 1];
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 300; i++) {
      root.position.x = Math.sin(i / 18) * 0.05;
      root.updateMatrixWorld(true);
      system.update(1 / 60);
      root.updateMatrixWorld(true);
      positions.push(new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld));
    }

    const velocities = positions
      .slice(1)
      .map((p, i) => p.clone().sub(positions[i]));
    let reversals = 0;
    for (let i = 1; i < velocities.length; i++) {
      if (velocities[i].dot(velocities[i - 1]) < 0) reversals++;
    }
    const reversalRate = reversals / (velocities.length - 1);

    // 平順的擺動每個週期才反向兩次（約 2%）；實機壞掉時是 38%。
    expect(reversalRate).toBeLessThan(0.12);
  });

  // 實機量到的病徵：頭部轉動時，長髮末端速度的自相關 lag1 = -0.78、方向反轉率
  // 38%（其他骨鏈只有 1~3%）——這是「每一幀交替」的指紋。來源是固定步長累加器：
  // 步長 1/60、畫面也是 60Hz，相位一漂就變成「這幀 0 步、下幀 2 步」，
  // 頭在連續轉動，頭髮卻在不動與走雙倍之間跳。
  //
  // 現在改成直接吃每幀的實際時間，阻尼與各項上限都以 1/60 正規化，
  // 所以步長忽長忽短也不該產生交替。
  it("畫面步長忽長忽短時，插值後的姿勢仍然平順（不會每幀交替）", () => {
    const { root, bones } = makeChain(6, "hair");
    const system = new SpringBoneSystem([bones]);
    const scheduler = new FixedStepScheduler();

    // 這裡刻意測「物理 + 排程 + 插值」的組合，因為抖動就發生在這個介面上：
    // 單看 update() 是穩定的，是「固定步長的物理」直接畫到「更新率不同的畫面」
    // 才產生每幀交替。
    const advance = (frameSeconds: number): void => {
      let step = scheduler.advance(frameSeconds);
      while (step > 0) {
        root.updateMatrixWorld(true);
        system.update(step);
        step = scheduler.advance(0);
      }
      system.applyInterpolated(scheduler.alpha);
      root.updateMatrixWorld(true);
    };

    for (let i = 0; i < 120; i++) advance(1 / 60);

    const tip = bones[bones.length - 1];
    const positions: THREE.Vector3[] = [];
    let elapsed = 0;
    for (let i = 0; i < 300; i++) {
      const frame = i % 2 === 0 ? 0.012 : 0.022;
      elapsed += frame;
      root.position.x = Math.sin(elapsed * 3) * 0.05;
      advance(frame);
      positions.push(new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld));
    }

    const velocities = positions.slice(1).map((p, i) => p.clone().sub(positions[i]));
    let dotSum = 0;
    let magSum = 0;
    for (let i = 1; i < velocities.length; i++) {
      dotSum += velocities[i].dot(velocities[i - 1]);
      magSum += velocities[i - 1].lengthSq();
    }
    // 自相關 lag1：平順時為正，每幀交替時是明顯的負值（實機壞掉時 -0.78）。
    expect(dotSum / magSum).toBeGreaterThan(0);
  });
});

// 「裙子不會飄」修好之後浮現的下一個問題：髮尾亂甩。
//
// 注意這裡要斷言的不是「尾端轉得比根部少」——甩尾的本質就是越往末端越
// 追不上，尾端本來就會頂到自己的上限。要保證的是**那個上限沿著鏈收緊**，
// 尾端的可動範圍遠小於根部，這樣才是甩尾而不是亂抖。
describe("長骨鏈的末端要收斂", () => {
  /** 頭髮的基準上限（見 PARAM_PRESETS）與末端收緊係數（1 - 0.55）。 */
  const HAIR_MAX_DEFLECTION = 0.40;
  const TIP_TAPER = 0.45;

  function swingAndMeasure(name: string, joints: number): number[] {
    const { root, bones } = makeChain(joints, name);
    const system = new SpringBoneSystem([bones]);
    simulate(root, system, 60);
    root.position.x += 0.6;
    simulate(root, system, 10);
    return bones.map(deviation);
  }

  it("髮尾的單節偏轉被收緊到基準值的一半以下", () => {
    const devs = swingAndMeasure("髪", 10);
    const tip = devs[devs.length - 1];
    // 收緊前是 0.55 rad（31.5°）；現在末端上限約 0.18 rad（10.3°）。
    expect(tip).toBeLessThanOrEqual(HAIR_MAX_DEFLECTION * TIP_TAPER + 1e-6);
  });

  it("鏈上每一節都不超過自己那一節的上限", () => {
    const devs = swingAndMeasure("髪", 10);
    devs.forEach((dev, i) => {
      const depthRatio = Math.min(i / 5, 1);
      const cap = HAIR_MAX_DEFLECTION * (1 - depthRatio * 0.55);
      expect(dev).toBeLessThanOrEqual(cap + 1e-6);
    });
  });

  it("髮根仍然擺得起來，不是又被整條掐死", () => {
    const devs = swingAndMeasure("髪", 10);
    // 舊版全域上限是 0.08 rad，超過它就代表沒有回到當初那種凍住的狀態。
    expect(devs[0]).toBeGreaterThan(0.08);
  });

  it("長髮最終仍然收斂回靜止姿勢", () => {
    const { root, bones } = makeChain(10, "髪");
    const system = new SpringBoneSystem([bones]);
    simulate(root, system, 60);
    root.position.x += 0.6;
    simulate(root, system, 10);
    const swung = deviation(bones[0]);

    simulate(root, system, 1200);
    expect(deviation(bones[0])).toBeLessThan(swung / 10);
    for (const bone of bones) expect(Number.isFinite(bone.quaternion.x)).toBe(true);
  });
});

describe("碰撞體只擋新的侵入，不驅逐一開始就在裡面的布料", () => {
  /** 造一顆球形碰撞體，掛在可移動的骨頭上。 */
  function makeCollider(center: THREE.Vector3, radius: number) {
    const bone = new THREE.Bone();
    bone.position.copy(center);
    bone.updateMatrixWorld(true);
    return {
      bone,
      shape: "sphere" as const,
      radius,
      height: 0,
      offset: new THREE.Vector3(),
      axis: new THREE.Vector3(0, 1, 0),
      group: 0,
    };
  }

  it("綁定姿勢就在碰撞體內部的關節不會被推出去", () => {
    // 裙子的骨架是一圈套在髖部外的籠子，前幾圈本來就位在下半身碰撞體裡面。
    // 照一般規則每幀都會被推出去：實測整件裙子的半徑被撐大 35%、下襬朝天。
    const { root, bones } = makeChain(4, "裙_0");
    const collider = makeCollider(new THREE.Vector3(0, -0.2, 0), 0.5);
    const system = new SpringBoneSystem([bones], [collider]);

    simulate(root, system, 90);

    for (const bone of bones) {
      expect(deviation(bone), `${bone.name} 被碰撞體頂開`).toBeLessThan(0.05);
    }
  });

  it("碰撞體移進來時仍然會把布料推開", () => {
    const { root, bones } = makeChain(4, "裙_0");
    const collider = makeCollider(new THREE.Vector3(0.6, -0.2, 0), 0.25);
    const system = new SpringBoneSystem([bones], [collider]);
    simulate(root, system, 60);
    const before = deviation(bones[1]);

    // 碰撞體往骨鏈壓過來（等同抬腿時大腿撞進裙子）
    collider.bone.position.x = 0.05;
    collider.bone.updateMatrixWorld(true);
    simulate(root, system, 30);

    expect(deviation(bones[1])).toBeGreaterThan(before + 0.02);
  });
});
