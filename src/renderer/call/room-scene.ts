/**
 * 真正的 3D 房間。
 *
 * 取代照片背景板（`scene-backdrop.ts`）。差別不是「比較好看」，而是三件
 * 照片先天做不到的事：
 *
 *   1. **角色站得住。** 照片裡的地板線跟 3D 世界的 y=0 沒有任何對應關係，
 *      所以不管怎麼調，角色看起來都像浮在一張圖前面。有了真的地板與牆，
 *      透視自己會對上。
 *   2. **景深是真的。** 照片板整片在同一個深度，只能整片糊掉；真房間的
 *      近牆與遠牆散景程度不同，那才是 gosari 那類 MMD 影片的立體感來源。
 *   3. **視差。** 相機一動，近的家具與遠的牆位移不同。照片板永遠是平的。
 *
 * ## 為什麼是程序化幾何而不是匯入模型
 *
 * 沒有現成的房間資產，而動漫風格的室內其實不需要細節 —— 平塗的色塊、
 * 乾淨的邊、暖色的窗光就夠了。程序化的好處是可以直接按角色的尺度長出來
 * （模型高 1.5，房間就 2.6 高），而且換氛圍只要換一組顏色。
 */

import * as THREE from "three";
// 床上的玩偶直接借用道具的幾何 —— 同一個房間裡的同一顆熊，
// 使用者丟一個玩偶進來的時候會認得它就是床上那隻。
import { buildProp } from "./prop-models";

export type RoomPreset = "bedroom" | "terrace" | "astral";

/**
 * 配色刻意比「看起來該有的顏色」暗一半左右。
 *
 * 場景的燈光是為了「角色站在照片前」調的：環境 0.82 + 主光 0.72 + 補光 0.32
 * + 邊光 0.30，加起來超過 2.0。角色的材質吃得住（貼圖本來就偏粉彩、又有
 * toon ramp 壓過），但房間如果用一般的奶油白牆，直接會被打成一片死白 ——
 * 第一版就是那樣，整個畫面只剩一塊平的米色。
 *
 * 不去動場景的燈光是因為那會連角色一起改掉。
 */
interface RoomPalette {
  floor: number;
  rug: number;
  wall: number;
  ceiling: number;
  trim: number;
  furniture: number;
  fabric: number;
  accent: number;
  /** 窗外的顏色，會被自發光材質用掉。 */
  sky: number;
  /** 窗光的顏色與強度。 */
  windowLight: number;
  windowIntensity: number;
}

const PALETTES: Record<RoomPreset, RoomPalette> = {
  /**
   * 昔漣的臥室：柔粉牆、奶油白木作、玫瑰金點綴、黃昏的窗。
   *
   * 第一版是暖褐色木地板 + 米色牆，量起來「不過曝」但讀起來是一間褐色的
   * 木屋，跟她一點關係都沒有。參考了一輪粉色女孩房之後改成這一組。
   *
   * **要讀成粉色，關鍵是色相的落差而不是亮度。** 燈光加起來約 2.16 倍，
   * 任何顏色乘上去都會往白靠；先前那組 R/G/B 差距太小（0x8f7d64 的三個通道
   * 只差 0.17），乘完就是一片沒有顏色的米白。現在每個顏色都刻意讓
   * **R > B > G**、而且拉開差距，乘完之後粉色還在。
   *
   * 亮度也不是照「燈光加起來 2.16 倍」去除的。那個倍率只對**正對主光**的面
   * 成立；後牆、天花板、床側這些背光面實際只吃到環境光 0.82 左右，照 2.16
   * 去算會暗掉一倍以上 —— 第一版粉色就是這樣變成一間暗紫色的房間。
   * 現在的值是實機看著調的：背光面讀得出顏色，受光面（床頂、地毯）也不過曝。
   */
  bedroom: {
    // 地板：淺色木，偏暖灰粉
    floor: 0xa8867f,
    // 絨毛地毯：奶油白
    rug: 0xd0b6a6,
    // 牆：柔粉
    wall: 0xc297a4,
    ceiling: 0xa9858e,
    // 木作與線板：奶油白，房間裡最亮的實體
    trim: 0xd6bfc2,
    // 家具：白漆
    furniture: 0xc6acae,
    // 床品與紗幔：淡粉
    fabric: 0xd89bad,
    // 點綴：玫瑰金
    accent: 0xd69281,
    sky: 0xf2a8c0,
    windowLight: 0xffcf9a,
    windowIntensity: 1.05,
  },
  // 櫻花露台：偏冷的石灰牆、夜櫻的粉
  terrace: {
    floor: 0x5a4f42,
    rug: 0x8f8880,
    wall: 0x8b8894,
    ceiling: 0x6f6d78,
    trim: 0x7a7681,
    furniture: 0x60584c,
    fabric: 0x9e8590,
    accent: 0xa06f88,
    sky: 0x8f6fae,
    windowLight: 0xffc0d8,
    windowIntensity: 0.9,
  },
  // 星穹列車：金屬與深藍，窗外是星海
  astral: {
    floor: 0x322e42,
    rug: 0x413c58,
    wall: 0x2a2739,
    ceiling: 0x1f1d2b,
    trim: 0x8a7650,
    furniture: 0x3a3550,
    fabric: 0x4c4468,
    accent: 0x9a834f,
    sky: 0x241f45,
    windowLight: 0xb8cdff,
    windowIntensity: 0.8,
  },
};

/**
 * 房間尺寸（公尺）。角色高 1.5，站在原點。
 *
 * `depth` 給到 7 是因為**相機必須在房間裡面**。相機最遠會退到 z=3.2
 * （`setCameraView('full')`），而 OrbitControls 的 `maxDistance` 是 5。
 * 第一版 depth 只有 3.8，前緣落在 z=+1.6，相機整個站到屋外，畫面上看到的
 * 是側牆的**外側**、還有一塊貼在鏡頭前的床。
 *
 * 沒有前牆（那面正對相機，做了只會擋住視線），所以加深不會讓構圖變成走廊 ——
 * 看得到的永遠是後半段。
 */
const ROOM = {
  width: 6.0,
  depth: 7.0,
  height: 2.8,
  /** 角色站在原點，後牆退到她後方這麼遠。 */
  backZ: -2.4,
};

/**
 * 後牆上「看得到」的水平半寬（公尺）。
 *
 * 通話畫面是直式的，垂直 fov 32°、長寬比約 0.5，換算出來**水平 fov 只有
 * 約 16°**。相機在 z=3.2、後牆在 z=-2.4，距離 5.6 —— 後牆上實際入鏡的
 * 寬度只有 1.6 公尺左右。
 *
 * 第一版沒算這件事，把床擺在 x=-1.08、窗開在側牆，結果側牆的窗永遠看不到，
 * 而床只有最靠近相機的一角擠進畫面、還大得誇張。
 *
 * 所以陳設一律照這個半寬佈置：主要的東西放在 ±0.8 之內，
 * 邊緣的東西放在 ±0.8~1.3 讓它只露出一部分，形成景框。
 */
