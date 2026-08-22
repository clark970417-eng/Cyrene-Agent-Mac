import * as THREE from "three";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import { applyAppendTransforms, type AppendTransformEntry } from "./append-transform";
import { buildMMDPhysicsPayload, collectBoneRestPositions } from "./mmd-physics";
import { buildSyntheticAppendTransforms } from "./shoulder-strap";
import type { MMDPhysicsPayload } from "./mmd-physics";
import type { RawPMXIKBone } from "./vmd-animation";

/**
 * 由 PMX kinematic 剛體（type 0）轉換來的碰撞體。
 *
 * 這類剛體在 MMD 裡不參與動力學，純粹是「身體的形狀」，用來擋住頭髮與裙襬。
 * 位移與軸向都已換算成 three.js 場景座標，且相對於所屬骨頭的本地空間，
 * 所以骨頭一動碰撞體就跟著動。
 */
export interface PMXCollider {
  bone: THREE.Bone;
  shape: "sphere" | "capsule";
  /** 半徑（場景單位）。 */
  radius: number;
  /** 膠囊圓柱段的長度；球體為 0。 */
  height: number;
  /** 相對骨頭的本地位移。 */
  offset: THREE.Vector3;
  /** 膠囊在骨頭本地空間中的軸向（單位向量）；球體不使用。 */
  axis: THREE.Vector3;
  /** 所屬碰撞群組（0~15）。搖擺骨要靠自己的遮罩決定要不要理它。 */
  group: number;
}

/**
 * 飽和度倍率（1.0 = 原色）。搭配 vrm-viewer 調降後的燈光使用：
 * 燈光壓回不過曝的範圍避免亮部燒白，這裡再把彩度推回來。
 */
const COLOR_SATURATION = "1.30";

/**
 * toon ramp 暗部的加深係數（1.0 = 照模型原值）。
 *
 * 這顆模型的 ramp **本身幾乎是平的**：身體材質的陰影端是 213/255 = 0.84，
 * 只比受光端暗 16%。結果整個身體看起來是一片死白、沒有體積 ——
 * 而且這不是燈光的問題，減環境光也救不回 ramp 本身沒有的對比
 * （實測 amb 0.82 → 0.30 + 方向光加倍，差異很小）。
 *
 * 0.65 是實機 A/B 挑的：胸下、軀幹側面、手臂都重新有了形體，又不會髒。
 * 0.80 太輕、看不太出來。
 *
 * 只作用在 32 階的 ramp；臉是另外壓平的（`flattenToonGradient`），
 * 不受這裡影響 —— 臉本來就刻意不要明暗。
 */
const SHADOW_DEPTH = 0.65;

/**
 * 一張貼圖的 alpha 通道統計，用來決定材質要走「混合」還是「鏤空」。
 */
export interface AlphaProfile {
  /** 有任何不是完全不透明的 texel（沒有的話連 alphaTest 都不用開）。 */
  hasAlpha: boolean;
  /** alpha 落在 20~235 之間（真正的半透明）的 texel 佔比。 */
  softRatio: number;
}

/** 漫符材質，以及會把它推進畫面的 morph 名稱。 */
interface EmoteMarkInfo {
  /** 材質索引 → 是不是漫符。 */
  isMark: boolean[];
  /** 名字像符號（怒／！／？／汗／びっくり）而且真的動到漫符頂點的 morph。 */
  morphNames: string[];
}

/**
 * 漫符要現身的最低 morph 權重。
 *
 * 漫符（`怒`／`！`／`汗` 那幾片方片）平常必須是**隱藏**的。
 * 它們在靜止姿勢下 8 片疊在額頭上（見 splitEmoteMarkMaterials），深度擋不住 ——
 * 那個位置本來就在頭的表面外側。
 *
 * 所以顯示與否要直接由驅動它的 morph 權重決定，不能交給深度。
 */
const EMOTE_MARK_VISIBLE_THRESHOLD = 0.35;

/**
 * 漫符的 morph **不做插值**，過門檻就直接跳到 1。
 *
 * 漫符是靠頂點 morph 從頭裡推到頭旁邊的。權重照常從 0 漸變到 1 的話，
 * 那幾片方片會**從額頭上慢慢滑出來**，整段滑行都看得一清二楚。
 * 漫畫符號的語言是「啪一聲出現在該在的位置」，
 * 不是從腦袋裡被拖出來。
 *
 * 所以驅動漫符的 morph 一律吃 0 或 1：位置永遠是最終位置，
 * 出現與否交給材質的 `visible`（同一個門檻）。
 */
const EMOTE_MARK_SNAP = true;

/** 一個材質最終的透明度設定。 */
export interface AlphaPolicy {
  transparent: boolean;
  depthWrite: boolean;
  alphaTest: number;
  /** 只有真半透明才需要疊層混合；其餘交給 three 關掉混合器。 */
  translucent: boolean;
}

/**
 * 把一個材質分到三條路的其中一條。純函式，方便測試釘住分界。
 *
 *   1. **不透明**（貼圖沒有 alpha）：不混合、寫深度、不做 alphaTest。
 *   2. **鏤空**（alpha 是二值的）：不混合、寫深度、alphaTest 0.5。
 *      蕾絲、彩虹內裡花紋、鏤空裙片走這條 —— 走不透明通道，深度排序是硬的。
 *   3. **真半透明**（有大量中間 alpha，或作者把 diffuse alpha 調低）：
 *      混合、不寫深度、alphaTest 0.01。只有薄紗這類。
 *
 * `isDoubleShell`（零厚度雙殼，正反兩面同一片布）即使半透明也要寫深度，
 * 否則布折到自己前面時只會照材質順序覆蓋。
 */
export function classifyAlpha(
  profile: AlphaProfile,
  diffuseAlpha: number,
  isDoubleShell: boolean
): AlphaPolicy {
  const translucent =
    diffuseAlpha < 0.99 || profile.softRatio >= SHEER_ALPHA_RATIO;
  return {
    translucent,
    transparent: translucent,
    // **角色的材質一律寫深度，半透明的也是。**
    //
    // 教科書寫法是「半透明不寫深度」，那是為了讓後面的層透得出來。但這裡有
    // 後處理的景深：CoC 是從深度緩衝算的，不寫深度的面片就會拿它**背後**的
    // 深度來算 —— 背後是背景的話，那片就被當成遠景糊掉。頭飾的白葉子
    // （`发饰叶`）就是這樣被糊成一團的，漫符也犯過同一個錯。
    //
    // 代價是同一顆網格裡的半透明層只能照材質索引排序而不是照深度；實測這顆
    // 模型沒有可見的差別（PMX 的材質順序本來就大致是由內到外），而葉子、
    // 袖紗、肩後紗全部變清晰。`isDoubleShell` 本來就已經是這個行為。
    depthWrite: true,
    alphaTest: translucent ? 0.01 : profile.hasAlpha ? CUTOUT_ALPHA_TEST : 0,
  };
}

/** 一個待套用透明度政策的材質。 */
interface AlphaPolicyEntry {
  mat: THREE.MeshToonMaterial;
  texName: string;
  initialOpacity: number;
  isDoubleShell: boolean;
  isEmoteMark: boolean;
  isDecalOverlay: boolean;
}

/** 量 alpha 時的取樣邊長。4096×2048 的貼圖不需要逐 texel 讀。 */
const ALPHA_SAMPLE_SIZE = 256;

/**
 * 半透明 texel 佔比超過這個值，才算「真的薄紗」而走混合通道。
 *
 * **透明度必須由貼圖真正的 alpha 決定，不能由材質名稱決定。**
 * 先前的規則是「名稱含 袖／衣2／叶／发饰／裙链，或貼圖是 纱/衣3/衣5」就一律
 * `transparent: true`，結果實測（256×256 取樣的半透 texel 佔比）是：
 *
 *   纱.png   24.5%  → 真薄紗
 *   衣2.png   0.5%  → 二值鏤空
 *   衣3.png   1.1%  → 二值鏤空
 *   衣5.png   1.3%  → 二值鏤空
 *   衣.png    0.0%  → 完全沒有 alpha 通道內容
 *
 * 也就是主裙、上衣、彩虹內裡這**兩萬多個面**全被丟進了混合通道：它們排在不
 * 透明通道之後畫、彼此之間只能照材質索引排序，而 alphaTest 又只有 0.08，
 * 於是衣服邊緣那圈半透 texel 會直接把底下的身體與內層透出來 —— 看起來就是
 * 「人物是半透明的，穿模」。
 *
 * 0.05 這條線把 纱.png(0.245) 與最接近的鏤空貼圖 衣5.png(0.013) 分得很開，
 * 不是壓在邊界上硬切。
 */
const SHEER_ALPHA_RATIO = 0.05;

/**
 * 二值鏤空的 alpha 門檻。
 *
 * 鏤空走的是不透明通道，沒有混合可以幫忙柔化邊緣，門檻要落在中間才不會在
 * 輪廓外圍留一圈 mipmap 淡出的半透明毛邊（0.08 等於「幾乎全留」）。
 */
const CUTOUT_ALPHA_TEST = 0.5;


