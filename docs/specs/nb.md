# 怎麼量出 3D 動作的準確位置

這份文件說明一件事：**在昔漣的 3D 模型上，怎麼確定「手真的比到了該比的地方」。**
不需要先讀其他文件，照著做就能重現。

相關程式碼都在 `src/renderer/call/`。

---

## 1. 問題：手寫的角度沒有人驗證過

原本 22 個手勢都是直接寫每根骨頭的 euler 旋轉：

```ts
offsets.rightArm  = { x: 0.62, y: -0.32, z: -0.72 };
offsets.rightElbow = { x: -0.28, y: -0.55, z: 1.50 };
```

要讓手碰到臉頰，得同時猜對三根骨頭 × 三個軸的複合旋轉。而且這個模型在載入時
經過鏡像座標轉換，左右手的軸向相反，猜錯的方向也相反。

實際量出來的結果（手腕的世界座標）：

| 動作 | 手腕落點 | 應該在 | 差距 |
|---|---|---|---|
| 摀臉害羞 | y=1.19（胸口） | 臉頰 y=1.42 | 25cm |
| 掩口驚訝 | y=1.25 | 嘴巴 y=1.41 | 25cm |
| 歡呼 | y=1.15（比肩膀還低） | 頭側 y=1.55 | 41cm |
| 拍手 | 左手 x=−0.04、右手 x=+0.04 | 兩手交叉穿過了對方 | — |
| 叉腰 | 身體正前方 | 髖部 x=±0.11 | 20cm |
| 敬禮 | 離頭 22cm | 太陽穴 ≈7cm | 21cm |

**這些錯誤在程式碼裡完全看不出來。** 只有量位置才看得到。

---

## 2. 方法：在 node 裡讀真模型量座標

`src/renderer/call/skeleton-fixture.ts` 會直接從硬碟讀 PMX 檔，只建骨頭階層，
不建網格、不碰 WebGL、不需要瀏覽器。座標轉換與 `pmx-loader.ts` 完全一致
（同樣把身高正規化到 1.65、X/Z 置中、腳底貼 0），所以量到的數字就是畫面上的數字。

```ts
import { loadSkeletonFixture } from "./skeleton-fixture";

const fx = loadSkeletonFixture();
fx.worldOf("左手首");   // → THREE.Vector3，骨頭的世界座標
fx.reset();             // 回到綁定姿勢
fx.update();            // 更新世界矩陣並套用付与（腿要靠這個才會動）
```

### 鐵則：擺姿勢一定要走 `pose-composer.ts`

`applyArmPose()` / `applyLegPose()` 是**唯一**一份「把手勢偏移寫進骨頭」的實作，
畫面與測試都走它。如果量測程式自己另外寫一套，量到的就是另一個東西 ——
量得再準也不代表畫面上是那樣。

這也是為什麼這份邏輯當初要從 `vrm-viewer.ts` 拆出來。

### 可直接複製的探針

存成 `src/renderer/call/__probe.test.ts`，調完就刪掉：

