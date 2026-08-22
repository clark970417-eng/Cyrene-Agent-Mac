/**
 * 昔漣 3D 模型擬真程序化動作系統（Human-like Procedural Gesture System）
 *
 * 一個手勢由四層組成：
 * 1. **身體 euler 偏移**（下面的 switch）：頭、頸、脊椎的動作，以及手臂的風格
 *    （手肘往內收還是往外開）。這一層同時當作 IK 的種子姿勢。
 * 2. **手的目標位置**（GESTURE_TARGETS）：手要放到臉頰、髖部還是頭頂。位置由
 *    IK 解，掌心朝向由掌心法線對準 —— 手寫 euler 猜不出這些（見該表的註解）。
 * 3. **手型**（GESTURE_HANDS）：握拳、比讚、攤平。
 * 4. **腿與骨盆**（GESTURE_LEGS）：只有少數動作需要。
 *
 * 每一層都有各自的時間包絡，依「肩 → 臂 → 肘 → 腕 → 指」遞增延遲，
 * 手指最後到位；同時到位看起來像機械手臂。
 *
 * 支援完整動作庫（共 23 款手勢）：
 * - `wave`：揮手打招呼
 * - `nod`：點頭贊同
 * - `shakeHead`：搖頭否定／無奈
 * - `think`：托腮思考
 * - `handsOnHeart`：撫胸感謝
 * - `bow`：微鞠躬致意
 * - `cheer`：雀躍歡呼
 * - `clap`：拍手鼓掌
 * - `listen`：側耳傾聽
 * - `headScratch`：撓頭害羞
 * - `stretch`：伸懶腰
 * - `gasp`：驚訝掩口
 * - `salute`：俏皮敬禮
 * - `raiseHand`：舉手發言
 * - `tiltHead`：歪頭賣萌
 * - `angry`：生氣叉腰嘟嘴
 * - `shyBlush`：雙手摀臉害羞
 * - `sweat`：擦汗無奈
 * - `winkHeart`：單眼比心
 * - `yawn`：掩嘴哈欠
 * - `proud`：自豪挺胸
 * - `pray`：祈禱拜託
 * - `headPat`：被摸摸頭（頭迎上去、肩膀縮起、雙手害羞收在胸前）
 */

import { blendHandPose, HAND_SHAPES, type HandPose, type HandShapeName } from "./hand-pose";
import type { AnchorName } from "./body-anchors";

export type CyreneGestureName =
  | "singHold"
  | "wave"
  | "nod"
  | "shakeHead"
  | "think"
  | "handsOnHeart"
  | "bow"
  | "cheer"
  | "clap"
  | "listen"
  | "headScratch"
  | "stretch"
  | "gasp"
  | "salute"
  | "raiseHand"
  | "tiltHead"
  | "angry"
  | "shyBlush"
  | "sweat"
  | "winkHeart"
  | "yawn"
  | "proud"
  | "pray"
  | "headPat";

export interface GestureEulerOffset {
  x: number;
  y: number;
  z: number;
}

export interface GestureBoneOffsets {
  head?: Partial<GestureEulerOffset>;
  neck?: Partial<GestureEulerOffset>;
  spine?: Partial<GestureEulerOffset>;
  chest?: Partial<GestureEulerOffset>;
  leftShoulder?: Partial<GestureEulerOffset>;
  rightShoulder?: Partial<GestureEulerOffset>;
  leftArm?: Partial<GestureEulerOffset>;
  rightArm?: Partial<GestureEulerOffset>;
  leftElbow?: Partial<GestureEulerOffset>;
  rightElbow?: Partial<GestureEulerOffset>;
  leftWrist?: Partial<GestureEulerOffset>;
  rightWrist?: Partial<GestureEulerOffset>;
  /** 手型。旋轉軸由骨架量出來，見 hand-pose.ts。 */
  leftHand?: HandPose;
  rightHand?: HandPose;
  /**
   * 前臂扭轉（弧度）：正值把掌心翻向外側。
   *
   * 手腕本身能轉，但只轉手腕的話布料會在腕口擰成一道摺痕；PMX 準備了
   * `腕捩 / 手捩` 讓扭轉沿著前臂分散開，這兩個欄位就是餵給它們的。
   */
  leftArmTwist?: number;
  rightArmTwist?: number;
  leftForearmTwist?: number;
  rightForearmTwist?: number;
  /** 下半身（骨盆）。腿的動作要靠它才有重心轉移的感覺。 */
  lowerBody?: Partial<GestureEulerOffset>;
  leftLeg?: Partial<GestureEulerOffset>;
  rightLeg?: Partial<GestureEulerOffset>;
  leftKnee?: Partial<GestureEulerOffset>;
  rightKnee?: Partial<GestureEulerOffset>;
  leftFoot?: Partial<GestureEulerOffset>;
  rightFoot?: Partial<GestureEulerOffset>;
  /** 眼球（`両目`，透過付与帶動左右眼）。 */
  eyes?: Partial<GestureEulerOffset>;
  /**
   * 這一幀要蓋掉的表情 morph（名稱 → 0~1）。
   *
   * 有些動作光靠骨頭永遠不像：打哈欠不張嘴、倒抽一口氣不瞪眼，姿勢再準
   * 也只是「手放在臉旁邊」。這裡寫的權重會在心情與母音之後套用（所以會
   * 蓋過它們），動作一結束就自動歸零還給表情層。
   */
  morphs?: Record<string, number>;
  /**
   * 手要放到身體的哪個位置。有指定的話，手臂的最終姿勢由 IK 解出來，
   * 上面那些 arm / elbow 偏移退化成 IK 的種子姿勢（決定手肘往哪邊開）。
   */
  leftHandTarget?: HandTarget;
  rightHandTarget?: HandTarget;
  rootY?: number;
}

/** 手的目標位置與掌心朝向。 */
export interface HandTarget {
  anchor: AnchorName;
  /** 相對定位點的額外位移（模型空間，公尺）。 */
  offset?: Partial<GestureEulerOffset>;
  /** 掌心希望朝向的方向（模型空間）。+Z 是鏡頭方向。 */
  palm?: GestureEulerOffset;
  /**
   * 指尖朝向（模型空間）。與 `palm` 一起把手的朝向完全鎖住。
   *
   * 只給 `palm` 的話手還能繞著掌心法線轉一圈：實測合十時掌心確實相對，
   * 指尖卻朝正前方平伸，看起來像在推東西。需要合十、比手勢、貼臉這類
   * 「手的方向本身就是語意」的動作都要給。
   */
  fingers?: GestureEulerOffset;
  /**
   * 掌心與指尖方向要以誰為基準。
   *
   * `model`（預設）＝模型空間，方向固定；`head` ＝跟著頭轉。
   * 揮手、敬禮這種「比給對方看」的動作要用 `head`：她轉頭看哪邊，手就朝哪邊
   * 揮，不然頭轉走了手還對著原本的方向比，像在對空氣揮手。
   */
  orientTo?: "model" | "head";
  /**
   * 手的**位置**要跟著頭轉多少（0~1）。
   *
   * `orientTo` 只轉掌心朝向；位置仍掛在胸口的定位點上。她轉頭之後，手還留在
   * 原來那一側、掌心卻朝著新方向，看起來就是「姿勢跟臉朝不同邊」。
   *
   * 不給 1 是有理由的：手完全跟著頭走的話，轉頭超過 30 度就會把手腕帶到
   * 手臂搆不到的地方。0.6~0.8 看起來就跟著臉了，也還在活動範圍內。
   */
  followHead?: number;
  /**
   * 手肘要朝哪邊（模型空間）。省略時用預設：往下、略往外後方。
   *
   * 這個方向不影響手的位置，只決定手臂繞著「肩→手腕」那條軸轉到哪個角度。
   * 預設值是「手肘自然垂著」；舉手歡呼那類手臂朝上的動作要另外給，
   * 因為軸接近垂直時「往下」在垂直於軸的平面上幾乎沒有分量。
   */
  elbowPole?: GestureEulerOffset;
  /** 0~1 淡入權重。 */
  weight: number;
}

/** 身體參與的描述，單位是度，見 GESTURE_BODY。 */
interface GestureBodySpec {
  /** 前傾（負值後仰）。 */
  lean?: number;
  /** 軀幹轉向（正值轉向角色左側）。 */
  turn?: number;
  /** 軀幹側傾（正值往角色左側）。 */
  sway?: number;
  headNod?: number;
  headTurn?: number;
  headTilt?: number;
  /** 重心：+1 落在左腳、-1 右腳、0 平均。 */
  weight?: number;
  /** 節奏起伏，乘在 lean 上（拍手、歡呼那種一下一下的律動）。 */
  pulse?: (elapsed: number) => number;
}

interface GestureTargetSpec {
  anchor: AnchorName;
  offset?: Partial<GestureEulerOffset>;
  palm?: GestureEulerOffset;
  fingers?: GestureEulerOffset;
  orientTo?: "model" | "head";
  followHead?: number;
  elbowPole?: GestureEulerOffset;
  /** 隨時間變化的附加位移，用來做拍手這類「整隻手真的在移動」的動作。 */
  motion?: (elapsed: number, progress: number) => Partial<GestureEulerOffset>;
  /**
   * 隨時間變化的指尖方向偏移 —— 也就是**手腕在擺**。
   *
   * 揮手要用這個而不是 `motion`：真人揮手時上臂與前臂幾乎不動，只有手腕
   * 左右擺。把擺動掛在目標位置上，IK 會把整條手臂帶著左右移動，看起來像
   * 在擦玻璃。
   */
  fingerMotion?: (elapsed: number) => Partial<GestureEulerOffset>;
}