export interface PMXModelResult {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  morphTargetDictionary: Record<string, number>;
  setMorphWeight: (name: string, weight: number) => void;
  getMorphWeight: (name: string) => number;
  headCenter: THREE.Vector3;
  /** 依骨名索引的骨頭表（日文標準骨名，如「頭」「首」「上半身2」）。 */
  bones: Map<string, THREE.Bone>;
  headBone: THREE.Bone | null;
  neckBone: THREE.Bone | null;
  /**
   * PMX 剛體標記為物理驅動的骨頭，已組成由根到末端的骨鏈
   * （頭髮、頭紗、裙襬、袖子等），可直接餵給 SpringBoneSystem。
   */
  physicsBoneChains: THREE.Bone[][];
  /** 身體的碰撞形狀，供彈簧骨避免頭髮／裙襬穿模。 */
  colliders: PMXCollider[];
  /** 搖擺骨 → PMX 碰撞遮罩（位元 N 代表「會碰群組 N」）。 */
  physicsBoneCollisionMask: Map<THREE.Bone, number>;
  /** 付与（跟隨其他骨頭旋轉）的骨頭清單，見 PMXAppendTransform。 */
  appendTransforms: PMXAppendTransform[];
  /**
   * PMX 原生剛體＋關節，可直接餵給 `MMDPhysics`（Bullet）。
   *
   * 模型沒帶關節時是 null，這時候會退回 `physicsBoneChains` + `colliders`
   * 的彈簧骨路徑。
   */
  physics: MMDPhysicsPayload | null;
  /** 骨頭在 PMX 空間的靜止位置，依 PMX 骨索引。 */
  boneRestPositions: THREE.Vector3[];
  /**
   * 站立高度（場景單位，腳底到頭頂含髮飾）。
   *
   * 任何「相對於角色尺寸」的常數都該乘上它，而不是寫死公尺數 ——
   * 見 body-anchors.ts 那次因為寫死而整表歪掉的教訓。
   */
  standingHeight: number;
  /**
   * PMX 骨頭原始資料，依骨索引。目前只有 IK 設定會用到
   * （見 vmd-animation.ts 的 buildIKConfig）。
   */
  rawBones: RawPMXIKBone[];
  /**
   * 套用所有付与關係。每幀擺完姿勢、算彈簧骨之前呼叫一次。
   *
   * 不呼叫的話腿（`足D` 鏈）與前臂扭轉分散骨（`腕捩1~3`）完全不會動 ——
   * 它們不是被擺姿勢的那幾根骨頭的子骨。
   */
  applyAppendTransforms: () => void;
}

/** PMX 的付与關係，見 append-transform.ts。 */
export type PMXAppendTransform = AppendTransformEntry;

export class CyrenePMXLoader {
  private tgaLoader = new TGALoader();
  private textureLoader = new THREE.TextureLoader();
  /** 同一張貼圖會被多個材質共用（例如 64 個材質只用到 19 張圖），快取避免重複下載。 */
  private textureCache = new Map<string, THREE.Texture>();
  /** 貼圖檔名 → alpha 統計（見 AlphaProfile）。一張貼圖只量一次。 */
  private alphaProfileCache = new Map<string, Promise<AlphaProfile>>();