```ts
import { describe, it } from "vitest";
import * as THREE from "three";
import { loadSkeletonFixture } from "./skeleton-fixture";
import { buildHandRig, buildTwistRig } from "./hand-pose";
import { buildArmChain } from "./arm-ik";
import { buildBodyAnchors, type AnchorName } from "./body-anchors";
import { applyArmPose, applyLegPose, REST_ARM_POSE, type PoseRigs } from "./pose-composer";
import { GESTURE_CONFIGS, sampleGestureOffsets, type CyreneGestureName } from "./gestures";

describe("probe", () => {
  it("每個手勢的手落在哪裡", () => {
    const fx = loadSkeletonFixture();
    const anchors = buildBodyAnchors(fx.bones);
    const rigs: PoseRigs = {
      hands: { left: buildHandRig(fx.bones, "left"), right: buildHandRig(fx.bones, "right") },
      twists: {
        leftArm: buildTwistRig(fx.bones, "左腕捩", "左腕", "左ひじ"),
        rightArm: buildTwistRig(fx.bones, "右腕捩", "右腕", "右ひじ"),
        leftForearm: buildTwistRig(fx.bones, "左手捩", "左ひじ", "左手首"),
        rightForearm: buildTwistRig(fx.bones, "右手捩", "右ひじ", "右手首"),
      },
      arms: { left: buildArmChain(fx.bones, "left"), right: buildArmChain(fx.bones, "right") },
      anchors,
      updateWorld: () => fx.update(),
    };
    const base = {
      left: { ...REST_ARM_POSE },
      right: { x: REST_ARM_POSE.x, y: -REST_ARM_POSE.y, z: -REST_ARM_POSE.z },
    };
    const point = new THREE.Vector3();

    for (const name of Object.keys(GESTURE_CONFIGS) as CyreneGestureName[]) {
      const offsets = sampleGestureOffsets(name, GESTURE_CONFIGS[name].duration * 0.5);
      fx.reset();
      applyLegPose(fx.bones, offsets);
      applyArmPose(fx.bones, rigs, offsets, base);
      fx.update();

      const parts: string[] = [];
      for (const side of ["left", "right"] as const) {
        const target = side === "left" ? offsets?.leftHandTarget : offsets?.rightHandTarget;
        if (!target) continue;
        anchors.resolve(target.anchor as AnchorName, point);
        point.x += target.offset?.x ?? 0;
        point.y += target.offset?.y ?? 0;
        point.z += target.offset?.z ?? 0;
        const wrist = fx.worldOf(side === "left" ? "左手首" : "右手首");
        const elbow = fx.worldOf(side === "left" ? "左ひじ" : "右ひじ");
        const shoulder = fx.worldOf(side === "left" ? "左腕" : "右腕");
        parts.push(
          `${side[0].toUpperCase()} 誤差=${(wrist.distanceTo(point) * 100).toFixed(1)}cm` +
          ` 肘高=${((elbow.y - shoulder.y) * 100).toFixed(0)}cm`
        );
      }
      const lw = fx.worldOf("左手首");
      const rw = fx.worldOf("右手首");
      console.log(
        name.padEnd(13),
        parts.join(" | ") || "(無手部目標)",
        `| Lx=${lw.x.toFixed(3)} Rx=${rw.x.toFixed(3)}`
      );
    }
  });
});
```

執行：

```bash
npx vitest run src/renderer/call/__probe.test.ts --reporter=verbose
```

修改後的實際輸出（節錄）：

```
wave          R 誤差=0.8cm 肘高=6cm    | Lx=0.138 Rx=-0.233
shyBlush      L 誤差=0.0cm 肘高=-1cm   | R 誤差=0.0cm 肘高=-1cm   | Lx=0.068 Rx=-0.068
cheer         L 誤差=0.0cm 肘高=8cm    | R 誤差=0.0cm 肘高=8cm    | Lx=0.125 Rx=-0.125
pray          L 誤差=0.0cm 肘高=-10cm  | R 誤差=0.0cm 肘高=-10cm  | Lx=0.022 Rx=-0.022
stretch       L 誤差=1.6cm 肘高=10cm   | R 誤差=1.6cm 肘高=10cm   | Lx=0.137 Rx=-0.137
nod           (無手部目標) | Lx=0.124 Rx=-0.124
```

（`stretch` 誤差 1.6cm 是刻意的：伸懶腰的定位點放在手臂極限外一點，
讓手臂真的拉直。`wave` 的 0.8cm 是因為目標本身在擺動。）

三個要一起看的指標：

- **誤差**：手腕離目標多遠。
- **肘高**：手肘相對肩膀的高度。正值太大＝雞翅膀姿勢（位置對但姿勢不對）。
- **Lx / Rx**：左手應該永遠在 +x、右手在 −x。符號相反＝兩手交叉穿模。

---

## 3. 這副骨架的實測數字

單位公尺，身高正規化為 1.65。+Z 是鏡頭方向，+X 是角色的左側。