/**
 * 每個手勢「手該放到哪裡」。
 *
 * 這張表取代了原本靠手寫 euler 去猜手臂三根骨頭複合旋轉的做法 —— 那種寫法
 * 實測幾乎每個動作都把手停在胸腹高度（摀臉停在 y=1.19，臉頰其實在 y=1.42），
 * 拍手與祈禱的兩隻手還會交叉穿過對方。位置改用 IK 解，方向用掌心法線對準。
 *
 * 沒列在這裡的手勢（點頭、搖頭、歪頭）本來就不靠手，維持純 euler。
 */
const GESTURE_TARGETS: Partial<
  Record<CyreneGestureName, { left?: GestureTargetSpec; right?: GestureTargetSpec }>
> = {
  wave: {
    right: {
      anchor: "besideHeadR",
      // 往中線收：通話視窗是直式窄框，手停在最外側會被切掉看不到。
      //
      // 高度落在眼睛稍上方（y≈1.455，眼睛 1.435）：舉到額頭以上會變成「報到」
      // 而不是打招呼，上臂也被迫抬過肩線。
      //
      // 高度降下來之後要往外、往前補一點，維持腕距肩 14~16cm —— 手腕離肩膀
      // 太近時手肘只能折到極限（實測 11.4cm 時肘夾角 58 度），手臂會擠成一團。
      offset: { x: 0.012, y: -0.012, z: 0.042 },
      palm: { x: -0.12, y: 0.12, z: 1 },
      // 掌心與位置都跟著頭轉：她看哪邊就朝哪邊揮。
      orientTo: "head", followHead: 0.75,
      // 指尖略往內傾，手掌不是正正的一片板子。
      fingers: { x: 0.20, y: 0.97, z: 0.05 },
      // 手肘往下、微微往外。前向分量要小：給 0.40 時手肘會往鏡頭方向突出
      // 10cm，正面看是一支朝前刺的肘。
      elbowPole: { x: -0.38, y: -1, z: 0.12 },
      // 手的位置幾乎不動，只留一點點跟隨；擺動交給手腕。
      motion: (elapsed) => ({ x: Math.sin(elapsed * 4.1) * 0.006 }),
      // 手腕左右擺 ±22 度，這才是招手。
      fingerMotion: (elapsed) => ({ x: Math.sin(elapsed * 4.1) * 0.40 }),
    },
  },
  cheer: {
    left: {
      anchor: "aboveHeadL",
      offset: { x: 0.015, y: 0.010, z: 0.015 },
      palm: { x: 0, y: 0.2, z: 0.9 },
      fingers: { x: 0, y: 1, z: 0.1 },
      elbowPole: { x: 0.65, y: -0.5, z: 0.2 },
      motion: (elapsed) => ({ y: Math.sin(elapsed * 4.5) * 0.015 }),
    },
    right: {
      anchor: "aboveHeadR",
      offset: { x: -0.015, y: 0.010, z: 0.015 },
      palm: { x: 0, y: 0.2, z: 0.9 },
      fingers: { x: 0, y: 1, z: 0.1 },
      elbowPole: { x: -0.65, y: -0.5, z: 0.2 },
      motion: (elapsed) => ({ y: Math.sin(elapsed * 4.5 + 0.5) * 0.015 }),
    },
  },
  clap: {
    left: {
      anchor: "clapCenter",
      // 合起來那一刻兩手掌根要相距約 2cm —— 骨頭在手掌中間、單手厚約 1cm，
      // 這個距離掌面剛好貼上又不互穿。
      //
      // 兩個方向都試過：原本 ±0.012（掌根 3.3cm）掌面之間還隔著 1.3cm 空氣，
      // 是「快碰到」；收到 ±0.004（掌根 1.3cm）就變成掌面互相穿插 0.7cm。
      // 這個值落在中間，gesture-reach.test.ts 有守住這個區間。
      offset: { x: 0.006 },
      palm: { x: -1, y: 0, z: 0 },
      // 指尖朝上，不是朝鏡頭。原本 (0, 0.45, 1) 讓兩隻手變成水平平伸、
      // 指尖比手腕還前面 7 公分（實測指尖 z=0.475），從正面看就是胸口下方
      // 糊著一塊肉色，看不出在拍手。
      fingers: { x: 0, y: 1, z: 0.35 },
      elbowPole: { x: 0.55, y: -1, z: 0.1 },
      motion: (elapsed) => ({ x: 0.005 + Math.abs(Math.sin(elapsed * 4.9)) * 0.031 }),
    },
    right: {
      anchor: "clapCenter",
      offset: { x: -0.006 },
      palm: { x: 1, y: 0, z: 0 },
      fingers: { x: 0, y: 1, z: 0.35 },
      elbowPole: { x: -0.55, y: -1, z: 0.1 },
      motion: (elapsed) => ({ x: -0.005 - Math.abs(Math.sin(elapsed * 4.9)) * 0.031 }),
    },
  },
  pray: {
    left: { anchor: "prayCenter", offset: { x: 0.016 }, fingers: { x: 0, y: 1, z: 0.15 }, palm: { x: -1, y: 0.1, z: 0.1 }, elbowPole: { x: 0.45, y: -1, z: 0.1 } },
    right: { anchor: "prayCenter", offset: { x: -0.016 }, fingers: { x: 0, y: 1, z: 0.15 }, palm: { x: 1, y: 0.1, z: 0.1 }, elbowPole: { x: -0.45, y: -1, z: 0.1 } },
  },
  think: {
    right: { anchor: "chin", offset: { x: -0.018, y: -0.010, z: 0.015 }, fingers: { x: 0, y: 1, z: 0.25 }, palm: { x: 0.35, y: 0.25, z: -0.85 }, elbowPole: { x: -0.4, y: -1, z: 0.3 } },
  },
  handsOnHeart: {
    // 撫胸的手要**貼在胸口**：指尖朝內上（沿著鎖骨方向），不是朝前上方浮著。
    // 手肘也要往外離開肋骨，否則前臂會陷進胸腔（實測穿進軀幹碰撞體 3.2cm）。
    right: {
      anchor: "chestFront", offset: { x: -0.022, y: 0.008, z: 0.006 },
      fingers: { x: 0.55, y: 0.78, z: 0.12 }, palm: { x: 0.15, y: 0.1, z: -0.98 },
      elbowPole: { x: -0.85, y: -1, z: 0.15 },
    },
    left: {
      anchor: "chestFront", offset: { x: 0.042, y: -0.038, z: 0.004 },
      fingers: { x: -0.55, y: 0.78, z: 0.12 }, palm: { x: -0.15, y: 0.1, z: -0.98 },
      elbowPole: { x: 0.85, y: -1, z: 0.15 },
    },
  },
  listen: {
    right: {
      anchor: "earR", offset: { x: -0.020, z: 0.005 },
      palm: { x: 1, y: 0, z: 0.25 }, elbowPole: { x: -0.40, y: -1, z: 0.35 },
      fingers: { x: 0, y: 1, z: 0.1 },
    },
  },
  headScratch: {
    right: {
      // 手要繞到**後腦**：實測原本落在 z=0.230（頭骨中心 0.259、後腦約 0.19），
      // 等於停在耳朵外側，看起來像在招手而不是在撓頭。
      anchor: "backHeadR", offset: { x: 0.010, y: 0.012, z: -0.042 },
      palm: { x: 0.3, y: -0.2, z: 0.9 }, elbowPole: { x: -0.65, y: -0.8, z: 0.25 },
      fingers: { x: 0, y: 0.9, z: -0.4 },
      motion: (elapsed) => ({ y: Math.sin(elapsed * 5.2) * 0.012, x: Math.sin(elapsed * 5.2) * 0.008 }),
    },
  },
  stretch: {
    left: { anchor: "aboveHeadL", offset: { x: 0.010, y: 0.005, z: 0.010 }, fingers: { x: 0, y: 1, z: 0.1 }, palm: { x: 0.2, y: 0.8, z: 0.5 }, elbowPole: { x: 0.75, y: -0.4, z: -0.2 } },
    right: { anchor: "aboveHeadR", offset: { x: -0.010, y: 0.005, z: 0.010 }, fingers: { x: 0, y: 1, z: 0.1 }, palm: { x: -0.2, y: 0.8, z: 0.5 }, elbowPole: { x: -0.75, y: -0.4, z: -0.2 } },
  },
  gasp: {
    // 跟哈欠同一個道理：IK 目標是手腕，手指從手腕往上長。照著嘴巴擺會讓
    // 整隻手變成擋在鼻子以上的一塊板子（實測指尖 y=1.47，比眼睛還高）。
    right: {
      anchor: "mouth", offset: { x: -0.030, y: -0.062, z: 0.032 },
      fingers: { x: 0, y: 1, z: 0.2 }, palm: { x: 0.2, y: -0.15, z: -0.9 },
      elbowPole: { x: -0.45, y: -0.95, z: 0.15 },
    },
  },
  salute: {
    right: { orientTo: "head", followHead: 0.7, anchor: "templeR", offset: { x: -0.010, y: 0.005, z: 0.012 }, fingers: { x: 0, y: 0.85, z: 0.25 }, palm: { x: 0.2, y: -0.6, z: 0.7 }, elbowPole: { x: -0.95, y: -0.2, z: 0.2 } },
  },
  raiseHand: {
    right: { anchor: "aboveHeadR", offset: { x: -0.015, y: 0.015, z: 0.015 }, fingers: { x: 0, y: 1, z: 0.05 }, palm: { x: 0, y: 0.1, z: 0.95 }, elbowPole: { x: -0.55, y: -0.7, z: 0.2 } },
  },
  angry: {
    left: { anchor: "hipL", fingers: { x: 0, y: -0.55, z: 0.6 }, palm: { x: -1, y: 0, z: 0 }, elbowPole: { x: 0.7, y: -0.5, z: -0.2 } },
    right: { anchor: "hipR", fingers: { x: 0, y: -0.55, z: 0.6 }, palm: { x: 1, y: 0, z: 0 }, elbowPole: { x: -0.7, y: -0.5, z: -0.2 } },
  },
  proud: {
    left: { anchor: "hipL", offset: { y: 0.010 }, fingers: { x: 0, y: -0.55, z: 0.6 }, palm: { x: -1, y: 0, z: 0 }, elbowPole: { x: 0.7, y: -0.5, z: -0.2 } },
    right: { anchor: "hipR", offset: { y: 0.010 }, fingers: { x: 0, y: -0.55, z: 0.6 }, palm: { x: 1, y: 0, z: 0 }, elbowPole: { x: -0.7, y: -0.5, z: -0.2 } },
  },
  // 害羞是**雙手背在身後**扭捏，不是雙手捧臉。
  // 捧臉那個版本在畫面上看起來像牙痛，而且兩隻手把臉遮掉一半 ——
  // 害羞的重點在表情（臉紅、閉眼、頭偏），手應該讓開。
  shyBlush: {
    left: {
      anchor: "buttocksL", offset: { x: 0.006, y: -0.004, z: -0.012 },
      palm: { x: 0.35, y: -0.2, z: 0.9 }, elbowPole: { x: 0.7, y: -0.45, z: -0.6 },
      fingers: { x: 0, y: 0.88, z: 0.32 },
      // 背在身後的手輕輕絞著：害羞的小動作全在這裡。
      motion: (elapsed) => ({
        x: Math.sin(elapsed * 2.6) * 0.012,
        y: Math.sin(elapsed * 1.7) * 0.005,
      }),
    },
    right: {
      anchor: "buttocksR", offset: { x: -0.006, y: -0.004, z: -0.012 },
      palm: { x: -0.35, y: -0.2, z: 0.9 }, elbowPole: { x: -0.7, y: -0.45, z: -0.6 },
      fingers: { x: 0, y: 0.88, z: 0.32 },
      motion: (elapsed) => ({
        x: Math.sin(elapsed * 2.6 + 0.9) * 0.012,
        y: Math.sin(elapsed * 1.7 + 0.5) * 0.005,
      }),
    },
  },
  sweat: {
    right: {
      anchor: "foreheadC", offset: { x: -0.048, y: -0.018, z: 0.020 },
      palm: { x: 0.1, y: -0.35, z: -0.9 }, elbowPole: { x: -0.75, y: -0.85, z: 0.3 },
      // 擦汗是手背橫過額頭抹過去，指尖朝對側。指尖朝上會變成「手擱在頭頂」，
      // 實測右手腕還會被解到 x=+0.013（穿過中線到左半邊）。
      fingers: { x: 0.9, y: 0.25, z: 0.1 },
      motion: (elapsed) => ({ x: Math.sin(elapsed * 4.0) * 0.022 }),
    },
  },
  winkHeart: {
    right: {
      // 比 ye 的手原本離肩膀只有 7.9cm，手肘被折到 39 度（人的極限），
      // 看起來像手臂卡住。抬高之後手臂才展得開。
      // 高度跟打招呼一致（眼睛稍上方）：兩個都是「比給對方看」的動作，
      // 高度不一致會覺得其中一個怪。
      anchor: "besideHeadR", offset: { x: 0.016, y: -0.012, z: 0.048 },
      orientTo: "head", followHead: 0.75,
      fingers: { x: 0.16, y: 0.96, z: 0.22 }, palm: { x: 0.05, y: 0.05, z: 1 },
      elbowPole: { x: -0.35, y: -1, z: 0.14 },
    },
  },
  yawn: {
    // 手腕要落在嘴巴「下方」六公分，不是對著嘴。
    //
    // IK 目標是手腕，手指是從手腕往上長的：把手腕直接放在嘴巴上，整隻手掌
    // 會蓋到眼睛以上 —— 實測手腕 y=1.411 已經高過頭骨原點，畫面看起來是
    // 摀著整張臉在哭，不是打哈欠。手腕壓到嘴下、指尖朝上，才是掩嘴。
    //
    // z 還要再往外推一截：定位點掛在「頭」上，頭往後仰時它跟著退（實測頭骨
    // 原點 z 0.26 → 0.19），但瀏海不會跟著退，手就整隻埋進頭髮裡看不見了。
    // 也不能推太遠：相機就在正前方，手離臉 6 公分就因為透視放大蓋到眼睛。
    // 實測手腕落在頭骨原點前方約 6 公分（臉皮大約在 4 公分處）最像掩嘴。
    //
    // 高度再壓到下巴：手掌正對嘴巴時會整片糊住嘴，張開的嘴反而看不見 ——
    // 而張嘴才是這個動作最主要的辨識訊號。指尖擋在下唇、嘴從上方露出來，
    // 才同時有「掩」和「哈欠」。
    right: {
      anchor: "mouth", offset: { x: -0.030, y: -0.085, z: 0.030 },
      fingers: { x: 0, y: 1, z: 0.2 }, palm: { x: 0.25, y: -0.15, z: -0.9 },
      elbowPole: { x: -0.45, y: -0.95, z: 0.1 },
    },
  },
  singHold: {
    left: {
      anchor: "buttocksL", offset: { x: 0.004, y: -0.004, z: -0.014 },
      palm: { x: 0.35, y: -0.2, z: 0.9 }, elbowPole: { x: 0.72, y: -0.4, z: -0.6 },
      fingers: { x: 0, y: 0.9, z: 0.3 },
      // 隨著身體左右擺動，手在背後也跟著輕輕移位，不會像黏死在同一點。
      motion: (elapsed) => ({ x: Math.sin(elapsed * 0.9) * 0.010, y: Math.sin(elapsed * 1.8) * 0.004 }),
    },
    right: {
      anchor: "buttocksR", offset: { x: -0.004, y: -0.004, z: -0.014 },
      palm: { x: -0.35, y: -0.2, z: 0.9 }, elbowPole: { x: -0.72, y: -0.4, z: -0.6 },
      fingers: { x: 0, y: 0.9, z: 0.3 },
      motion: (elapsed) => ({ x: Math.sin(elapsed * 0.9) * 0.010, y: Math.sin(elapsed * 1.8 + 0.7) * 0.004 }),
    },
  },
  bow: {
    // 交疊的手：左手在前、右手在後靠著，兩手都貼近身體中線。
    left: { anchor: "frontL", offset: { x: -0.038, y: -0.030, z: -0.030 }, fingers: { x: -0.35, y: -0.5, z: 0.8 }, palm: { x: -0.2, y: -0.85, z: 0 }, elbowPole: { x: 0.55, y: -1, z: -0.15 } },
    right: { anchor: "frontR", offset: { x: 0.048, y: -0.048, z: -0.030 }, fingers: { x: 0.35, y: -0.5, z: 0.8 }, palm: { x: 0.2, y: -0.85, z: 0 }, elbowPole: { x: -0.55, y: -1, z: -0.15 } },
  },
  headPat: {
    left: { anchor: "buttocksL", offset: { x: 0.005, y: -0.005, z: -0.010 }, fingers: { x: 0, y: 0.85, z: 0.35 }, palm: { x: 0.35, y: -0.2, z: 0.9 }, elbowPole: { x: 0.7, y: -0.4, z: -0.6 } },
    right: { anchor: "buttocksR", offset: { x: -0.005, y: -0.005, z: -0.010 }, fingers: { x: 0, y: 0.85, z: 0.35 }, palm: { x: -0.35, y: -0.2, z: 0.9 }, elbowPole: { x: -0.7, y: -0.4, z: -0.6 } },
  },
};

