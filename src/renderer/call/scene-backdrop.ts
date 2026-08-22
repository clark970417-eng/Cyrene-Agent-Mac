/**
 * 場景背景板：把情境背景從 CSS 圖層搬進 3D 場景。
 *
 * 為什麼要搬：原本背景是 `.call__scene-bg` 這個 CSS 圖層，貼在透明 canvas 後面。
 * 角色與背景等於在兩個互不相干的平面上，於是：
 *
 *   - **景深做不出來。** 後處理的散景吃的是深度緩衝，CSS 圖層根本不在裡面，
 *     再怎麼調都只會糊到角色自己
 *   - **沒有視差。** 相機轉動時背景紋風不動，立體感整個垮掉
 *   - **光影對不上。** 角色的邊光與背景的光源方向可以完全矛盾
 *
 * 參考 MMD 圈子的作法：那些畫面之所以有「質感」，很大一部分是舞台本身就在
 * 3D 場景裡、被景深糊成散景，主體才跳得出來。
 *
 * 這裡用最省的作法 —— 一塊擺在世界座標後方的貼圖平面。不是完整的 3D 舞台，
 * 但深度緩衝裡有它，景深與視差就成立了。
 */

import * as THREE from "three";

/**
 * 背景板與相機的距離。
 *
 * 為什麼是 20 這種誇張的數字（相機 far 是 100，放得下）：
 *
 * 景深的 CoC 是 `smoothstep(0, focusRange, |距離 − 對焦距離|)` —— 一條**漸變**
 * 曲線，不是硬邊界。角色只要離對焦點有一點距離就會吃到一部分模糊：
 * 曾經背景放 4、focusRange 1.8，頭頂的頭髮離對焦點 0.4，smoothstep 給 0.12，
 * 乘上 bokehScale 8 就是肉眼看得出來的糊。
 *
 * 拉開距離才解得掉：背景放到 20，focusRange 就能開到 6 —— 角色最遠的部位
 * （近距離視角下的腳，離對焦點約 0.9）算出來只有 0.06，乘 8 不到半個像素；
 * 而背景離對焦點 17 以上，CoC 早就飽和成 1，散景一點沒少。
 *
 * 平面尺寸由 `layout()` 依距離換算，放遠只是等比放大，不影響構圖。
 */
const BACKDROP_DISTANCE = 20;

/**
 * 平面尺寸相對視錐的倍率。
 *
 * 掛在相機底下之後只需要一點點餘裕（避免浮點誤差露出邊緣），
 * 不必像放在世界座標時那樣給兩倍。
 */
const BACKDROP_OVERSIZE = 1.08;

export class SceneBackdrop {
  private mesh: THREE.Mesh | null = null;
  private texture: THREE.Texture | null = null;
  private readonly loader = new THREE.TextureLoader();
  /** 用來忽略「切太快時，先發出的那個請求後到」的情況。 */
  private requestToken = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera
  ) {}

  public get active(): boolean {
    return this.mesh !== null && this.mesh.visible;
  }

  /**
   * 換背景圖。傳 null 代表沒有圖（純色／漸層氛圍），背景板會隱藏起來，
   * 畫面回到透明 canvas 疊 CSS 底色的模式。
   */
  public async setImage(url: string | null): Promise<void> {
    const token = ++this.requestToken;

    if (!url) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }

    const texture = await new Promise<THREE.Texture | null>((resolve) => {
      this.loader.load(
        url,
        (t) => resolve(t),
        undefined,
        () => resolve(null)
      );
    });

    // 載入期間又被切走了，或這張根本載不起來。
    if (token !== this.requestToken) {
      texture?.dispose();
      return;
    }
    if (!texture) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;

    this.ensureMesh();
    const material = this.mesh!.material as THREE.MeshBasicMaterial;
    material.map = texture;
    material.needsUpdate = true;

    this.texture?.dispose();
    this.texture = texture;
    this.mesh!.visible = true;
    this.layout();
  }

  private ensureMesh(): void {
    if (this.mesh) return;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      // 背景是一張照片，不該再被場景的燈光二次照亮，所以用 Basic 而非 Toon。
      toneMapped: false,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "cyrene-backdrop";
    // 背景板永遠在最遠處，不需要參與視錐剔除判斷（它本來就填滿畫面）。
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    mesh.position.set(0, 0, -BACKDROP_DISTANCE);

    // 掛在相機底下，而不是放在世界座標。
    //
    // 放世界座標時算過一版，錯在「假設相機是直視 -Z」：實際上相機會俯視
    // `controls.target`（在相機下方），視錐是往下斜的，於是畫面下緣看到的
    // 位置比平面的下緣還低 —— 腳的下方會出現一條硬邊，再往下就是空的。
    // 切到全身視角時最明顯，因為俯角最大。
    //
    // 掛在相機底下就沒有這個問題：平面永遠正對相機、永遠填滿畫面，
    // 不論怎麼俯仰、繞行、縮放。代價是沒有視差，但那本來就只是錦上添花。
    this.camera.add(mesh);
    // three.js 只走訪 scene 底下的節點；相機沒加進場景的話，它的子物件不會被畫。
    if (this.camera.parent !== this.scene) this.scene.add(this.camera);
    this.mesh = mesh;
  }

  /**
   * 依相機視錐重算平面大小。相機 fov／aspect 一變就要呼叫（resize、切視角）。
   */
  public layout(): void {
    if (!this.mesh) return;
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    const texture = material.map;

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const frustumHeight = 2 * Math.tan(vFov / 2) * BACKDROP_DISTANCE;
    const frustumWidth = frustumHeight * this.camera.aspect;

    let width = frustumWidth * BACKDROP_OVERSIZE;
    let height = frustumHeight * BACKDROP_OVERSIZE;

    // 維持圖片本身的長寬比，用 cover 的邏輯把短邊撐滿，跟原本 CSS 的
    // `background-size: cover` 行為一致，不然照片會被拉扁。
    const image = texture?.image as { width?: number; height?: number } | undefined;
    if (image?.width && image.height) {
      const imageAspect = image.width / image.height;
      const boxAspect = width / height;
      if (imageAspect > boxAspect) width = height * imageAspect;
      else height = width / imageAspect;
    }

    this.mesh.scale.set(width, height, 1);
  }

  public dispose(): void {
    if (this.mesh) {
      this.camera.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    this.texture?.dispose();
    this.texture = null;
  }
}
