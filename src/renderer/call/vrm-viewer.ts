import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CyrenePMXLoader, type PMXModelResult } from "./pmx-loader";
import { SpringBoneSystem } from "./spring-bones";
import { MMDPhysics, loadAmmo } from "./mmd-physics";
import { SceneBackdrop } from "./scene-backdrop";
import { RoomScene, type RoomPreset } from "./room-scene";
import { PostFX, type PostFXQuality } from "./post-fx";
import { VMDPlayer, type ParsedVMD } from "./vmd-animation";
import { InteractiveWorld, type PropKind } from "./interactive-world";
import { FixedStepScheduler, renderPixelRatio } from "./render-performance";
import { resolveAsset } from "../../shared/renderer-base";
import {
  type CyreneGestureName,
  sampleGestureOffsets,
  type GestureBoneOffsets,
} from "./gestures";
import { buildHandRig, buildTwistRig, type HandRig, type TwistRig } from "./hand-pose";
import { applyArmPose, applyLegPose, type PoseRigs } from "./pose-composer";
import { buildArmChain, type ArmIKChain } from "./arm-ik";
import { buildBodyAnchors, type BodyAnchors } from "./body-anchors";

export type { CyreneGestureName };

export interface VRMViewerOptions {
  canvas: HTMLCanvasElement;
  onLoaded?: () => void;
  onError?: (err: unknown) => void;
  onHeadpat?: () => void;
}

/**
 * 瞬間表情的時間包絡。
 *
 * 眨眼這種是「一個動作」，不是一種心情：以前 wink 的做法是把 `ウィンク`
 * 直接釘在 1.0，而 setMood 只有在下一個「不同的」mood 到來時才會歸零。
 * 結果一次眨眼會掛著整輪對話不放，隨機眨眼又獨立作用在雙眼上，看起來就
 * 變成一直瞇著一隻眼睛。改成有頭有尾的包絡，眨完自己會睜開。
 */
export interface ExpressionBeatShape {
  /** 闔上所需秒數。 */
  attack: number;
  /** 完全闔上後停留的秒數。 */
  hold: number;
  /** 睜開所需秒數。 */
  release: number;
  /** 最大權重。 */
  peak: number;
}

/** 取得某個時間點的權重。用 smoothstep 讓起落自然，不會像線性那樣有轉折。 */
export function expressionBeatWeight(shape: ExpressionBeatShape, elapsed: number): number {
  const { attack, hold, release, peak } = shape;
  if (elapsed <= 0) return 0;
  // 明確地在總長度處收斂到 0。少了這道，浮點誤差會讓末端回傳 1e-32 這種
  // 非零殘值——眼睛實際上永遠差那麼一點點沒睜開。
  if (elapsed >= attack + hold + release) return 0;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  if (elapsed < attack) return peak * smooth(elapsed / attack);
  if (elapsed < attack + hold) return peak;
  const releasing = elapsed - attack - hold;
  return peak * smooth(1 - releasing / release);
}

/** 包絡總長度，用來判斷 beat 何時結束。 */
export function expressionBeatDuration(shape: ExpressionBeatShape): number {
  return shape.attack + shape.hold + shape.release;
}

/**
 * 這些 morph 和 `まばたき` 作用在同一隻眼睛上（MMD 慣例：`ウィンク` 是左眼、
 * `ウィンク右` 是右眼），而 morph 權重是相加的。眨眼剛好撞上眨單眼時，那隻
 * 眼睛會被壓到 2.0，眼皮過度變形，看起來就是眼窩整個凹下去。
 */
export const BLINK_OVERLAPPING_MORPHS = new Set(["ウィンク", "ウィンク２", "ウィンク右", "ｳｨﾝｸ２右"]);

/** 讓單眼 morph 與雙眼眨眼/閉眼的合計不超過 1，避免同一隻眼睛被壓兩次或眼皮過度形變。 */
export function blinkSafeWinkWeight(winkWeight: number, blinkWeight: number, eyeClosedWeight = 0): number {
  const totalClosed = Math.max(blinkWeight, eyeClosedWeight);
  return Math.max(0, Math.min(winkWeight, 1 - totalClosed));
}

export type AvatarMood =
  | "neutral"
  | "happy"
  | "shy"
  | "thinking"
  | "surprised"
  | "sad"
  | "wink"
  | "smug"
  | "talking"
  | "pout"
  | "excited"
  | "sleepy"
  | "curious"
  | "angry"
  | "shyBlush"
  | "sweat"
  | "winkHeart"
  | "yawn"
  | "proud"
  | "pray";


/** 特殊表情的預設持續秒數。
 *
 * 害羞曾經因為看起來「掛太久」而被調短，實際原因不是時間而是 bug：
 * `shyBlush` 設的 `moodBlinkBase` 每一幀都會被寫回閉眼 morph，換心情時沒有歸零，
 * 眼睛就永久閉著。那個 bug 修掉之後 4.5 秒是舒服的，所以維持原值。 */
const SPECIAL_MOOD_HOLD_SEC = 4.5;
const MOOD_HOLD_SEC: Partial<Record<AvatarMood, number>> = {};

/**
 * 每個動作預設搭配的表情。
 *
 * 只在 `triggerGesture` 沒有另外指定 mood 時生效（`playReaction` 會用呼叫端
 * 給的那個）。放在 viewer 這一層是因為 mood 的型別屬於這裡，gestures.ts
 * 反向引用會變成循環相依。
 */
const GESTURE_DEFAULT_MOOD: Partial<Record<CyreneGestureName, AvatarMood>> = {
  wave: "happy",
  cheer: "excited",
  clap: "excited",
  pray: "pray",
  think: "thinking",
  handsOnHeart: "happy",
  listen: "curious",
  headScratch: "shy",
  stretch: "sleepy",
  gasp: "surprised",
  salute: "happy",
  raiseHand: "excited",
  tiltHead: "curious",
  angry: "angry",
  shyBlush: "shyBlush",
  sweat: "sweat",
  winkHeart: "winkHeart",
  yawn: "yawn",
  proud: "proud",
  bow: "happy",
  headPat: "shyBlush",
  nod: "happy",
  shakeHead: "thinking",
};

export interface CompoundReactionOptions {
  gesture?: CyreneGestureName;
  mood?: AvatarMood;
  duration?: number;
}

export class Cyrene3DViewer {
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;

  private ambientLight!: THREE.AmbientLight;
  private mainLight!: THREE.DirectionalLight;
  private frontLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  /** 只投影、不發光的頂光，見 enableGroundShadow。 */
  private shadowLight: THREE.DirectionalLight | null = null;

  private currentPmx: PMXModelResult | null = null;
  private springBones: SpringBoneSystem | null = null;
  /**
   * PMX 原生剛體＋關節物理。載入成功之後就由它取代彈簧骨。
   *
   * 兩套並存而不是直接換掉：模型若沒帶關節（`result.physics === null`），
   * 或 ammo.js 載入失敗，都還能退回彈簧骨，不會變成完全不會動。
   */
  private mmdPhysics: MMDPhysics | null = null;
  /** 3D 背景板（取代原本貼在 canvas 後面的 CSS 圖層），見 scene-backdrop.ts。 */
  private backdrop: SceneBackdrop | null = null;
  /** 真正的 3D 房間，見 room-scene.ts。有房間時背景板會隱藏。 */
  private room: RoomScene | null = null;
  /** 景深＋輝光＋SMAA，見 post-fx.ts。 */
  private postFX: PostFX | null = null;
  /** VMD 動作播放（含腿部 IK），見 vmd-animation.ts。 */
  private vmdPlayer: VMDPlayer | null = null;
  /** 地板、道具與接觸陰影，見 interactive-world.ts。 */
  private interactiveWorld: InteractiveWorld | null = null;

  /** 手指與前臂扭轉的旋轉軸（載入時從骨架量出來，見 hand-pose.ts）。 */
  private handRigs: { left: HandRig | null; right: HandRig | null } = { left: null, right: null };
  private twistRigs: {
    leftArm: TwistRig | null; rightArm: TwistRig | null;
    leftForearm: TwistRig | null; rightForearm: TwistRig | null;
  } = { leftArm: null, rightArm: null, leftForearm: null, rightForearm: null };
  /** 手臂 IK 與身體定位點：手勢指定「手放到臉頰」時由它們解出手臂角度。 */
  private armChains: { left: ArmIKChain | null; right: ArmIKChain | null } = { left: null, right: null };
  private bodyAnchors: BodyAnchors | null = null;

  private physicsScheduler = new FixedStepScheduler();
  private timer = new THREE.Timer();
  private animFrameId: number | null = null;
  private paused = false;
  private pausedBeforeContextLoss = false;