/**
 * 每個手勢的身體參與：軀幹怎麼轉、重心放哪隻腳、頭怎麼配合。
 *
 * 單位是**度**（讀起來直觀），套用時才換成弧度。正負號：
 * `lean` 正值前傾、`turn` 正值轉向角色左側、`sway` 正值往角色左側側傾、
 * `headNod` 正值低頭、`headTurn` 正值轉向角色左、`headTilt` 正值往左歪、
 * `weight` +1 重心在左腳、-1 在右腳。
 *
 * 幾條原則：
 * - 單手動作，軀幹要**轉向那隻手**，重心放在另一隻腳，人才不會像被釘住。
 * - 高興的動作（歡呼、得意、敬禮）挺胸抬下巴；退縮的動作（害羞、擦汗、驚訝）
 *   縮肩低頭往後。
 * - 幅度都很小（多半 3~8 度）：這一層是要讓姿勢活起來，不是要她扭來扭去。
 */
const GESTURE_BODY: Partial<Record<CyreneGestureName, GestureBodySpec>> = {
  // 右手揮：身體朝右手那側轉開一點、頭往手那邊歪，重心落在左腳。
  wave: { turn: -7, sway: -2.5, headTilt: -6, headTurn: -4, weight: 1, lean: 1.5 },
  cheer: { lean: -6, headNod: -8, weight: 0, pulse: (t) => 1 + Math.sin(t * 4.5) * 0.35 },
  clap: { lean: 4, headNod: 3, weight: -1, pulse: (t) => 1 + Math.abs(Math.sin(t * 4.9)) * 0.5 },
  pray: { lean: 3, headNod: 4, headTilt: 3, weight: 1 },
  think: { turn: -5, lean: 2, headTilt: -7, headTurn: -5, weight: -1 },
  handsOnHeart: { lean: 2.5, headNod: 5, headTilt: 4, weight: 1 },
  listen: { turn: -6, headTilt: -9, headTurn: -3, weight: 1, lean: 2 },
  headScratch: { turn: -4, headTilt: 6, headNod: 2, weight: -1, lean: 1 },
  gasp: { lean: -5, headNod: -3, headTurn: -3, weight: 1 },
  salute: { lean: -3, headNod: -4, turn: -3, weight: -1 },
  raiseHand: { turn: -5, sway: -3, headTurn: -4, headTilt: -3, lean: -2, weight: 1 },
  angry: { lean: 4, headNod: 3, weight: 0, pulse: (t) => 1 + Math.sin(t * 3.2) * 0.25 },
  shyBlush: { lean: 3, headNod: 6, headTilt: 5, turn: 4, weight: 1 },
  sweat: { lean: -3, turn: -4, headTilt: -5, headTurn: -3, weight: -1 },
  winkHeart: { turn: -5, sway: -3, headTilt: -7, headTurn: -3, weight: 1, lean: 1 },
  yawn: { lean: -5, headNod: -11, headTilt: 4, weight: -1 },
  proud: { lean: -6, headNod: -5, weight: 1, sway: 2 },
  stretch: { lean: -4, headNod: -5, weight: 0 },
  headPat: { headTilt: 4, turn: 3, weight: 1, lean: 1.5 },
  singHold: { sway: 3, headTilt: 3, weight: 1, pulse: (t) => 1 + Math.sin(t * 0.9) * 0.4 },
  bow: { weight: 0 },
  nod: { headTilt: 2, weight: 1, lean: 1 },
  shakeHead: { sway: 1.5, weight: -1 },
  tiltHead: { sway: 2.5, turn: -3, weight: 1 },
};