const VISIBLE_HALF_WIDTH = 0.8;

export class RoomScene {
  private readonly group = new THREE.Group();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private windowLight: THREE.DirectionalLight | null = null;
  private preset: RoomPreset | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "cyrene-room";
    this.group.visible = false;
    this.scene.add(this.group);
  }

  public get visible(): boolean {
    return this.group.visible;
  }

  public get currentPreset(): RoomPreset | null {
    return this.preset;
  }

  public hide(): void {
    this.group.visible = false;
    if (this.windowLight) this.windowLight.intensity = 0;
  }

  /** 蓋出（或換掉）房間。 */
  public build(preset: RoomPreset): void {
    if (this.preset === preset) {
      this.group.visible = true;
      if (this.windowLight) this.windowLight.intensity = PALETTES[preset].windowIntensity;
      return;
    }

    this.clear();
    const p = PALETTES[preset];

    this.addShell(p);
    this.addWindow(p);
    this.addRug(p);
    this.addBed(p);
    this.addNightstand(p);
    this.addShelf(p);
    this.addDecor(p);
    this.addPendant(p);
    this.addBunting(p);
    this.addFloorClutter(p);
    this.addMirror(p);
    this.addPlant(p);

    this.preset = preset;
    this.group.visible = true;
  }

  /** 平塗材質。房間跟角色同一套美術方向，不要寫實的高光。 */
  private mat(color: number, options: THREE.MeshLambertMaterialParameters = {}): THREE.Material {
    const m = new THREE.MeshLambertMaterial({ color, ...options });
    this.materials.push(m);
    return m;
  }

  /**
   * 在幾何的頂點色上烤一道漸層。
   *
   * 這是整個房間看起來「有沒有做過」的分水嶺。全部平塗的盒子不管配色多好，
   * 都會像積木 —— 因為真實空間裡牆角是暗的、靠窗是亮的、地板邊緣比中間暗，
   * 而平行光給不出這種**位置相關**的明暗。
   *
   * 完整的作法是烘焙光照貼圖或跑 SSAO，但兩者都跟平塗的美術方向打架
   * （SSAO 會在色塊上畫出寫實的髒污）。頂點色漸層便宜又剛好：它只是一層
   * 乘在底色上的空間變化，硬邊完全保留。
   *
   * @param mode vertical = 依高度（牆、家具）；radial = 依水平距離（地板、地毯）
   */
  private bakeGradient(
    geometry: THREE.BufferGeometry,
    darkFactor: number,
    mode: "vertical" | "radial" = "vertical"
  ): void {
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const spanY = Math.max(bb.max.y - bb.min.y, 1e-6);
    const spanXZ = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 1e-6) / 2;

    for (let i = 0; i < pos.count; i++) {
      let t: number;
      if (mode === "vertical") {
        t = (pos.getY(i) - bb.min.y) / spanY;
      } else {
        const r = Math.hypot(pos.getX(i), pos.getZ(i)) / spanXZ;
        t = 1 - Math.min(1, r);
      }
      const f = darkFactor + (1 - darkFactor) * t;
      colors[i * 3] = f;
      colors[i * 3 + 1] = f;
      colors[i * 3 + 2] = f;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  private box(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    gradient?: { dark: number; mode?: "vertical" | "radial" }
  ): THREE.Mesh {
    const g = new THREE.BoxGeometry(w, h, d);
    if (gradient) this.bakeGradient(g, gradient.dark, gradient.mode);
    this.geometries.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(x, y, z);
    // 房間只承接陰影、不投影 —— 角色的接觸陰影才是重點，家具互相投影
    // 只會讓平塗的畫面變髒。
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * 地板、天花板、三面牆。刻意不做第四面（相機那一側），否則會擋住視線。
   *
   * 每一面都烤了漸層：牆壁靠地板暗、靠天花板亮（真實空間的間接光就是這樣
   * 分佈的），地板則是中間亮、邊緣暗。沒有這一層的話整個房間就是一堆
   * 均勻色塊的積木。
   */
  private addShell(p: RoomPalette): void {
    const { width, depth, height, backZ } = ROOM;
    const centerZ = backZ + depth / 2;
    const t = 0.06;

    const vc = { vertexColors: true };
    this.box(width, t, depth, this.mat(p.floor, vc), 0, -t / 2, centerZ, {
      dark: 0.45,
      mode: "radial",
    });
    this.box(width, t, depth, this.mat(p.ceiling, vc), 0, height + t / 2, centerZ, {
      dark: 0.55,
      mode: "radial",
    });
    // 牆貼壁紙。map × vertexColor 會相乘，所以原本烘的高度漸層照樣有效。
    const paper = this.makeWallpaperTexture(p);
    const wallMat = (repeatX: number, repeatY: number): THREE.Material => {
      const tex = paper.clone();
      tex.needsUpdate = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      this.textures.push(tex);
      return this.mat(p.wall, { vertexColors: true, map: tex });
    };
    this.box(width, height, t, wallMat(width / 0.5, height / 0.5), 0, height / 2, backZ - t / 2, {
      dark: 0.42,
    });
    this.box(t, height, depth, wallMat(depth / 0.5, height / 0.5), -width / 2 - t / 2, height / 2, centerZ, {
      dark: 0.38,
    });
    this.box(t, height, depth, wallMat(depth / 0.5, height / 0.5), width / 2 + t / 2, height / 2, centerZ, {
      dark: 0.38,
    });

    // 踢腳板與腰牆線：平塗的畫面很吃這種水平收邊，一條線就能把牆「分層」。
    const skirting = this.mat(p.trim);
    this.box(width, 0.09, 0.02, skirting, 0, 0.045, backZ + 0.02);
    this.box(0.02, 0.09, depth, skirting, -width / 2 + 0.02, 0.045, centerZ);
    this.box(0.02, 0.09, depth, skirting, width / 2 - 0.02, 0.045, centerZ);
    this.box(width, 0.025, 0.015, skirting, 0, 0.95, backZ + 0.018);
  }

  /**
   * **後牆**上的窗。
   *
   * 第一版開在側牆，但直式取景的水平視角只有 16°，側牆從來不會入鏡 ——
   * 窗做了等於沒做。開在後牆、稍微偏一側，才會出現在角色旁邊。
   *
   * 窗景是一張程序生成的漸層貼圖（不吃光照），比單一色塊立體得多，而且
   * 它是畫面裡最亮的東西 —— 後處理的 bloom 會自動讓它暈開，那正是室內
   * 逆光該有的樣子。
   */
  private addWindow(p: RoomPalette): void {
    const { backZ } = ROOM;
    const winW = 1.05;
    const winH = 1.35;
    const winY = 1.35;
    const x = VISIBLE_HALF_WIDTH * 0.75;
    const z = backZ + 0.04;

    const glassGeo = new THREE.PlaneGeometry(winW, winH);
    this.geometries.push(glassGeo);
    const glassMat = new THREE.MeshBasicMaterial({
      map: this.makeSkyTexture(p),
      toneMapped: false,
    });
    this.materials.push(glassMat);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(x, winY, z);
    this.group.add(glass);

    const frame = this.mat(p.trim);
    const fb = 0.07;
    this.box(winW + fb * 2, fb, 0.05, frame, x, winY + winH / 2 + fb / 2, z + 0.01);
    this.box(winW + fb * 2, fb, 0.05, frame, x, winY - winH / 2 - fb / 2, z + 0.01);
    this.box(fb, winH + fb * 2, 0.05, frame, x - winW / 2 - fb / 2, winY, z + 0.01);
    this.box(fb, winH + fb * 2, 0.05, frame, x + winW / 2 + fb / 2, winY, z + 0.01);
    this.box(0.035, winH, 0.04, frame, x, winY, z + 0.01);
    this.box(winW + fb * 4, 0.05, 0.16, frame, x, winY - winH / 2 - fb, z + 0.07);

    // 窗簾：上緣窄、下緣寬，做出垂墜感，比一塊等寬的板子像布得多。
    const curtain = this.mat(p.fabric, { vertexColors: true });
    for (const side of [-1, 1]) {
      const cx = x + side * (winW / 2 + 0.19);
      const g = new THREE.CylinderGeometry(0.09, 0.17, winH + 0.62, 8, 1, true);
      this.bakeGradient(g, 0.5, "vertical");
      this.geometries.push(g);
      const m = new THREE.Mesh(g, curtain);
      m.position.set(cx, winY + 0.1, z + 0.06);
      m.scale.z = 0.45;
      m.receiveShadow = true;
      this.group.add(m);
    }
    // 窗簾桿
    this.box(winW + 0.75, 0.03, 0.03, frame, x, winY + winH / 2 + 0.2, z + 0.07);

    const light = new THREE.DirectionalLight(p.windowLight, p.windowIntensity);
    light.position.set(x + 0.6, winY + 1.0, z - 1.4);
    light.target.position.set(0, 0.9, 0);
    this.group.add(light);
    this.group.add(light.target);
    this.windowLight = light;
  }

  /**
   * 程序生成的窗景漸層。
   *
   * 只有 2×64 的直向漸層 —— 窗被景深糊掉之後細節本來就看不見，
   * 需要的只是「上面比較深、靠地平線比較暖」這個層次。
   */
  private makeSkyTexture(p: RoomPalette): THREE.Texture {
    const W = 256;
    const H = 320;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const sky = new THREE.Color(p.sky);
    const glow = new THREE.Color(p.windowLight);
    const hex = (c: THREE.Color) => `#${c.getHexString()}`;

    // 天空漸層：上面深、靠地平線暖
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, hex(sky.clone().multiplyScalar(0.6)));
    grad.addColorStop(0.42, hex(sky));
    grad.addColorStop(0.78, hex(sky.clone().lerp(glow, 0.55)));
    grad.addColorStop(1, hex(sky.clone().lerp(glow, 0.85)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 夕陽：地平線上一顆暖光暈
    const sunY = H * 0.72;
    const sun = ctx.createRadialGradient(W * 0.62, sunY, 0, W * 0.62, sunY, W * 0.5);
    sun.addColorStop(0, "rgba(255,240,214,0.95)");
    sun.addColorStop(0.28, "rgba(255,214,170,0.5)");
    sun.addColorStop(1, "rgba(255,200,160,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);

    // 雲：幾條壓扁的橢圓，帶一點暖色。位置用黃金角散開，不必亂數。
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = hex(glow.clone().lerp(new THREE.Color(0xffffff), 0.45));
    for (let i = 0; i < 7; i++) {
      const a = i * 2.399963;
      const cx = ((Math.sin(a) * 0.5 + 0.5) * 1.1 - 0.05) * W;
      const cy = (0.16 + (i % 4) * 0.11) * H;
      const rx = W * (0.11 + (i % 3) * 0.05);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, rx * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 遠山／遠景的剪影：兩層，後層淡、前層深，一眼就有距離感
    const ridge = (baseY: number, amp: number, alpha: number, color: THREE.Color) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hex(color);
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let px = 0; px <= W; px += 4) {
        const t = px / W;
        const y =
          baseY -
          Math.sin(t * Math.PI * 1.6 + 0.6) * amp -
          Math.sin(t * Math.PI * 4.3) * amp * 0.35;
        ctx.lineTo(px, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    ridge(H * 0.8, H * 0.05, 0.3, sky.clone().lerp(new THREE.Color(0x000000), 0.35));
    ridge(H * 0.87, H * 0.035, 0.45, sky.clone().lerp(new THREE.Color(0x000000), 0.55));

    // 幾顆星：只在上緣，數量少才像黃昏不是深夜
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (let i = 0; i < 9; i++) {
      const a = i * 2.399963;
      const sx = (Math.sin(a * 1.7) * 0.5 + 0.5) * W;
      const sy = (0.03 + (i % 5) * 0.045) * H;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(tex);
    return tex;
  }

  /**
   * 相框裡的畫。
   *
   * 相框原本是「一塊 trim 色的方框 + 一塊 accent 色的方塊」—— 沒有景深之後
   * 那就是牆上貼了幾張純色紙。每張畫都是程序生成的小圖：畫面上它們只有幾十
   * 個像素，需要的是**可辨識的形狀與配色**，不是細節。
   */
  private makeArtTexture(p: RoomPalette, kind: number): THREE.Texture {
    const S = 64;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d")!;
    const hex = (c: THREE.Color) => `#${c.getHexString()}`;
    const sky = new THREE.Color(p.sky);
    const glow = new THREE.Color(p.windowLight);
    const accent = new THREE.Color(p.accent);

    ctx.fillStyle = hex(new THREE.Color(p.rug).multiplyScalar(1.25));
    ctx.fillRect(0, 0, S, S);

    switch (kind % 4) {
      case 0: {
        // 黃昏的小風景
        const g = ctx.createLinearGradient(0, 0, 0, S);
        g.addColorStop(0, hex(sky));
        g.addColorStop(1, hex(sky.clone().lerp(glow, 0.8)));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = hex(sky.clone().lerp(new THREE.Color(0x000000), 0.5));
        ctx.beginPath();
        ctx.moveTo(0, S);
        ctx.lineTo(0, S * 0.72);
        ctx.lineTo(S * 0.4, S * 0.55);
        ctx.lineTo(S * 0.68, S * 0.75);
        ctx.lineTo(S, S * 0.62);
        ctx.lineTo(S, S);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 1: {
        // 愛心
        ctx.fillStyle = hex(accent.clone().lerp(new THREE.Color(0xff9ab5), 0.6));
        ctx.beginPath();
        const cx = S / 2;
        const cy = S * 0.42;
        const r = S * 0.19;
        ctx.arc(cx - r * 0.75, cy, r, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.75, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - r * 1.66, cy + r * 0.15);
        ctx.lineTo(cx, S * 0.85);
        ctx.lineTo(cx + r * 1.66, cy + r * 0.15);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 2: {
        // 一朵花
        ctx.fillStyle = hex(new THREE.Color(p.fabric).multiplyScalar(1.3));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(
            S / 2 + Math.cos(a) * S * 0.16,
            S * 0.44 + Math.sin(a) * S * 0.16,
            S * 0.13,
            S * 0.09,
            a,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
        ctx.fillStyle = hex(glow);
        ctx.beginPath();
        ctx.arc(S / 2, S * 0.44, S * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#4d6b45";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(S / 2, S * 0.56);
        ctx.lineTo(S / 2, S * 0.92);
        ctx.stroke();
        break;
      }
      default: {
        // 幾道斜條紋，當抽象畫
        for (let i = -4; i < 10; i++) {
          ctx.fillStyle =
            i % 3 === 0 ? hex(accent) : i % 3 === 1 ? hex(sky) : hex(glow);
          ctx.save();
          ctx.translate(i * 10, 0);
          ctx.rotate(0.35);
          ctx.fillRect(0, -S, 5, S * 3);
          ctx.restore();
        }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(tex);
    return tex;
  }

  /**
   * 家具底下的接觸陰影。
   *
   * 房間的家具是 `castShadow: false`（互相投影只會讓平塗畫面變髒），所以它們
   * 跟地板之間只有一條硬邊，看起來像積木擺在紙上而不是放在地上。真實感最便宜
   * 的來源就是這一圈接地的暗影 —— 一張 64×64 的徑向漸層當 alphaMap，
   * 所有家具共用同一張，成本可以忽略。
   *
   * 不用真的陰影貼圖：那需要家具都投影，而平行光只有一個方向，
   * 平塗的色塊上會出現寫實的斜投影，跟這個房間的畫風打架。
   */
  private contactShadowTexture: THREE.Texture | null = null;

  private getContactShadowTexture(): THREE.Texture {
    if (this.contactShadowTexture) return this.contactShadowTexture;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const half = size / 2;
      const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.45, "rgba(255,255,255,0.72)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    this.textures.push(texture);
    this.contactShadowTexture = texture;
    return texture;
  }

  /** 在 (x, z) 的地面上放一塊 w×d 的接地暗影。 */
  private contactShadow(x: number, z: number, w: number, d: number, opacity = 0.34): void {
    const geo = new THREE.PlaneGeometry(w, d);
    this.geometries.push(geo);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: this.getContactShadowTexture(),
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    // 比地毯（0.004）高一點點，家具的影子壓在地毯上也才看得到
    mesh.position.set(x, 0.008, z);
    mesh.renderOrder = -1;
    this.group.add(mesh);
  }

  /**
   * 圓柱零件。家具的腿、圓角、燈桿都靠它。
   *
   * 房間本來全是 `BoxGeometry`，遠看是一堆積木 —— 使用者的話是「床不應該是
   * 單純方塊」。真實家具的辨識度幾乎都在**輪廓的圓角與細長件**（腿、把手、
   * 圓邊）上，補這些比補貼圖有效得多，而且成本只是幾個低段數的圓柱。
   */
  private cyl(
    rTop: number,
    rBottom: number,
    h: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts: { rotX?: number; rotZ?: number; segments?: number; thetaLength?: number } = {}
  ): THREE.Mesh {
    const g = new THREE.CylinderGeometry(
      rTop,
      rBottom,
      h,
      opts.segments ?? 12,
      1,
      false,
      0,
      opts.thetaLength ?? Math.PI * 2
    );
    this.geometries.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(x, y, z);
    if (opts.rotX) mesh.rotation.x = opts.rotX;
    if (opts.rotZ) mesh.rotation.z = opts.rotZ;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * 圓角方塊。
   *
   * 房間「看起來像一堆方框」的根源：所有家具都是 `BoxGeometry`，而**真實物件
   * 幾乎沒有數學上的直角** —— 木作有導角、布料有厚度、書有書背的弧。少了那
   * 一圈圓角，再好的配色都像積木。
   *
   * 作法是把細分過的方塊往內縮 r，再把每個頂點沿著「它超出內縮盒的方向」
   * 推出 r：面上的點原地不動、邊上的點形成圓柱、角上的點形成球。
   * 4×4 的細分是 150 個頂點，比另外拼 12 根圓柱 + 8 顆球便宜得多。
   */
  private roundedBox(
    w: number,
    h: number,
    d: number,
    r: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    gradient?: { dark: number; mode?: "vertical" | "radial" }
  ): THREE.Mesh {
    const radius = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const half = new THREE.Vector3(w / 2 - radius, h / 2 - radius, d / 2 - radius);
    const v = new THREE.Vector3();
    const inner = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      inner.set(
        Math.min(half.x, Math.max(-half.x, v.x)),
        Math.min(half.y, Math.max(-half.y, v.y)),
        Math.min(half.z, Math.max(-half.z, v.z))
      );
      v.sub(inner);
      const len = v.length();
      if (len > 1e-6) v.multiplyScalar(radius / len);
      v.add(inner);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    if (gradient) this.bakeGradient(g, gradient.dark, gradient.mode);
    this.geometries.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    return mesh;
  }

  /** 壓扁的球：枕頭、被子、坐墊這種軟的東西。 */
  private puff(
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rotY = 0
  ): THREE.Mesh {
    const g = new THREE.SphereGeometry(1, 14, 10);
    this.geometries.push(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    return mesh;
  }

  /** 圓地毯：外圈深、內圈淺，加一道邊。 */
  private addRug(p: RoomPalette): void {
    const geo = new THREE.CircleGeometry(1.15, 48);
    this.bakeGradient(geo, 0.62, "radial");
    this.geometries.push(geo);
    const rug = new THREE.Mesh(
      geo,
      this.mat(0xffffff, { vertexColors: true, map: this.makeRugTexture(p) })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.004, 0.2);
    rug.receiveShadow = true;
    this.group.add(rug);

    // 同心花紋改畫在貼圖上（見 makeRugTexture）：實心環只能給同心圓，
    // 貼圖還能一起給放射狀的絨毛感，而且少 4 個 draw call。
  }

  /**
   * 牆上的裝飾：兩個相框與一串小燈。
   *
   * 小燈用不吃光照的材質，是畫面裡除了窗以外唯一的亮點 —— 後處理的 bloom
   * 會把它們暈成柔和的光點，空間立刻有氣氛。平塗的房間最缺的就是這種
   * 「亮度層次」。
   */
  private addDecor(p: RoomPalette): void {
    const { backZ } = ROOM;
    const z = backZ + 0.03;

    // 相框牆：大小錯落的一叢，不是兩個等距掛著的方框。
    // 參考的粉色房幾乎每一間都有這一叢 —— 它比單張大圖更有「住了人」的感覺。
    // 全部掛在角色左側：右側是窗與層架，中間是她自己。
    const frameMat = this.mat(p.trim);
    const artA = this.mat(p.accent);
    const artB = this.mat(p.fabric);
    const spots: Array<[number, number, number, number, boolean]> = [
      [-0.68, 1.72, 0.26, 0.20, true],
      [-0.36, 1.80, 0.17, 0.21, false],
      [-0.63, 1.42, 0.19, 0.24, false],
      [-0.34, 1.47, 0.22, 0.17, true],
      [-0.50, 1.13, 0.15, 0.15, false],
    ];
    for (let i = 0; i < spots.length; i++) {
      const [fx, fy, fw, fh] = spots[i];
      this.roundedBox(fw, fh, 0.022, 0.008, frameMat, fx, fy, z);
      const artGeo = new THREE.PlaneGeometry(fw - 0.04, fh - 0.04);
      this.geometries.push(artGeo);
      const artMat = new THREE.MeshBasicMaterial({
        map: this.makeArtTexture(p, i),
        toneMapped: false,
      });
      this.materials.push(artMat);
      const art = new THREE.Mesh(artGeo, artMat);
      art.position.set(fx, fy, z + 0.013);
      this.group.add(art);
    }

    // 串燈：沿著後牆上緣掛一排小光點
    const bulbGeo = new THREE.SphereGeometry(0.022, 8, 6);
    this.geometries.push(bulbGeo);
    const bulbMat = new THREE.MeshBasicMaterial({ color: p.windowLight, toneMapped: false });
    this.materials.push(bulbMat);
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const bx = -1.35 + t * 2.7;
      // 垂墜的弧線
      const by = 2.12 - Math.sin(t * Math.PI) * 0.14;
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(bx, by, z + 0.02);
      this.group.add(bulb);
    }

    // 第二串：低一點、垂得更深，跨過窗的上緣。
    // 兩串不同高度的光點會在景深裡疊出前後層次，只有一串看起來像一條裝飾線。
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const bx = -0.15 + t * 1.85;
      const by = 1.78 - Math.sin(t * Math.PI) * 0.22;
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(bx, by, z + 0.05);
      this.group.add(bulb);
    }
  }

  /** 角落的盆栽：給畫面一個有機的輪廓，全是方塊會很悶。 */
  private addPlant(p: RoomPalette): void {
    const { backZ } = ROOM;
    const x = VISIBLE_HALF_WIDTH * 1.5;
    const z = backZ + 0.35;

    const potGeo = new THREE.CylinderGeometry(0.13, 0.1, 0.22, 12);
    this.bakeGradient(potGeo, 0.6, "vertical");
    this.geometries.push(potGeo);
    const pot = new THREE.Mesh(potGeo, this.mat(p.trim, { vertexColors: true }));
    pot.position.set(x, 0.11, z);
    pot.receiveShadow = true;
    this.group.add(pot);
    // 盆緣與底盤：直筒圓柱看起來像水桶，有這兩圈才像花盆
    this.cyl(0.14, 0.14, 0.028, this.mat(p.trim), x, 0.226, z, { segments: 14 });
    this.cyl(0.135, 0.12, 0.02, this.mat(p.accent), x, 0.012, z, { segments: 14 });

    const leafMat = this.mat(0x5f7a52);
    const leafGeo = new THREE.SphereGeometry(0.1, 8, 6);
    this.geometries.push(leafGeo);
    const clumps: Array<[number, number, number, number]> = [
      [0, 0.34, 0, 1.5],
      [-0.11, 0.46, 0.03, 1.05],
      [0.12, 0.5, -0.02, 0.9],
      [0.02, 0.62, 0.04, 0.75],
    ];
    for (const [dx, dy, dz, sc] of clumps) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(x + dx, dy, z + dz);
      leaf.scale.setScalar(sc);
      leaf.castShadow = false;
      this.group.add(leaf);
    }
    this.contactShadow(x, z, 0.5, 0.5, 0.4);
  }

  /**
   * 床：擺在畫面左緣，只露出一部分。
   *
   * 完整放進畫面會跟角色搶主體；只露一角反而能交代「這是臥室」又不搶戲。
   * x 用可見半寬的 1.35 倍，剛好讓床頭那一側切在畫面外。
   */
  private addBed(p: RoomPalette): void {
    const { backZ } = ROOM;
    // 1.7 而不是 1.35：床原本 x 範圍是 −1.65~−0.51，而床頭櫃站在 −0.76 ——
    // **床頭櫃連同檯燈整個站在床裡面**（使用者：「燈不會放床上吧」）。
    // 床退到 −1.36（範圍 −1.93~−0.79），床頭櫃才有地方站。
    const x = -VISIBLE_HALF_WIDTH * 1.7;
    const z = backZ + 1.05;
    const frame = this.mat(p.furniture);
    const fabric = this.mat(p.fabric);
    const accent = this.mat(p.accent);

    const cream = this.mat(p.rug);

    // 床腳：把整張床從地板上抬起來。少了這一步，床就是一塊躺在地上的板子 ——
    // 「積木感」有一半來自這裡。
    for (const dx of [-0.5, 0.5]) {
      for (const dz of [-0.85, 0.85]) {
        this.cyl(0.036, 0.028, 0.17, frame, x + dx, 0.085, z + dz, { segments: 8 });
      }
    }

    // 床框：比床墊窄一點，側面才看得到一圈木邊
    this.roundedBox(1.14, 0.13, 1.94, 0.03, frame, x, 0.235, z);
    // 床墊：上緣用一條圓柱收邊，不是一刀切的直角
    this.roundedBox(1.08, 0.19, 1.88, 0.075, cream, x, 0.39, z);

    // 被子：圓角的厚板，不是一顆壓扁的球。
    //
    // 第一版用 `puff`（壓扁的球）當被子，加上一條 r=0.075 的圓柱當「翻起來的
    // 折邊」—— 實機看起來是一塊粉色圓餅上面橫著一根白香腸。被子的辨識度來自
    // **矩形的輪廓 + 圓角 + 一道薄薄的翻邊**，不是圓弧的體積。
    const duvet = this.mat(0xd4849c);
    this.roundedBox(1.07, 0.14, 0.95, 0.06, duvet, x, 0.5, z + 0.25);
    // 翻起來的床單邊：薄薄一條，壓在被子上緣
    this.roundedBox(1.07, 0.055, 0.17, 0.025, cream, x, 0.55, z - 0.19);

    // 枕頭：兩顆壓扁的球，不是兩塊板子
    this.puff(cream, x - 0.26, 0.55, z - 0.74, 0.27, 0.1, 0.17, 0.12);
    this.puff(cream, x + 0.26, 0.55, z - 0.74, 0.27, 0.1, 0.17, -0.12);
    // 靠枕：小一顆、撞色
    this.puff(accent, x + 0.04, 0.6, z - 0.6, 0.16, 0.09, 0.11, 0.4);

    // 腳邊摺好的毯子：放在**床墊**上，不是塞進被子裡。
    // 先前被子 z 範圍是 −0.22~+0.94、毯子在 +0.52~+0.92，整條埋在被子體積內 ——
    // 畫面上就是一塊粉色斜穿過另一塊粉色。現在被子收到 +0.72 為止，毯子接在後面。
    // z 要落在被子結束（+0.725）之後，兩塊布才不會互穿。
    // 尾端略微超出床墊（床墊到 +0.94）是刻意的 —— 毯子垂過床尾才像鋪的。
    this.roundedBox(1.06, 0.09, 0.3, 0.04, accent, x, 0.53, z + 0.88);
    this.cyl(0.03, 0.03, 1.06, accent, x, 0.56, z + 0.75, { rotZ: Math.PI / 2, segments: 8 });

    // 床頭板：長方形 + 半圓拱頂。拱頂是這張床最大的一個輪廓特徵，
    // 也是參考的粉色房裡最常見的床頭造型。
    // 高度要收：第一版拱頂到 1.47 公尺，比床本身還搶眼，
    // 整個左半邊變成一塊大白拱。現在頂端 1.19 公尺，讀得出是床頭又不搶戲。
    // 拱頂用**整根**圓柱，不是半圓。
    //
    // `thetaLength: Math.PI` 的半圓柱在 three 裡只會生出弧面與兩片半圓端蓋 ——
    // 被切開的那個**平面是空的**，從側面看進去就是一個空殼，使用者回報的
    // 「只做一半，另一半是空的」就是這個。
    //
    // 整根圓柱是封閉的，下半部剛好落在床頭板方塊裡面（板子 0.27~0.77，
    // 圓心 0.77 半徑 0.44 → 下半 0.33~0.77），看不到也不必挖掉。
    const headZ = z - 1.0;
    this.roundedBox(1.16, 0.5, 0.08, 0.035, frame, x, 0.52, headZ);
    this.cyl(0.44, 0.44, 0.08, frame, x, 0.77, headZ, {
      rotX: Math.PI / 2,
      segments: 28,
    });
    // 拱頂內側的軟包
    this.roundedBox(1.0, 0.4, 0.05, 0.025, fabric, x, 0.54, headZ + 0.05);
    this.cyl(0.36, 0.36, 0.05, fabric, x, 0.74, headZ + 0.05, {
      rotX: Math.PI / 2,
      segments: 24,
    });

    this.contactShadow(x, z + 0.1, 1.85, 2.75, 0.4);

    this.addBedPlushies(x, z - 0.5);
  }

  /**
   * 床上的玩偶。
   *
   * 幾何直接借道具的 `plush` —— 使用者丟一隻玩偶進場景時，會認得那就是床上
   * 這一隻。房間裡有「她的東西」比多一件家具更能讓空間屬於某個人。
   */
  private addBedPlushies(x: number, z: number): void {
    // 高度要算出來，不能用猜的。
    //
    // 第一版直接寫 y=0.52，而被子的上緣在 0.57 —— 兩隻熊有一半埋在被子裡，
    // 只有頭露出來（使用者截圖回報的穿模就是這個）。
    // `prop-models` 的玩偶從原點往下延伸約 1.1 個 size，所以坐在高度 h 的
    // 平面上時，原點要放在 h + 1.1 × size。
    const DUVET_TOP = 0.57;
    const spots: Array<[number, number, number]> = [
      [x + 0.2, z + 0.06, 0.115],
      [x - 0.14, z + 0.26, 0.085],
    ];
    for (const [px, pz, size] of spots) {
      const py = DUVET_TOP + size * 1.1;
      const build = buildProp("plush", size);
      this.geometries.push(build.geometry);
      const mesh = new THREE.Mesh(
        build.geometry,
        this.mat(0xffffff, { vertexColors: true })
      );
      mesh.position.set(px, py, pz);
      mesh.rotation.y = px > x ? -0.5 : 0.35;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** 床頭櫃與檯燈：畫面左側，床的前方。 */
  private addNightstand(p: RoomPalette): void {
    const { backZ } = ROOM;
    // 0.66 → x = −0.53，櫃面 0.44 寬所以佔 −0.75~−0.31，
    // 跟床的右緣（−0.79）留 4 公分。見 addBed 的說明。
    const x = -VISIBLE_HALF_WIDTH * 0.66;
    const z = backZ + 0.22;
    const wood = this.mat(p.furniture);
    const trim = this.mat(p.trim);

    // 桌腳 + 檯面外伸：一個 0.4×0.52×0.36 的方塊只是個箱子，
    // 加上細腿與外伸的檯面才讀得出是家具。
    for (const dx of [-0.15, 0.15]) {
      for (const dz of [-0.13, 0.13]) {
        this.cyl(0.02, 0.015, 0.14, wood, x + dx, 0.07, z + dz, { segments: 8 });
      }
    }
    this.roundedBox(0.36, 0.34, 0.32, 0.03, wood, x, 0.31, z);
    // 檯面（四邊各外伸 2 公分）＋ 圓邊
    this.roundedBox(0.44, 0.04, 0.4, 0.018, trim, x, 0.5, z);
    this.cyl(0.018, 0.018, 0.44, trim, x, 0.5, z + 0.2, { rotZ: Math.PI / 2, segments: 8 });
    // 抽屜面與把手
    this.roundedBox(0.3, 0.13, 0.025, 0.012, trim, x, 0.36, z + 0.165);
    const knobGeo = new THREE.SphereGeometry(0.022, 10, 8);
    this.geometries.push(knobGeo);
    const knob = new THREE.Mesh(knobGeo, this.mat(p.accent));
    knob.position.set(x, 0.36, z + 0.185);
    this.group.add(knob);

    // 檯燈：底座 → 燈桿 → 燈罩
    this.cyl(0.05, 0.065, 0.03, this.mat(p.accent), x, 0.535, z, { segments: 14 });
    this.box(0.024, 0.14, 0.024, this.mat(p.accent), x, 0.61, z);

    // 檯面上再放兩樣小東西：一疊書與一個馬克杯。
    // 幾何借道具的 —— 房間裡的東西跟她會丟出來玩的東西是同一批，比較像
    // 「她的房間」而不是樣品屋。
    this.addTabletop(x - 0.15, 0.52, z + 0.02);
    const shadeGeo = new THREE.CylinderGeometry(0.085, 0.125, 0.15, 16);
    this.geometries.push(shadeGeo);
    const shadeMat = new THREE.MeshBasicMaterial({ color: p.windowLight, toneMapped: false });
    this.materials.push(shadeMat);
    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.position.set(x, 0.735, z);
    this.group.add(shade);

    // 檯燈要真的照亮它旁邊那一塊牆，不然只是一顆貼在暗處的亮點。
    const lamp = new THREE.PointLight(p.windowLight, 0.55, 2.2, 2);
    lamp.position.set(x, 0.78, z + 0.05);
    this.group.add(lamp);
    this.contactShadow(x, z, 0.78, 0.72, 0.38);
  }

  /**
   * 壁紙。
   *
   * 房間「像一格一格的方塊」最大的來源是**牆**：它是畫面裡最大的一片面積，
   * 而平塗的單色 + 每面一個色調，讀起來就是一塊一塊的色板。加一層很淡的
   * 重複花紋之後，同一面牆上就有了高頻的細節，眼睛不再把它讀成一塊色塊。
   *
   * 花紋要**很淡**（透明度 0.05~0.12）：這是壁紙不是印花布，太明顯會跟角色搶。
   */
  private makeWallpaperTexture(p: RoomPalette): THREE.Texture {
    const S = 128;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, S, S);

    // 直條紋：兩種寬度交錯，比等寬條紋耐看
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 4; i++) ctx.fillRect(i * 32, 0, 9, S);
    ctx.fillStyle = "rgba(0,0,0,0.045)";
    for (let i = 0; i < 4; i++) ctx.fillRect(i * 32 + 16, 0, 3, S);

    // 小愛心：交錯排列（磚砌），才不會排成明顯的格線
    const heart = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      ctx.arc(cx - r * 0.5, cy, r * 0.55, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.5, cy, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.02, cy + r * 0.12);
      ctx.lineTo(cx, cy + r * 1.25);
      ctx.lineTo(cx + r * 1.02, cy + r * 0.12);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        heart(col * 32 + (row % 2 ? 16 : 0) + 16, row * 32 + 16, 4.2);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.textures.push(tex);
    return tex;
  }

  /**
   * 地毯的花紋。
   *
   * 畫面下三分之一幾乎只有地毯。原本是四圈實心的環，遠看還是「同心圓色塊」；
   * 貼圖可以同時給同心圓、放射狀的絨毛感與邊緣的流蘇。
   */
  private makeRugTexture(p: RoomPalette): THREE.Texture {
    const S = 256;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d")!;
    const c = S / 2;
    const hex = (v: number) => `#${new THREE.Color(v).getHexString()}`;

    ctx.fillStyle = hex(p.rug);
    ctx.fillRect(0, 0, S, S);

    // 同心環
    const bands: Array<[number, number, string]> = [
      [0.98, 0.9, hex(p.accent)],
      [0.86, 0.83, hex(p.fabric)],
      [0.66, 0.6, hex(p.accent)],
      [0.4, 0.37, hex(p.fabric)],
      [0.16, 0.0, hex(p.fabric)],
    ];
    for (const [outer, inner, color] of bands) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c, c, c * outer, 0, Math.PI * 2);
      ctx.arc(c, c, c * inner, 0, Math.PI * 2, true);
      ctx.fill();
    }

    // 放射狀的絨毛：很淡的細線，讓它不是一塊平的顏色
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * c * 0.18, c + Math.sin(a) * c * 0.18);
      ctx.lineTo(c + Math.cos(a) * c * 0.97, c + Math.sin(a) * c * 0.97);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(tex);
    return tex;
  }

  /**
   * 三角旗串。
   *
   * 少女房的參考裡出現頻率很高，而且它做的事情是**打斷牆面的水平線**：
   * 房間裡的線條（踢腳、腰牆、層板、床）全是水平的，一條垂墜的斜線就能
   * 讓整面牆活過來。
   */
  private addBunting(p: RoomPalette): void {
    const z = ROOM.backZ + 0.05;
    const x0 = -1.45;
    const x1 = 0.55;
    const y0 = 2.24;
    const sag = 0.26;
    const colors = [p.accent, p.fabric, p.trim, 0xd4849c, p.rug];
    const N = 13;

    // 繩子：用一串短圓柱連成垂曲線
    const cordMat = this.mat(p.trim);
    let prev: [number, number] | null = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const bx = x0 + (x1 - x0) * t;
      const by = y0 - Math.sin(t * Math.PI) * sag;
      if (prev) {
        const dx = bx - prev[0];
        const dy = by - prev[1];
        const len = Math.hypot(dx, dy);
        const seg = this.cyl(0.006, 0.006, len, cordMat, (bx + prev[0]) / 2, (by + prev[1]) / 2, z, {
          segments: 5,
        });
        seg.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
      }
      // 旗子：倒三角。用 3 段的 CircleGeometry 就是一個正三角形。
      if (i < N) {
        const flagGeo = new THREE.CircleGeometry(0.075, 3);
        this.geometries.push(flagGeo);
        const flag = new THREE.Mesh(flagGeo, this.mat(colors[i % colors.length]));
        flag.position.set(bx + (x1 - x0) / N / 2, by - 0.06, z + 0.01);
        // CircleGeometry 的三角形尖端朝上，轉 180 度變成垂下來的旗子
        flag.rotation.z = Math.PI;
        flag.scale.set(0.9, 1.25, 1);
        this.group.add(flag);
      }
      prev = [bx, by];
    }
  }

  /**
   * 地上的坐墊與玩具籃。
   *
   * 地板原本除了地毯什麼都沒有，而「東西多」正是少女房跟樣品屋的差別。
   * 這些都放在角色身後兩側 —— 前方要留給會掉下來的道具。
   */
  private addFloorClutter(p: RoomPalette): void {
    // 坐墊：兩顆壓扁的球，圓形在滿是矩形的房間裡特別有用
    this.puff(this.mat(0xd4849c), -0.62, 0.075, -1.15, 0.23, 0.075, 0.23);
    this.puff(this.mat(p.accent), 0.72, 0.08, -1.35, 0.2, 0.08, 0.2, 0.4);
    this.contactShadow(-0.62, -1.15, 0.66, 0.66, 0.3);
    this.contactShadow(0.72, -1.35, 0.6, 0.6, 0.3);

    // 玩具籃：一個矮圓桶，裡面塞兩隻玩偶
    const bx = 1.12;
    const bz = -1.5;
    this.cyl(0.19, 0.16, 0.22, this.mat(p.trim), bx, 0.11, bz, { segments: 16 });
    this.cyl(0.195, 0.195, 0.025, this.mat(p.accent), bx, 0.225, bz, { segments: 16 });
    this.contactShadow(bx, bz, 0.55, 0.55, 0.34);
    const peeking: Array<[number, number, number]> = [
      [bx - 0.06, bz + 0.02, 0.075],
      [bx + 0.07, bz - 0.03, 0.065],
    ];
    for (const [px, pz, size] of peeking) {
      const build = buildProp("plush", size);
      this.geometries.push(build.geometry);
      const mesh = new THREE.Mesh(build.geometry, this.mat(0xffffff, { vertexColors: true }));
      // 只露出上半身，下半身埋在籃子裡
      mesh.position.set(px, 0.2 + size * 0.55, pz);
      mesh.rotation.y = px > bx ? -0.6 : 0.4;
      this.group.add(mesh);
    }
  }

  /** 檯面上的小物：一疊書 + 一個馬克杯。幾何借自 prop-models。 */
  private addTabletop(x: number, y: number, z: number): void {
    const items: Array<[string, number, number, number, number]> = [
      ["book", x, z, 0.035, 0.4],
      ["book", x + 0.005, z + 0.01, 0.033, -0.25],
      ["cup", x + 0.13, z + 0.02, 0.032, 0.6],
    ];
    let stack = 0;
    for (const [kind, ix, iz, size, rot] of items) {
      const build = buildProp(kind as "book" | "cup", size);
      this.geometries.push(build.geometry);
      const mesh = new THREE.Mesh(
        build.geometry,
        this.mat(0xffffff, { vertexColors: true })
      );
      // 書是躺著疊的，杯子站著
      if (kind === "book") {
        mesh.rotation.set(Math.PI / 2, rot, 0);
        mesh.position.set(ix, y + 0.022 + stack, iz);
        stack += 0.03;
      } else {
        mesh.rotation.y = rot;
        mesh.position.set(ix, y + size * 0.65, iz);
      }
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /**
   * 天花板吊燈。
   *
   * 房間原本所有光源都在腰部以下（檯燈、窗、串燈），畫面上半部除了牆什麼都沒有。
   * 吊燈補的是**垂直方向的構圖**：一條線從天花板下來，把上緣的空白接起來。
   */
  private addPendant(p: RoomPalette): void {
    const x = -0.42;
    const z = ROOM.backZ + 0.9;
    const shadeY = 2.02;
    this.cyl(0.008, 0.008, ROOM.height - shadeY, this.mat(p.trim), x, (ROOM.height + shadeY) / 2, z, {
      segments: 6,
    });
    const shadeGeo = new THREE.CylinderGeometry(0.055, 0.15, 0.14, 18, 1, true);
    this.geometries.push(shadeGeo);
    const shadeMat = new THREE.MeshBasicMaterial({
      color: p.windowLight,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(shadeMat);
    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.position.set(x, shadeY, z);
    this.group.add(shade);

    const bulbGeo = new THREE.SphereGeometry(0.035, 10, 8);
    this.geometries.push(bulbGeo);
    const bulb = new THREE.Mesh(bulbGeo, shadeMat);
    bulb.position.set(x, shadeY - 0.06, z);
    this.group.add(bulb);

    const light = new THREE.PointLight(p.windowLight, 0.42, 3.2, 2);
    light.position.set(x, shadeY - 0.1, z);
    this.group.add(light);
  }

  /**
   * 牆上的圓鏡。
   *
   * 參考的粉色房裡出現頻率僅次於串燈的元素。它在平塗的牆面上提供一個
   * **圓形**的對比 —— 房間其他東西幾乎全是矩形，一個圓就足夠打破單調。
   */
  private addMirror(p: RoomPalette): void {
    // 掛在**床的上方**，不是床頭櫃上方。
    // 第一版放 (−0.53, 1.5)，而相框叢佔 x −0.68~−0.34、y 1.13~1.80 ——
    // 鏡子（半徑 0.22）整個壓在相框上。床頭板頂到 1.21，這裡從 1.53 起，clear。
    const x = -1.05;
    const y = 1.75;
    const z = ROOM.backZ + 0.04;
    const rimGeo = new THREE.TorusGeometry(0.2, 0.022, 8, 28);
    this.geometries.push(rimGeo);
    const rim = new THREE.Mesh(rimGeo, this.mat(p.accent));
    rim.position.set(x, y, z + 0.012);
    this.group.add(rim);

    const glassGeo = new THREE.CircleGeometry(0.2, 28);
    this.geometries.push(glassGeo);
    // 鏡面不做真的反射（成本高又跟平塗打架），用一層比牆亮的冷色帶漸層代替。
    this.bakeGradient(glassGeo, 0.72, "radial");
    // 鏡面帶一點暖，純冷灰在一整面粉牆上會像一塊石頭
    const glass = new THREE.Mesh(
      glassGeo,
      this.mat(0xccc2cc, { vertexColors: true })
    );
    glass.position.set(x, y, z + 0.008);
    this.group.add(glass);
  }

  /** 層架：畫面右側、窗的下方，放幾本書當視覺重量。 */
  private addShelf(p: RoomPalette): void {
    const { backZ } = ROOM;
    const x = VISIBLE_HALF_WIDTH * 1.15;
    const wood = this.mat(p.furniture);
    const z = backZ + 0.14;

    // 層板前緣用圓柱收邊，側板改成細柱，看起來才像木作而不是一個口字方塊
    for (const shelfY of [0.62, 0.28]) {
      this.roundedBox(0.62, 0.04, 0.25, 0.018, wood, x, shelfY, z);
      this.cyl(0.018, 0.018, 0.62, wood, x, shelfY, z + 0.125, {
        rotZ: Math.PI / 2,
        segments: 8,
      });
    }
    for (const dx of [-0.29, 0.29]) {
      this.cyl(0.022, 0.022, 0.66, wood, x + dx, 0.34, z - 0.08, { segments: 8 });
      this.cyl(0.022, 0.022, 0.66, wood, x + dx, 0.34, z + 0.1, { segments: 8 });
    }

    const bookColors = [p.accent, p.fabric, p.trim, p.rug];
    for (let i = 0; i < 6; i++) {
      const h = 0.19 + (i % 3) * 0.03;
      this.roundedBox(
        0.042,
        h,
        0.17,
        0.012,
        this.mat(bookColors[i % bookColors.length]),
        x - 0.2 + i * 0.055,
        0.64 + h / 2,
        z
      );
    }

    // 下層擺一小盆植物與一個相框，層架才不是「一排書 + 一塊空板」
    this.cyl(0.05, 0.038, 0.07, this.mat(p.accent), x - 0.16, 0.335, z, { segments: 10 });
    this.puff(this.mat(0x6f8a5e), x - 0.16, 0.4, z, 0.06, 0.055, 0.06);
    this.roundedBox(0.12, 0.15, 0.018, 0.008, this.mat(p.trim), x + 0.14, 0.375, z);
    this.box(0.09, 0.12, 0.02, this.mat(p.fabric), x + 0.14, 0.375, z + 0.005);

    this.contactShadow(x, z, 1.05, 0.6, 0.28);
  }

  private clear(): void {
    for (const child of [...this.group.children]) this.group.remove(child);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.length = 0;
    this.textures.length = 0;
    this.materials.length = 0;
    // 貼圖已經在上面 dispose 過了（它也在 textures 裡），這裡只是把快取清掉，
    // 換配色重建時才不會沿用一張已經釋放的貼圖。
    this.contactShadowTexture = null;
    this.windowLight = null;
    this.preset = null;
  }

  public dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }
}
