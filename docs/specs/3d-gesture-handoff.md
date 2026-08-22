# 3D 動作系統交接（給 Antigravity）

你要接手昔漣通話視窗的 3D 動作系統。這份文件講兩件事：**我怎麼確定手真的比到對的位置**，以及**還有什麼沒做完**。

程式碼全部在 `src/renderer/call/`。先讀這幾支再動手：
`gestures.ts`（動作定義）、`pose-composer.ts`（唯一一份「把偏移寫進骨頭」的實作）、
`arm-ik.ts`（手臂 IK）、`body-anchors.ts`（身體定位點）、`hand-pose.ts`（手指）、
`skeleton-fixture.ts`（測試用骨架夾具）、`gesture-reach.test.ts`（驗收）。

---

## 一、核心方法：不要用看的，要用量的

### 問題長什麼樣

原本 22 個手勢都是手寫每根骨頭的 euler 偏移，例如：

```ts
offsets.rightArm = { x: 0.62, y: -0.32, z: -0.72 };
offsets.rightElbow = { x: -0.28, y: -0.55, z: 1.50 };
```

這種寫法沒有人驗證過結果。實際量出來：

| 動作 | 手腕實際落點 | 應該在哪 |
|---|---|---|
| 摀臉害羞 | y=1.19（胸口） | 臉頰 y=1.42 |
| 掩口驚訝 | y=1.25 | 嘴巴 y=1.41 |
| 歡呼 | y=1.15（比肩膀還低） | 頭側 y=1.55 |
| 拍手／祈禱 | 左手 x=-0.04、右手 x=+0.04 | 兩手交叉穿過對方了 |
| 叉腰 | 手在身體正前方 | 髖部 x=±0.11 |

**光看程式碼永遠看不出這些**。要用量的。

### 量測夾具怎麼用

`skeleton-fixture.ts` 會在 node 裡直接讀真的 PMX 檔（不需要 WebGL、不需要瀏覽器），
只建骨頭階層，座標轉換與 `pmx-loader.ts` 完全一致。

```ts
import { loadSkeletonFixture } from "./skeleton-fixture";

const fx = loadSkeletonFixture();
console.log(fx.worldOf("左手首"));   // 骨頭的世界座標
fx.reset();                          // 回到綁定姿勢
fx.update();                         // 更新世界矩陣 + 套用付与
```

擺姿勢一定要走 `pose-composer.ts` 的 `applyArmPose` / `applyLegPose`，
**不要自己另外寫一套把偏移套到骨頭上的程式**。畫面走的是這一份，
測試若自己寫一份，量的就是另一個東西，量得再準也沒有意義。

寫個一次性的 `__probe.test.ts` 印數字，調完就刪掉；長期的斷言放 `gesture-reach.test.ts`。

```bash
npx vitest run src/renderer/call/__probe.test.ts --reporter=verbose
```

### 這副骨架的實測數字（單位：公尺，身高正規化為 1.65）

```
頭 y=1.405   眼 y=1.435   耳 (±0.040, 1.430, 0.261)   頭頂髮飾 y=1.553
肩 y=1.347   上臂根 (±0.055, 1.339, 0.254)
上半身2 y=1.265   下半身 y=1.196   膝 y=0.925   腳踝 y=0.690
臉的正面大約 z=0.29~0.31（+Z 是鏡頭方向）
```

**最重要的一個限制：手臂總長只有 0.233**（上臂 0.124 + 前臂 0.109）。
定位點離上臂根超過這個距離就永遠搆不到，IK 只會把手臂拉直，看起來像在用力伸卻碰不到。
「舉手過頭頂」在這副骨架上實際只到頭側 y≈1.55；寫成 y=1.72 是搆不到的。
`gesture-reach.test.ts` 第一項測試就在擋這件事。

### 動作怎麼定義（四層）

1. **身體 euler**（`gestures.ts` 的 switch）：頭、頸、脊椎，以及手臂的「風格」
   （手肘往內收還是往外開）。這層同時是 IK 的種子姿勢 —— 不要刪掉它改成純 IK，
   從零解出來的姿勢位置對但很機械。