/**
 * 各手勢自帶的表情。
 *
 * 為什麼需要這一層：很多動作光看骨頭永遠不像。打哈欠不張嘴、倒抽一口氣
 * 不瞪眼、擦汗沒有汗滴 —— 姿勢再準也只是「手放在臉旁邊」。這副模型有
 * 七十七個 morph，包含 `！`／`？`／`汗`／`はぁと`／`星目` 這種漫符，
 * 辨識度幾乎一半在臉上。
 *
 * 只用實測「看得出來」的 morph：這顆頭的眉毛整片被瀏海蓋住，所以
 * `困る`／`びっくり`／`喜び`／`慈愛` 這類純眉型的表情放到 1.0 也完全沒有
 * 畫面差別（已逐顆截圖比對過）。改用會動到眼型的（`じと目`／`ｷﾘｯ`／
 * `にやり`／`星目`／`驚かす`／`痛み`／`心配する`）、嘴型的，以及漫符。
 *
 * 數值是峰值權重，會乘上動作自己的包絡線（比手慢一點點到位），動作結束
 * 後由 viewer 歸零還給表情層。在 switch 裡自己寫 `offsets.morphs` 的動作
 * （例如哈欠要嘴巴自己一套開合節奏）以那邊為準。
 */
const GESTURE_FACE: Partial<Record<CyreneGestureName, Record<string, number>>> = {
  gasp: { 驚かす: 0.85, あ: 0.42, "！": 0.75 },
  angry: { ｷﾘｯ: 0.6, 口角下げ: 0.5, 怒: 0.7 },
  sweat: { 汗: 0.85, じと目: 0.5 },
  shyBlush: { 脸红: 0.9, 心配する: 0.3 },
  // `はぁと` 是把瞳孔變成愛心，不是飄在頭上的符號 —— 配 `笑い`（笑瞇眼）
  // 等於把愛心藏起來，實測畫面上完全看不到。改用嘴角上揚配愛心眼。
  winkHeart: { はぁと: 1.0, 口角上げ: 0.6 },
  cheer: { 笑い: 0.7, あ: 0.5, "星目 ": 0.5 },
  think: { "？": 0.6, じと目: 0.45 },
  proud: { にやり: 0.7, ｷﾘｯ: 0.45 },
  stretch: { まばたき: 0.75, あ: 0.28 },
  headScratch: { 汗: 0.5, じと目: 0.35 },
  salute: { ｷﾘｯ: 0.7 },
  pray: { まばたき: 0.85 },
  bow: { まばたき: 0.55 },
  headPat: { 脸红: 0.7, 笑い: 0.55 },
  listen: { "？": 0.35 },
};
/**
 * 各手勢的手型。
 *
 * 拆成表格而不是寫進下面的 switch：手型是「這個動作的手長什麼樣」，跟手臂
 * 軌跡是兩件事，混在一起會讓每個 case 再長一倍。沒列到的手勢一律用待機手型。
 */
const GESTURE_HANDS: Partial<
  Record<CyreneGestureName, { left?: HandShapeName; right?: HandShapeName }>
> = {
  singHold: { left: "relaxed", right: "relaxed" },
  wave: { right: "open" },
  cheer: { left: "fist", right: "fist" },
  clap: { left: "flat", right: "flat" },
  raiseHand: { right: "point" },
  salute: { right: "flat" },
  think: { right: "pinch" },
  handsOnHeart: { left: "flat", right: "flat" },
  pray: { left: "prayer", right: "prayer" },
  angry: { left: "fist", right: "fist" },
  // 摀嘴那隻手不張成海星（那是「停」的手勢）；沒有目標的左手就自然垂著。
  gasp: { left: "relaxed", right: "cover" },
  headScratch: { right: "claw" },
  stretch: { left: "open", right: "open" },
  proud: { left: "fist", right: "fist" },
  // 「單眼比心」要比心，不是比 V。原本用 peace，目視時一眼就對不上名字。
  winkHeart: { right: "fingerHeart" },
  shyBlush: { left: "flat", right: "flat" },
  sweat: { right: "flat" },
  yawn: { right: "cover" },
  listen: { right: "open" },
  bow: { left: "flat", right: "flat" },
  headPat: { left: "relaxed", right: "relaxed" },
};

/**
 * 各手勢的腿部姿勢（弧度，會再乘上整體權重）。
 *
 * 只有幾個動作真的需要動到腿——大部分上半身動作配合骨盆微傾就夠了，
 * 腿動太多反而會讓人物看起來在原地扭。
 */
const GESTURE_LEGS: Partial<
  Record<
    CyreneGestureName,
    {
      lowerBody?: Partial<GestureEulerOffset>;
      knee?: number;
      /** 站姿開合：正值兩腳外開。 */
      stance?: number;
    }
  >
> = {
  bow: { lowerBody: { x: 0.155 }, knee: 0.115, stance: -0.02 },
  cheer: { lowerBody: { x: -0.05 }, knee: -0.02, stance: 0.05 },
  stretch: { lowerBody: { x: -0.08 }, knee: -0.03 },
  yawn: { lowerBody: { x: -0.06 }, knee: 0.03 },
  angry: { lowerBody: { x: 0.04 }, stance: 0.07 },
  proud: { lowerBody: { x: -0.06 }, stance: 0.04 },
  shyBlush: { lowerBody: { x: 0.05 }, knee: 0.08, stance: -0.05 },
  pray: { lowerBody: { x: 0.04 }, knee: 0.04 },
  gasp: { lowerBody: { x: -0.03 }, knee: 0.05 },
};

export interface GestureConfig {
  duration: number;
  attack: number;
  release: number;
}

export const GESTURE_CONFIGS: Record<CyreneGestureName, GestureConfig> = {
  // 唱歌時的持續姿勢：長度由歌曲長度覆寫，起手與收手都放慢，才不會突然彈上去。
  singHold: { duration: 240, attack: 1.1, release: 1.4 },
  wave: { duration: 2.3, attack: 0.4, release: 0.5 },
  nod: { duration: 1.2, attack: 0.25, release: 0.35 },
  shakeHead: { duration: 1.4, attack: 0.3, release: 0.4 },
  think: { duration: 2.5, attack: 0.45, release: 0.5 },
  handsOnHeart: { duration: 2.6, attack: 0.5, release: 0.55 },
  bow: { duration: 1.8, attack: 0.45, release: 0.55 },
  cheer: { duration: 1.6, attack: 0.35, release: 0.45 },
  clap: { duration: 2.2, attack: 0.35, release: 0.45 },
  listen: { duration: 2.4, attack: 0.45, release: 0.55 },
  headScratch: { duration: 2.6, attack: 0.5, release: 0.55 },
  stretch: { duration: 3.0, attack: 0.7, release: 0.7 },
  gasp: { duration: 1.9, attack: 0.28, release: 0.5 },
  salute: { duration: 1.9, attack: 0.32, release: 0.45 },
  raiseHand: { duration: 2.2, attack: 0.4, release: 0.5 },
  tiltHead: { duration: 1.7, attack: 0.35, release: 0.45 },
  angry: { duration: 2.6, attack: 0.4, release: 0.55 },
  shyBlush: { duration: 2.7, attack: 0.45, release: 0.55 },
  sweat: { duration: 2.4, attack: 0.4, release: 0.5 },
  winkHeart: { duration: 2.5, attack: 0.4, release: 0.5 },
  yawn: { duration: 2.8, attack: 0.6, release: 0.65 },
  proud: { duration: 2.4, attack: 0.4, release: 0.5 },
  pray: { duration: 2.6, attack: 0.45, release: 0.55 },
  headPat: { duration: 2.8, attack: 0.35, release: 0.7 },
};

/** 五次 Hermite Smootherstep 曲線。 */
export function smootherStep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

export const smoothStep = smootherStep;

/** 計算時間點上的總體進度 (0~1) 與五次平滑淡入淡出權重 (0~1)。 */
export function calculateGestureEnvelope(
  elapsed: number,
  duration: number,
  attack: number,
  release: number
): { progress: number; weight: number; isDone: boolean } {
  if (elapsed <= 0) return { progress: 0, weight: 0, isDone: false };
  if (elapsed >= duration) return { progress: 1, weight: 0, isDone: true };

  const progress = elapsed / duration;
  let weight = 1;

  if (elapsed < attack) {
    // 進場用 ease-out（起步快、到位緩），不是對稱的 smootherstep。
    // 真人的肢體是先加速再減速貼上目標；兩端一樣慢的曲線看起來像伺服馬達
    // 在走定位。
    const t = elapsed / attack;
    weight = 1 - Math.pow(1 - t, 2.6);
  } else if (elapsed > duration - release) {
    const remaining = duration - elapsed;
    weight = smootherStep(remaining / release);
  }

  return { progress, weight, isDone: false };
}

