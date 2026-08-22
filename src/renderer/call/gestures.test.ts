import { describe, it, expect } from "vitest";
import {
  GESTURE_CONFIGS,
  calculateGestureEnvelope,
  sampleGestureOffsets,
  smootherStep,
  type CyreneGestureName,
} from "./gestures";

describe("Procedural Gesture System (22 Gestures)", () => {
  it("smootherStep returns smooth [0, 1] range with zero initial slope", () => {
    expect(smootherStep(-0.5)).toBe(0);
    expect(smootherStep(0)).toBe(0);
    expect(smootherStep(0.5)).toBe(0.5);
    expect(smootherStep(1)).toBe(1);
    expect(smootherStep(1.5)).toBe(1);
  });

  it("calculates gesture envelope through attack, sustain, and release", () => {
    const duration = 2.0;
    const attack = 0.4;
    const release = 0.5;

    expect(calculateGestureEnvelope(0, duration, attack, release)).toEqual({
      progress: 0,
      weight: 0,
      isDone: false,
    });

    const inAttack = calculateGestureEnvelope(0.2, duration, attack, release);
    expect(inAttack.progress).toBeCloseTo(0.1);
    expect(inAttack.weight).toBeGreaterThan(0);
    expect(inAttack.weight).toBeLessThan(1);
    expect(inAttack.isDone).toBe(false);

    const inSustain = calculateGestureEnvelope(1.0, duration, attack, release);
    expect(inSustain.progress).toBeCloseTo(0.5);
    expect(inSustain.weight).toBe(1);
    expect(inSustain.isDone).toBe(false);

    const inRelease = calculateGestureEnvelope(1.75, duration, attack, release);
    expect(inRelease.progress).toBeCloseTo(0.875);
    expect(inRelease.weight).toBeGreaterThan(0);
    expect(inRelease.weight).toBeLessThan(1);
    expect(inRelease.isDone).toBe(false);

    const done = calculateGestureEnvelope(2.1, duration, attack, release);
    expect(done.isDone).toBe(true);
    expect(done.weight).toBe(0);
  });

  const allGestures: CyreneGestureName[] = [
    "wave",
    "nod",
    "shakeHead",
    "think",
    "handsOnHeart",
    "bow",
    "cheer",
    "clap",
    "listen",
    "headScratch",
    "stretch",
    "gasp",
    "salute",
    "raiseHand",
    "tiltHead",
    "angry",
    "shyBlush",
    "sweat",
    "winkHeart",
    "yawn",
    "proud",
    "pray",
  ];

  allGestures.forEach((name) => {
    it(`samples offsets properly for gesture: ${name}`, () => {
      const config = GESTURE_CONFIGS[name];
      expect(config).toBeDefined();

      expect(sampleGestureOffsets(name, 0)).toBeNull();

      const midTime = config.duration * 0.5;
      const midOffsets = sampleGestureOffsets(name, midTime);
      expect(midOffsets).not.toBeNull();

      const afterTime = config.duration + 0.1;
      expect(sampleGestureOffsets(name, afterTime)).toBeNull();
    });
  });

  it("angry gesture configures both arms onto hips", () => {
    const off = sampleGestureOffsets("angry", 0.6);
    expect(off?.leftElbow?.z).toBeLessThan(-0.5);
    expect(off?.rightElbow?.z).toBeGreaterThan(0.5);
  });

  it("害羞是雙手背在身後，不是雙手捧臉", () => {
    const off = sampleGestureOffsets("shyBlush", 0.6);
    // 手交給 IK 目標，落點在臀部後方
    expect(off?.leftHandTarget?.anchor).toBe("buttocksL");
    expect(off?.rightHandTarget?.anchor).toBe("buttocksR");
    // 這個動作不該再自己寫死手臂偏移（會跟 IK 目標打架）
    expect(off?.leftArm).toBeUndefined();
    expect(off?.rightArm).toBeUndefined();
    // 身體是「縮小」的：低頭、偏開視線、含胸
    expect(off?.head?.x).toBeGreaterThan(0);
    expect(off?.head?.y).toBeLessThan(0);
    expect(off?.chest?.x).toBeGreaterThan(0);
  });

  it("生氣與得意的軀幹方向相反（剪影才分得開）", () => {
    const angry = sampleGestureOffsets("angry", 0.6);
    const proud = sampleGestureOffsets("proud", 0.6);
    // 兩個都是叉腰、手的落點幾乎一樣，差異必須做在軀幹上：
    // 生氣往前傾（+），得意往後仰（−）。
    expect(angry?.spine?.x ?? 0).toBeGreaterThan(0);
    expect(proud?.spine?.x ?? 0).toBeLessThan(0);
    // 生氣要聳肩，幅度明顯大於得意
    expect(Math.abs(angry?.leftShoulder?.y ?? 0)).toBeGreaterThan(
      Math.abs(proud?.leftShoulder?.y ?? 0)
    );
  });

  it("sweat gesture moves right hand towards forehead to wipe", () => {
    const off = sampleGestureOffsets("sweat", 0.6);
    expect(off?.rightArm?.x).toBeGreaterThan(0.5);
    expect(off?.rightElbow?.z).toBeGreaterThan(1.0);
  });

  it("winkHeart gesture moves hand forward with pulse", () => {
    const off = sampleGestureOffsets("winkHeart", 0.6);
    expect(off?.rightArm?.x).toBeGreaterThan(0.3);
    expect(off?.rightElbow?.z).toBeGreaterThan(1.0);
  });

  it("pray gesture brings hands together in front of chest", () => {
    const off = sampleGestureOffsets("pray", 0.6);
    expect(off?.leftArm?.x).toBeGreaterThan(0.3);
    expect(off?.rightArm?.x).toBeGreaterThan(0.3);
  });

  it("每個手勢都會給手型（沒指定的用待機手型）", () => {
    for (const name of Object.keys(GESTURE_CONFIGS) as CyreneGestureName[]) {
      const off = sampleGestureOffsets(name, GESTURE_CONFIGS[name].duration * 0.5);
      expect(off?.leftHand, name).toBeDefined();
      expect(off?.rightHand, name).toBeDefined();
    }
  });

  it("cheer 握拳：手指比待機彎得多", () => {
    const relaxed = sampleGestureOffsets("nod", 0.6)?.rightHand?.curl?.index ?? 0;
    const fist = sampleGestureOffsets("cheer", 0.9)?.rightHand?.curl?.index ?? 0;
    expect(fist).toBeGreaterThan(relaxed + 0.3);
  });

  it("raiseHand 只伸出食指", () => {
    const hand = sampleGestureOffsets("raiseHand", 1.1)?.rightHand;
    expect(hand?.curl?.index ?? 1).toBeLessThan(0.25);
    expect(hand?.curl?.middle ?? 0).toBeGreaterThan(0.6);
  });

  it("手指比手臂晚到位", () => {
    // 起手瞬間手臂已經在動，手指還維持待機手型。
    const early = sampleGestureOffsets("cheer", 0.18);
    expect(Math.abs(early?.rightArm?.x ?? 0)).toBeGreaterThan(0.01);
    expect(early?.rightHand?.curl?.index ?? 1).toBeLessThan(0.45);
  });

  it("bow 會帶動骨盆與膝蓋", () => {
    const off = sampleGestureOffsets("bow", 0.9);
    expect(off?.lowerBody?.x ?? 0).toBeGreaterThan(0.02);
    expect(off?.leftKnee?.x ?? 0).toBeGreaterThan(0);
    // 兩腳略有差異，才不會像立正。
    expect(off?.rightKnee?.x).not.toBe(off?.leftKnee?.x);
  });

  it("沒有腿部設定的手勢只有極小的重心偏移", () => {
    // 身體參與層會給每個動作一點重心轉移（見 GESTURE_BODY）——站姿完全對稱
    // 就是立正。但沒指定腿部動作的手勢，幅度必須小到只是「放鬆站著」。
    const off = sampleGestureOffsets("nod", 0.6);
    const deg = (v?: number): number => Math.abs(v ?? 0) * (180 / Math.PI);
    expect(deg(off?.lowerBody?.z)).toBeLessThan(3);
    expect(deg(off?.leftKnee?.x)).toBeLessThan(7);
    expect(deg(off?.rightKnee?.x)).toBeLessThan(7);
  });

  it("動作自帶的表情在峰值出得來、播完就收乾淨", () => {
    // 表情是這些動作辨識度的一半（打哈欠不張嘴就只是把手放在臉旁邊），
    // 而且一定要收乾淨 —— 沒收的話她會頂著一張哈欠臉講完接下來整段話。
    const peak = sampleGestureOffsets("yawn", GESTURE_CONFIGS.yawn.duration * 0.5);
    expect(peak?.morphs?.["大口"] ?? 0).toBeGreaterThan(0.5);
    expect(peak?.morphs?.["まばたき"] ?? 0).toBeGreaterThan(0.7);

    // 播完之後取樣直接回 null，viewer 就會把上一幀寫過的 morph 歸零。
    expect(sampleGestureOffsets("yawn", GESTURE_CONFIGS.yawn.duration + 0.3)).toBeNull();
  });

  it("表情跟著動作的包絡線淡入，不是一開始就整張臉切過去", () => {
    const dur = GESTURE_CONFIGS.gasp.duration;
    const early = sampleGestureOffsets("gasp", 0.02)?.morphs?.["！"] ?? 0;
    const mid = sampleGestureOffsets("gasp", dur * 0.5)?.morphs?.["！"] ?? 0;
    expect(early).toBeLessThan(mid * 0.5);
    expect(mid).toBeGreaterThan(0.5);
  });

  it("哈欠的嘴是先張開再閉起來，不是一路開到底", () => {
    const dur = GESTURE_CONFIGS.yawn.duration;
    const open = sampleGestureOffsets("yawn", dur * 0.5)?.morphs?.["大口"] ?? 0;
    const late = sampleGestureOffsets("yawn", dur * 0.9)?.morphs?.["大口"] ?? 0;
    expect(open).toBeGreaterThan(0.5);
    expect(late).toBeLessThan(open * 0.5);
  });

  it("翻腕時前臂扭轉骨分掉一部分角度", () => {
    const off = sampleGestureOffsets("wave", 0.9);
    const wristY = off?.rightWrist?.y ?? 0;
    expect(Math.abs(wristY)).toBeGreaterThan(0.01);
    expect(off?.rightForearmTwist).toBeCloseTo(wristY * 0.55, 6);
    // 前臂分得比上臂多。
    expect(Math.abs(off?.rightForearmTwist ?? 0)).toBeGreaterThan(
      Math.abs(off?.rightArmTwist ?? 0)
    );
  });
});