2. **手的目標位置**（`GESTURE_TARGETS`）：手放到臉頰、髖部還是頭頂。位置由 IK 解，
   掌心朝向由掌心法線對準。
3. **手型**（`GESTURE_HANDS`）：握拳、比讚、攤平。
4. **腿與骨盆**（`GESTURE_LEGS`）。

新增一個動作的完整流程：

```ts
// 1. gestures.ts：加名字、加時長
export type CyreneGestureName = ... | "myGesture";
GESTURE_CONFIGS.myGesture = { duration: 2.2, attack: 0.4, release: 0.5 };

// 2. switch 裡寫身體動作（頭、脊椎，以及手臂種子姿勢）
case "myGesture": {
  offsets.head = { x: 0.05 * wHead };
  offsets.rightArm = { x: 0.5 * wArm, z: 0.6 * wArm };  // 只是種子，不必準
  break;
}

// 3. GESTURE_TARGETS：手真正要去哪
myGesture: {
  right: { anchor: "cheekR", offset: { x: -0.02 }, palm: { x: 1, y: 0, z: -0.2 } },
},

// 4. GESTURE_HANDS / GESTURE_LEGS（需要才加）

// 5. 跑測試量結果
npx vitest run src/renderer/call/gesture-reach.test.ts
```

定位點不夠用就到 `body-anchors.ts` 加，格式是「掛在哪根骨頭 + 綁定姿勢下的座標」，
它會自動換算成該骨頭的本地位移，所以頭一轉、定位點就跟著轉。

### 我踩過的四個坑（別再踩一次）

**1. `q.identity().slerp(q, t)` 是無效的。**
`identity()` 會先把 `q` 本身清成單位四元數，接著變成「從單位插值到單位」，永遠不轉。
這行讓 IK 對所有超過 0.45 弧度的旋轉完全失效，症狀是每個動作誤差都卡在 20cm 上下。
要縮放旋轉量請用 `arm-ik.ts` 的 `scaleRotation()`。

**2. CCD 迭代不夠會停在半路。**
10 次迭代 × 0.45 上限時，揮手途中有幾幀解不完，手腕單幀位移 14cm。
現在是 22 次 × 0.55。改這兩個值時要重跑連續性測試。

**3. 逐幀重解會在多個解之間跳。**
同一個目標位置有無限多組手臂姿勢（手肘可以繞著「肩→手腕」軸轉一圈）。
種子姿勢隨淡入權重在變，解就會跳。解法是 `ArmIKChain.previous`：用上一幀的解當起點。
存的是**還沒套手肘方向、也還沒混合權重**的原始解 —— 存後面的版本等於把處理結果餵回自己。

**4. CCD 不管手肘朝哪邊。**
位置解對了，手肘可能翹到肩膀上方 10cm（雞翅膀）。`applyElbowPole()` 繞著
「上臂根→手腕」那條軸轉，手腕位置完全不受影響。手臂朝上時「往下」在垂直於軸的
平面上幾乎沒有分量，這種動作要另外給 `elbowPole`。

### 驗證環境的限制

**Browser 預覽面板不會合成畫面**：`document.hidden` 恆為 true、`requestAnimationFrame`
完全不觸發，連手動往 2D canvas 畫圖再截圖都不會更新。3D 的視覺改動在那裡看不到。
所以目前所有驗證都是幾何量測，**沒有任何人真的用眼睛看過這些動作**。
如果你有辦法跑起 Electron app 目視確認，那是現在最有價值的一件事。

app 已經打包安裝在 `/Applications/昔漣桌寵.app`。
重新打包：`npm run dist:mac`（會自動簽章、驗證、安裝，不會自動重啟）。

---

## 二、還剩什麼

### A. 裙子與頭紗還是靜態鎖定（最重要）

`pmx-loader.ts` 的 `nonPhysicsBoneRegex`（約第 667 行）把 `裙*`、`後中裙`、
`後紗/長紗/長頭紗`、`左右胸`、腰與上下半身全部排除在彈簧骨之外。

註解說鎖它是為了「消滅碰撞體把裙子往外頂開、下擺朝天亂飛」。那是**碰撞的問題**，
不是彈簧骨的問題。現在腿會動了（見下一段），大幅度的腿部動作會直接穿過不會動的裙子。