/** 關節層級延遲時間包絡。 */
export function calculateDelayedEnvelope(
  elapsed: number,
  duration: number,
  attack: number,
  release: number,
  delaySeconds: number
): { progress: number; weight: number; isDone: boolean } {
  if (elapsed <= 0) return { progress: 0, weight: 0, isDone: false };
  if (elapsed >= duration) return { progress: 1, weight: 0, isDone: true };

  const progress = elapsed / duration;
  if (elapsed < delaySeconds) return { progress, weight: 0, isDone: false };

  let weight = 1;
  const attackEnd = delaySeconds + attack;
  const releaseStart = duration - release;

  if (elapsed < attackEnd && attack > 0) {
    weight = smootherStep((elapsed - delaySeconds) / attack);
  } else if (elapsed > releaseStart && release > 0) {
    const remaining = duration - elapsed;
    weight = smootherStep(remaining / release);
  }

  return { progress, weight, isDone: false };
}

/** 肌肉彈性超調與微幅回彈。 */
export function settleOvershoot(elapsed: number, attackTime: number, magnitude = 0.04): number {
  if (elapsed < attackTime) {
    return (elapsed / attackTime) * magnitude * 0.5;
  }
  const t = elapsed - attackTime;
  return Math.exp(-t * 6.5) * Math.sin(t * 11.0) * magnitude;
}

