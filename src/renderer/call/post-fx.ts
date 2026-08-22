/**
 * 後處理鏈：景深、輝光、抗鋸齒。
 *
 * 三個效果的分工：
 *
 *   - **景深（DoF）** —— 主角。把背景糊成散景，主體才跳得出來。gosari 那類
 *     MMD 影片的「質感」有很大一塊就是這個，而不是模型本身
 *   - **輝光（Bloom）** —— 極輕微，只讓髮飾與眼睛的亮部帶一點暈。動漫渲染很
 *     容易被 bloom 洗成一片糊，門檻設高、強度壓低
 *   - **SMAA** —— 比 MSAA 適合平塗色塊的邊緣。toon 的硬色階邊界用 MSAA 會殘留
 *     階梯，SMAA 是形態學的，處理長斜邊比較乾淨
 *
 * ## 刻意不做的事
 *
 * **不加色調映射。** `vrm-viewer` 特意把 `toneMapping` 設成 `NoToneMapping`，
 * 因為 ACES 是為寫實 HDR 設計的，會把高光往白色壓並明顯去飽和 —— 昔漣的貼圖
 * 本身就是粉彩色調，過一次 ACES 粉紅和青綠會一起洗成灰白。這裡不要推翻它。
 *
 * **不加 SSAO。** 環境遮蔽會在平塗色塊上畫出寫實的接觸陰影，跟 toon 的美術
 * 方向直接打架。要陰影應該走 toon ramp，不是後處理。
 */

import * as THREE from "three";
import {
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from "postprocessing";

export type PostFXQuality = "off" | "low" | "high";

export interface PostFXOptions {
  quality?: PostFXQuality;
}

/**
 * 對焦範圍（世界單位）。
 *
 * 這個值調過三次，兩次都是被 CoC 的語意騙了。實際的式子是
 *
 *     CoC = smoothstep(0, focusRange, |相機到該點的距離 − 對焦距離|)
 *
 * 也就是一條**漸變**曲線，不是「範圍內全清楚、範圍外才糊」。離對焦點
 * 三分之一個 focusRange 的地方就已經有 26% 的 CoC，乘上 bokehScale 之後
 * 完全看得出來。
 *
 * 兩次踩坑：
 *   - 0.6（理由「模型厚度 0.3」）：錯在該看的是相機到頭 vs 到腳的距離差，
 *     近視角下那是 0.81，整個下半身糊掉
 *   - 1.8（理由「吃得下頭到腳」）：頭到腳是進了範圍，但頭頂離對焦點 0.4，
 *     smoothstep 給 0.12 × bokehScale 8 ≈ 一個像素的糊，頭髮邊緣就爛了
 *
 * 6 配上放到 20 單位遠的背景板才真的乾淨：角色最遠的部位算出來不到 0.06，
 * 而背景早就飽和成 1。詳見 scene-backdrop.ts 的 BACKDROP_DISTANCE。
 */
const FOCUS_RANGE = 6;

export class PostFX {
  private composer: EffectComposer | null = null;
  private dof: DepthOfFieldEffect | null = null;
  private quality: PostFXQuality;
  /**
   * 對焦點。預設放在胸口高度而不是頭 —— 對焦點放在頭的話，誤差全部往下累積
   * （頭到腳的距離差是單向的），腳會先失焦。放在身體中段誤差才對稱。
   */
  private readonly focusTarget = new THREE.Vector3(0, 1.0, 0);

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    options: PostFXOptions = {}
  ) {
    this.quality = options.quality ?? "high";
    if (this.quality !== "off") this.build();
  }

  public get enabled(): boolean {
    return this.composer !== null;
  }

  private build(): void {
    const highQuality = this.quality === "high";

    const composer = new EffectComposer(this.renderer, {
      // 保留透明背景：沒有選圖片背景的氛圍（星空／極簡）靠 CSS 底色透出來。
      alpha: true,
    } as ConstructorParameters<typeof EffectComposer>[1]);

    composer.addPass(new RenderPass(this.scene, this.camera));

    // 景深先拿掉：使用者要背景是清楚的。
    //
    // 房間是自己建的 3D 空間，不是一張照片背景 —— 家具、相框、串燈、床上的
    // 玩偶都是刻意做出來的細節，糊掉等於全部白做。散景本來是為了「角色貼在
    // 照片前」那個模式服務的，換成真的房間之後那個理由就不成立了。
    //
    // `DepthOfFieldEffect` 與 `FOCUS_RANGE` 都留著：照片背景的氛圍還在用，
    // 之後要做「只有照片背景才開景深」也只是在這裡加一個條件。
    const dof: DepthOfFieldEffect | null = null;
    this.dof = dof;

    const bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: 0.32,
      // 門檻拉高：只有真的很亮的地方（髮飾金屬、眼睛高光）才會暈開，
      // 皮膚和淺色布料不該發光。
      luminanceThreshold: 0.86,
      luminanceSmoothing: 0.22,
    });

    const smaa = new SMAAEffect({
      preset: highQuality ? SMAAPreset.HIGH : SMAAPreset.MEDIUM,
    });

    // 合成一個 EffectPass：postprocessing 會把它們編進同一支 shader，
    // 比每個效果各跑一遍 pass 省很多。
    composer.addPass(new EffectPass(this.camera, bloom, smaa));

    this.composer = composer;
  }

  /** 設定對焦點（通常是角色頭部或胸口的世界座標）。 */
  public setFocusPoint(point: THREE.Vector3): void {
    this.focusTarget.copy(point);
  }

  public setQuality(quality: PostFXQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.dispose();
    if (quality !== "off") this.build();
  }

  /**
   * 還原 `EffectComposer` 對 renderer 做的全域設定。
   *
   * postprocessing 建立 composer 時會把 `renderer.autoClear` 設成 false（它自己
   * 管清除）。關掉後處理之後如果不還原，直接 `renderer.render` 就永遠不清畫面，
   * 每一幀疊在前一幀上 —— 畫面會拖出殘影，而且移動中的部位看起來像有殘留。
   *
   * 實測踩到過：關掉後處理量「相鄰幀像素差」，量到 0.004（幾乎不變），
   * 一度以為後處理是畫面抖動的元凶。其實只是畫面根本沒被清掉。
   */
  private restoreRendererDefaults(): void {
    this.renderer.autoClear = true;
    this.renderer.autoClearColor = true;
    this.renderer.autoClearDepth = true;
    this.renderer.autoClearStencil = true;
  }

  public setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
  }

  /**
   * 畫一幀。
   *
   * @returns 是否真的畫了。回傳 false 時呼叫端要自己 `renderer.render`。
   */
  public render(deltaSeconds: number): boolean {
    if (!this.composer) return false;
    this.composer.render(deltaSeconds);
    return true;
  }

  public dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.dof = null;
    this.restoreRendererDefaults();
  }
}