要做的事：先重現當初「裙子被頂翻」的現象並找出是哪幾顆碰撞體造成的
（`colliders` 是 PMX type 0 剛體，`pmx-loader.ts` 約 710 行），修碰撞，再逐條解鎖裙骨。
`spring-bones.ts` 裡 `PARAM_PRESETS` 已經有 `裙`、`帶/紗`、`胸` 三組參數，
目前是走不到的死路，解鎖後直接就會生效。

驗證方式：用 `skeleton-fixture` 擺出屈膝姿勢，量裙骨與腿部碰撞體的最近距離。

### B. 腳沒有 IK

模型有 `左足ＩＫ / 右足ＩＫ / つま先ＩＫ`，但完全沒實作。現在腿是純 FK：
站姿、屈膝、開合都沒問題，但走路或踩地板不會鎖腳，膝蓋一彎腳掌就會跟著飄。

`pose-composer.ts` 的 `applyLegPose` 現在用一個很粗的補償
（腳踝反轉膝蓋角度的 0.5 倍）在假裝腳底貼地。要做位移類動作就得換成真的 IK。
`arm-ik.ts` 的 CCD 可以直接重用，鏈換成 `足 → ひざ → 足首`，加一個膝蓋只能單向彎的限制。

### C. 目標是手腕，不是指尖

現在 IK 的末端是 `手首`，但「摸臉頰」「掩口」真正該碰到的是**指尖**。
現在是靠在 `GESTURE_TARGETS` 手動加位移在補（例如 `gasp` 加了 `y:-0.030, z:+0.040`
才讓手腕不要陷進臉裡），這是治標。

比較好的做法是讓 `HandTarget` 可以選末端是手腕還是中指指尖，
IK 鏈延伸到 `中指３`。難點是手指姿勢與手腕朝向會互相影響，要想清楚順序。

### D. 情緒姿態（mood）的手臂角度沒量過

`vrm-viewer.ts` 約 446–590 行，20 種情緒各自設定 `targetPose.leftArm/rightArm`。
那些值跟手勢是同一種手寫來源，只是幅度小（都在 ±0.1 弧度內，是「手臂垂放時的微調」
而不是「把手舉到某處」），所以不會像手勢那樣整個歪掉。優先度低，但值得量一次確認。

### E. 動作庫 UI 只開了 12 個

`index.html` 的抽屜有 12 個 `data-action`：
`wave / winkHeart / cheer / stretch / bow / clap / shyBlush / think / salute / yawn / proud / pray`。

程式裡有 23 個。沒開到 UI 的：`nod / shakeHead / tiltHead / listen / headScratch /
gasp / raiseHand / angry / sweat / handsOnHeart`（`headPat` 有自己的按鈕）。
這些在對話中由 TTS chunk 的 `gesture` 欄位觸發，不一定要進抽屜 —— 但如果要讓使用者
手動測試每個動作，補上會方便很多。

### F. 表情與動作的綁定

`headPat` 現在靠 mood `shyBlush` 帶表情。如果要更精準（例如被摸頭時瞇眼、
打哈欠時閉眼），可以讓手勢自己帶 morph beat，而不是依賴 mood。
`vrm-viewer.ts` 已經有 `beats` 機制（`expressionBeatWeight`）可以接。

---

## 三、動手前

```bash
npx vitest run src/renderer/call/     # 146 項，全綠才動
npm run typecheck:renderer
```

改完必須讓 `gesture-reach.test.ts` 全過。那九項測試是這套系統唯一的安全網：
定位點在搆得到的範圍內、每個動作誤差 <3cm、兩手不交叉、掌心 <20°、
手不穿進頭裡、動作結束回到身側、揮手全程不跳幀。

另外：`main.ts` / `call.css` / `index.html` 目前有你之前的大量改動（約 1366 行）
還沒被審過，我沒有碰那三支。要動 `gestures.ts` / `pose-composer.ts` / `arm-ik.ts` /
`body-anchors.ts` / `hand-pose.ts` 之前先講一聲，避免互相蓋掉。