  // 動態與相機追蹤（最佳視訊黃金比例視角：鎖定面部與胸口，預留頭頂空間）
  private mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
  private cameraBasePos = new THREE.Vector3(0, 1.34, 1.28);
  private cameraLookAt = new THREE.Vector3(0, 1.30, 0);
  /**
   * 各視角的相機距離，用「頭部高度的倍率」表示而不是寫死公尺數。
   *
   * 寫死過一次，然後 pmx-loader 改了高度基準（腳底而不是拖襬最低點），
   * 模型一口氣放大 1.62 倍，四個視角全部變成大特寫。用倍率的話尺度再變
   * 也不用重調。
   *
   * 數值是實測取景挑的（頭頂與腰部的 NDC 都要留在畫面內，而且腰不能被
   * 底部的控制列蓋掉 —— 控制列大約吃掉畫面下緣 13%）。
   */
  private static readonly CAMERA_DISTANCE = {
    default: 1.4,
    upper: 1.56,
    face: 0.92,
    full: 2.56,
  } as const;

  // 眨眼計時
  private blinkTimer = 0;
  private nextBlinkInterval = 3.2;
  private isBlinking = false;
  private blinkProgress = 0;

  /** 進行中的瞬間表情（見 expressionBeatWeight）。 */
  private beats: Array<ExpressionBeatShape & { morph: string; elapsed: number }> = [];

  // 嘴型與聲音（五母音獨立權重：A, I, U, E, O）
  private currentVowels = { a: 0, i: 0, u: 0, e: 0, o: 0 };
  private targetVowels = { a: 0, i: 0, u: 0, e: 0, o: 0 };
  private currentMood: AvatarMood = "neutral";
  private moodTimer = 0;
  private moodDuration = 0; // 0 為長駐（僅限 neutral），特殊表情預設時間後自動回歸日常微笑
  private moodBlinkBase = 0;
  private moodBlushBase = 0;
  private moodSmileBase = 0;

  // 動作姿態與情緒姿態系統（Mood Gestures & Dynamic Poses）
  private speechWeight = 0;
  private currentPose = {
    head: new THREE.Vector3(),
    chest: new THREE.Vector3(),
    leftArm: new THREE.Vector3(0.16, 0.12, -0.48),
    rightArm: new THREE.Vector3(0.16, -0.12, 0.48),
  };
  private targetPose = {
    head: new THREE.Vector3(),
    chest: new THREE.Vector3(),
    leftArm: new THREE.Vector3(0.16, 0.12, -0.48),
    rightArm: new THREE.Vector3(0.16, -0.12, 0.48),
  };

  // 空間走動與真實重心地面踩踏系統（Spatial Movement & Ground Weight Shift）
  private spatialPos = new THREE.Vector3(0, 0, 0);
  private targetSpatialPos = new THREE.Vector3(0, 0, 0);
  private weightShiftTimer = 0;
  private weightShiftInterval = 9.0;
  private currentWeightShift = 0; // -1 (左腳重心) ~ +1 (右腳重心)
  private targetWeightShift = 0;

  private lastWidth = 0;
  private lastHeight = 0;

  // 程序化手勢與動作系統
  /** 上一幀被動作蓋掉的 morph 名稱，用來在動作結束時還原。 */
  private gestureMorphs = new Set<string>();

  private activeGesture: {
    name: CyreneGestureName;
    elapsed: number;
    duration?: number;
    /** 這次播放的隨機相位，讓同一個動作每次都不完全一樣（見 sampleGestureOffsets）。 */
    seed: number;
  } | null = null;