  private parseInWorker(arrayBuffer: ArrayBuffer): Promise<any> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./pmx-parser.worker.ts", import.meta.url), {
        type: "module",
        name: "cyrene-pmx-parser",
      });
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error("PMX 解析逾時（20 秒）"));
      }, 20_000);
      const finish = (): void => {
        window.clearTimeout(timeout);
        worker.terminate();
      };

      worker.onmessage = (event: MessageEvent<{ ok: boolean; pmx?: unknown; error?: string }>) => {
        finish();
        if (event.data.ok) resolve(event.data.pmx);
        else reject(new Error(event.data.error || "PMX 解析失敗"));
      };
      worker.onerror = (event) => {
        finish();
        reject(new Error(event.message || "PMX 解析 Worker 發生錯誤"));
      };
      worker.postMessage({ buffer: arrayBuffer });
    });
  }

  /**
   * 把 PMX 的 toon 貼圖轉成 three 能用的 gradientMap。
   *
   * 兩邊的慣例對不上：PMX 的 toon 是一張垂直漸層圖（上緣＝受光、下緣＝陰影），
   * 而 `MeshToonMaterial` 是拿 `dotNL * 0.5 + 0.5` 當 **u** 座標去取樣，也就是
   * 需要一條水平的 1D 漸層。所以這裡把原圖縮成一欄像素、再上下翻轉成
   * 「u=0 陰影 → u=1 受光」。
   *
   * 色彩空間刻意留 NoColorSpace：MMD 的 toon 是**在 gamma 空間直接相乘**的
   * 明暗係數，不是顏色。標成 sRGB 會被硬體再解碼一次，本模型的陰影階
   * （toon4 的 213）就會從 0.84 掉到 0.65，暗部整整多壓 20%。
   */
  private async loadToonGradient(url: string): Promise<THREE.DataTexture> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`toon ramp ${response.status} (${url})`);
    const bitmap = await createImageBitmap(await response.blob());

    const STEPS = 32;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = STEPS;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("無法取得 2D context");
    ctx.drawImage(bitmap, 0, 0, 1, STEPS);
    bitmap.close();

    const source = ctx.getImageData(0, 0, 1, STEPS).data;
    const data = new Uint8Array(STEPS * 4);
    for (let i = 0; i < STEPS; i++) {
      const from = (STEPS - 1 - i) * 4; // 翻轉：影像最下緣要對到 u=0
      // 加深暗部，見 SHADOW_DEPTH。i=0 是陰影端、i=STEPS-1 是受光端；
      // 受光端係數必須是 1.0，flattenToonGradient 取的就是那一格。
      const t = i / (STEPS - 1);
      const f = SHADOW_DEPTH + (1 - SHADOW_DEPTH) * t;
      data[i * 4 + 0] = Math.round(source[from + 0] * f);
      data[i * 4 + 1] = Math.round(source[from + 1] * f);
      data[i * 4 + 2] = Math.round(source[from + 2] * f);
      data[i * 4 + 3] = 255;
    }

    const gradient = new THREE.DataTexture(data, STEPS, 1, THREE.RGBAFormat);
    // 最近鄰取樣是平塗的關鍵：線性內插會把硬色階糊成連續漸層，
    // 那就變回一般的漫反射了。
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.colorSpace = THREE.NoColorSpace;
    gradient.needsUpdate = true;
    return gradient;
  }

  /**
   * 把一條 toon ramp 壓平成「整條都是受光值」。
   *
   * 用途只有一個：**臉不要有陰影**。
   *
   * 一般的漫反射打在臉上會在眼窩、鼻側、下巴留下暗塊，角色看起來就像沒睡飽 ——
   * 這不是 bug，是把寫實光照套在動漫臉上的必然結果。所以遊戲原作（以及幾乎
   * 所有動漫渲染）都不讓臉吃一般的明暗：崩壞／原神那一系是用 **SDF 臉部陰影
   * 貼圖**，由美術決定臉上哪裡該暗、隨光源方向平移一條乾淨的分界。
   *
   * 這顆 PMX 沒有那張 SDF 圖（拆包移植時通常不會帶），所以退而求其次 ——
   * 整張臉一律用受光值，明暗完全交給貼圖本身畫好的那一套。臉的立體感本來
   * 就來自貼圖與瀏海的形狀，不是來自光照。
   *
   * 取「受光端」而不是純白：ramp 的亮端才是這個模型調校過的臉部亮度，
   * 用純白會比原本的受光面還亮，臉會過曝。
   */
  private flattenToonGradient(source: THREE.Texture | null): THREE.DataTexture {
    let r = 255, g = 255, b = 255;
    const data = (source as THREE.DataTexture | null)?.image?.data as Uint8Array | undefined;
    if (data && data.length >= 4) {
      // ramp 的 u=1 是受光端，也就是資料的最後一個 texel。
      const last = data.length - 4;
      r = data[last];
      g = data[last + 1];
      b = data[last + 2];
    }
    const flat = new Uint8Array([r, g, b, 255]);
    const tex = new THREE.DataTexture(flat, 1, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    // 跟 loadToonGradient 一樣留 NoColorSpace：這是明暗係數，不是顏色。
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * 量一張貼圖的 alpha 通道分佈。
   *
   * 取樣到 256×256 再讀 —— 這顆模型的貼圖是 4096×2048，逐 texel 讀要 800 萬次，
   * 而我們要的只是「半透明 texel 佔多少」這個比例，降取樣不影響判斷。
   *
   * 讀不到（貼圖載入失敗、或瀏覽器不給 canvas 讀回）時回報「沒有 alpha」，
   * 也就是退回最保守的不透明 —— 寧可少一層薄紗，也不要整個人變半透明。
   */
  /**
   * 等貼圖解碼完，依真實 alpha 分佈套用 `classifyAlpha` 的結果。
   *
   * 不透明與鏤空同時把 blending 收回 NormalBlending：three 只有在
   * `blending === NormalBlending && transparent === false` 時才會真的關掉
   * 混合器，留著 CustomBlending 的話不透明材質也會照樣走混合。
   */
  private async applyAlphaPolicies(entries: AlphaPolicyEntry[]): Promise<void> {
    const ALPHA_TIMEOUT_MS = 5000;
    await Promise.all(
      entries.map(async (entry) => {
        // 漫符另有一套（要蓋過頭髮又要寫深度給景深用），見材質建構處。
        if (entry.isEmoteMark) return;

        let profile: AlphaProfile | null = null;
        try {
          profile = await Promise.race([
            this.alphaProfileCache.get(entry.texName) ?? Promise.resolve(null),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), ALPHA_TIMEOUT_MS)
            ),
          ]);
        } catch {
          profile = null;
        }
        // 量不到就維持建構時依名稱給的保守設定，不要亂動。
        if (!profile) return;

        const policy = classifyAlpha(profile, entry.initialOpacity, entry.isDoubleShell);
        const mat = entry.mat;
        mat.transparent = policy.transparent;
        mat.depthWrite = policy.depthWrite;
        mat.alphaTest = policy.alphaTest;
        mat.blending = policy.translucent
          ? THREE.CustomBlending
          : THREE.NormalBlending;
        mat.needsUpdate = true;
      })
    );
  }

  private async measureAlpha(texture: THREE.Texture | null): Promise<AlphaProfile> {
    const opaque: AlphaProfile = { hasAlpha: false, softRatio: 0 };
    const image = texture?.image as
      | (HTMLImageElement | ImageBitmap | HTMLCanvasElement)
      | { data?: ArrayLike<number>; width?: number; height?: number }
      | undefined;
    if (!image) return opaque;

    let alpha: ArrayLike<number> | null = null;
    const stride = 4;

    // TGA 走 DataTexture，image.data 就是 RGBA 位元組，不必經過 canvas。
    const raw = (image as { data?: ArrayLike<number> }).data;
    if (raw && raw.length >= 4) {
      alpha = raw;
    } else {
      try {
        const source = image as CanvasImageSource;
        const w = Math.min(ALPHA_SAMPLE_SIZE, (image as { width?: number }).width || ALPHA_SAMPLE_SIZE);
        const h = Math.min(ALPHA_SAMPLE_SIZE, (image as { height?: number }).height || ALPHA_SAMPLE_SIZE);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return opaque;
        ctx.clearRect(0, 0, w, h);
        // **必須關掉平滑化**：縮圖的雙線性濾波會把二值鏤空的每一道邊界都插值成
        // 中間 alpha，4096→256 縮 16 倍之後，衣2.png 這種「36% 全透 / 63% 不透」
        // 的鏤空貼圖會被量成一片半透明，整件衣服又被判回混合通道。
        // 關掉之後是最近鄰點取樣，等於在原圖上均勻抽 texel，alpha 分佈不失真。
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0, w, h);
        alpha = ctx.getImageData(0, 0, w, h).data;
      } catch {
        return opaque;
      }
    }
    if (!alpha) return opaque;

    let soft = 0;
    let full = 0;
    let total = 0;
    for (let i = 3; i < alpha.length; i += stride) {
      const a = alpha[i];
      total++;
      if (a >= 235) full++;
      else if (a > 20) soft++;
    }
    if (total === 0) return opaque;
    return { hasAlpha: full < total, softRatio: soft / total };
  }

  private loadTextureByIndex(
    pmx: { textures: string[] },
    index: number,
    baseDir: string
  ): THREE.Texture | null {
    if (index === undefined || index < 0 || index >= pmx.textures.length) return null;
    const texName = pmx.textures[index];
    const cached = this.textureCache.get(texName);
    if (cached) return cached;

    try {
      const texUrl = baseDir + encodeURIComponent(texName);
      // 解碼完成才量得到 alpha，所以順手把 onLoad 接成 promise 存進
      // alphaProfileCache；材質建完之後會 await 它來決定透明度政策。
      let settle!: (t: THREE.Texture | null) => void;
      const decoded = new Promise<THREE.Texture | null>((resolve) => {
        settle = resolve;
      });
      const holder: { tex: THREE.Texture | null } = { tex: null };
      const onLoad = () => settle(holder.tex);
      const onError = () => settle(null);
      const texture = texName.toLowerCase().endsWith(".tga")
        ? this.tgaLoader.load(texUrl, onLoad, undefined, onError)
        : this.textureLoader.load(texUrl, onLoad, undefined, onError);
      if (!texture) return null;
      holder.tex = texture;
      this.alphaProfileCache.set(
        texName,
        decoded.then((t) => this.measureAlpha(t))
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      // 官方 MMDLoader 的做法：貼圖一律 flipY = false，UV 原封不動照搬 PMX。
      // 先前是反過來的（留著 three 預設的 flipY = true，改成手動翻 UV 的 V 軸）——
      // 對一般貼圖兩者取樣到的 texel 完全等價（含 repeat 環繞），所以這一項改動
      // 本身不會改變畫面；意義在於跟參考實作對齊：翻轉只發生在上傳階段一次，
      // UV 屬性維持 PMX 原值，之後要比對官方行為或換貼圖類型（如 TGA 走
      // DataTexture 路徑）才不會兩套慣例互相抵銷得不明不白。
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      // 16x anisotropy is excessive for a portrait-sized canvas and creates a
      // noticeable texture-upload spike on integrated GPUs.
      texture.anisotropy = 4;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      this.textureCache.set(texName, texture);
      return texture;
    } catch {
      return null;
    }
  }

  /**
   * 找出「零厚度雙殼」材質：同一片薄布的正反兩面。
   *
   * MMD 的薄布（袖套、頭紗、裙鏈、後紗）沒有厚度，作者是把同一組頂點做兩份、
   * 法線相反，兩面各貼一塊 UV——袖套就是外面白紗、裡面彩虹漸層。
   *
   * 麻煩的是它的命名跟真正的貼花覆蓋層一樣是「X / X+」，但兩者要的處理完全相反：
   *   - 貼花層（顏+、上衣+、衣+、裙3+，法線同向）要 polygonOffset 拉向鏡頭，才不會 z-fighting
   *   - 雙殼拉向鏡頭反而讓內裡那一面刺穿外層；而且它必須寫深度，否則布料折到自己
   *     前面時，後畫的那一面會整片蓋掉先畫的那一面（彩虹內裡蓋掉白色外層就是這樣來的）
   *
   * 名字分不出來，只能看幾何：兩個材質的三角形位置一一對應、但**繞序相反**。
   * 比繞序而不是比頂點法線，因為背面剔除看的就是繞序；而且同一片布的兩份頂點
   * 可能焊接得不一樣多（衣2 有 2174 個、衣2+ 只有 2124 個），拿頂點數當條件會漏抓。
   */
  private detectDoubleShellMaterials(pmx: any): boolean[] {
    const materials = pmx.materials as Array<{ faceCount: number }>;
    const isDoubleShell = new Array<boolean>(materials.length).fill(false);

    // PMX 的面依材質順序連續排列。
    const faceStart: number[] = [];
    let cursor = 0;
    for (const m of materials) {
      faceStart.push(cursor);
      cursor += m.faceCount;
    }

    const positionKey = (p: number[]): string =>
      `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;

    // 三角形的身分＝三個頂點位置（排序過，與繞序無關）
    const triangleKey = (f: number): string =>
      pmx.faces[f].indices
        .map((i: number) => positionKey(pmx.vertices[i].position))
        .sort()
        .join("|");

    // 由繞序決定的面法線
    const windingNormal = (f: number): number[] => {
      const [a, b, c] = pmx.faces[f].indices;
      const pa = pmx.vertices[a].position;
      const pb = pmx.vertices[b].position;
      const pc = pmx.vertices[c].position;
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      return [n[0] / len, n[1] / len, n[2] / len];
    };

    // 只有面數一樣的材質才可能是同一片布的兩面，先分組把比對量壓下來。
    const byFaceCount = new Map<number, number[]>();
    materials.forEach((m, i) => {
      if (m.faceCount <= 0) return;
      const list = byFaceCount.get(m.faceCount);
      if (list) list.push(i);
      else byFaceCount.set(m.faceCount, [i]);
    });

    for (const group of byFaceCount.values()) {
      for (let x = 0; x < group.length; x++) {
        for (let y = x + 1; y < group.length; y++) {
          const a = group[x];
          const b = group[y];

          const twinOf = new Map<string, number>();
          for (let f = faceStart[b]; f < faceStart[b] + materials[b].faceCount; f++) {
            twinOf.set(triangleKey(f), f);
          }

          let reversed = 0;
          for (let f = faceStart[a]; f < faceStart[a] + materials[a].faceCount; f++) {
            const twin = twinOf.get(triangleKey(f));
            if (twin === undefined) continue;
            const na = windingNormal(f);
            const nb = windingNormal(twin);
            if (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] < -0.9) reversed++;
          }

          // 門檻取一半即可：實測雙殼是 1.000、同向的貼花層是 0.000，中間空得很。
          if (reversed >= materials[a].faceCount * 0.5) {
            isDoubleShell[a] = true;
            isDoubleShell[b] = true;
          }
        }
      }
    }

    return isDoubleShell;
  }

  /**
   * 找出「漫符」材質：頭上飄的 `怒`／`！`／`汗` 那些符號。
   *
   * 這類符號在 MMD 裡是貼在頭側的小方片，平常縮成一點藏起來，靠表情 morph
   * 把它撐開。它們是**畫面上的註記**，不是場景裡的物件，所以有兩個特別待遇：
   *
   *   1. **永遠不被遮擋。** 這顆模型的符號位置正好在側髮後面，照一般深度測試
   *      畫的話會被頭髮壓掉一半（實測「怒」只露出上緣一角）。
   *   2. **要走透明。** 貼圖 `bq.png` 的符號周圍是透明的，但這個材質的
   *      diffuse alpha 是 1、PMX flag 也沒標，於是被當成不透明材質 ——
   *      透明區直接畫成**黑色方塊**，符號像貼在一張黑紙上。
   *
   * 判斷方式不寫死材質索引：找「被符號類 morph 動到、而且面數極少」的材質。
   * 面數門檻是為了排除眼睛（`はぁと`／`星目` 也會動到眼睛材質，但那有 1758 個面、
   * 是真的 3D 表面，該照常被遮擋）；符號材質只有 16 個面。
   */
  private detectEmoteMarkMaterials(pmx: any): EmoteMarkInfo {
    const materials = pmx.materials as Array<{ faceCount: number }>;
    const isMark = new Array<boolean>(materials.length).fill(false);
    const morphNames: string[] = [];

    /** 面數上限。符號是幾個方片，真正的表面不可能這麼少。 */
    const MAX_MARK_FACES = 64;
    const MARK_NAME = /^(怒|！|!|？|\?|汗|びっくり|ﾋﾞｯｸﾘ)/;

    // 頂點 → 材質（依材質順序連續配置的面）
    const vertexMaterial = new Int32Array(pmx.vertices.length).fill(-1);
    let cursor = 0;
    for (let m = 0; m < materials.length; m++) {
      const end = cursor + materials[m].faceCount;
      for (let f = cursor; f < end; f++) {
        const face = pmx.faces[f];
        if (!face) continue;
        for (const vi of face.indices) vertexMaterial[vi] = m;
      }
      cursor = end;
    }

    for (const morph of (pmx.morphs ?? []) as Array<{
      name: string;
      elements?: Array<{ index: number }>;
    }>) {
      if (!MARK_NAME.test(morph.name)) continue;
      let drivesMark = false;
      for (const el of morph.elements ?? []) {
        const m = vertexMaterial[el.index];
        if (m >= 0 && materials[m].faceCount <= MAX_MARK_FACES) {
          isMark[m] = true;
          drivesMark = true;
        }
      }
      if (drivesMark) morphNames.push(morph.name);
    }
    return { isMark, morphNames };
  }

  /**
   * 把漫符材質**依符號拆開**，每個符號一個群組、一份材質，各自開關。
   *
   * 這顆模型的漫符材質是 32 個頂點 / 16 個面 = **8 片方片疊在額頭同一個位置**，
   * 每個 morph（`怒`／`！`／`？`／`汗`／`！！`）只把其中一片推到它該去的地方。
   *
   * 所以「整個材質一起顯示」是錯的：生氣的時候 `怒` 那片被推出去了，另外 7 片
   * 還原封不動疊在額頭上，一起被畫出來就是一團看不懂的橘黃色色塊。
   *
   * 拆法：先算出每個頂點被哪個 morph 推動，再把面依「屬於哪個符號」分桶，
   * 就地重排這段索引讓同一個符號的面連續（three 的 group 必須是連續區間），
   * 最後每個符號發一個 group + 一份材質複本。沒有任何 morph 認領的面
   * （模型留的空片）直接永遠隱藏。
   */
  private splitEmoteMarkMaterials(
    pmx: any,
    geometry: THREE.BufferGeometry,
    materials: THREE.Material[],
    emoteMark: boolean[],
    markMorphNames: string[]
  ): Array<{ material: THREE.Material; morphName: string }> {
    const index = geometry.index;
    if (!index) return [];

    // 頂點 → 推動它的 morph 名稱（一個頂點只會屬於一個符號）
    const ownerOf = new Map<number, string>();
    for (const morph of (pmx.morphs ?? []) as Array<{
      name: string;
      type: number;
      elements?: Array<{ index: number; position?: number[] }>;
    }>) {
      if (!markMorphNames.includes(morph.name)) continue;
      for (const el of morph.elements ?? []) {
        const p = el.position;
        if (!p || Math.hypot(p[0], p[1], p[2]) < 1e-4) continue;
        if (!ownerOf.has(el.index)) ownerOf.set(el.index, morph.name);
      }
    }
    if (ownerOf.size === 0) return [];

    const array = index.array as Uint16Array | Uint32Array;
    const result: Array<{ material: THREE.Material; morphName: string }> = [];
    const originalGroups = [...geometry.groups];
    geometry.groups.length = 0;

    for (const group of originalGroups) {
      const m = group.materialIndex ?? 0;
      if (!emoteMark[m]) {
        geometry.groups.push(group);
        continue;
      }

      // 這個材質的每個面屬於哪個符號
      const buckets = new Map<string, number[][]>();
      const orphans: number[][] = [];
      for (let f = group.start; f < group.start + group.count; f += 3) {
        const face = [array[f], array[f + 1], array[f + 2]];
        const owner =
          ownerOf.get(face[0]) ?? ownerOf.get(face[1]) ?? ownerOf.get(face[2]);
        if (owner === undefined) {
          orphans.push(face);
          continue;
        }
        const list = buckets.get(owner);
        if (list) list.push(face);
        else buckets.set(owner, [face]);
      }

      // 就地重排：同一個符號的面必須連續，group 才切得出來
      let cursor = group.start;
      for (const [morphName, faces] of buckets) {
        const start = cursor;
        for (const face of faces) {
          array[cursor++] = face[0];
          array[cursor++] = face[1];
          array[cursor++] = face[2];
        }
        const clone = (materials[m] as THREE.Material).clone();
        clone.visible = false;
        clone.name = `emote-mark:${morphName}`;
        const materialIndex = materials.length;
        materials.push(clone);
        geometry.groups.push({ start, count: cursor - start, materialIndex });
        result.push({ material: clone, morphName });
      }

      // 沒人認領的空片：留在原材質底下，永遠隱藏
      const orphanStart = cursor;
      for (const face of orphans) {
        array[cursor++] = face[0];
        array[cursor++] = face[1];
        array[cursor++] = face[2];
      }
      (materials[m] as THREE.Material).visible = false;
      if (cursor > orphanStart) {
        geometry.groups.push({
          start: orphanStart,
          count: cursor - orphanStart,
          materialIndex: m,
        });
      }
    }

    index.needsUpdate = true;
    return result;
  }

  public async load(pmxUrl: string): Promise<PMXModelResult> {
    const baseDir = pmxUrl.substring(0, pmxUrl.lastIndexOf("/") + 1);

    console.log("[PMXLoader] 下載並解析 PMX 模型:", pmxUrl);
    const response = await fetch(pmxUrl);
    if (!response.ok) {
      throw new Error(`無法載入 PMX 檔案: ${response.status} ${response.statusText} (${pmxUrl})`);
    }
    const arrayBuffer = await response.arrayBuffer();

    // Parsing the PMX synchronously blocks Electron's renderer long enough for
    // the window to appear frozen. Keep the UI responsive by doing it off-thread.
    const pmx = await this.parseInWorker(arrayBuffer);

    // 1. 計算頂點範圍 (Bounding Box)
    let minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const v of pmx.vertices) {
      if (v.position[0] < minX) minX = v.position[0];
      if (v.position[0] > maxX) maxX = v.position[0];
      if (v.position[1] < minY) minY = v.position[1];
      if (v.position[1] > maxY) maxY = v.position[1];
      if (v.position[2] < minZ) minZ = v.position[2];
      if (v.position[2] > maxZ) maxZ = v.position[2];
    }

    // 地板基準要用**腳底**，不是幾何最低點。
    //
    // 這顆模型的裙子有兩片很長的拖襬（材質 #51 / #55），綁定姿勢下從腰垂到
    // 比腳底還低 0.6（換算後）。原本拿整體最低點當基準，於是：
    //   - 模型被墊高：腳趾骨落在 y = 0.635，等於離地 63 公分
    //   - 尺度也錯了：「1.65 公尺」裡有 40% 是垂在腳下的布，人只有 0.94 高
    // 畫面上就是「她一直浮著」—— 跟背景是照片還是 3D 房間無關，一直都在。
    //
    // 改用腳尖／腳踝骨當地板：這些骨頭一定在鞋子裡，跟鞋底只差幾公釐。
    // 找不到（換了別的模型）就退回原本的整體最低點。
    const footBoneY: number[] = [];
    for (const b of pmx.bones as Array<{ name: string; position: number[] }>) {
      if (/つま先|足首/.test(b.name)) footBoneY.push(b.position[1]);
    }
    const groundRawY = footBoneY.length > 0 ? Math.min(...footBoneY) : minY;

    // 站立高度＝腳底到頭頂（含髮飾），拖襬不算在內。
    const standingHeight = maxY - groundRawY || maxY - minY || 35.0;
    const TARGET_HEIGHT = 1.65;
    const SCALE = TARGET_HEIGHT / standingHeight;

    const numVertices = pmx.vertices.length;
    const boneCount = pmx.bones.length;
    const positions = new Float32Array(numVertices * 3);
    const normals = new Float32Array(numVertices * 3);
    const uvs = new Float32Array(numVertices * 2);
    // three.js 的蒙皮固定吃 4 根骨頭；PMX 的 BDEF1/BDEF2 只給 1~2 根，
    // 不足的槽位補 index 0 / weight 0。
    const skinIndices = new Uint16Array(numVertices * 4);
    const skinWeights = new Float32Array(numVertices * 4);

    // 頭部大約落在站立高度的 86%（用來估頭部中心，見下方 headCenter）。
    const headRawY = groundRawY + standingHeight * 0.86;

    // PMX → three.js 的座標轉換。骨骼必須跟頂點用同一組轉換，
    // 否則蒙皮會整個錯位，所以抽成共用函式。
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const toSceneX = (x: number): number => (x - centerX) * SCALE;
    const toSceneY = (y: number): number => (y - groundRawY) * SCALE;
    const toSceneZ = (z: number): number => -(z - centerZ) * SCALE;

    for (let i = 0; i < numVertices; i++) {
      const v = pmx.vertices[i];
      positions[i * 3 + 0] = toSceneX(v.position[0]);
      positions[i * 3 + 1] = toSceneY(v.position[1]);
      positions[i * 3 + 2] = toSceneZ(v.position[2]);

      normals[i * 3 + 0] = v.normal[0];
      normals[i * 3 + 1] = v.normal[1];
      normals[i * 3 + 2] = -v.normal[2];

      // UV 照搬 PMX 原值（V 軸不翻）；翻轉交給貼圖的 flipY = false 處理。
      uvs[i * 2 + 0] = v.uv[0];
      uvs[i * 2 + 1] = v.uv[1];

      // 蒙皮權重：略過負數索引（PMX 用 -1 表示未使用）與零權重，
      // 最後正規化成總和 1，避免 BDEF4 的浮點誤差讓模型被拉扁。
      const vIdx = v.skinIndices ?? [];
      const vWeight = v.skinWeights ?? [];
      let weightSum = 0;
      for (let j = 0; j < 4; j++) {
        const bIdx = vIdx[j];
        const bWeight = vWeight[j];
        if (bIdx === undefined || bIdx < 0 || bIdx >= boneCount || !(bWeight > 0)) continue;
        skinIndices[i * 4 + j] = bIdx;
        skinWeights[i * 4 + j] = bWeight;
        weightSum += bWeight;
      }
      if (weightSum > 0) {
        for (let j = 0; j < 4; j++) skinWeights[i * 4 + j] /= weightSum;
      } else {
        // 沒有任何有效權重的頂點：綁到第一根骨頭，至少跟著整體移動。
        skinWeights[i * 4] = 1;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));

    // 2. 面索引 (Faces)
    const indices: number[] = [];
    for (let i = 0; i < pmx.faces.length; i++) {
      const f = pmx.faces[i];
      if (f.indices && f.indices.length >= 3) {
        indices.push(f.indices[0], f.indices[2], f.indices[1]);
      }
    }
    geometry.setIndex(indices);

    // 3. 材質 (Materials)
    // 先把用到的 toon ramp 讀進來。這個模型全部是 toonFlag=0（指向自己的貼圖
    // 清單），只有 toon3.png 與 toon4.png 兩張，載入一次共用即可。
    const toonGradients = new Map<number, THREE.Texture>();
    const usedToonIndices = new Set<number>();
    for (const mData of pmx.materials) {
      if (mData.toonFlag === 0 && mData.toonIndex >= 0 && mData.toonIndex < pmx.textures.length) {
        usedToonIndices.add(mData.toonIndex);
      }
    }
    const TOON_TIMEOUT_MS = 5000;
    const loaded = await Promise.all(
      [...usedToonIndices].map(async (toonIndex) => {
        const name = pmx.textures[toonIndex];
        try {
          const gradient = await Promise.race([
            this.loadToonGradient(baseDir + encodeURIComponent(name)),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`toon ramp 逾時 ${TOON_TIMEOUT_MS}ms`)), TOON_TIMEOUT_MS)
            ),
          ]);
          return { toonIndex, gradient };
        } catch (err) {
          console.warn("[PMXLoader] toon ramp 載入失敗，改用預設色階:", name, err);
          return null;
        }
      })
    );
    for (const entry of loaded) {
      if (entry) toonGradients.set(entry.toonIndex, entry.gradient);
    }

    const doubleShell = this.detectDoubleShellMaterials(pmx);
    const emoteMarkInfo = this.detectEmoteMarkMaterials(pmx);
    const emoteMark = emoteMarkInfo.isMark;
    /** 漫符材質本體（拆成一符號一份之前的原始材質）。 */
    const emoteMarkMaterials: THREE.Material[] = [];
    /** 拆開之後：每個符號一份材質，各自跟著自己的 morph 開關。 */
    let emoteMarkSymbols: Array<{ material: THREE.Material; morphName: string }> = [];

    const materials: THREE.Material[] = [];
    const alphaPending: AlphaPolicyEntry[] = [];
    let indexOffset = 0;

    for (let i = 0; i < pmx.materials.length; i++) {
      const mData = pmx.materials[i];
      const indexCount = mData.faceCount * 3;

      geometry.addGroup(indexOffset, indexCount, i);
      indexOffset += indexCount;

      const texture = this.loadTextureByIndex(pmx, mData.textureIndex, baseDir);
      // Sphere map（MMD 的 spa/sph）：以視角空間法線當 UV 的環境貼圖，
      // 金屬、寶石與眼睛的高光就是靠它。envFlag 1=乘算(sph)、2=加算(spa)。
      const sphereTexture =
        mData.envFlag === 1 || mData.envFlag === 2
          ? this.loadTextureByIndex(pmx, mData.envTextureIndex, baseDir)
          : null;

      const texName =
        mData.textureIndex >= 0 && mData.textureIndex < pmx.textures.length
          ? pmx.textures[mData.textureIndex]
          : "";

      // 顯示與否完全交給 PMX 自己的 diffuse alpha 決定。
      //
      // 這裡原本有一份寫死的隱藏清單（后纱带、衣後紗、頭紗、髮飾环），把作者
      // 標成可見（alpha = 1）的**半透明紫白薄紗**一起關掉了——那是這套服裝從肩後
      // 垂到裙襬的主要層次，關掉之後跟原模型差很多。真正該隱藏的（頭紗、髮飾环、
      // 衣後紗2）作者本來就把 alpha 設成 0，不必另外列名單。
      const initialOpacity = mData.diffuse[3];
      const isVisible = initialOpacity > 0.001;

      // 半透明薄紗、蕾絲飾品、心形葉片、透光袖套、肩部蕾絲羽翼、眼影（使用 纱.png 或名稱含紗/透/葉/白/發飾/裙鏈/袖/衣2）
      const isGauzeOrLace =
        texName.includes("纱") ||
        texName.includes("紗") ||
        mData.name.includes("紗") ||
        mData.name.includes("纱") ||
        mData.name.includes("透") ||
        mData.name.includes("目影") ||
        mData.name.includes("叶") ||
        mData.name.includes("葉") ||
        mData.name.includes("发饰") ||
        mData.name.includes("裙链") ||
        mData.name.includes("袖") ||
        mData.name.includes("衣2");

      // 貼花裝飾層（同頂點幾何覆蓋層）：
      // PMX 作者命名規則：名稱含 "+" 的材質為與基底材質共享頂點幾何的覆蓋層，
      // 例如 衣+ (星空內裙覆蓋)、上衣+ (上衣花紋)、裙3+ (彩虹褶邊花紋)、衣++ (第二層覆蓋)。
      // 另外 纹饰 和使用 衣3.png / 衣5.png 的材質也是貼花層。
      const isDecalOverlay =
        mData.name.includes("+") ||
        mData.name === "纹饰" ||
        texName.includes("衣3") ||
        texName.includes("衣5");

      // 深度寫入必須由「真正的不透明度」決定，不能由材質名稱決定。
      //
      // 這個模型有 64 個材質，其中 裙2、衣2、发饰叶、发饰白、后纱带 的 diffuse
      // alpha 都是 1.00，只是貼圖用了 纱.png（鏤空蕾絲）或名稱含「紗」。先前
      // 只要命中名稱／貼圖規則就一律 depthWrite: false，於是這些**完全不透明**
      // 的面片在深度緩衝裡等於不存在，後面畫的任何材質都會蓋過去——看起來就是
      // 裙片與飾品飄在外層、穿到別的部位前面。
      //
      // 正確的分法是三種，而不是兩種：
      // 半透明薄紗與透光袖套（使用 纱.png、名稱含 透/紗/纱/目影/发饰纱/衣2）：
      // 這些面片在貼圖中有漸變透明度與淡紫/粉彩漸層，必須啟用 transparent: true 與 depthWrite: false，
      // 才能正確呈現晶瑩剔透的薄紗羽翼質感，並讓底下的手臂皮膚與衣物自然透出，徹底消除死白遮擋！
      const isSheerGauze =
        texName.includes("纱") ||
        texName.includes("紗") ||
        mData.name.includes("透") ||
        mData.name.includes("目影") ||
        mData.name.includes("发饰纱") ||
        mData.name.includes("發飾紗");

      // 這一組只是**貼圖還沒解碼完之前的暫定值**，也是量不到 alpha 時的退路。
      // 真正的透明度政策在 applyAlphaPolicies() —— 那邊照貼圖真實的 alpha 分佈
      // 決定，因為名稱規則會把完全不透明的衣服也判成半透明（見 SHEER_ALPHA_RATIO）。
      const isTranslucent = initialOpacity < 0.99 || isSheerGauze;
      const needsAlphaCutout = isGauzeOrLace || isDecalOverlay;
      const isTransparent = isTranslucent;

      // MMD 卡通渲染材質配置：
      // 1. 實體 / 鏤空：transparent: false, depthWrite: true（鏤空另加 alphaTest）
      // 2. 真半透明：transparent: true, depthWrite: false
      // 3. 貼花覆蓋層：polygonOffset 把它拉向鏡頭，避免與底層 z-fighting
      // 官方 MMDLoader 的雙面規則：PMX material flag bit 0 (0x1) 是「兩面描画」，
      // 沒設的材質在 MMD 裡本來就會剔除背面。
      //
      // 這個模型 64 個材質**沒有任何一個**設了 bit 0，所以規則等價於
      // 「不透明的 55 個單面、diffuse alpha < 1 的 9 個雙面」。先前一律 DoubleSide
      // 等於把作者關掉的背面全部打開，內裡的面片會從外層透出來搶畫面。
      const isDoubleSided =
        (mData.flag & 0x1) === 1 ? true : initialOpacity !== 1.0;

      // ambient → emissive：MMD 的 ambient 是「不受光也會有的底色」，
      // three 這邊最接近的對應就是 emissive。官方在有貼圖時把係數壓到 0.2，
      // 否則貼圖本身的顏色會被這層平光洗掉。
      const ambient = mData.ambient ?? [0, 0, 0];

      // 零厚度雙殼（袖套白紗／彩虹內裡這種正反兩面）：
      // 1. 不能當貼花層拉向鏡頭——那等於把其中一面整片往前推，會刺穿另一面
      // 2. 必須寫深度——布折到自己前面時，靠深度決定誰擋誰，
      //    否則就是「材質順序在後的那一面直接蓋掉前面那一面」
      const isDoubleShell = doubleShell[i];

      // 臉部材質：貼圖是那張臉的圖集（顏／颜）。眼睛與睫毛的 toonIndex 本來
      // 就是 -1（沒有 ramp），套不套都一樣；嘴、舌、齒跟著臉一起壓平才不會
      // 只有下巴那一塊有陰影。
      const faceTexName = pmx.textures[mData.textureIndex] ?? "";
      const isFaceMaterial = /顏|颜/.test(faceTexName);
      // 漫符：永遠畫在最上層、走透明。見 detectEmoteMarkMaterials。
      const isEmoteMark = emoteMark[i];

      const mat = new THREE.MeshToonMaterial({
        map: texture,
        color: new THREE.Color(mData.diffuse[0], mData.diffuse[1], mData.diffuse[2]),
        gradientMap: isFaceMaterial
          ? this.flattenToonGradient(toonGradients.get(mData.toonIndex) ?? null)
          : (toonGradients.get(mData.toonIndex) ?? null),
        emissive: new THREE.Color().setRGB(
          ambient[0], ambient[1], ambient[2], THREE.SRGBColorSpace
        ),
        emissiveIntensity: texture ? 0.2 : 1.0,
        transparent: isEmoteMark ? true : isTransparent,
        opacity: initialOpacity,
        visible: isVisible,
        side: isEmoteMark
          ? THREE.DoubleSide
          : isDoubleSided ? THREE.DoubleSide : THREE.FrontSide,
        // 漫符要**測**深度也要**寫**深度。
        //
        // 這裡先前是 `depthTest: false`，理由是「不測深度才蓋得過頭髮」。兩個地方錯了：
        //
        // 1. **WebGL 關掉深度測試就等於不寫深度**（深度寫入是深度測試階段的一部分）。
        //    所以那組設定實際上什麼都沒寫進深度緩衝，後處理的景深只好拿背後的
        //    背景深度算 CoC，把整個符號當遠景糊掉 —— 正是它想避免的那個症狀。
        // 2. 符號**根本不需要蓋過頭髮**：8 片方片拆開之後（splitEmoteMarkMaterials），
        //    被推出去的那一片落在頭旁邊的空處，本來就沒有東西擋它。
        //    先前會被擋是因為整個材質一起顯示，看到的是疊在額頭上那 7 片。
        depthWrite: isEmoteMark ? true : (isDoubleShell ? true : !isTranslucent),
        depthTest: true,
        alphaTest: isEmoteMark ? 0.02 : (isSheerGauze ? 0.01 : (needsAlphaCutout ? 0.08 : 0)),
        polygonOffset: isDecalOverlay && !isDoubleShell,
        polygonOffsetFactor: isDecalOverlay && !isDoubleShell ? -2.0 : 0,
        polygonOffsetUnits: isDecalOverlay && !isDoubleShell ? -4.0 : 0,
        // 官方的自訂混合：alpha 來源取 SrcAlpha/OneMinusSrcAlpha，
        // 但 alpha 通道本身用 DstAlpha 保留背景既有的 alpha，
        // 疊了好幾層薄紗之後才不會把整塊區域的 alpha 推到 1。
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.SrcAlphaFactor,
        blendDstAlpha: THREE.DstAlphaFactor,
      });

      // Sphere map（MMD 的 spa/sph）：以視角空間法線當 UV 的環境貼圖，
      // envFlag 1=乘算(sph)、2=加算(spa)。
      //
      // 混合方式跟著官方 MMDToonShader：乘算直接相乘、加算直接相加，
      // 兩邊權重都是 1.0（本模型 61 個材質是加算、3 個是乘算）。
      // 先前依貼圖檔名派了 0.08~0.95 的自訂權重，那是搭配舊的 UV 算法
      // （見下方 onBeforeCompile）手調出來的，UV 換成官方版之後不再適用。
      const blend =
        mData.envFlag === 1
          ? "outgoingLight *= mmdSphereColor;"
          : "outgoingLight += mmdSphereColor;";
      const sphereBlock = `{
              // 官方 MMDToonShader 的 matcap UV：拿視線方向建一組正交基底，
              // 再把法線投影上去。先前直接用 normal.xy，等於假設鏡頭永遠正對模型，
              // 相機一旋轉（或模型轉頭）光澤就不會跟著轉，寶石看起來像貼死的花紋。
              vec3 mmdViewDir = normalize( vViewPosition );
              vec3 mmdSphereX = normalize( vec3( mmdViewDir.z, 0.0, - mmdViewDir.x ) );
              vec3 mmdSphereY = cross( mmdViewDir, mmdSphereX );
              vec2 mmdSphereUv = vec2( dot( mmdSphereX, normal ), dot( mmdSphereY, normal ) ) * 0.495 + 0.5;
              vec3 mmdSphereColor = texture2D( mmdSphereMap, mmdSphereUv ).rgb;
              ${blend}
            }`;

      // 飽和度補償：以 Rec.709 亮度為軸把顏色往外推，亮度不變、彩度提高。
      // 動漫貼圖本來就是粉彩色調，經過 toon 平塗與多盞補光之後會更往灰白靠，
      // 這一步把粉紫、青綠、寶石的彩虹重新拉出來。
      const saturationBlock = `{
              float mmdLuma = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
              outgoingLight = mix( vec3( mmdLuma ), outgoingLight, ${COLOR_SATURATION} );
            }`;

      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "return vec3( texture2D( gradientMap, coord ).r );",
          "return texture2D( gradientMap, coord ).rgb;"
        );

        if (sphereTexture) {
          shader.uniforms.mmdSphereMap = { value: sphereTexture };
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <common>",
            "#include <common>\nuniform sampler2D mmdSphereMap;"
          );
        }

        // 兩個區塊一次插入：分兩次 replace 會讓第二次又命中同一個 include。
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `${sphereTexture ? sphereBlock : ""}
            ${saturationBlock}
            #include <opaque_fragment>`
        );
      };
      // three.js 依這個 key 快取編譯好的 program。shader 原始碼現在只隨 envFlag
      // 變（乘算／加算兩種），貼圖是走 uniform 各材質獨立，所以 key 帶 envFlag 就夠。
      mat.customProgramCacheKey = () =>
        sphereTexture ? `mmd-sphere-${mData.envFlag}` : "mmd-plain";

      if (isEmoteMark) {
        // 平常藏起來；由 syncEmoteMarks 依 morph 權重打開。
        mat.visible = false;
        emoteMarkMaterials.push(mat);
      }

      materials.push(mat);
      if (texture && texName) {
        alphaPending.push({
          mat,
          texName,
          initialOpacity,
          isDoubleShell,
          isEmoteMark,
          isDecalOverlay,
        });
      }
    }

    await this.applyAlphaPolicies(alphaPending);

    // 漫符要拆成一個符號一份材質，否則 8 片方片會一起現身。
    // 必須在 applyAlphaPolicies 之後：複本要帶著最終的透明度設定。
    emoteMarkSymbols = this.splitEmoteMarkMaterials(
      pmx,
      geometry,
      materials,
      emoteMark,
      emoteMarkInfo.morphNames
    );

    // 4. 表情 BlendShapes (Morph Targets)
    const morphTargetDictionary: Record<string, number> = {};
    const morphPositions: THREE.BufferAttribute[] = [];
    let morphIdx = 0;

    for (let i = 0; i < pmx.morphs.length; i++) {
      const morph = pmx.morphs[i];
      if (morph.type === 1 && morph.elements.length > 0) {
        const morphArray = new Float32Array(numVertices * 3);
        for (let j = 0; j < morph.elements.length; j++) {
          const el = morph.elements[j];
          const vIdx = el.index;
          if (vIdx < numVertices) {
            morphArray[vIdx * 3 + 0] = el.position[0] * SCALE;
            morphArray[vIdx * 3 + 1] = el.position[1] * SCALE;
            morphArray[vIdx * 3 + 2] = -el.position[2] * SCALE;
          }
        }
        const attr = new THREE.BufferAttribute(morphArray, 3);
        attr.name = morph.name;
        morphPositions.push(attr);
        morphTargetDictionary[morph.name] = morphIdx;
        morphIdx++;
      }
    }

    if (morphPositions.length > 0) {
      geometry.morphAttributes.position = morphPositions;
      geometry.morphTargetsRelative = true;
    }

    // 5. 骨骼 (Skeleton)
    const bones: THREE.Bone[] = [];
    const boneWorld: THREE.Vector3[] = [];
    const boneByName = new Map<string, THREE.Bone>();

    for (let i = 0; i < boneCount; i++) {
      const bData = pmx.bones[i];
      const bone = new THREE.Bone();
      bone.name = bData.name;
      bones.push(bone);
      boneWorld.push(
        new THREE.Vector3(
          toSceneX(bData.position[0]),
          toSceneY(bData.position[1]),
          toSceneZ(bData.position[2])
        )
      );
      if (!boneByName.has(bData.name)) boneByName.set(bData.name, bone);
    }

    const boneRoots: THREE.Bone[] = [];
    for (let i = 0; i < boneCount; i++) {
      const parentIndex = pmx.bones[i].parentIndex;
      if (parentIndex >= 0 && parentIndex < boneCount && parentIndex !== i) {
        bones[parentIndex].add(bones[i]);
        bones[i].position.copy(boneWorld[i]).sub(boneWorld[parentIndex]);
      } else {
        boneRoots.push(bones[i]);
        bones[i].position.copy(boneWorld[i]);
      }
    }

    // 裙、頭紗、胸也都放行了。當初鎖它們的理由是「碰撞體把裙子頂開、下擺朝天」，
    // 但那是在 maxDeflection（每節偏轉上限，裙子 0.45 弧度 ≈ 25 度）加進來之前。
    // 有了那道上限，布料再怎麼被推也回得去，鎖著反而讓腿一動就穿模。
    //
    // 只剩下真正不該當布料的骨頭：整體控制骨與軀幹主幹。
    //
    // 肩帶（`前肩带 / 后肩带`）不在這份名單裡，但**它們也不是物理布料** ——
    // 這 8 根骨頭沒有剛體、沒有關節、也沒有付与，所以從來就沒進過
    // physicsBoneSet（這裡的判斷條件就是「有非 type 0 的剛體」）。
    // 舊註解寫「交回彈簧骨處理才會自然垂著」是錯的，那條路徑不存在。
    //
    // `右前肩带1` 的父骨是 `右腕`，於是它 100% 繼承上臂旋轉，手一舉肩甲就翻走。
    // 真正的修正在 shoulder-strap.ts：補一筆比例為負的付与把大部分轉動抵掉。
    //
    // 搖擺骨：PMX 剛體 type 0 是「跟隨骨骼」（純碰撞用），1 與 2 才是物理驅動。
    // 重要：裙撐骨骼（所有 裙_* 骨骼）、腰部軀幹、以及背部長紗帶全部鎖定為非物理靜態，
    // 徹底消滅碰撞體把裙子往外頂開、下擺朝天亂飛亂翻的問題，讓星空蓬蓬裙永遠保持完美立體弧度！
    const nonPhysicsBoneRegex =
      /^(全ての親|センター|グルーブ|腰|下半身|上半身|上半身1|上半身2|首|頭)/;

    const physicsBoneSet = new Set<THREE.Bone>();
    for (const body of (pmx.rigidBodies ?? []) as Array<{ boneIndex: number; type: number }>) {
      if (body.type === 0) continue;
      if (body.boneIndex < 0 || body.boneIndex >= boneCount) continue;
      const b = bones[body.boneIndex];
      const rawName = pmx.bones[body.boneIndex]?.name ?? "";
      if (nonPhysicsBoneRegex.test(rawName)) continue;
      physicsBoneSet.add(b);
    }

    const isPhysicsBone = (obj: THREE.Object3D | null): obj is THREE.Bone =>
      obj !== null && (obj as THREE.Bone).isBone === true && physicsBoneSet.has(obj as THREE.Bone);

    const chainStarts: THREE.Bone[] = [];
    for (let i = 0; i < boneCount; i++) {
      const bone = bones[i];
      if (physicsBoneSet.has(bone) && !isPhysicsBone(bone.parent)) chainStarts.push(bone);
    }

    const visited = new Set<THREE.Bone>();
    const physicsBoneChains: THREE.Bone[][] = [];
    const pending = [...chainStarts];

    while (pending.length > 0) {
      const start = pending.shift() as THREE.Bone;
      if (visited.has(start)) continue;

      const chain: THREE.Bone[] = [];
      let current: THREE.Bone | undefined = start;
      while (current && !visited.has(current)) {
        visited.add(current);
        chain.push(current);
        const physicsChildren: THREE.Bone[] = current.children.filter(isPhysicsBone);
        current = physicsChildren[0];
        for (let i = 1; i < physicsChildren.length; i++) pending.push(physicsChildren[i]);
      }
      if (chain.length > 0) physicsBoneChains.push(chain);
    }

    // 碰撞體（使用精準骨骼逆矩陣轉換，確保身體與胸口、手臂、腿部碰撞體 100% 精準定位防穿模）
    const colliders: PMXCollider[] = [];
    const mirrorQuat = new THREE.Quaternion();
    const localAxis = new THREE.Vector3();
    const worldColliderPos = new THREE.Vector3();
    const boneInvMatrix = new THREE.Matrix4();

    for (const boneRoot of boneRoots) boneRoot.updateMatrixWorld(true);

    for (const body of (pmx.rigidBodies ?? []) as Array<{
      boneIndex: number; type: number; shapeType: number;
      width: number; height: number; depth: number;
      position: number[]; rotation: number[];
      groupIndex: number; groupTarget: number;
    }>) {
      if (body.type !== 0) continue;
      if (body.boneIndex < 0 || body.boneIndex >= boneCount) continue;
      const bone = bones[body.boneIndex];
      const shape: "sphere" | "capsule" = body.shapeType === 2 ? "capsule" : "sphere";

      mirrorQuat.setFromEuler(
        new THREE.Euler(body.rotation[0], body.rotation[1], body.rotation[2])
      );
      mirrorQuat.set(-mirrorQuat.x, -mirrorQuat.y, mirrorQuat.z, mirrorQuat.w);
      localAxis.set(0, 1, 0).applyQuaternion(mirrorQuat).normalize();

      worldColliderPos.set(
        toSceneX(body.position[0]),
        toSceneY(body.position[1]),
        toSceneZ(body.position[2])
      );

      bone.updateWorldMatrix(true, false);
      boneInvMatrix.copy(bone.matrixWorld).invert();
      const offset = worldColliderPos.clone().applyMatrix4(boneInvMatrix);
      const axis = localAxis.clone().transformDirection(boneInvMatrix).normalize();

      // 碰撞半徑一律照 PMX 原值。
      //
      // 曾經為了擋「頭髮穿過肩甲與袖套」把肩、上臂放大 2.2 倍——那層布確實沒有
      // 自己的剛體，但放大之後脖子旁的頭髮會被 5cm 的碰撞體整片頂開，靠不回身體，
      // 姿態明顯不對。寧可偶爾穿模，也不要把頭髮頂歪。
      colliders.push({
        bone,
        shape,
        radius: body.width * SCALE,
        height: shape === "capsule" ? body.height * SCALE : 0,
        offset,
        axis,
        group: body.groupIndex,
      });
    }

    const physicsBoneCollisionMask = new Map<THREE.Bone, number>();
    for (const body of (pmx.rigidBodies ?? []) as Array<{
      boneIndex: number; type: number; groupTarget: number;
    }>) {
      if (body.type === 0) continue;
      if (body.boneIndex < 0 || body.boneIndex >= boneCount) continue;
      const bone = bones[body.boneIndex];
      if (!physicsBoneCollisionMask.has(bone)) {
        const authored = body.groupTarget >>> 0;
        // 遮罩 0 代表作者把碰撞完全關掉。在 MMD 那邊沒問題 —— 那些小配件
        // （手腕的緞帶、髮飾）都有關節把它們吊在原位，不會亂跑。我們的彈簧骨
        // 沒有關節，關掉碰撞的緞帶就會直接穿過手臂。至少要讓它碰到身體本體。
        //
        // 但「有碰撞、卻沒開群組 0」要補起來：群組 0 是身體本體（軀幹、頭、
        // 腿共 37 個碰撞體）。這個模型的袖子遮罩是 ...0110 —— 只跟兩隻上臂碰、
        // 完全不碰身體，長袖垂到髖部就直接穿過裙子與腿。
        //
        // 在 MMD 裡這樣設定沒問題，因為那邊還有關節約束把布料吊住；我們的
        // 彈簧骨沒有關節，布料會垂得更遠，非碰不可。補上群組 0 是安全的：
        // 綁定時就在碰撞體內的關節不會被推出去（見 measureBindClearances）。
        physicsBoneCollisionMask.set(bone, authored | 1);
      }
    }

    // PMX 原生物理資料（給 MMDPhysics 用）。
    //
    // 上面那份 colliders / physicsBoneCollisionMask 是彈簧骨的退路：只吃得下
    // 39 個「骨骼追隨」剛體，408 個動力學剛體與 639 個關節全部丟掉。
    // 這裡把完整的原始資料整理出來，讓 Bullet 直接跑作者綁好的那一套。
    // 轉換細節（相對偏移、關節帶動的型別修正）見 buildMMDPhysicsPayload。
    const built = buildMMDPhysicsPayload(pmx, bones, {
      scale: SCALE,
      centerX,
      centerZ,
      // 這裡是「場景 y = 0 對應到 PMX 的哪個高度」，也就是地板基準。
      minY: groundRawY,
    });
    const physics: MMDPhysicsPayload | null = built?.payload ?? null;
    const boneRestPositions = collectBoneRestPositions(pmx);

    // 付与（append transform）：PMX 讓一根骨頭「按比例跟著另一根骨頭轉」的機制。
    //
    // 這個模型的腿是靠它動的：蒙皮權重掛在 `左足D / 左ひざD / 左足首D` 上，而這三根
    // 在骨架裡是 `腰キャンセル左` 的子骨——不是 `左足` 的子骨——只透過付与跟著
    // `左足` 轉。沒有這段，轉 `左足` 只會動到一根沒有任何頂點的骨頭，腿完全不會動。
    //
    // 同一個機制還帶起另外三組：手臂的 `腕捩1~3 / 手捩1~3`（把翻腕的扭轉沿著前臂
    // 分散開，不然會在手腕處擰出一道摺痕）、`両目 → 左目/右目`（一根骨頭轉兩顆
    // 眼球），以及 `肩C / 腰キャンセル` 這類比例 -1 的反向抵銷骨。
    const appendTransforms: PMXAppendTransform[] = [];
    for (let i = 0; i < boneCount; i++) {
      const grant = pmx.bones[i]?.grant as
        | { parentIndex: number; ratio: number; affectRotation: boolean; affectPosition: boolean }
        | undefined;
      if (!grant) continue;
      if (grant.parentIndex < 0 || grant.parentIndex >= boneCount) continue;
      if (!grant.affectRotation && !grant.affectPosition) continue;
      if (!Number.isFinite(grant.ratio) || grant.ratio === 0) continue;

      appendTransforms.push({
        bone: bones[i],
        source: bones[grant.parentIndex],
        ratio: grant.ratio,
        affectRotation: grant.affectRotation,
        affectPosition: grant.affectPosition,
        bindRotation: bones[i].quaternion.clone(),
        bindPosition: bones[i].position.clone(),
        sourceBindPosition: bones[grant.parentIndex].position.clone(),
      });
    }

    // 模型缺的那筆補償：前肩帶不該 100% 跟著上臂轉。詳見 shoulder-strap.ts。
    //
    // 接在原生付与之後：這兩根骨頭的索引（136 / 153）都大於來源的 `腕`，
    // 順序上本來就該排在後面，applyAppendTransforms 依序跑一趟即可。
    const strapFixes = buildSyntheticAppendTransforms(bones);
    appendTransforms.push(...strapFixes);

    // 6. 組合 SkinnedMesh 與 Root Group
    const mesh = new THREE.SkinnedMesh(geometry, materials);
    // 陰影旗標不在這裡設，由 `vrm-viewer.enableGroundShadow` 決定。
    //
    // 這裡原本是 `castShadow / receiveShadow = true` 兩行空轉（renderer 沒開
    // shadowMap、燈也沒有一盞 castShadow）。現在的規則是：
    //   - `castShadow` 會被打開，但只為了讓地面接得到接觸陰影（沒有影子的話
    //     角色看起來是浮在背景前面的）
    //   - `receiveShadow` 永遠維持 false —— 自影會讓瀏海在臉上投出硬邊暗斑，
    //     那是動漫渲染最忌諱的（遊戲原作用 SDF 臉部陰影貼圖迴避，PMX 沒帶那張圖）
    // 身上的明暗交給 toon ramp，不要交給 shadow map。
    mesh.frustumCulled = false;

    for (const boneRoot of boneRoots) mesh.add(boneRoot);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));

    const root = new THREE.Group();
    root.add(mesh);

    const headBoneIndex = pmx.bones.findIndex((b: { name: string }) => b.name === "頭");
    const headCenter =
      headBoneIndex >= 0
        ? new THREE.Vector3(0, boneWorld[headBoneIndex].y, 0)
        : new THREE.Vector3(0, (headRawY - minY) * SCALE, 0);

    // 記錄初始材質基礎屬性以便計算 material morph
    const baseMaterialProps = pmx.materials.map((m: any) => ({
      diffuse: [...m.diffuse],
      opacity: m.diffuse[3],
    }));

    const morphByName = new Map<string, any>();
    pmx.morphs.forEach((m: any) => morphByName.set(m.name, m));

    const applyMaterialMorph = (morph: any, weight: number) => {
      for (const el of morph.elements) {
        const matIdx = el.index;
        const targetMats = matIdx === -1 ? materials : [materials[matIdx]];
        const targetProps = matIdx === -1 ? baseMaterialProps : [baseMaterialProps[matIdx]];

        for (let k = 0; k < targetMats.length; k++) {
          const m = targetMats[k] as THREE.MeshToonMaterial;
          const base = targetProps[k];
          if (!m || !base) continue;

          if (el.type === 0) {
            // Multiply
            const targetOpacity = base.opacity * (1.0 - weight * (1.0 - el.diffuse[3]));
            m.opacity = Math.max(0, Math.min(1, targetOpacity));
            m.visible = m.opacity > 0.001;
          } else if (el.type === 1) {
            // Add
            const targetOpacity = base.opacity + el.diffuse[3] * weight;
            m.opacity = Math.max(0, Math.min(1, targetOpacity));
            m.visible = m.opacity > 0.001;
          }
        }
      }
    };

    const currentWeights = new Map<string, number>();

    const getMorphWeight = (name: string): number => {
      return currentWeights.get(name) ?? 0;
    };

    /**
     * 依漫符 morph 的權重開關漫符材質。見 EMOTE_MARK_VISIBLE_THRESHOLD。
     *
     * 只看驅動漫符的那幾個 morph 的最大值 —— 同時觸發多個符號時任何一個
     * 有權重就該顯示，取最大值最直接。
     */
    const syncEmoteMarks = () => {
      if (emoteMarkSymbols.length > 0) {
        // 拆開之後：每個符號只看自己的 morph
        for (const symbol of emoteMarkSymbols) {
          const w = currentWeights.get(symbol.morphName) ?? 0;
          symbol.material.visible = w > EMOTE_MARK_VISIBLE_THRESHOLD;
        }
        return;
      }
      // 拆不開時的退路：整個材質一起開關（至少靜止時不會掛在額頭上）
      if (emoteMarkMaterials.length === 0) return;
      let peak = 0;
      for (const morphName of emoteMarkInfo.morphNames) {
        const w = currentWeights.get(morphName) ?? 0;
        if (w > peak) peak = w;
      }
      const show = peak > EMOTE_MARK_VISIBLE_THRESHOLD;
      for (const mat of emoteMarkMaterials) mat.visible = show;
    };

    const emoteMarkMorphs = new Set(emoteMarkInfo.morphNames);

    const setMorphWeight = (name: string, weight: number) => {
      currentWeights.set(name, weight);
      // 1. 頂點 Morph
      //    漫符要嘛在最終位置、要嘛不存在，中間不能有滑行 —— 見 EMOTE_MARK_SNAP。
      const applied =
        EMOTE_MARK_SNAP && emoteMarkMorphs.has(name)
          ? weight > EMOTE_MARK_VISIBLE_THRESHOLD
            ? 1
            : 0
          : weight;
      const idx = morphTargetDictionary[name];
      if (idx !== undefined && mesh.morphTargetInfluences && mesh.morphTargetInfluences[idx] !== undefined) {
        mesh.morphTargetInfluences[idx] = applied;
      }

      // 2. 材質 Morph / 群組 Morph
      const morph = morphByName.get(name);
      if (morph) {
        if (morph.type === 8) {
          applyMaterialMorph(morph, weight);
        } else if (morph.type === 0) {
          for (const sub of morph.elements) {
            const childMorph = pmx.morphs[sub.index];
            if (childMorph) {
              setMorphWeight(childMorph.name, weight * sub.ratio);
            }
          }
        }
      }

      syncEmoteMarks();
    };

    console.log(
      "[PMXLoader] 昔漣官方 3D 模型建立完成！頂點數:", numVertices,
      "面數:", pmx.faces.length,
      "骨骼數:", boneCount,
      "表情數:", morphPositions.length,
      "搖擺骨鏈:", physicsBoneChains.length,
      "搖擺骨數:", visited.size,
      "碰撞體:", colliders.length,
      "付与骨:", appendTransforms.length,
      "（含肩帶修正", strapFixes.length, "）",
      "零厚度雙殼材質:", doubleShell.filter(Boolean).length,
      "漫符材質:", emoteMark.filter(Boolean).length,
      "| 站立高度(PMX):", standingHeight.toFixed(2),
      "地板基準:", groundRawY.toFixed(2),
      "（幾何最低", minY.toFixed(2), "）",
      "| PMX 物理 — 剛體:", physics?.rigidBodies.length ?? 0,
      "關節:", physics?.joints.length ?? 0,
      "型別修正:", built?.retypedBodies ?? 0
    );
    return {
      root,
      mesh,
      morphTargetDictionary,
      setMorphWeight,
      getMorphWeight,
      headCenter,
      bones: boneByName,
      headBone: boneByName.get("頭") ?? null,
      neckBone: boneByName.get("首") ?? null,
      physicsBoneChains,
      colliders,
      physicsBoneCollisionMask,
      appendTransforms,
      physics,
      boneRestPositions,
      standingHeight: TARGET_HEIGHT,
      rawBones: pmx.bones as RawPMXIKBone[],
      applyAppendTransforms: () => applyAppendTransforms(appendTransforms),
    };
  }
}