```
頭 (0, 1.405, 0.260)      眼 (±0.014, 1.435, 0.280)     耳 (±0.040, 1.430, 0.261)
頸 (0, 1.364, 0.252)      頭頂髮飾 (0, 1.553, 0.191)     臉的正面約 z = 0.29 ~ 0.31
肩 (±0.009, 1.347, 0.264) 上臂根 (±0.055, 1.339, 0.254)
上半身2 (0, 1.265, 0.285) 下半身 (0, 1.196, 0.278)
膝 (±0.038, 0.925, 0.265) 腳踝 (±0.038, 0.690, 0.243)
```

### 最重要的一條限制：手臂總長只有 0.233

上臂 0.124 + 前臂 0.109。**定位點離上臂根超過這個距離，就永遠搆不到。**
IK 只會把手臂拉直，畫面上看起來像在用力伸卻碰不到東西。

實例：「舉手過頭頂」如果寫成 y=1.72，離上臂根 0.388，是搆不到的。
在這副骨架上「舉過頭」實際只到頭側 y≈1.55（離上臂根 0.224，剛好在極限內）。

驗收測試的第一項就在擋這件事：

```ts
expect(point.distanceTo(shoulder)).toBeLessThan(0.233 * 1.12);
```

---

## 4. 從「手要放到臉頰」到解出角度

量出問題之後，修法不是回去改 euler 數字（那還是在猜），而是換一種描述方式。

### 4.1 定位點：`body-anchors.ts`

25 個掛在骨頭上的身體位置。定義方式是「哪根骨頭 + 綁定姿勢下的座標」，
建立時自動換算成該骨頭的本地位移 —— 所以頭一轉，臉頰的定位點就跟著轉，
摀臉的手會追著臉走，而不是停在空中原本臉所在的位置。

```ts
cheekL:     { bone: "頭",      at: [0.050, 1.418, 0.288] },
templeR:    { bone: "頭",      at: [-0.058, 1.458, 0.272] },
chestFront: { bone: "上半身2",  at: [0, 1.298, 0.345] },
hipL:       { bone: "下半身",   at: [0.112, 1.185, 0.268] },
```

加新的定位點就照這個格式寫，座標用第 3 節的實測數字推。

### 4.2 目標：`gestures.ts` 的 `GESTURE_TARGETS`

```ts
shyBlush: {
  left: {
    anchor: "cheekL",
    offset: { x: 0.018, y: -0.010 },       // 相對定位點的微調
    palm: { x: -1, y: 0, z: -0.2 },        // 掌心朝哪（模型空間方向）
    elbowPole: { x: 0.25, y: -1, z: 0.55 },// 手肘朝哪
  },
  ...
},
```

還可以給 `motion: (elapsed) => ({ x, y, z })` 做揮手、拍手這類週期動作 ——
擺動掛在目標位置上，手臂會自然跟著晃。

### 4.3 解算：`arm-ik.ts`

CCD（Cyclic Coordinate Descent）：從手肘往肩膀方向逐一旋轉，每次讓
「關節→手腕」轉向「關節→目標」，來回二十幾輪收斂。鏈是 `肩 → 腕 → ひじ`，
末端是 `手首`。

三件配套的事：

- **種子姿勢**用原本手寫的 euler。那些數值決定手臂的「風格」（手肘往內收還是
  往外開、手臂從哪一側繞上去），是有意義的；從零解出來的姿勢位置對但很機械。
- **`applyElbowPole()`** 決定手肘繞轉方向。CCD 只管手腕落在哪，手肘可以繞著
  「上臂根→手腕」那條軸轉一整圈都不影響結果。繞的是通過手腕的軸，所以手腕位置
  完全不受影響。
- **`aimPalm()`** 用手指 rig 量出的掌心法線去對準指定方向。「揮手時掌心朝鏡頭」
  「摀臉時掌心朝自己」正是這些動作看不看得懂的關鍵。

---

## 5. 四個坑（每個都花了一輪才找到）

### 5.1 `q.identity().slerp(q, t)` 永遠不轉

```ts
tmpDelta.identity().slerp(tmpDelta, ratio);   // ❌ 完全無效
```