  constructor(options: VRMViewerOptions) {
    this.canvas = options.canvas;
    this.timer.connect(document);

    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera
    const initialWidth = this.canvas.clientWidth || window.innerWidth || 420;
    const initialHeight = this.canvas.clientHeight || window.innerHeight || 800;
    const aspect = initialWidth / (initialHeight || 1);

    this.camera = new THREE.PerspectiveCamera(32, aspect, 0.05, 100.0);
    this.camera.position.copy(this.cameraBasePos);

    // 3. WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(initialWidth, initialHeight, false);
    this.renderer.setPixelRatio(renderPixelRatio(window.devicePixelRatio));
    // 動漫模型不要用 ACES：它是為寫實 HDR 設計的，會把高光往白色壓並明顯
    // 去飽和。昔漣的貼圖本身就是粉彩色調，經過 ACES 之後粉紅和青綠會一起
    // 洗成灰白。關掉色調映射，讓貼圖的顏色直接呈現。
    this.renderer.toneMapping = THREE.NoToneMapping;
    // 明寫輸出色彩空間，免得日後升版預設值一改，整個亮度／飽和度又跑掉。
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.lastWidth = initialWidth;
    this.lastHeight = initialHeight;

    // 4. OrbitControls
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.copy(this.cameraLookAt);
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 5.0;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.2;
    this.controls.minPolarAngle = Math.PI / 4;

    // 5. 光影設置 (全方位明亮光影)
    this.setupLighting();

    // 5b. 3D 背景板與後處理。
    //
    // 順序重要：背景板要在場景裡才會進深度緩衝，景深才有東西可以糊。
    this.backdrop = new SceneBackdrop(this.scene, this.camera);
    this.room = new RoomScene(this.scene);
    this.postFX = new PostFX(this.renderer, this.scene, this.camera);

    // 6. 事件監聽
    this.handleResize = this.handleResize.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("mousemove", this.handleMouseMove);

    // 點擊/輕撫 3D 畫面頭頂區域直接觸發摸摸頭
    this.canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      if (ny < 0.42 && Math.abs(nx - 0.5) < 0.32) {
        this.playReaction({ gesture: "headPat", mood: "shyBlush" });
        if (options.onHeadpat) {
          options.onHeadpat();
        }
      }
    });

    // 7. 自動載入昔漣官方模型
    void this.loadBestCyreneModel(options.onLoaded, options.onError);

    // 8. 主渲染迴圈
    this.animate = this.animate.bind(this);
    this.animate();
  }

  private setupLighting(): void {
    // 全方位明亮通透的動漫光影配置：
    // 1. 均勻環境光（全面提亮底色與暗部）
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.78);
    this.scene.add(this.ambientLight);

    // 2. 主光源（明亮主光，塑造立體層次）
    this.mainLight = new THREE.DirectionalLight(0xffffff, 0.66);
    this.mainLight.position.set(0.6, 2.5, 2.0);
    this.scene.add(this.mainLight);

    // 3. 正面補光（溫暖粉白，提亮面部五官）
    this.frontLight = new THREE.DirectionalLight(0xfff8fd, 0.30);
    this.frontLight.position.set(0, 1.4, 2.5);
    this.scene.add(this.frontLight);

    // 4. 背後粉紫邊緣輪廓光（營造夢幻通透晶瑩感）
    this.rimLight = new THREE.DirectionalLight(0xf3e8ff, 0.28);
    this.rimLight.position.set(-1.5, 2.0, -1.5);
    this.scene.add(this.rimLight);
  }

  /**
   * 根據當前背景場景色溫與環境光，動態調節 3D 模型的打光，使昔漣與真實空間完全融為一體。
   */
  /**
   * 每個氛圍對應的 3D 背景圖。
   *
   * 沒列在這裡的（星空、極簡）沒有照片，背景板會隱藏，畫面回到透明 canvas
   * 疊 CSS 漸層的模式。
   */
  /**
   * 有 3D 房間版本的氛圍。
   *
   * 房間比照片好在角色站得住（照片的地板線跟 3D 的 y=0 沒有對應關係，
   * 怎麼調都像浮著）、景深有真實的深度梯度、相機一動有視差。
   */
  private static readonly ROOM_PRESETS: Record<string, RoomPreset> = {
    room: "bedroom",
    terrace: "terrace",
    astral: "astral",
  };

  private static readonly BACKDROP_IMAGES: Record<string, string> = {
    room: "backgrounds/bedroom.jpg",
    astral: "backgrounds/astral.jpg",
    terrace: "backgrounds/terrace.jpg",
  };

  /**
   * 丟一個道具進場景。會從角色上方掉下來、落在地板上，被她的身體推得動。
   */
  public spawnProp(kind: PropKind = "ball"): boolean {
    return this.interactiveWorld?.spawnProp(kind) ?? false;
  }

  /** 清掉場上所有道具（地板與接觸陰影留著）。 */
  public clearProps(): void {
    this.interactiveWorld?.clearProps();
  }

  public get propCount(): number {
    return this.interactiveWorld?.propCount ?? 0;
  }

  /**
   * 只為了地面接觸陰影而開的陰影貼圖。
   *
   * 先前是完全不開陰影的，理由仍然成立：真陰影會讓瀏海在臉上投出硬邊暗斑，
   * 這是動漫渲染最忌諱的。所以這裡的設定很克制 ——
   *   - 角色與道具 `castShadow`，但**都不** `receiveShadow`（不會自影）
   *   - 只有 `ShadowMaterial` 的地面承接
   *
   * ## 為什麼另開一盞燈而不是用 mainLight
   *
   * mainLight 在 (0.5, 2.2, 1.8)：水平距離 1.9、高度 2.2，入射角只有 49°，
   * 投出來的影子會往側前方拉得又長又偏，離腳下老遠 —— 那反而更像浮著，
   * 沒有「站在地上」的錨定感。
   *
   * 但也不能把 mainLight 挪到頭頂：它同時是角色的主要造型光，一動整個打光
   * 就變了。所以另外放一盞**只投影、不發光**（intensity 0）的頂光。
   * `ShadowMaterial` 看的是遮蔽率而不是光強度，intensity 0 照樣有影子。
   */
  private enableGroundShadow(result: PMXModelResult): void {
    this.renderer.shadowMap.enabled = true;
    // three 0.185 起 PCFSoftShadowMap 已棄用（會自動退回 PCFShadowMap），
    // 直接寫 PCFShadowMap 免得每次載入都印一行警告。
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const light = new THREE.DirectionalLight(0xffffff, 0);
    light.position.set(0.35, 4.2, 0.75);
    light.target.position.set(0, 0, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 8;
    light.shadow.camera.left = -1.2;
    light.shadow.camera.right = 1.2;
    light.shadow.camera.top = 1.2;
    light.shadow.camera.bottom = -1.2;
    // 布料很薄，預設的 bias 會讓影子從自己身上滲出來。
    light.shadow.bias = -0.0015;
    light.shadow.camera.updateProjectionMatrix();
    this.scene.add(light);
    this.scene.add(light.target);
    this.shadowLight = light;

    result.mesh.castShadow = true;
    result.mesh.receiveShadow = false;
  }

  /**
   * 播放一段 VMD 動作檔。
   *
   * 播放期間程序化手勢會自動讓位（見 `animate`），播完自動交還。
   *
   * @param url  VMD 檔位址
   * @param loop 是否循環（跳舞用；單次演出留 false）
   */
  public async playVMD(url: string, loop = false): Promise<boolean> {
    if (!this.vmdPlayer) {
      console.warn("[3D] VMD 播放器未就緒（模型缺少物理／骨骼資料）");
      return false;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const vmd = (await this.parseVMD(await response.arrayBuffer())) as ParsedVMD;
      this.vmdPlayer.play(vmd, { loop, name: url });
      console.log(
        "[3D] VMD 播放中：", url,
        "／骨骼關鍵格", vmd.metadata?.motionCount ?? 0,
        "／表情關鍵格", vmd.metadata?.morphCount ?? 0
      );
      return true;
    } catch (error) {
      console.warn("[3D] VMD 播放失敗：", url, error);
      return false;
    }
  }

  /** 停止 VMD，交還給程序化手勢。 */
  public stopVMD(): void {
    this.vmdPlayer?.stop();
  }

  private parseVMD(buffer: ArrayBuffer): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./pmx-parser.worker.ts", import.meta.url), {
        type: "module",
        name: "cyrene-vmd-parser",
      });
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error("VMD 解析逾時（20 秒）"));
      }, 20_000);
      worker.onmessage = (event: MessageEvent<{ ok: boolean; pmx?: unknown; error?: string }>) => {
        window.clearTimeout(timeout);
        worker.terminate();
        if (event.data.ok) resolve(event.data.pmx);
        else reject(new Error(event.data.error || "VMD 解析失敗"));
      };
      worker.onerror = (event) => {
        window.clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || "VMD 解析 Worker 發生錯誤"));
      };
      worker.postMessage({ buffer, kind: "vmd" });
    });
  }

  /**
   * 調整後處理品質。
   *
   * `off` 會整條後處理鏈拆掉、直接 `renderer.render`，低階機器或使用者
   * 不想要景深時可以關。
   */
  public setPostFXQuality(quality: PostFXQuality): void {
    this.postFX?.setQuality(quality);
  }

  /** 目前的氛圍是否使用 3D 背景板（呼叫端據此決定要不要隱藏 CSS 背景層）。 */
  public usesSceneBackdrop(bg: string): boolean {
    return bg in Cyrene3DViewer.ROOM_PRESETS || bg in Cyrene3DViewer.BACKDROP_IMAGES;
  }

  public setEnvironmentLighting(bg: string): void {
    // 有對應的 3D 房間就蓋房間，否則退回照片背景板。
    //
    // 兩者不能同時開：房間是實體幾何，背景板是貼在相機前方 20 單位的平面，
    // 疊在一起等於用一張照片把整個房間糊掉。
    const roomPreset = Cyrene3DViewer.ROOM_PRESETS[bg];
    if (roomPreset) {
      this.room?.build(roomPreset);
      void this.backdrop?.setImage(null);
    } else {
      this.room?.hide();
      const image = Cyrene3DViewer.BACKDROP_IMAGES[bg];
      void this.backdrop?.setImage(image ? resolveAsset(image) : null);
    }

    if (!this.ambientLight || !this.mainLight || !this.frontLight || !this.rimLight) return;
    switch (bg) {
      case "room":
        // 昔漣臥室：溫暖檯燈琥珀光 + 暮光微紫輪廓
        this.ambientLight.color.setHex(0xffede2);
        this.ambientLight.intensity = 0.82;
        this.mainLight.color.setHex(0xfff3de);
        this.mainLight.intensity = 0.72;
        this.mainLight.position.set(0.5, 2.2, 1.8);
        this.frontLight.color.setHex(0xfff5ee);
        this.frontLight.intensity = 0.32;
        this.rimLight.color.setHex(0xedd8ff);
        this.rimLight.intensity = 0.30;
        break;
      case "astral":
        // 星穹列車：璀璨星光天窗金芒 + 深邃星雲紫輪廓光
        this.ambientLight.color.setHex(0xe8ebff);
        this.ambientLight.intensity = 0.80;
        this.mainLight.color.setHex(0xffeed2);
        this.mainLight.intensity = 0.85;
        this.mainLight.position.set(0.4, 2.6, 2.0);
        this.frontLight.color.setHex(0xfdf8ff);
        this.frontLight.intensity = 0.28;
        this.rimLight.color.setHex(0xf5d8ff);
        this.rimLight.intensity = 0.45;
        break;
      case "terrace":
        // 暮光露台：和風紙燈籠暖光 + 暮色紫粉環境 + 星空銀藍輪廓
        this.ambientLight.color.setHex(0xffe8f3);
        this.ambientLight.intensity = 0.82;
        this.mainLight.color.setHex(0xffedd8);
        this.mainLight.intensity = 0.75;
        this.mainLight.position.set(0.5, 2.2, 1.9);
        this.frontLight.color.setHex(0xfff2f8);
        this.frontLight.intensity = 0.30;
        this.rimLight.color.setHex(0xdfecff);
        this.rimLight.intensity = 0.35;
        break;
      case "starry":
      case "minimal":
      default:
        this.ambientLight.color.setHex(0xffffff);
        this.ambientLight.intensity = 0.78;
        this.mainLight.color.setHex(0xffffff);
        this.mainLight.intensity = 0.66;
        this.mainLight.position.set(0.6, 2.5, 2.0);
        this.frontLight.color.setHex(0xfff8fd);
        this.frontLight.intensity = 0.30;
        this.rimLight.color.setHex(0xf3e8ff);
        this.rimLight.intensity = 0.28;
        break;
    }
  }

  public async loadBestCyreneModel(onLoaded?: () => void, onError?: (err: unknown) => void): Promise<void> {
    const pmxLoader = new CyrenePMXLoader();
    const pmxPath = resolveAsset("models/pmx/cyrene/星穹铁道—大昔涟 物理优化.pmx");

    try {
      console.log("[3D] 正在載入昔漣官方 3D 模型...", pmxPath);
      const result = await pmxLoader.load(pmxPath);
      this.currentPmx = result;

      this.scene.add(result.root);

      // 彈簧骨要在骨架進場景、世界矩陣算過一輪之後才建立，
      // 否則各關節記下的「靜止尾端位置」會是錯的。
      result.root.updateMatrixWorld(true);
      this.springBones = new SpringBoneSystem(
        result.physicsBoneChains,
        result.colliders,
        result.physicsBoneCollisionMask
      );
      console.log(
        "[3D] 彈簧骨物理已就緒（退路）：",
        this.springBones.chainCount, "條鏈 /",
        this.springBones.jointCount, "個關節 /",
        this.springBones.colliderCount, "個碰撞體"
      );

      // VMD 播放器。順便把模型自帶的 4 條腿部 IK 鏈接上 —— 之前完全沒用到，
      // 沒有它的話 VMD 舞蹈動作移動 `足ＩＫ` 骨，腿卻整條僵在原地。
      if (result.physics && result.rawBones) {
        this.vmdPlayer = new VMDPlayer(result.mesh, {
          space: result.physics.space,
          pmxBones: result.rawBones,
          boneList: result.physics.boneList,
        });
        console.log("[3D] VMD 播放器已就緒／IK 鏈:", this.vmdPlayer.ikChainCount, "條");
      }

      // PMX 原生物理。載入是非同步的（ammo.js 有 1.8MB），不擋模型顯示：
      // 這段期間先由彈簧骨頂著，Bullet 一好就接手。
      void this.enableMMDPhysics(result);

      this.handRigs = {
        left: buildHandRig(result.bones, "left"),
        right: buildHandRig(result.bones, "right"),
      };
      this.twistRigs = {
        leftArm: buildTwistRig(result.bones, "左腕捩", "左腕", "左ひじ"),
        rightArm: buildTwistRig(result.bones, "右腕捩", "右腕", "右ひじ"),
        leftForearm: buildTwistRig(result.bones, "左手捩", "左ひじ", "左手首"),
        rightForearm: buildTwistRig(result.bones, "右手捩", "右ひじ", "右手首"),
      };
      this.armChains = {
        left: buildArmChain(result.bones, "left"),
        right: buildArmChain(result.bones, "right"),
      };
      this.bodyAnchors = buildBodyAnchors(result.bones, result.standingHeight);
      console.log(
        "[3D] 手部骨骼：",
        this.handRigs.left ? "左手 ✓" : "左手 ✗",
        this.handRigs.right ? "右手 ✓" : "右手 ✗",
        "／扭轉骨",
        Object.values(this.twistRigs).filter(Boolean).length, "根",
        "／付与骨", result.appendTransforms.length, "根"
      );

      // 取景：以頭部與胸口高度為基準，確保頭部在畫面上方 1/3、胸口居中，頭頂預留舒適空間不被標籤遮擋
      const headY = result.headCenter.y > 0 ? result.headCenter.y : 1.405;
      const targetLookAtY = headY - 0.065;
      this.cameraLookAt.set(0, targetLookAtY, 0);
      this.controls.target.copy(this.cameraLookAt);
      this.cameraBasePos.set(0, targetLookAtY + 0.04, headY * Cyrene3DViewer.CAMERA_DISTANCE.default);
      this.camera.position.copy(this.cameraBasePos);

      console.log("[3D] 昔漣官方 3D 模型載入成功！");
      onLoaded?.();
      return;
    } catch (pmxErr) {
      console.warn("[3D] PMX 載入失敗，切換 2D 備援:", pmxErr);
      onError?.(pmxErr);
    }
  }

  private handleResize(): void {
    if (!this.canvas) return;
    const width = this.canvas.clientWidth || window.innerWidth || 420;
    const height = this.canvas.clientHeight || window.innerHeight || 800;

    if (width === this.lastWidth && height === this.lastHeight) return;
    this.lastWidth = width;
    this.lastHeight = height;

    this.camera.aspect = width / (height || 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.postFX?.setSize(width, height);
    this.backdrop?.layout();
  }

  private handleMouseMove(e: MouseEvent): void {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    this.mouse.targetX = nx * 0.25;
    this.mouse.targetY = ny * 0.18;
  }

  /**
   * 啟用 PMX 原生剛體＋關節物理。
   *
   * 失敗（模型沒帶關節、ammo.js 載不起來、建構丟例外）一律安靜退回彈簧骨 ——
   * 這是畫面表現，不該讓整個通話畫面掛掉。
   */
  private async enableMMDPhysics(result: PMXModelResult): Promise<void> {
    if (!result.physics) {
      console.log("[3D] 模型未帶 PMX 關節，維持彈簧骨。");
      return;
    }
    try {
      const ammo = await loadAmmo();
      // 載入期間模型可能已經被換掉或釋放。
      if (this.currentPmx !== result) return;

      result.root.updateMatrixWorld(true);
      const physics = new MMDPhysics(ammo, result.physics, result.boneRestPositions);
      // 空跑一下讓裙襬落定，否則進場第一秒會看到布從綁定姿勢掉下來。
      // 分段進行（內部會 yield），期間畫面仍由彈簧骨驅動。
      await physics.warmup();
      if (this.currentPmx !== result) {
        physics.dispose();
        return;
      }

      this.mmdPhysics = physics;
      console.log(
        "[3D] PMX 原生物理已接手：",
        physics.bodyCount, "個剛體 /",
        physics.constraintCount, "個關節"
      );

      // 互動場景要跟角色共用同一個 Bullet 世界，她的身體才推得動道具。
      const worldExtras = new InteractiveWorld(
        ammo,
        physics.bulletWorld,
        result.physics.space,
        this.scene
      );
      worldExtras.addGround();
      worldExtras.addShadowCatcher();
      const patched = worldExtras.enableCharacterCollision(physics.kinematicBodies);
      this.interactiveWorld = worldExtras;
      this.enableGroundShadow(result);
      console.log(
        "[3D] 互動場景已建立：地板 ✓ 接觸陰影 ✓ ／角色碰撞遮罩已補",
        patched, "個剛體"
      );
    } catch (error) {
      console.warn("[3D] PMX 原生物理啟用失敗，維持彈簧骨：", error);
    }
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.pausedBeforeContextLoss = this.paused;
    this.paused = true;
    console.error("[3D] WebGL context lost; waiting for automatic restore");
  };

  private handleContextRestored = (): void => {
    this.paused = this.pausedBeforeContextLoss;
    this.timer.reset();
    console.info("[3D] WebGL context restored");
  };

  /** 排入一次瞬間表情。同一個 morph 重複觸發時重新計時，不疊加。 */
  private playExpressionBeat(morph: string, shape: ExpressionBeatShape): void {
    const existing = this.beats.find((b) => b.morph === morph);
    if (existing) {
      existing.elapsed = 0;
      return;
    }
    this.beats.push({ ...shape, morph, elapsed: 0 });
  }

  public setMood(mood: AvatarMood, duration?: number): void {
    // 眨眼是一個瞬間動作，不是心情：放一次 beat 就好，臉上的基準情緒維持原樣，
    // 否則她會一直用一隻眼睛跟你講完整段話。
    if (mood === "wink") {
      // 若當前心情眼睛已處於深度閉眼狀態（例如笑瞇瞇），不觸發單眼 wink，避免單側眼皮抽動
      const smile = this.currentPmx?.getMorphWeight("笑い") ?? 0;
      if (smile < 0.6) {
        this.playExpressionBeat("ウィンク", { attack: 0.09, hold: 0.13, release: 0.22, peak: 1.0 });
      }
      return;
    }

    // 特殊表情（撒嬌、生氣、驚訝、想睡、得意、祈禱等）預設 4.5 秒後自動回歸日常微笑/中性。
    // 害羞另外算：shyBlush 會把眨眼 morph 拉到滿（眼睛全閉），掛四秒半看起來像睡著了，
    // 那是一閃而過的神情，給一秒半就夠。
    const isSpecialMood = mood !== "neutral" && mood !== "talking";
    const defaultHold = MOOD_HOLD_SEC[mood] ?? (isSpecialMood ? SPECIAL_MOOD_HOLD_SEC : 0);
    this.moodDuration = duration !== undefined ? duration : defaultHold;
    this.moodTimer = 0;

    // 當前心情相同時（例如連續 TTS 語音 chunk 皆為 talking），保持當前姿態與表情連續流暢，
    // 絕不重複重置 Morph 與骨骼，徹底消除一句話接下一句話時的抖動與重置回原點感！
    if (this.currentMood === mood) {
      return;
    }

    this.currentMood = mood;
    if (this.currentPmx) {
      // 這三個基準值是「每一幀都重新寫進 morph」的（見 updateExpressions），
      // 只清 morph 沒有用——下一幀又會被寫回去。shyBlush 把 moodBlinkBase 設成 1.0
      // 等於眼睛永久閉著，換成別的動作也打不開；換心情時必須連基準值一起歸零。
      this.moodBlinkBase = 0;
      this.moodBlushBase = 0;
      this.moodSmileBase = 0;
      this.currentPmx.setMorphWeight("まばたき", 0);

      // 重置基礎情緒 Morph
      this.currentPmx.setMorphWeight("笑い", 0);
      this.currentPmx.setMorphWeight("笑い2", 0);
      this.currentPmx.setMorphWeight("喜び", 0);
      this.currentPmx.setMorphWeight("びっくり", 0);
      this.currentPmx.setMorphWeight("脸红", 0);
      this.currentPmx.setMorphWeight("照れ", 0);
      this.currentPmx.setMorphWeight("困る", 0);
      this.currentPmx.setMorphWeight("悲しい", 0);
      this.currentPmx.setMorphWeight("口角上げ", 0);
      this.currentPmx.setMorphWeight("にやり", 0);
      this.currentPmx.setMorphWeight("ウィンク", 0);
      this.currentPmx.setMorphWeight("ウィンク右", 0);
      this.currentPmx.setMorphWeight("ウィンク２", 0);
      this.currentPmx.setMorphWeight("ｳｨﾝｸ２右", 0);

      // 切換為其他心情時，移除所有正在播放的眨單眼 beat
      this.beats = this.beats.filter((b) => !BLINK_OVERLAPPING_MORPHS.has(b.morph));

      switch (mood) {
        case "happy":
          this.currentPmx.setMorphWeight("口角上げ", 0.7);
          this.currentPmx.setMorphWeight("照れ", 0.25);
          this.targetPose.head.set(0.02, 0.015, 0.035);
          this.targetPose.chest.set(0.012, 0, 0);
          this.targetPose.leftArm.set(0.18, 0.14, -0.45);
          this.targetPose.rightArm.set(0.18, -0.14, 0.45);
          this.targetSpatialPos.set(0, 0, 0.015);
          break;
        case "shy":
          this.currentPmx.setMorphWeight("困る", 0.3);
          this.currentPmx.setMorphWeight("口角上げ", 0.2);
          this.currentPmx.setMorphWeight("照れ", 0.7);
          this.targetPose.head.set(-0.04, -0.05, -0.02);
          this.targetPose.chest.set(-0.01, 0, 0);
          this.targetPose.leftArm.set(0.14, 0.10, -0.50);
          this.targetPose.rightArm.set(0.14, -0.10, 0.50);
          this.targetSpatialPos.set(-0.01, 0, -0.035);
          break;
        case "surprised":
          this.currentPmx.setMorphWeight("びっくり", 0.8);
          this.targetPose.head.set(-0.03, 0, 0.01);
          this.targetPose.chest.set(-0.018, 0, 0);
          this.targetPose.leftArm.set(0.20, 0.15, -0.42);
          this.targetPose.rightArm.set(0.20, -0.15, 0.42);
          this.targetSpatialPos.set(0, 0, -0.04);
          break;
        case "thinking":
          this.currentPmx.setMorphWeight("困る", 0.4);
          this.currentPmx.setMorphWeight("口角上げ", 0.2);
          this.targetPose.head.set(0.03, 0.04, -0.055);
          this.targetPose.chest.set(0.005, 0, 0);
          this.targetPose.leftArm.set(0.16, 0.12, -0.48);
          this.targetPose.rightArm.set(0.28, -0.16, 0.42);
          this.targetSpatialPos.set(0.01, 0, 0);
          break;
        case "sad":
          this.currentPmx.setMorphWeight("悲しい", 0.8);
          this.currentPmx.setMorphWeight("困る", 0.6);
          this.targetPose.head.set(-0.05, 0, -0.03);
          this.targetPose.chest.set(-0.015, 0, 0);
          this.targetPose.leftArm.set(0.14, 0.08, -0.50);
          this.targetPose.rightArm.set(0.14, -0.08, 0.50);
          this.targetSpatialPos.set(0, 0, -0.025);
          break;
        case "smug":
          this.currentPmx.setMorphWeight("にやり", 0.6);
          this.currentPmx.setMorphWeight("口角上げ", 0.4);
          this.targetPose.head.set(0.035, -0.02, -0.03);
          this.targetPose.chest.set(0.016, 0, 0);
          this.targetPose.leftArm.set(0.16, 0.12, -0.48);
          this.targetPose.rightArm.set(0.16, -0.12, 0.48);
          this.targetSpatialPos.set(-0.01, 0, 0.02);
          break;
        case "talking":
          this.currentPmx.setMorphWeight("口角上げ", 0.35);
          this.targetPose.head.set(0, 0, 0);
          this.targetPose.chest.set(0, 0, 0);
          this.targetPose.leftArm.set(0.16, 0.12, -0.48);
          this.targetPose.rightArm.set(0.16, -0.12, 0.48);
          this.targetSpatialPos.set(0, 0, 0.02);
          break;
        case "pout":
          this.currentPmx.setMorphWeight("困る", 0.35);
          this.currentPmx.setMorphWeight("照れ", 0.35);
          this.targetPose.head.set(-0.02, 0.05, -0.04);
          this.targetPose.chest.set(-0.01, 0, 0);
          this.targetPose.leftArm.set(0.18, 0.12, -0.46);
          this.targetPose.rightArm.set(0.18, -0.12, 0.46);
          this.targetSpatialPos.set(-0.012, 0, 0.015);
          break;
        case "excited":
          this.currentPmx.setMorphWeight("口角上げ", 0.85);
          this.currentPmx.setMorphWeight("喜び", 0.7);
          this.currentPmx.setMorphWeight("照れ", 0.3);
          this.targetPose.head.set(0.04, 0, 0.02);
          this.targetPose.chest.set(0.02, 0, 0);
          this.targetPose.leftArm.set(0.22, 0.16, -0.40);
          this.targetPose.rightArm.set(0.22, -0.16, 0.40);
          this.targetSpatialPos.set(0, 0, 0.045);
          break;
        case "sleepy":
          this.currentPmx.setMorphWeight("まばたき", 0.45);
          this.currentPmx.setMorphWeight("困る", 0.2);
          this.targetPose.head.set(-0.06, 0, -0.02);
          this.targetPose.chest.set(-0.015, 0, 0);
          this.targetPose.leftArm.set(0.12, 0.06, -0.52);
          this.targetPose.rightArm.set(0.12, -0.06, 0.52);
          this.targetSpatialPos.set(0, 0, -0.02);
          break;
        case "curious":
          this.currentPmx.setMorphWeight("びっくり", 0.4);
          this.currentPmx.setMorphWeight("口角上げ", 0.35);
          this.targetPose.head.set(0.03, -0.05, 0.06);
          this.targetPose.chest.set(0.015, 0, 0);
          this.targetPose.leftArm.set(0.16, 0.12, -0.48);
          this.targetPose.rightArm.set(0.16, -0.12, 0.48);
          this.targetSpatialPos.set(0.015, 0, 0.055);
          break;
        case "angry":
          this.currentPmx.setMorphWeight("困る", 0.6);
          this.currentPmx.setMorphWeight("照れ", 0.3);
          this.currentPmx.setMorphWeight("口角上げ", 0);
          this.targetPose.head.set(-0.04, 0.06, -0.05);
          this.targetPose.chest.set(-0.02, 0, 0);
          this.targetPose.leftArm.set(0.20, 0.14, -0.44);
          this.targetPose.rightArm.set(0.20, -0.14, 0.44);
          this.targetSpatialPos.set(-0.018, 0, 0.03);
          break;
        case "shyBlush":
          this.moodBlinkBase = 1.0;
          this.moodBlushBase = 1.0;
          this.moodSmileBase = 0.6;
          this.currentPmx.setMorphWeight("まばたき", 1.0);
          this.currentPmx.setMorphWeight("照れ", 1.0);
          this.currentPmx.setMorphWeight("笑い", 0.6);
          this.currentPmx.setMorphWeight("口角上げ", 0.55);
          this.currentPmx.setMorphWeight("困る", 0.2);
          this.targetPose.head.set(0.04, -0.04, 0.05);
          this.targetPose.chest.set(0.015, 0, 0);
          this.targetPose.leftArm.set(0.18, 0.12, -0.46);
          this.targetPose.rightArm.set(0.18, -0.12, 0.46);
          this.targetSpatialPos.set(-0.015, 0, -0.045);
          break;
        case "sweat":
          this.currentPmx.setMorphWeight("困る", 0.65);
          this.currentPmx.setMorphWeight("口角上げ", 0.3);
          this.currentPmx.setMorphWeight("悲しい", 0.35);
          this.targetPose.head.set(-0.03, 0.05, -0.06);
          this.targetPose.chest.set(-0.01, 0, 0);
          this.targetPose.leftArm.set(0.16, 0.10, -0.48);
          this.targetPose.rightArm.set(0.16, -0.10, 0.48);
          this.targetSpatialPos.set(0.01, 0, -0.025);
          break;
        case "winkHeart":
          this.currentPmx.setMorphWeight("口角上げ", 0.8);
          this.currentPmx.setMorphWeight("照れ", 0.45);
          this.playExpressionBeat("ウィンク", { attack: 0.1, hold: 0.2, release: 0.25, peak: 1.0 });
          this.targetPose.head.set(0.02, -0.03, 0.06);
          this.targetPose.chest.set(0.01, 0, 0);
          this.targetPose.leftArm.set(0.18, 0.12, -0.46);
          this.targetPose.rightArm.set(0.18, -0.12, 0.46);
          this.targetSpatialPos.set(0.01, 0, 0.04);
          break;
        case "yawn":
          this.currentPmx.setMorphWeight("まばたき", 0.6);
          this.currentPmx.setMorphWeight("困る", 0.3);
          this.targetPose.head.set(-0.08, 0, 0.02);
          this.targetPose.chest.set(-0.02, 0, 0);
          this.targetPose.leftArm.set(0.12, 0.06, -0.52);
          this.targetPose.rightArm.set(0.12, -0.06, 0.52);
          this.targetSpatialPos.set(0, 0, -0.02);
          break;
        case "proud":
          this.currentPmx.setMorphWeight("にやり", 0.7);
          this.currentPmx.setMorphWeight("口角上げ", 0.6);
          this.targetPose.head.set(-0.04, -0.03, -0.02);
          this.targetPose.chest.set(0.02, 0, 0);
          this.targetPose.leftArm.set(0.16, 0.12, -0.48);
          this.targetPose.rightArm.set(0.16, -0.12, 0.48);
          this.targetSpatialPos.set(-0.015, 0, 0.025);
          break;
        case "pray":
          this.currentPmx.setMorphWeight("笑い", 0.6);
          this.currentPmx.setMorphWeight("口角上げ", 0.5);
          this.currentPmx.setMorphWeight("照れ", 0.25);
          this.targetPose.head.set(0.04, 0, 0.02);
          this.targetPose.chest.set(0.02, 0, 0);
          this.targetPose.leftArm.set(0.16, 0.12, -0.48);
          this.targetPose.rightArm.set(0.16, -0.12, 0.48);
          this.targetSpatialPos.set(0, 0, 0.02);
          break;
        case "neutral":
        default:
          this.targetPose.head.set(0, 0, 0);
          this.targetPose.chest.set(0, 0, 0);
          this.targetPose.leftArm.set(0.16, 0.12, -0.48);
          this.targetPose.rightArm.set(0.16, -0.12, 0.48);
          this.targetSpatialPos.set(0, 0, 0);
          break;
      }
    }
  }

  /**
   * 觸發特定程序化動作／手勢。
   */
  public triggerGesture(name: CyreneGestureName, duration?: number): void {
    this.activeGesture = {
      name,
      elapsed: 0,
      duration,
      // 每次觸發換一個相位：同一個動作連按兩次不該長得像同一段影片。
      seed: Math.random() * Math.PI * 2,
    };

    // 動作自己帶表情。
    //
    // 動作庫的按鈕本來就會另外指定 mood，但 TTS 的 chunk 與閒置巡航都是直接
    // 呼叫這個函式 —— 那些路徑上她會做出打哈欠的身體卻掛著一張平靜的臉，
    // 動作看起來就「不像」。表情是這些動作辨識度的一半。
    const mood = GESTURE_DEFAULT_MOOD[name];
    if (mood) this.setMood(mood);
  }

  /** 目前是否有動作在播。閒置巡航要靠它避免打斷使用者剛點的動作。 */
  public get isGesturePlaying(): boolean {
    return this.activeGesture !== null;
  }

  /** 立刻收掉正在進行的動作（例如歌停了，手要從背後放下來）。 */
  public stopGesture(): void {
    this.activeGesture = null;
  }

  /**
   * 同步觸發「動作 + 表情」二位一體複合反應。
   */
  public playReaction(options: CompoundReactionOptions): void {
    if (options.mood) {
      this.setMood(options.mood, options.duration);
    }
    if (options.gesture) {
      this.triggerGesture(options.gesture, options.duration);
    }
  }

  /**
   * 簡易開口度設定（相容舊版呼叫，0.0~1.0）
   */
  public setMouthOpen(mouthOpen: number): void {
    const clamped = Math.min(Math.max(mouthOpen, 0), 1.0);
    this.targetVowels.a = clamped * 0.75;
    this.targetVowels.u = clamped * 0.25;
    this.targetVowels.i = 0;
    this.targetVowels.e = 0;
    this.targetVowels.o = 0;
  }

  /**
   * 由 TTS 音訊驅動嘴型。
   * 支援接收 5 母音權重物件 `{ a, i, u, e, o, vol }` 或傳統音量/開口數值。
   */
  public updateLipSync(
    volOrWeights: number | Partial<{ a: number; i: number; u: number; e: number; o: number; vol: number }>,
    brightness = 0.5
  ): void {
    if (typeof volOrWeights === "object" && volOrWeights !== null) {
      this.targetVowels.a = Math.min(1, Math.max(0, volOrWeights.a ?? 0));
      this.targetVowels.i = Math.min(1, Math.max(0, volOrWeights.i ?? 0));
      this.targetVowels.u = Math.min(1, Math.max(0, volOrWeights.u ?? 0));
      this.targetVowels.e = Math.min(1, Math.max(0, volOrWeights.e ?? 0));
      this.targetVowels.o = Math.min(1, Math.max(0, volOrWeights.o ?? 0));
    } else {
      const volume = typeof volOrWeights === "number" ? volOrWeights : 0;
      this.setMouthOpen(volume);
    }
  }

  private updateExpressions(delta: number): void {
    // 特殊表情計時自動回歸：害羞、生氣、撒嬌、驚訝等表情在預設時間結束後自然平滑回歸日常中性
    if (this.moodDuration > 0 && this.currentMood !== "neutral") {
      this.moodTimer += delta;
      if (this.moodTimer >= this.moodDuration) {
        this.moodDuration = 0;
        this.moodTimer = 0;
        this.setMood("neutral");
      }
    }

    // 五母音個別平滑逼近（張嘴 attack 0.6，閉嘴 decay 0.45）
    for (const key of ["a", "i", "u", "e", "o"] as const) {
      const target = this.targetVowels[key];
      const cur = this.currentVowels[key];
      const rate = target > cur ? 0.6 : 0.45;
      this.currentVowels[key] += (target - cur) * rate;
    }

    // 獲取當前情緒的眼睛閉合量（例如笑瞇瞇、悲傷眼皮等）
    const smileWeight = Math.max(
      this.currentPmx?.getMorphWeight("笑い") ?? 0,
      this.currentPmx?.getMorphWeight("笑い2") ?? 0
    );

    // 自然隨機眨眼系統（隨機 2.8s ~ 5.5s 間隔，15% 機率觸發靈動雙眨眼）
    this.blinkTimer += delta;
    // 眨單眼的當下或眼睛已經深度閉合（笑瞇瞇）時，不要再觸發雙眼眨眼，避免眼皮互相疊加穿透或左右眼不同步
    const winking = this.beats.some((b) => BLINK_OVERLAPPING_MORPHS.has(b.morph));
    const eyesAlreadyClosed = smileWeight >= 0.7;

    if (!this.isBlinking && !winking && !eyesAlreadyClosed && this.blinkTimer >= this.nextBlinkInterval) {
      this.isBlinking = true;
      this.blinkProgress = 0;
      this.blinkTimer = 0;
      this.nextBlinkInterval = Math.random() < 0.15 ? 0.35 : 2.8 + Math.random() * 2.7;
    }

    let blinkWeight = 0;
    if (this.isBlinking) {
      this.blinkProgress += delta * 8.5;
      if (this.blinkProgress <= 1.0) {
        const rawBlink = Math.sin(this.blinkProgress * Math.PI);
        // 眼睛已有笑瞇瞇閉合時，限制眨眼最大只補足剩餘的閉合空間，合計絕不超過 1.0
        blinkWeight = Math.min(rawBlink, Math.max(0, 1.0 - smileWeight));
      } else {
        this.isBlinking = false;
        blinkWeight = 0;
      }
    }

    // 昔漣 PMX 表情同步
    if (this.currentPmx) {
      const totalBlink = Math.min(1.0, this.moodBlinkBase + blinkWeight);
      this.currentPmx.setMorphWeight("まばたき", totalBlink);
      if (this.moodBlushBase > 0) {
        this.currentPmx.setMorphWeight("照れ", this.moodBlushBase);
      }
      if (this.moodSmileBase > 0) {
        this.currentPmx.setMorphWeight("笑い", this.moodSmileBase);
      }

      this.currentPmx.setMorphWeight("あ", this.currentVowels.a);
      this.currentPmx.setMorphWeight("い", this.currentVowels.i);
      this.currentPmx.setMorphWeight("う", this.currentVowels.u);
      this.currentPmx.setMorphWeight("え", this.currentVowels.e);
      this.currentPmx.setMorphWeight("お", this.currentVowels.o);

      // 瞬間表情疊在基準情緒之上，播完自己歸零並移除。
      for (let i = this.beats.length - 1; i >= 0; i--) {
        const beat = this.beats[i];
        beat.elapsed += delta;
        if (beat.elapsed >= expressionBeatDuration(beat)) {
          this.currentPmx.setMorphWeight(beat.morph, 0);
          this.beats.splice(i, 1);
          continue;
        }
        // 已經在眨眼途中才收到眨單眼時，兩者會短暫重疊：把單眼權重壓到
        // 「1 - 眨眼權重 - 笑瞇瞇閉眼量」，同一隻眼睛的合計就不會超過 1。
        const raw = expressionBeatWeight(beat, beat.elapsed);
        const weight = BLINK_OVERLAPPING_MORPHS.has(beat.morph)
          ? blinkSafeWinkWeight(raw, blinkWeight, smileWeight)
          : raw;
        this.currentPmx.setMorphWeight(beat.morph, weight);
      }
    }
  }

  /**
   * 套用動作自帶的表情 morph。
   *
   * 排在母音與心情之後（`updateExpressions` 先跑），所以動作要張嘴就真的
   * 張得開。上一幀寫過、這一幀不再需要的 morph 會被歸零 —— 少了這一步，
   * 打完哈欠她的嘴會一直開著。
   */
  private applyGestureMorphs(morphs?: Record<string, number>): void {
    if (!this.currentPmx) return;
    for (const name of this.gestureMorphs) {
      if (morphs && morphs[name] !== undefined) continue;
      this.currentPmx.setMorphWeight(name, 0);
      this.gestureMorphs.delete(name);
    }
    if (!morphs) return;
    for (const [name, weight] of Object.entries(morphs)) {
      if (typeof weight !== "number" || Number.isNaN(weight)) continue;
      this.currentPmx.setMorphWeight(name, Math.max(0, Math.min(1, weight)));
      this.gestureMorphs.add(name);
    }
  }

  private updateMotions(elapsed: number, delta: number): void {
    // 絲滑非線性彈簧追蹤
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.075;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.075;

    // 動作姿態平滑逼近（Smooth Pose Blending：跨句子連續過渡）
    const poseRate = Math.min(delta * 3.2, 1.0);
    this.currentPose.head.lerp(this.targetPose.head, poseRate);
    this.currentPose.chest.lerp(this.targetPose.chest, poseRate);
    this.currentPose.leftArm.lerp(this.targetPose.leftArm, poseRate);
    this.currentPose.rightArm.lerp(this.targetPose.rightArm, poseRate);

    // 程序化手勢偏移計算
    let gestureOffsets: GestureBoneOffsets | null = null;
    if (this.activeGesture) {
      this.activeGesture.elapsed += delta;
      gestureOffsets = sampleGestureOffsets(
        this.activeGesture.name,
        this.activeGesture.elapsed,
        this.activeGesture.duration,
        this.activeGesture.seed
      );
      if (!gestureOffsets) {
        this.activeGesture = null;
      }
    }
    this.applyGestureMorphs(gestureOffsets?.morphs);

    // 說話動態包絡線（連續平滑淡入淡出：當新的一句話開始時，從當前實際位置無縫自然銜接，絕不回原點或跳變）
    const vowelSum = this.currentVowels.a + this.currentVowels.i + this.currentVowels.u + this.currentVowels.e + this.currentVowels.o;
    const targetSpeechWeight = vowelSum > 0.03 ? 1.0 : 0.0;
    const speechBlendRate = targetSpeechWeight > this.speechWeight ? Math.min(delta * 7.0, 1.0) : Math.min(delta * 2.8, 1.0);
    this.speechWeight += (targetSpeechWeight - this.speechWeight) * speechBlendRate;

    // 擬真生命力微動（Organic Life Motion）：結合多頻非線性微擾與眼動微跳（Micro-saccade），徹底消除機械正弦感
    const organicHeadNoiseY = Math.sin(elapsed * 0.43) * 0.004 + Math.sin(elapsed * 1.17 + 0.9) * 0.0025;
    const organicHeadNoiseX = Math.cos(elapsed * 0.37) * 0.003 + Math.sin(elapsed * 0.89 + 0.3) * 0.002;
    const microSaccadeX = (Math.sin(elapsed * 2.7) > 0.96 ? 0.008 : 0) * (Math.sin(elapsed * 5.1) > 0 ? 1 : -1);
    const microSaccadeY = (Math.cos(elapsed * 2.3) > 0.97 ? 0.005 : 0) * (Math.cos(elapsed * 4.7) > 0 ? 1 : -1);

    // 說話語調起伏動態（隨母音開合能量自適應調節點頭與側傾強度）
    const voiceIntensityBoost = 1.0 + Math.min(vowelSum * 0.4, 0.6);
    const speechNod = (Math.sin(elapsed * 2.2) * 0.005 + Math.cos(elapsed * 1.3) * 0.003) * this.speechWeight * voiceIntensityBoost;
    const speechTilt = Math.sin(elapsed * 1.1) * 0.004 * this.speechWeight * voiceIntensityBoost;

    // 空間走動與真實重心地面踩踏動力學
    this.spatialPos.lerp(this.targetSpatialPos, Math.min(delta * 2.2, 1.0));

    this.weightShiftTimer += delta;
    if (this.weightShiftTimer >= this.weightShiftInterval) {
      this.weightShiftTimer = 0;
      this.weightShiftInterval = 7.0 + Math.random() * 7.0;
      const shifts = [-0.75, 0, 0.75];
      this.targetWeightShift = shifts[Math.floor(Math.random() * shifts.length)];
    }
    this.currentWeightShift += (this.targetWeightShift - this.currentWeightShift) * Math.min(delta * 1.6, 1.0);

    if (this.currentPmx) {
      // 靜態自然呼吸（呼吸純粹由胸腔與上脊椎旋轉擴張驅動，全身垂直高度固定為 0，雙腳踏實貼地）
      const breathMain = Math.sin(elapsed * 0.75);
      const breathSecondary = Math.sin(elapsed * 0.40 + 0.4);

      // 模型根節點：X 軸重心平移 + Z 軸空間走動，Y 軸嚴格鎖定為 0（絕不全身上下漂浮）
      this.currentPmx.root.position.set(
        this.spatialPos.x + this.currentWeightShift * 0.006,
        0,
        this.spatialPos.z
      );

      // 骨盆與腿（腿的網格靠付与帶動，見 pose-composer 與 append-transform）
      applyLegPose(this.currentPmx.bones, gestureOffsets, this.currentWeightShift);

      // 同步更新視訊畫面中的地面接觸陰影位置與縮放
      const shadowEl = document.querySelector(".call__ground-shadow") as HTMLElement | null;
      if (shadowEl) {
        const shadowX = (this.spatialPos.x + this.currentWeightShift * 0.006) * 550;
        const shadowScale = 1.0 + this.spatialPos.z * 1.8;
        shadowEl.style.transform = `translateX(calc(-50% + ${shadowX.toFixed(1)}px)) scale(${shadowScale.toFixed(3)})`;
      }

      const upperSpine = this.currentPmx.bones.get("上半身");
      const upperSpine2 = this.currentPmx.bones.get("上半身2");
      if (upperSpine2) {
        upperSpine2.rotation.x = breathMain * 0.003 + this.currentPose.chest.x + (gestureOffsets?.chest?.x ?? 0);
        upperSpine2.rotation.y = this.currentPose.chest.y + (gestureOffsets?.chest?.y ?? 0);
        upperSpine2.rotation.z = this.currentPose.chest.z + (gestureOffsets?.chest?.z ?? 0) + this.currentWeightShift * 0.012;
      }
      if (upperSpine) {
        upperSpine.rotation.x = breathSecondary * 0.0015 + (gestureOffsets?.spine?.x ?? 0);
        upperSpine.rotation.y = (gestureOffsets?.spine?.y ?? 0);
        upperSpine.rotation.z = (gestureOffsets?.spine?.z ?? 0) + this.currentWeightShift * 0.008;
      }

      const { headBone, neckBone } = this.currentPmx;
      if (headBone) {
        // 有骨骼就只轉頭：視線追蹤 + 情緒姿態 + 擬真有機微動 + 手勢動作偏移
        headBone.rotation.y = this.mouse.x * 0.35 + organicHeadNoiseY + microSaccadeX + this.currentPose.head.y + (gestureOffsets?.head?.y ?? 0);
        headBone.rotation.x = Math.max(-0.25, Math.min(0.25, -this.mouse.y * 0.20 + organicHeadNoiseX + microSaccadeY + this.currentPose.head.x + speechNod + (gestureOffsets?.head?.x ?? 0)));
        headBone.rotation.z = -this.mouse.x * 0.06 + this.currentPose.head.z + speechTilt + (gestureOffsets?.head?.z ?? 0);
        if (neckBone) {
          neckBone.rotation.y = this.mouse.x * 0.12 + organicHeadNoiseY * 0.4 + this.currentPose.head.y * 0.3 + (gestureOffsets?.neck?.y ?? 0);
          neckBone.rotation.x = Math.max(-0.15, Math.min(0.15, -this.mouse.y * 0.07 + organicHeadNoiseX * 0.3 + speechNod * 0.3 + (gestureOffsets?.neck?.x ?? 0)));
          neckBone.rotation.z = (gestureOffsets?.neck?.z ?? 0);
        }
        // 骨骼接手後，root 不再整體旋轉。
        this.currentPmx.root.rotation.set(0, 0, 0);
      } else {
        // 沒有骨骼（模型不含標準骨）時退回原本的整體旋轉。
        this.currentPmx.root.rotation.y = this.mouse.x * 0.18 + organicHeadNoiseY;
        this.currentPmx.root.rotation.x = -this.mouse.y * 0.10 + organicHeadNoiseX;
        this.currentPmx.root.rotation.z = -this.mouse.x * 0.04;
      }

      // 肩、臂、肘、腕、扭轉骨與手指。實際寫進骨頭的那一份在 pose-composer，
      // 測試量測手最後落在哪裡時走的是同一份程式（見 gesture-reach.test.ts）。
      const poseRigs: PoseRigs = {
        hands: this.handRigs,
        twists: this.twistRigs,
        arms: this.armChains,
        ...(this.bodyAnchors ? { anchors: this.bodyAnchors } : {}),
        updateWorld: () => this.currentPmx?.root.updateMatrixWorld(true),
        root: this.currentPmx.root,
        headBone: this.currentPmx.headBone,
      };
      applyArmPose(
        this.currentPmx.bones,
        poseRigs,
        gestureOffsets,
        { left: this.currentPose.leftArm, right: this.currentPose.rightArm },
        {
          // 待機的手臂微擺。原本只有 0.003 弧度（0.17 度），肉眼等於不動；
          // 手臂完全靜止是「像人偶」最明顯的一點，放大到 1 度左右才看得出
          // 她只是站著，而不是被擺在那裡。左右頻率刻意不成比例，不會同步。
          leftArmSway: Math.sin(elapsed * 0.65) * 0.012 + Math.sin(elapsed * 0.32 + 1.1) * 0.006,
          rightArmSway: Math.sin(elapsed * 0.53 + 0.9) * 0.011 + Math.sin(elapsed * 0.28 + 2.4) * 0.006,
          leftArmLift: Math.sin(elapsed * 0.38 + 0.3) * 0.009,
          rightArmLift: Math.sin(elapsed * 0.31 + 1.9) * 0.008,
          leftElbowFollow: Math.sin(elapsed * 1.50 - 0.55) * 0.018,
          rightElbowFollow: Math.sin(elapsed * 1.37 + 0.9 - 0.55) * 0.018,
          leftHandDrift: 0.06 + Math.sin(elapsed * 0.55) * 0.06,
          rightHandDrift: 0.06 + Math.sin(elapsed * 0.41 + 1.7) * 0.06,
        }
      );

      // 眼球。`両目` 一根骨頭透過付与帶動左右眼，所以只要寫這一根。
      const eyes = this.currentPmx.bones.get("両目");
      if (eyes) {
        eyes.rotation.set(
          -this.mouse.y * 0.06 + (gestureOffsets?.eyes?.x ?? 0),
          this.mouse.x * 0.10 + (gestureOffsets?.eyes?.y ?? 0),
          gestureOffsets?.eyes?.z ?? 0
        );
      }

      // 付与要在所有骨頭都擺好之後、彈簧骨之前跑：腿的網格、前臂扭轉分散骨
      // 與眼球都掛在這一步上。
      this.currentPmx.applyAppendTransforms();
    }

    this.controls.update();
  }

  private animate(timestamp?: DOMHighResTimeStamp): void {
    this.animFrameId = requestAnimationFrame(this.animate);
    this.timer.update(timestamp);

    if (this.paused || document.hidden) {
      return;
    }

    // 自動偵測畫布尺寸變化
    const curW = this.canvas.clientWidth || window.innerWidth || 420;
    const curH = this.canvas.clientHeight || window.innerHeight || 800;
    if (curW !== this.lastWidth || curH !== this.lastHeight) {
      this.handleResize();
    }

    // 單幀時間上限。
    //
    // `THREE.Timer` 不會自己夾住 delta：分頁切走再切回來（rAF 停了幾秒甚至
    // 幾分鐘）之後，回來的第一幀 delta 是好幾秒。那一幀會讓進行中的動作
    // elapsed 一次跳過整個時長、當場被判定播完 —— 實測切回來時觸發的動作
    // 在第一幀就被清掉，手完全沒抬起來。
    //
    // 0.1 秒等於 10 FPS，比這更糟的畫面本來就不該用真實時間推進。
    const delta = Math.min(this.timer.getDelta(), 0.1);
    const elapsed = this.timer.getElapsed();

    this.updateExpressions(delta);
    // VMD 播放期間程序化手勢必須讓位：兩邊都在寫同一批骨頭的 quaternion，
    // 同時跑的話手臂會在「動作檔的姿勢」與「手勢的姿勢」之間高頻抖動。
    if (this.vmdPlayer?.playing) {
      this.vmdPlayer.update(delta);
    } else {
      this.updateMotions(elapsed, delta);
    }

    // 彈簧骨吃的是上游骨骼的世界矩陣，所以必須排在頭部追蹤與呼吸位移之後，
    // 並先把整棵骨架的矩陣更新到最新，頭髮才會跟著頭的轉動甩起來。
    //
    // 物理走固定步長（穩定），畫面在最近兩個物理步之間插值（平順）。
    //
    // 只有固定步長會出問題：步長 1/60 而畫面也是 60Hz，兩者頻率相同但相位會漂，
    // 累加器有時湊不滿一步（這一幀頭髮完全不動）、有時湊滿兩步（下一幀走雙倍）。
    // 頭在連續轉動、頭髮卻在「不動 / 走雙倍」之間交替——實機量到髮尾速度的
    // 自相關 lag1 = -0.78、方向反轉率 38%，就是這個。
    //
    // 只用實際幀時間也不行：Verlet 的手感與步長綁在一起，步長忽長忽短同樣會抖
    // （合成測試餵 12/22ms 交替時 lag1 = -0.95）。
    //
    // 兩者分開才對：物理維持自己的固定時間軸，畫面則取插值。
    if (this.mmdPhysics && this.currentPmx) {
      // Bullet 自己就是固定步長累加器（`stepSimulation` 的第二、三個參數），
      // 而且會在子步之間插值。外面再包一層 FixedStepScheduler 只會讓兩個
      // 累加器互相打拍子，所以這條路徑直接餵真實 delta。
      this.currentPmx.root.updateMatrixWorld(true);
      this.mmdPhysics.update(delta);
      // 道具的 mesh 要在物理步進之後才同步，否則畫面永遠慢一幀。
      this.interactiveWorld?.sync();
    } else {
      let physicsDelta = this.physicsScheduler.advance(delta);
      while (physicsDelta > 0 && this.springBones && this.currentPmx) {
        this.currentPmx.root.updateMatrixWorld(true);
        this.springBones.update(physicsDelta);
        physicsDelta = this.physicsScheduler.advance(0);
      }
      this.springBones?.applyInterpolated(this.physicsScheduler.alpha);
    }

    // 對焦點跟著身體中段走（不是頭）。
    //
    // 用頭當對焦點的話，頭到腳的距離差會單向累積到下半身，裙襬和腳先失焦；
    // 放在上半身這一節，誤差對兩端對稱，整個人才會一起在景深內。
    const focusBone = this.currentPmx?.bones.get("上半身") ?? this.currentPmx?.headBone;
    if (this.postFX && focusBone) {
      focusBone.getWorldPosition(this.focusPoint);
      this.postFX.setFocusPoint(this.focusPoint);
    }

    if (!this.postFX?.render(delta)) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** 每幀重複使用，避免在算對焦點時配置新物件。 */
  private readonly focusPoint = new THREE.Vector3();

  public setCameraView(view: "full" | "upper" | "face" | "reset"): void {
    const headY = this.currentPmx?.headCenter.y && this.currentPmx.headCenter.y > 0 ? this.currentPmx.headCenter.y : 1.405;
    const defaultLookAtY = headY - 0.065;

    switch (view) {
      case "full":
        // 全身視角：完整展示昔漣全身華麗服飾與裙襬，**並且看得到腳邊的地面**。
        //
        // 舊參數是 (0, 0.95, 2.75) / target (0, 0.82, 0)，名字叫「全身」但實際
        // 把腳切在畫面外：實測腳底投影到 NDC y = −1.02（畫面下緣是 −1）。
        // 地面完全不在框內，於是物理道具落地之後永遠看不到 —— 丟東西這個功能
        // 等於不能用。
        //
        // 現在這組實測：腳底 −0.81、身前地面 −0.89、頭頂 0.90，
        // 上下都留了餘裕。
        this.camera.position.set(0, headY * 0.68, headY * Cyrene3DViewer.CAMERA_DISTANCE.full);
        this.controls.target.set(0, headY * 0.6, 0);
        break;
      case "upper":
        // 半身視角：日常互動與動作特寫
        this.camera.position.set(
          0,
          defaultLookAtY + 0.04,
          headY * Cyrene3DViewer.CAMERA_DISTANCE.upper
        );
        this.controls.target.set(0, defaultLookAtY, 0);
        break;
      case "face":
        // 臉部特寫：細緻觀賞面部表情、眼神與髮飾
        this.camera.position.set(
          0,
          headY + 0.02,
          headY * Cyrene3DViewer.CAMERA_DISTANCE.face
        );
        this.controls.target.set(0, headY - 0.01, 0);
        break;
      case "reset":
      default:
        this.camera.position.copy(this.cameraBasePos);
        this.controls.target.copy(this.cameraLookAt);
        break;
    }
    this.controls.update();
    // 相機距離變了，背景板要重新撐滿視錐。
    this.backdrop?.layout();
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.timer.reset();
      this.physicsScheduler.reset();
      // 暫停期間骨頭可能被擺到別的姿勢，剛體還停在舊位置。
      // 不重設的話恢復第一幀會有一股把布料從舊位置扯回來的暴衝。
      this.mmdPhysics?.reset();
    }
  }

  public dispose(): void {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("mousemove", this.handleMouseMove);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.timer.dispose();
    this.controls.dispose();
    this.mmdPhysics?.dispose();
    this.mmdPhysics = null;
    this.interactiveWorld?.dispose();
    this.interactiveWorld = null;
    this.vmdPlayer?.dispose();
    this.vmdPlayer = null;
    this.postFX?.dispose();
    this.postFX = null;
    this.backdrop?.dispose();
    this.backdrop = null;
    this.room?.dispose();
    this.room = null;

    if (this.currentPmx) {
      this.scene.remove(this.currentPmx.root);
      this.currentPmx.mesh.geometry.dispose();
      if (Array.isArray(this.currentPmx.mesh.material)) {
        const textures = new Set<THREE.Texture>();
        this.currentPmx.mesh.material.forEach((material) => {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) textures.add(value);
          }
          material.dispose();
        });
        textures.forEach((texture) => texture.dispose());
      } else {
        (this.currentPmx.mesh.material as THREE.Material).dispose();
      }
      this.currentPmx = null;
    }
    this.renderer.dispose();
  }
}