/** 計算特定手勢在 elapsed 時間點的擬真柔和骨骼旋轉偏移。 */
export function sampleGestureOffsets(
  name: CyreneGestureName,
  elapsed: number,
  customDuration?: number,
  /**
   * 每次觸發時給一個隨機相位，讓同一個動作每次播起來不完全一樣。
   *
   * 只作用在微漂移與待機擺盪這種「活著的雜訊」上，不影響動作本身的軌跡，
   * 所以測試不傳它就是完全確定性的。程序化動作最容易露餡的地方就是重播時
   * 一模一樣 —— 人不會兩次揮手長得像同一段影片。
   */
  seed = 0
): GestureBoneOffsets | null {
  const config = GESTURE_CONFIGS[name];
  if (!config) return null;

  const duration = customDuration ?? config.duration;
  const attack = Math.min(config.attack, duration * 0.3);
  // 收尾比起手長：人做完一個動作是「慢慢把手放下」，不是用同樣的速度收回去。
  // 起落用同一條對稱曲線正是動作看起來像機器手臂的原因之一。
  const release = Math.min(config.release * 1.35, duration * 0.4);

  const baseEnv = calculateGestureEnvelope(elapsed, duration, attack, release);
  if (baseEnv.isDone || baseEnv.weight <= 0.0001) return null;

  const shoulderEnv = calculateDelayedEnvelope(elapsed, duration, attack, release, 0.0);
  const armEnv = calculateDelayedEnvelope(elapsed, duration, attack, release, 0.035);
  const elbowEnv = calculateDelayedEnvelope(elapsed, duration, attack, release, 0.075);
  const wristEnv = calculateDelayedEnvelope(elapsed, duration, attack, release, 0.12);
  const headEnv = calculateDelayedEnvelope(elapsed, duration, attack, release, 0.04);

  const wCore = baseEnv.weight;
  const wShoulder = shoulderEnv.weight;
  const wArm = armEnv.weight;
  const wElbow = elbowEnv.weight;
  const wWrist = wristEnv.weight;
  const wHead = headEnv.weight;

  const organic = (Math.sin(elapsed * 2.2) * 0.012 + Math.cos(elapsed * 1.5) * 0.006) * wCore;
  const overshoot = settleOvershoot(elapsed, attack);

  const offsets: GestureBoneOffsets = {};

  switch (name) {
    case "wave": {
      const waveTwist = Math.sin(elapsed * 4.8) * 0.12;
      offsets.spine = { z: 0.015 * wArm, y: -0.010 * wArm };
      offsets.leftShoulder = { y: -0.03 * wShoulder, z: 0.04 * wShoulder };
      offsets.rightShoulder = { y: 0.06 * wShoulder, z: -0.08 * wShoulder };
      offsets.rightArm = {
        x: 0.45 * wArm,
        y: -0.22 * wArm,
        z: -0.65 * wArm,
      };
      offsets.rightElbow = {
        x: -0.15 * wElbow,
        y: -0.35 * wElbow,
        z: 0.95 * wElbow,
      };
      offsets.rightWrist = {
        y: waveTwist * wWrist,
        z: -0.05 * wWrist,
      };
      offsets.head = {
        x: -0.015 * wHead,
        y: 0.025 * wHead,
        z: 0.040 * wHead,
      };
      break;
    }

    case "nod": {
      const p = baseEnv.progress;
      // 實測峰值只有 8.6 度，在通話那個窄畫面裡幾乎看不出來。點頭是要讓
      // 對方確定「她有在聽」的動作，幅度要夠。
      const nod1 = Math.sin(Math.min(1, p * 2.2) * Math.PI) * 0.24;
      const nod2 = p > 0.45 ? Math.sin((p - 0.45) * 2.2 * Math.PI) * 0.12 : 0;
      const nodTotal = (nod1 + nod2) * wCore;

      offsets.head = { x: nodTotal * 0.95 };
      offsets.neck = { x: nodTotal * 0.55 };
      offsets.chest = { x: nodTotal * 0.25 };
      break;
    }

    case "shakeHead": {
      const p = baseEnv.progress;
      // 原本衰減太快（exp(-1.8p)），第二次擺回來只剩一半、第三次幾乎沒有，
      // 實測 +7.9° / -4.7°，看起來像頭歪了一下而不是在搖頭說不。
      const shakePhase = p * Math.PI * 3.5;
      const damping = Math.exp(-p * 0.85);
      const shakeVal = Math.sin(shakePhase) * damping * 0.23 * wCore;

      offsets.head = { y: shakeVal, z: -shakeVal * 0.22 };
      offsets.neck = { y: shakeVal * 0.45 };
      offsets.chest = { y: shakeVal * 0.15 };
      break;
    }

    case "think": {
      offsets.spine = { z: 0.015 * wArm };
      offsets.head = {
        x: (0.025 + organic) * wHead,
        y: (-0.035 - overshoot * 0.1) * wHead,
        z: (0.075 + overshoot * 0.2) * wHead,
      };
      offsets.rightShoulder = { y: 0.04 * wShoulder, z: -0.04 * wShoulder };
      offsets.rightArm = {
        x: 0.40 * wArm,
        y: -0.20 * wArm,
        z: -0.45 * wArm,
      };
      offsets.rightElbow = {
        x: -0.10 * wElbow,
        y: -0.32 * wElbow,
        z: 0.95 * wElbow,
      };
      offsets.chest = { y: -0.015 * wCore };
      break;
    }

    case "handsOnHeart": {
      offsets.spine = { x: 0.025 * wCore };
      offsets.chest = { x: (0.035 + organic * 0.5) * wCore };
      offsets.rightShoulder = { y: 0.04 * wShoulder, z: -0.04 * wShoulder };
      offsets.rightArm = {
        x: (0.42 + overshoot) * wArm,
        y: -0.22 * wArm,
        z: (-0.62 - overshoot) * wArm,
      };
      offsets.rightElbow = {
        x: -0.08 * wElbow,
        y: -0.48 * wElbow,
        z: (1.32 + organic) * wElbow,
      };
      offsets.rightWrist = {
        x: (0.18 + organic * 0.3) * wWrist,
        y: 0.08 * wWrist,
        z: (0.32 + overshoot * 0.4) * wWrist,
      };
      offsets.head = {
        x: (0.045 + overshoot * 0.2) * wHead,
        y: -0.018 * wHead,
        z: 0.025 * wHead,
      };
      break;
    }

    case "bow": {
      // 實測原本整體只前傾 13 度（頭 7.4 + 骨盆 5.7 + 脊椎 6.3），看不出在鞠躬。
      // 加深到約 32 度，並帶一點屈膝行禮的味道：身體前傾的同時頭略偏、
      // 肩膀微收，比直挺挺對折下去柔和。
      const bowPhase = smootherStep(Math.sin(baseEnv.progress * Math.PI));
      offsets.spine = { x: 0.20 * bowPhase * wCore, z: 0.018 * bowPhase * wCore };
      offsets.chest = { x: 0.115 * bowPhase * wCore };
      offsets.head = { x: 0.155 * bowPhase * wHead, z: 0.035 * bowPhase * wHead };
      offsets.neck = { x: 0.075 * bowPhase * wHead };
      // 手在身前輕輕交疊，是女孩子行禮的樣子；手臂貼著身體不外開。
      offsets.leftShoulder = { z: 0.045 * bowPhase * wShoulder };
      offsets.rightShoulder = { z: -0.045 * bowPhase * wShoulder };
      offsets.leftArm = { x: 0.10 * bowPhase * wArm, z: 0.16 * bowPhase * wArm };
      offsets.rightArm = { x: 0.10 * bowPhase * wArm, z: -0.16 * bowPhase * wArm };
      break;
    }

    case "cheer": {
      const bouncePhase = Math.sin(baseEnv.progress * Math.PI * 4);

      offsets.leftShoulder = { y: -0.055 * wShoulder, z: 0.075 * wShoulder };
      offsets.rightShoulder = { y: 0.055 * wShoulder, z: -0.075 * wShoulder };

      offsets.leftArm = {
        x: (0.24 + organic) * wArm,
        y: 0.14 * wArm,
        z: -0.24 * wArm,
      };
      offsets.rightArm = {
        x: (0.24 + organic) * wArm,
        y: -0.14 * wArm,
        z: 0.24 * wArm,
      };
      offsets.leftElbow = {
        x: 0.09 * wElbow,
        y: 0.18 * wElbow,
        z: (-0.32 + bouncePhase * 0.04) * wElbow,
      };
      offsets.rightElbow = {
        x: 0.09 * wElbow,
        y: -0.18 * wElbow,
        z: (0.32 - bouncePhase * 0.04) * wElbow,
      };
      offsets.head = { x: -0.035 * bouncePhase * wHead };
      break;
    }

    case "clap": {
      offsets.leftShoulder = { y: 0.05 * wShoulder, z: 0.04 * wShoulder };
      offsets.rightShoulder = { y: -0.05 * wShoulder, z: -0.04 * wShoulder };

      offsets.leftArm = { x: 0.42 * wArm, y: 0.22 * wArm, z: -0.45 * wArm };
      offsets.rightArm = { x: 0.42 * wArm, y: -0.22 * wArm, z: 0.45 * wArm };

      offsets.leftElbow = {
        x: -0.12 * wElbow,
        y: 0.35 * wElbow,
        z: -0.95 * wElbow,
      };
      offsets.rightElbow = {
        x: -0.12 * wElbow,
        y: -0.35 * wElbow,
        z: 0.95 * wElbow,
      };

      offsets.head = { z: 0.015 * wHead };
      offsets.chest = { x: 0.015 * wCore };
      break;
    }

    case "listen": {
      offsets.head = { x: -0.025 * wHead, y: (0.09 + organic) * wHead, z: (-0.12 - overshoot * 0.2) * wHead };
      offsets.neck = { y: 0.045 * wHead, z: -0.065 * wHead };
      offsets.chest = { x: 0.025 * wCore, y: 0.030 * wCore };

      offsets.rightArm = { x: 0.42 * wArm, y: -0.20 * wArm, z: -0.50 * wArm };
      offsets.rightElbow = { x: -0.09 * wElbow, y: -0.30 * wElbow, z: 1.10 * wElbow };
      break;
    }

    case "headScratch": {
      offsets.spine = { z: 0.015 * wArm };
      offsets.head = { x: -0.035 * wHead, y: 0.060 * wHead, z: -0.075 * wHead };
      offsets.neck = { x: -0.015 * wHead, z: -0.030 * wHead };

      offsets.rightShoulder = { y: 0.08 * wShoulder, z: -0.10 * wShoulder };
      offsets.rightArm = {
        x: 0.55 * wArm,
        y: -0.25 * wArm,
        z: -0.75 * wArm,
      };
      offsets.rightElbow = {
        x: -0.18 * wElbow,
        y: -0.48 * wElbow,
        z: 1.25 * wElbow,
      };
      break;
    }

    case "stretch": {
      const stretchPhase = smootherStep(Math.sin(baseEnv.progress * Math.PI));
      const spineArch = stretchPhase * 0.09 * wCore;

      offsets.spine = { x: -spineArch * 0.6 };
      offsets.chest = { x: -spineArch };
      offsets.head = { x: -0.08 * stretchPhase * wHead };

      offsets.leftShoulder = { y: -0.08 * wShoulder, z: 0.10 * wShoulder };
      offsets.rightShoulder = { y: 0.08 * wShoulder, z: -0.10 * wShoulder };

      offsets.leftArm = {
        x: 0.20 * wArm,
        y: 0.10 * wArm,
        z: -0.40 * wArm,
      };
      offsets.rightArm = {
        x: 0.20 * wArm,
        y: -0.10 * wArm,
        z: 0.40 * wArm,
      };

      offsets.leftElbow = { x: 0.08 * wElbow, y: 0.12 * wElbow, z: -0.30 * wElbow };
      offsets.rightElbow = { x: 0.08 * wElbow, y: -0.12 * wElbow, z: 0.30 * wElbow };
      break;
    }

    case "gasp": {
      // 😮 驚訝掩口：整個人往後縮一下 —— 肩膀猛地聳起、上身後仰、頭往後帶。
      // 跟哈欠的差別在節奏：這裡是「一瞬間收緊」，哈欠是「慢慢拱起再垮掉」。
      offsets.head = { x: (-0.075 - overshoot * 0.5) * wHead, y: -0.035 * wHead, z: 0.03 * wHead };
      offsets.neck = { x: -0.035 * wHead };
      offsets.chest = { x: -0.05 * wCore };
      offsets.spine = { x: -0.04 * wCore };

      // 兩肩一起縮起來（受驚的反射），不是只有摀嘴那一側。
      offsets.leftShoulder = { z: 0.09 * wShoulder };
      offsets.rightShoulder = { y: 0.05 * wShoulder, z: -0.12 * wShoulder };
      offsets.rightArm = {
        x: 0.38 * wArm,
        y: -0.18 * wArm,
        z: -0.42 * wArm,
      };
      offsets.rightElbow = {
        x: -0.08 * wElbow,
        y: -0.32 * wElbow,
        z: 0.95 * wElbow,
      };
      break;
    }

    case "salute": {
      offsets.head = { x: 0.030 * wHead, y: -0.022 * wHead, z: 0.040 * wHead };
      offsets.chest = { x: 0.015 * wCore };

      offsets.rightShoulder = { y: 0.08 * wShoulder, z: -0.09 * wShoulder };
      offsets.rightArm = {
        x: 0.55 * wArm,
        y: -0.28 * wArm,
        z: -0.75 * wArm,
      };
      offsets.rightElbow = {
        x: -0.15 * wElbow,
        y: -0.55 * wElbow,
        z: 1.25 * wElbow,
      };
      break;
    }

    case "raiseHand": {
      offsets.spine = { z: 0.015 * wArm };
      offsets.head = { x: 0.035 * wHead, y: -0.015 * wHead };
      offsets.chest = { x: 0.015 * wCore };

      offsets.rightShoulder = { y: 0.10 * wShoulder, z: -0.15 * wShoulder };
      offsets.rightArm = {
        x: 0.25 * wArm,
        y: -0.10 * wArm,
        z: -0.55 * wArm,
      };
      offsets.rightElbow = { x: 0.04 * wElbow, y: -0.10 * wElbow, z: 0.20 * wElbow };
      break;
    }

    case "tiltHead": {
      const tiltPhase = smootherStep(Math.sin(baseEnv.progress * Math.PI));
      offsets.head = {
        x: -0.018 * wHead,
        y: 0.038 * wHead,
        z: (0.21 * tiltPhase + overshoot * 0.2) * wHead,
      };
      offsets.neck = {
        z: 0.075 * tiltPhase * wHead,
      };
      offsets.leftShoulder = { y: -0.045 * tiltPhase * wShoulder, z: 0.055 * tiltPhase * wShoulder };
      offsets.rightShoulder = { y: -0.045 * tiltPhase * wShoulder, z: 0.055 * tiltPhase * wShoulder };
      break;
    }

    // ─── 5 款專屬情緒動作 ───
    case "angry": {
      // 「生氣叉腰」與「得意挺胸」都是叉腰，實測兩者的手位置差不到 1 公分 ——
      // 光看剪影分不出來。手的落點由 GESTURE_TARGETS 決定（都在髖部），
      // 所以差異必須做在**軀幹**上：
      //   proud  → 挺胸、下巴抬、身體後仰
      //   angry  → 含胸、下巴收、身體**前傾**、雙肩聳起
      // 前傾加聳肩是「逼近」的姿態，後仰加挺胸是「展示」的姿態，
      // 一眼就分得開。
      const poutPulse = Math.sin(elapsed * 4.0) * 0.02 * wCore;

      offsets.spine = { x: 0.055 * wCore, z: poutPulse };
      offsets.chest = { x: 0.040 * wCore };
      offsets.head = { x: 0.030 * wHead, y: 0.09 * wHead, z: (-0.06 + poutPulse) * wHead };
      offsets.neck = { x: 0.020 * wHead };

      // 雙肩聳起（y 正向是上提），比 proud 的下沉多得多。
      offsets.leftShoulder = { y: 0.135 * wShoulder, z: -0.06 * wShoulder };
      offsets.rightShoulder = { y: -0.135 * wShoulder, z: 0.06 * wShoulder };

      // 手肘往前外側張開，跟 proud 的往後收相反。
      offsets.leftElbow = { x: -0.20 * wElbow, y: 0.62 * wElbow, z: -1.05 * wElbow };
      offsets.rightElbow = { x: -0.20 * wElbow, y: -0.62 * wElbow, z: 1.05 * wElbow };
      break;
    }

    case "shyBlush": {
      // 手交給 GESTURE_TARGETS（背在身後），這裡只管身體與頭。
      // 原本這裡有一整組把手推到臉頰的偏移，跟現在的目標會打架，已移除。
      const shyOsc = Math.sin(elapsed * 3.5) * 0.015 * wCore;

      // 頭低一點、偏開視線，肩膀內收 —— 害羞是「把自己縮小」。
      offsets.head = { x: 0.075 * wHead, y: -0.10 * wHead, z: (0.06 + shyOsc) * wHead };
      offsets.neck = { x: 0.035 * wHead, y: -0.04 * wHead };
      offsets.chest = { x: 0.030 * wCore, y: -0.025 * wCore };
      offsets.spine = { x: 0.020 * wCore };

      // 雙肩微聳並往前收（含胸），背手的姿勢才不會變成挺胸站軍姿。
      offsets.leftShoulder = { y: 0.05 * wShoulder, z: 0.075 * wShoulder };
      offsets.rightShoulder = { y: -0.05 * wShoulder, z: -0.075 * wShoulder };
      break;
    }

    case "sweat": {
      offsets.head = { x: -0.025 * wHead, y: 0.05 * wHead, z: -0.06 * wHead };
      offsets.neck = { y: 0.025 * wHead, z: -0.03 * wHead };
      offsets.chest = { y: -0.015 * wCore };

      offsets.rightShoulder = { y: 0.08 * wShoulder, z: -0.10 * wShoulder };
      offsets.rightArm = { x: 0.55 * wArm, y: -0.22 * wArm, z: -0.65 * wArm };
      offsets.rightElbow = { x: -0.15 * wElbow, y: -0.45 * wElbow, z: 1.15 * wElbow };
      break;
    }

    case "winkHeart": {
      offsets.spine = { z: 0.015 * wArm };
      offsets.head = { x: 0.020 * wHead, y: -0.025 * wHead, z: 0.06 * wHead };

      offsets.rightShoulder = { y: 0.05 * wShoulder, z: -0.06 * wShoulder };
      offsets.rightArm = { x: 0.42 * wArm, y: -0.20 * wArm, z: -0.55 * wArm };
      offsets.rightElbow = { x: -0.10 * wElbow, y: -0.35 * wElbow, z: 1.05 * wElbow };
      break;
    }

    case "yawn": {
      // 🥱 打哈欠：整個身體往後拱、肩膀聳起、下巴抬高，另一手順勢往外伸展，
      // 最後鬆掉。原本這個動作跟「驚訝掩口」用了一模一樣的手臂數值，只有頭部
      // 差幾度 —— 兩個動作看起來完全一樣，都只是「把手放到嘴邊」。
      //
      // 哈欠的辨識度來自身體的弧線與節奏，不是手的位置：前半段憋著往後拱，
      // 後半段整個垮下來。
      const p = baseEnv.progress;
      const build = smootherStep(Math.min(1, p / 0.55));
      const sag = p > 0.62 ? smootherStep((p - 0.62) / 0.38) : 0;
      const arch = build - sag * 1.25;

      offsets.spine = { x: -0.075 * arch * wCore };
      offsets.chest = { x: -0.085 * arch * wCore };
      offsets.head = { x: -0.155 * arch * wHead, z: 0.035 * arch * wHead };
      offsets.neck = { x: -0.06 * arch * wHead };

      // 兩肩一起聳起來，這是哈欠最明顯的身體訊號。
      offsets.leftShoulder = { z: 0.115 * build * wShoulder, y: 0.03 * build * wShoulder };
      offsets.rightShoulder = { z: -0.115 * build * wShoulder, y: -0.03 * build * wShoulder };

      // 沒摀嘴的那隻手往外伸個懶腰。
      // z 的**正**向才是把手臂往外抬離身體。先前寫成 -0.30，等於把沒摀嘴的
      // 那隻手往身體夾緊 —— 實測左手腕從 x=0.20 被拉到 0.03（身體中線），
      // 畫面上像是遮在身前，跟註解說的「伸懶腰」剛好相反。
      offsets.leftArm = {
        x: 0.30 * build * wArm,
        y: 0.20 * build * wArm,
        z: 0.34 * build * wArm,
      };
      offsets.leftElbow = { y: 0.30 * build * wElbow, z: -0.55 * build * wElbow };

      offsets.rightArm = { x: 0.42 * wArm, y: -0.16 * wArm, z: -0.38 * wArm };
      offsets.rightElbow = { x: -0.10 * wElbow, y: -0.30 * wElbow, z: 1.02 * wElbow };
      // 眼睛往上翻一點：打哈欠時眼睛會瞇起來往上。
      offsets.eyes = { x: -0.06 * build };

      // 沒有這一段，她只是把手放在臉旁邊。
      //
      // 嘴要真的張開（`大口` 是這副模型張最大的那顆）、眼睛要瞇到閉起來、
      // 眉頭要皺，最後泛出一點生理性淚水 —— 哈欠的辨識度幾乎全在臉上，
      // 骨頭只負責把手送到嘴邊。
      const gape = Math.min(1, build * 1.15) * (1 - sag * 0.9);
      offsets.morphs = {
        大口: 0.88 * gape,
        あ: 0.45 * gape,
        まばたき: Math.min(1, 0.35 + 0.65 * gape),
        困る: 0.45 * gape,
        涙: 0.30 * smootherStep(Math.min(1, p / 0.85)),
      };
      break;
    }

    case "proud": {
      // 👑 自豪挺胸：單手叉腰、胸腔挺起、下巴微揚自信微笑
      offsets.spine = { x: -0.03 * wCore };
      offsets.chest = { x: -0.05 * wCore };
      offsets.head = { x: -0.055 * wHead, y: -0.035 * wHead, z: -0.03 * wHead };

      offsets.rightShoulder = { y: -0.06 * wShoulder, z: 0.08 * wShoulder };
      offsets.rightArm = { x: 0.35 * wArm, y: -0.22 * wArm, z: 0.42 * wArm };
      offsets.rightElbow = { x: 0.22 * wElbow, y: -0.52 * wElbow, z: 0.92 * wElbow };
      offsets.rightWrist = { x: -0.18 * wWrist, y: 0.28 * wWrist, z: -0.15 * wWrist };
      break;
    }

    case "pray": {
      // 🙏 祈禱許願：雙手胸前合十微晃、頭微下點、神情溫柔虔誠
      const prayOsc = Math.sin(elapsed * 3.0) * 0.015 * wCore;

      offsets.spine = { x: 0.025 * wCore };
      offsets.chest = { x: 0.035 * wCore };
      // 對稱動作要給一點偏擺，正對鏡頭的完全對稱看起來像機器人。
      offsets.head = { x: (0.05 + prayOsc) * wHead, y: -0.03 * wHead, z: 0.055 * wHead };

      offsets.leftShoulder = { y: 0.06 * wShoulder, z: 0.05 * wShoulder };
      offsets.rightShoulder = { y: -0.06 * wShoulder, z: -0.05 * wShoulder };

      offsets.leftArm = { x: 0.48 * wArm, y: 0.28 * wArm, z: -0.58 * wArm };
      offsets.rightArm = { x: 0.48 * wArm, y: -0.28 * wArm, z: 0.58 * wArm };

      offsets.leftElbow = { x: -0.15 * wElbow, y: 0.38 * wElbow, z: -1.25 * wElbow };
      offsets.rightElbow = { x: -0.15 * wElbow, y: -0.38 * wElbow, z: 1.25 * wElbow };

      offsets.leftWrist = { x: 0.22 * wWrist, y: 0.05 * wWrist, z: -0.15 * wWrist };
      offsets.rightWrist = { x: 0.22 * wWrist, y: -0.05 * wWrist, z: 0.15 * wWrist };
      break;
    }

    case "singHold": {
      // 🎤 唱歌：雙手背在身後，頭跟著拍子左右擺，肩膀微微向後打開。
      // 擺動走的是慢速正弦（約 0.9 rad/s，一次來回四秒多），比說話時的點頭
      // 慢得多——唱歌時人是順著旋律晃，不是逐句點頭。
      const swayY = Math.sin(elapsed * 0.9);
      const swayZ = Math.sin(elapsed * 0.9 + 0.5);
      const breathe = Math.sin(elapsed * 0.45);

      offsets.head = {
        x: (0.02 + breathe * 0.012) * wHead,
        y: swayY * 0.13 * wHead,
        z: swayZ * 0.075 * wHead,
      };
      offsets.neck = { y: swayY * 0.05 * wHead, z: swayZ * 0.03 * wHead, x: 0.012 * wHead };
      offsets.spine = { x: -0.015 * wCore, y: swayY * 0.03 * wCore, z: swayZ * 0.02 * wCore };
      offsets.chest = { x: -0.018 * wCore, y: swayY * 0.035 * wCore, z: swayZ * 0.025 * wCore };
      offsets.leftShoulder = { y: 0.05 * wShoulder, z: -0.045 * wShoulder };
      offsets.rightShoulder = { y: -0.05 * wShoulder, z: 0.045 * wShoulder };
      offsets.leftArm = { x: -0.16 * wArm, y: 0.13 * wArm, z: 0.27 * wArm };
      offsets.rightArm = { x: -0.16 * wArm, y: -0.13 * wArm, z: -0.27 * wArm };
      offsets.leftElbow = { y: 0.38 * wElbow, z: -0.48 * wElbow };
      offsets.rightElbow = { y: -0.38 * wElbow, z: 0.48 * wElbow };
      break;
    }

    case "headPat": {
      // 🫳 被摸頭：雙手害羞背在身後屁股上，頭往上迎、脖子放鬆、肩膀微縮，再左右輕晃享受。
      const p = baseEnv.progress;
      const nuzzle = Math.sin(elapsed * 2.4) * 0.035;
      const settle = Math.sin(Math.min(1, p * 1.6) * Math.PI) * 0.045;

      offsets.head = {
        x: (0.065 + settle) * wHead,
        y: nuzzle * wHead,
        z: (nuzzle * 0.8 + 0.02) * wHead,
      };
      offsets.neck = { x: 0.035 * wHead, y: nuzzle * 0.4 * wHead, z: nuzzle * 0.3 * wHead };
      offsets.spine = { x: -0.02 * wCore };
      offsets.chest = { x: -0.025 * wCore, z: nuzzle * 0.25 * wCore };
      // 肩膀微微向後收、微縮
      offsets.leftShoulder = { y: 0.04 * wShoulder, z: -0.04 * wShoulder };
      offsets.rightShoulder = { y: -0.04 * wShoulder, z: 0.04 * wShoulder };
      offsets.leftArm = { x: -0.15 * wArm, y: 0.12 * wArm, z: 0.25 * wArm };
      offsets.rightArm = { x: -0.15 * wArm, y: -0.12 * wArm, z: -0.25 * wArm };
      offsets.leftElbow = { y: 0.35 * wElbow, z: -0.45 * wElbow };
      offsets.rightElbow = { y: -0.35 * wElbow, z: 0.45 * wElbow };
      break;
    }
  }

  // 手型：跟著手腕的包絡再多延遲一點。真人的手指總是最後才到位，
  // 手臂還在半路手就已經握成拳，看起來像機械手臂。
  const fingerEnv = calculateDelayedEnvelope(elapsed, duration, attack, release, 0.16);
  const shapes = GESTURE_HANDS[name];
  offsets.leftHand = blendHandPose(
    HAND_SHAPES.relaxed,
    shapes?.left ? HAND_SHAPES[shapes.left] : HAND_SHAPES.relaxed,
    fingerEnv.weight
  );
  offsets.rightHand = blendHandPose(
    HAND_SHAPES.relaxed,
    shapes?.right ? HAND_SHAPES[shapes.right] : HAND_SHAPES.relaxed,
    fingerEnv.weight
  );

  // 表情：比手再慢一點點到位，臉不會在手臂還沒動時就先變。
  const face = GESTURE_FACE[name];
  if (face) {
    const faceEnv = calculateDelayedEnvelope(elapsed, duration, attack, release, 0.08);
    const merged: Record<string, number> = {};
    for (const [morph, peak] of Object.entries(face)) {
      merged[morph] = peak * faceEnv.weight;
    }
    // switch 裡自己排過時間軸的（哈欠）優先。
    offsets.morphs = { ...merged, ...(offsets.morphs ?? {}) };
  }

  // 前臂扭轉：手腕的 y 轉多少，前臂就分掉一部分，避免腕口擰出摺痕。
  const leftWristY = offsets.leftWrist?.y ?? 0;
  const rightWristY = offsets.rightWrist?.y ?? 0;
  if (leftWristY !== 0) {
    offsets.leftForearmTwist = leftWristY * 0.55;
    offsets.leftArmTwist = leftWristY * 0.2;
  }
  if (rightWristY !== 0) {
    offsets.rightForearmTwist = rightWristY * 0.55;
    offsets.rightArmTwist = rightWristY * 0.2;
  }

  // 腿與骨盆
  const legs = GESTURE_LEGS[name];
  if (legs) {
    const wLeg = calculateDelayedEnvelope(elapsed, duration, attack, release, 0.06).weight;
    if (legs.lowerBody) {
      offsets.lowerBody = {
        x: (legs.lowerBody.x ?? 0) * wLeg,
        y: (legs.lowerBody.y ?? 0) * wLeg,
        z: (legs.lowerBody.z ?? 0) * wLeg,
      };
    }
    const knee = (legs.knee ?? 0) * wLeg;
    const stance = (legs.stance ?? 0) * wLeg;
    if (knee !== 0) {
      // 膝蓋只能往後彎，正值代表彎曲；兩腳給一點點差異才不會像立正。
      offsets.leftKnee = { x: knee };
      offsets.rightKnee = { x: knee * 0.88 };
      offsets.leftLeg = { x: -knee * 0.45 };
      offsets.rightLeg = { x: -knee * 0.40 };
    }
    if (stance !== 0) {
      offsets.leftLeg = { ...(offsets.leftLeg ?? {}), z: stance };
      offsets.rightLeg = { ...(offsets.rightLeg ?? {}), z: -stance };
    }
  }

  // 身體參與。實測原本大部分動作只有手臂在動：拍手時頭 0.9 度、軀幹 0.9 度、
  // 骨盆與膝蓋 0 度 —— 手在拍，身體是一尊雕像。真人做任何手勢，軀幹都會轉、
  // 重心都會移、頭都會配合，這一層就是補這件事。
  //
  // 這裡是**疊加**在 switch 已經寫好的值上面，所以鞠躬、伸懶腰那些本來就有
  // 大幅度身體動作的手勢不會被蓋掉。
  const body = GESTURE_BODY[name];
  if (body) {
    const D = Math.PI / 180;
    const pulse = body.pulse ? body.pulse(elapsed) : 1;
    // 維持期的自我調整：人擺好姿勢之後不會像模型一樣定住，軀幹一直有 1~2 度
    // 的緩慢重新平衡。兩個不成比例的頻率相加，避免看得出週期。
    const idleSway =
      (Math.sin(elapsed * 0.61 + seed) * 0.9 + Math.sin(elapsed * 0.37 + 1.1 + seed * 1.7) * 0.55) * wCore;
    const idleLean = Math.sin(elapsed * 0.45 + 2.2 + seed * 0.8) * 0.6 * wCore;
    const lean = ((body.lean ?? 0) * pulse + idleLean) * D * wCore;
    const turn = (body.turn ?? 0) * D * wCore;
    const sway = ((body.sway ?? 0) + idleSway) * D * wCore;

    // 前傾與轉身分給脊椎與胸口：脊椎出大部分、胸口補一點，看起來才像整條背
    // 在動，而不是折在同一個點上。
    offsets.spine = {
      x: (offsets.spine?.x ?? 0) + lean * 0.6,
      y: (offsets.spine?.y ?? 0) + turn * 0.55,
      z: (offsets.spine?.z ?? 0) + sway * 0.6,
    };
    offsets.chest = {
      x: (offsets.chest?.x ?? 0) + lean * 0.4,
      y: (offsets.chest?.y ?? 0) + turn * 0.45,
      z: (offsets.chest?.z ?? 0) + sway * 0.4,
    };
    offsets.head = {
      x: (offsets.head?.x ?? 0) + (body.headNod ?? 0) * D * wHead,
      y: (offsets.head?.y ?? 0) + (body.headTurn ?? 0) * D * wHead,
      z: (offsets.head?.z ?? 0) + (body.headTilt ?? 0) * D * wHead,
    };
    // 脖子跟頭同向但只走三成，否則看起來像整顆頭被折過去。
    offsets.neck = {
      x: (offsets.neck?.x ?? 0) + (body.headNod ?? 0) * D * wHead * 0.3,
      y: (offsets.neck?.y ?? 0) + (body.headTurn ?? 0) * D * wHead * 0.3,
      z: (offsets.neck?.z ?? 0) + (body.headTilt ?? 0) * D * wHead * 0.3,
    };

    // 重心：骨盆往支撐腳那側微傾，另一腳的膝蓋放鬆彎一點。
    // 這是站姿好不好看的關鍵 —— 左右完全對稱地站直就是立正。
    const shift = (body.weight ?? 0) * wCore;
    if (shift !== 0) {
      offsets.lowerBody = {
        x: offsets.lowerBody?.x ?? 0,
        y: offsets.lowerBody?.y ?? 0,
        z: (offsets.lowerBody?.z ?? 0) - shift * 0.045,
      };
      const relaxed = Math.abs(shift) * 0.10;
      if (shift > 0) {
        offsets.rightKnee = { x: (offsets.rightKnee?.x ?? 0) + relaxed };
        offsets.rightLeg = { ...(offsets.rightLeg ?? {}), x: (offsets.rightLeg?.x ?? 0) - relaxed * 0.45 };
      } else {
        offsets.leftKnee = { x: (offsets.leftKnee?.x ?? 0) + relaxed };
        offsets.leftLeg = { ...(offsets.leftLeg ?? {}), x: (offsets.leftLeg?.x ?? 0) - relaxed * 0.45 };
      }
    }
  }

  // 手的目標位置。跟著手腕的包絡淡入，這樣手臂抬起與手到位是同一條時間軸。
  const targets = GESTURE_TARGETS[name];
  if (targets) {
    const wTarget = wristEnv.weight;
    if (targets.left) {
      offsets.leftHandTarget = resolveTarget(targets.left, elapsed, baseEnv.progress, wTarget, seed, attack);
    }
    if (targets.right) {
      // 右手給 2.1 的相位差：兩隻手同步漂移看起來像連動機構。
      offsets.rightHandTarget = resolveTarget(targets.right, elapsed, baseEnv.progress, wTarget, seed + 2.1, attack);
    }
  }

  return offsets;
}