`identity()` 會先把 `tmpDelta` 本身清成單位四元數，接著變成「從單位插值到單位」。
這行讓 IK 對所有超過 0.45 弧度的旋轉靜默失效，**症狀是每個動作的誤差都卡在 20cm 上下**
—— 看起來像 IK 沒效果，其實是有跑但被清成不轉。

正確寫法（`arm-ik.ts` 的 `scaleRotation()`）：

```ts
tmpClampSource.copy(target);
target.identity().slerp(tmpClampSource, ratio);   // ✅ 先把來源存起來
```

### 5.2 CCD 迭代不足會停在半路

10 次迭代 × 單步上限 0.45 時，揮手途中有幾幀跑不完，手腕單幀位移 14cm。
現在是 22 次 × 0.55。改這兩個值必須重跑連續性測試。

### 5.3 逐幀重解會在多個解之間跳

同一個目標位置有無限多組手臂姿勢。種子姿勢隨著淡入權重在變，解就會在兩組之間跳，
畫面上是手臂瞬間換邊。

解法是 `ArmIKChain.previous`：用上一幀的解當這一幀的起點（warm start）。
**存的必須是還沒套手肘方向、也還沒混合權重的原始解** —— 存處理後的版本等於
把上一幀的處理結果再餵回自己一次，實測會讓抖動變嚴重（4cm → 6cm）。

### 5.4 位置對不代表姿勢對

一定要同時看肘高。修好位置之後第一次量，摸嘴、揮手的手肘都翹到肩膀上方 10cm ——
誤差 0.0cm，但那是雞翅膀。加了 pole 之後才降到合理範圍。

手臂朝上的動作（歡呼、舉手）要另外給 `elbowPole`：軸接近垂直時，「往下」在垂直於
軸的平面上幾乎沒有分量，預設值會失效。

---

## 6. 驗收

`src/renderer/call/gesture-reach.test.ts`，九項：

```bash
npx vitest run src/renderer/call/gesture-reach.test.ts
```

1. 每個定位點都在手臂搆得到的範圍內
2. 有指定目標的手實際誤差 < 3cm
3. 兩隻手不會交叉穿過對方（左手 x > 0、右手 x < 0）
4. 掌心朝向與指定方向差 < 20°
5. 手不會穿進頭裡（手腕離頭骨中心 > 5.5cm）
6. 動作結束後手回到身體兩側（< 1cm）
7. 揮手全程單幀位移：起手/收尾 < 6cm、維持期 < 2cm
8. 摸頭時頭往上迎、肩膀縮起
9. 摸頭時手收在胸前不擋臉

改任何跟手臂、手指、IK、定位點有關的東西，這九項都必須全過。

---

## 7. 驗證環境的限制（重要）

**Browser 預覽面板不會合成畫面。** `document.hidden` 恆為 true、
`requestAnimationFrame` 完全不觸發，連手動往 2D canvas 畫圖再截圖都不會更新。
3D 的視覺改動在那裡看不到。

所以上述全部是**幾何量測，不是目視**。到目前為止沒有人真的用眼睛看過這些動作。
如果你能跑起 Electron app 確認，那是現在最有價值的一件事：

```bash
open /Applications/昔漣桌寵.app     # 已打包安裝的版本
npm run dist:mac                    # 重新打包（自動簽章、驗證、安裝，不自動重啟）
```

---

## 8. 動手前

```bash
npx vitest run src/renderer/call/    # 146 項
npm run typecheck:renderer
```

檔案分工：

| 檔案 | 負責 |
|---|---|
| `gestures.ts` | 動作定義（身體 euler、手部目標、手型、腿） |
| `pose-composer.ts` | 唯一一份「把偏移寫進骨頭」的實作 |
| `arm-ik.ts` | CCD 解算、手肘 pole、掌心對準 |
| `body-anchors.ts` | 25 個身體定位點 |
| `hand-pose.ts` | 手指旋轉軸與手型 |
| `append-transform.ts` | PMX 付与（腿的網格靠這個才會動） |
| `skeleton-fixture.ts` | 測試用骨架夾具 |
| `gesture-reach.test.ts` | 驗收 |
