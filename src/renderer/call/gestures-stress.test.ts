import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  GESTURE_CONFIGS,
  sampleGestureOffsets,
  calculateGestureEnvelope,
  type CyreneGestureName,
} from "./gestures";
import {
  blinkSafeWinkWeight,
  expressionBeatWeight,
  type AvatarMood,
} from "./vrm-viewer";

describe("Gestures & Expressions Stress & Stability Tests (22 Gestures & 20 Moods)", () => {
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

  const allMoods: AvatarMood[] = [
    "neutral",
    "happy",
    "shy",
    "thinking",
    "surprised",
    "sad",
    "wink",
    "smug",
    "talking",
    "pout",
    "excited",
    "sleepy",
    "curious",
    "angry",
    "shyBlush",
    "sweat",
    "winkHeart",
    "yawn",
    "proud",
    "pray",
  ];

  describe("1. Continuity & Boundary Verification", () => {
    it("all 22 gestures start and end cleanly with zero / null offsets (no residual displacement)", () => {
      for (const name of allGestures) {
        const config = GESTURE_CONFIGS[name];
        expect(sampleGestureOffsets(name, 0)).toBeNull();

        const start = sampleGestureOffsets(name, 0.001);
        if (start) {
          // 只看旋轉偏移的數值。手部目標（leftHandTarget）帶著定位點名稱這種
          // 字串欄位，一起丟進 Math.max 會得到 NaN；手型則是 0~1 的抽象量，
          // 不是弧度，也不該拿同一把尺量。
          const rotationKeys = [
            "head", "neck", "spine", "chest",
            "leftShoulder", "rightShoulder", "leftArm", "rightArm",
            "leftElbow", "rightElbow", "leftWrist", "rightWrist",
            "lowerBody", "leftLeg", "rightLeg", "leftKnee", "rightKnee",
            "leftFoot", "rightFoot", "eyes",
          ] as const;
          const values = rotationKeys.flatMap((key) => {
            const v = (start as Record<string, unknown>)[key];
            return v && typeof v === "object" ? Object.values(v as Record<string, number>) : [];
          });
          const maxStartVal = values.length > 0 ? Math.max(...values.map(Math.abs)) : 0;
          expect(maxStartVal).toBeLessThan(0.1);
        }

        expect(sampleGestureOffsets(name, config.duration + 0.01)).toBeNull();
      }
    });

    it("all gesture offsets contain only finite, non-NaN numbers at 60 FPS", () => {
      const dt = 1 / 60;
      let invalidCount = 0;
      for (const name of allGestures) {
        const config = GESTURE_CONFIGS[name];
        const steps = Math.ceil(config.duration / dt) + 5;

        for (let i = 0; i <= steps; i++) {
          const t = i * dt;
          const offsets = sampleGestureOffsets(name, t);
          if (offsets) {
            // 手型（leftHand / rightHand）不是旋轉，是 0~1 的抽象量，而且自己
            // 還帶一層 curl 物件，所以要跟旋轉偏移分開檢查。
            for (const [key, val] of Object.entries(offsets)) {
              if (key === "leftHandTarget" || key === "rightHandTarget") {
                // 手的目標位置：定位點是字串，位移與掌心方向是公尺／方向向量，
                // 都不是旋轉，不能拿旋轉的標準（< π）去驗。
                const target = val as {
                  anchor: string;
                  weight: number;
                  offset?: Record<string, number>;
                  palm?: Record<string, number>;
                };
                if (typeof target.anchor !== "string" || target.anchor.length === 0) invalidCount++;
                if (!Number.isFinite(target.weight) || target.weight < 0 || target.weight > 1) {
                  invalidCount++;
                }
                for (const v of Object.values(target.offset ?? {})) {
                  // 位移是相對定位點的微調，超過 20cm 就是定位點選錯了。
                  if (!Number.isFinite(v) || Math.abs(v) > 0.2) invalidCount++;
                }
                for (const v of Object.values(target.palm ?? {})) {
                  if (!Number.isFinite(v)) invalidCount++;
                }
              } else if (key === "leftHand" || key === "rightHand") {
                const pose = val as { curl?: Record<string, number>; spread?: number };
                for (const curl of Object.values(pose.curl ?? {})) {
                  if (!Number.isFinite(curl) || curl < 0 || curl > 1) invalidCount++;
                }
                const spread = pose.spread ?? 0;
                if (!Number.isFinite(spread) || Math.abs(spread) > 1) invalidCount++;
              } else if (typeof val === "number") {
                if (!Number.isFinite(val) || Number.isNaN(val)) invalidCount++;
              } else if (typeof val === "object" && val !== null) {
                for (const [, angle] of Object.entries(val)) {
                  if (!Number.isFinite(angle) || Number.isNaN(angle) || Math.abs(angle as number) >= Math.PI) {
                    invalidCount++;
                  }
                }
              }
            }
          }
        }
      }
      expect(invalidCount).toBe(0);
    });
  });

  describe("2. Extreme Delta Times & Frame Drops", () => {
    it("handles extreme frame lag without exploding or crashing", () => {
      const extremeDeltas = [-1, 0, 0.00001, 0.5, 1.0, 5.0, 100.0];
      for (const name of allGestures) {
        for (const dt of extremeDeltas) {
          expect(() => sampleGestureOffsets(name, dt)).not.toThrow();
        }
      }
    });

    it("calculateGestureEnvelope never produces negative weight or NaN", () => {
      const testTimes = [-10, -0.001, 0, 0.1, 0.5, 1.0, 1.99, 2.0, 2.001, 100];
      for (const t of testTimes) {
        const env = calculateGestureEnvelope(t, 2.0, 0.4, 0.5);
        expect(env.weight).toBeGreaterThanOrEqual(0);
        expect(env.weight).toBeLessThanOrEqual(1);
        expect(Number.isFinite(env.weight)).toBe(true);
        expect(Number.isNaN(env.weight)).toBe(false);
      }
    });
  });

  describe("3. Facial Morph Weights & Winking Safety", () => {
    it("blinkSafeWinkWeight prevents eye clipping when smiling or blinking simultaneously", () => {
      const wink = blinkSafeWinkWeight(1.0, 0, 1.0);
      expect(wink).toBe(0);

      expect(blinkSafeWinkWeight(1.0, 0, 0.8)).toBeCloseTo(0.2);

      const normalWink = blinkSafeWinkWeight(1.0, 0, 0);
      expect(normalWink).toBe(1.0);

      const partialWink = blinkSafeWinkWeight(1.0, 0.3, 0);
      expect(partialWink).toBeCloseTo(0.7);
    });

    it("expressionBeatWeight produces smooth zero-ended curve", () => {
      const shape = { attack: 0.1, hold: 0.15, release: 0.2, peak: 1.0 };
      const duration = shape.attack + shape.hold + shape.release;

      expect(expressionBeatWeight(shape, 0)).toBe(0);
      expect(expressionBeatWeight(shape, 0.15)).toBe(1.0);
      expect(expressionBeatWeight(shape, duration)).toBe(0);
      expect(expressionBeatWeight(shape, duration + 0.1)).toBe(0);
    });
  });

  describe("4. Simulated 3D Skeleton Pipeline", () => {
    it("simulates full gesture playback on Three.js Bones without drift or distortion", () => {
      const bones = new Map<string, THREE.Bone>();
      const boneNames = [
        "上半身",
        "上半身2",
        "首",
        "頭",
        "左肩",
        "右肩",
        "左腕",
        "右腕",
        "左ひじ",
        "右ひじ",
        "左手首",
        "右手首",
      ];

      const root = new THREE.Object3D();
      for (const bName of boneNames) {
        const b = new THREE.Bone();
        b.name = bName;
        root.add(b);
        bones.set(bName, b);
      }

      const dt = 0.1;
      for (const gesture of allGestures) {
        const config = GESTURE_CONFIGS[gesture];
        const frames = Math.ceil(config.duration / dt) + 2;

        for (let f = 0; f < frames; f++) {
          const elapsed = f * dt;
          const offsets = sampleGestureOffsets(gesture, elapsed);

          if (offsets) {
            if (offsets.head) {
              const head = bones.get("頭")!;
              head.rotation.x = offsets.head.x ?? 0;
              head.rotation.y = offsets.head.y ?? 0;
              head.rotation.z = offsets.head.z ?? 0;
            }
            if (offsets.rightArm) {
              const rArm = bones.get("右腕")!;
              rArm.rotation.x = offsets.rightArm.x ?? 0;
              rArm.rotation.y = offsets.rightArm.y ?? 0;
              rArm.rotation.z = offsets.rightArm.z ?? 0;
            }
          }

          root.updateMatrixWorld(true);

          for (const bone of bones.values()) {
            for (const el of bone.matrixWorld.elements) {
              expect(Number.isFinite(el)).toBe(true);
              expect(Number.isNaN(el)).toBe(false);
            }
          }
        }
      }
    }, 30000);

    it("simulates rapid gesture switching (interruptions) without breaking matrix hierarchy", () => {
      const root = new THREE.Object3D();
      const rightArm = new THREE.Bone();
      rightArm.name = "右腕";
      root.add(rightArm);

      const sequence: CyreneGestureName[] = [
        "wave",
        "angry",
        "shyBlush",
        "sweat",
        "winkHeart",
        "yawn",
        "salute",
        "clap",
      ];
      for (let i = 0; i < 60; i++) {
        const gName = sequence[i % sequence.length];
        const off = sampleGestureOffsets(gName, 0.05 * (i % 5));
        if (off?.rightArm) {
          rightArm.rotation.set(off.rightArm.x ?? 0, off.rightArm.y ?? 0, off.rightArm.z ?? 0);
        }
        root.updateMatrixWorld(true);
        for (const el of rightArm.matrixWorld.elements) {
          expect(Number.isFinite(el)).toBe(true);
        }
      }
    });
  });
});