/**
 * 維持期的微漂移：手到位之後不會像雕像一樣凍住。
 *
 * 這是「動作看起來像機器人」最大的來源 —— 程序化動作把手解到目標點就停在
 * 那裡，一動也不動；真人維持一個姿勢時，手一直有 1~2 公分的緩慢晃動（呼吸、
 * 重心微調、肌肉張力變化）。
 *
 * 用兩個不成比例的頻率相加，才不會週期性地重複同一條軌跡。左右手給不同相位，
 * 兩隻手就不會同步漂。
 */
function holdDrift(elapsed: number, phase: number): { x: number; y: number; z: number } {
  return {
    x: Math.sin(elapsed * 0.83 + phase) * 0.006 + Math.sin(elapsed * 1.61 + phase * 2.3) * 0.0028,
    y: Math.sin(elapsed * 0.67 + phase * 1.7) * 0.005 + Math.sin(elapsed * 1.29 + phase) * 0.0022,
    z: Math.sin(elapsed * 0.94 + phase * 0.6) * 0.004 + Math.sin(elapsed * 1.83 + phase * 1.4) * 0.0018,
  };
}

function resolveTarget(
  spec: GestureTargetSpec,
  elapsed: number,
  progress: number,
  weight: number,
  phase = 0,
  attack = 0.4
): HandTarget {
  const motion = spec.motion?.(elapsed, progress);
  const drift = holdDrift(elapsed, phase);
  // 到位時的回彈：手不是「開到定點然後煞車」，而是稍微過頭再收回來。
  const bounce = settleOvershoot(elapsed, attack, 0.010);
  const target: HandTarget = { anchor: spec.anchor, weight };
  const offset = {
    x: (spec.offset?.x ?? 0) + (motion?.x ?? 0) + drift.x * weight,
    y: (spec.offset?.y ?? 0) + (motion?.y ?? 0) + (drift.y + bounce) * weight,
    z: (spec.offset?.z ?? 0) + (motion?.z ?? 0) + drift.z * weight,
  };
  if (offset.x !== 0 || offset.y !== 0 || offset.z !== 0) target.offset = offset;
  if (spec.palm) target.palm = spec.palm;
  if (spec.fingers) {
    const swing = spec.fingerMotion?.(elapsed);
    target.fingers = swing
      ? {
          x: spec.fingers.x + (swing.x ?? 0),
          y: spec.fingers.y + (swing.y ?? 0),
          z: spec.fingers.z + (swing.z ?? 0),
        }
      : spec.fingers;
  }
  if (spec.elbowPole) target.elbowPole = spec.elbowPole;
  if (spec.orientTo) target.orientTo = spec.orientTo;
  if (spec.followHead !== undefined) target.followHead = spec.followHead;
  return target;
}
