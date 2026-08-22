/**
 * 互動道具的外觀。
 *
 * 原本三種道具是「球、方塊、壓扁的方塊」，那顆壓扁的方塊叫做「抱枕」——
 * 看起來就是一塊木頭。這裡把每個道具做成看得出是什麼東西的形狀。
 *
 * ## 為什麼是合併幾何 + 頂點色，而不是一堆 Mesh 組成的 Group
 *
 * 場上最多同時 24 個道具。一個玩偶如果用 10 個 Mesh 拼，那是 240 個 draw call，
 * 只為了幾顆會滾來滾去的玩具，不值得。這裡把所有零件先各自烘上顏色、套好變換，
 * 再 `mergeGeometries` 成**一顆** BufferGeometry，材質是
 * `MeshLambertMaterial({ vertexColors: true })` —— 一個道具一次 draw call，
 * 跟原本的單一方塊一樣便宜，但可以有配色。
 *
 * ## 顏色為什麼要砍半
 *
 * 場景燈光加起來超過 2.0（環境 0.82 + 主光 0.72 + 補光 0.32 + 邊光 0.30）。
 * 這是配合角色材質調的，道具若直接用粉彩色會過曝成一塊白。所以常數寫「想要
 * 看到的顏色」，由 `dim()` 統一壓暗 —— 這樣讀常數的時候看到的是真的顏色。
 *
 * 0.66 是實機挑的：先前砍到 0.5，道具落在地上（離主光遠、又被角色擋掉一部分）
 * 會暗成一團醬色，球看起來像深棕色而不是粉紅色。
 *
 * ## 碰撞形狀跟外觀是分開的
 *
 * 視覺可以很細，碰撞體一律用最接近的簡單體積（盒／球／圓柱）。玩偶不需要
 * 逐耳朵碰撞，用一顆球就夠了，而且簡單體積的解算穩定得多。
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type PropKind =
  | "ball"
  | "plush"
  | "cube"
  | "donut"
  | "cup"
  | "book"
  | "balloon";

/** 所有道具的種類，UI 依這個順序排。 */
export const PROP_KINDS: PropKind[] = [
  "ball",
  "plush",
  "cube",
  "donut",
  "cup",
  "book",
  "balloon",
];

/** 碰撞形狀的描述；由 interactive-world 翻成 ammo 的 shape。 */
export type PropCollider =
  | { kind: "sphere"; radius: number }
  | { kind: "box"; half: [number, number, number] }
  | { kind: "cylinder"; half: [number, number, number] };

export interface PropBuild {
  geometry: THREE.BufferGeometry;
  collider: PropCollider;
  /** 彈性。球會跳、書幾乎不跳。 */
  restitution: number;
  /** 質量倍率。氣球輕、書重 —— 撞到的手感才會不一樣。 */
  massScale: number;
  /**
   * 重力倍率。氣球用 0.18 慢慢飄下來，其餘 1。
   *
   * 真的做浮力要負重力，但那樣氣球會黏在天花板上再也拿不下來；
   * 減弱重力可以有「飄」的感覺又一定會落地。
   */
  gravityScale: number;
  /** UI 上的標籤。 */
  label: string;
}

/** 燈光補償：常數寫想看到的顏色，實際用的是它的一半。 */
const EXPOSURE = 0.66;

function dim(hex: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(EXPOSURE);
}

interface Part {
  geometry: THREE.BufferGeometry;
  color: number;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

/**
 * 把零件各自烘上顏色與變換，合併成一顆幾何。
 *
 * `mergeGeometries` 要求所有輸入的屬性集合一致，所以每個零件都要補上 `color`；
 * three 內建的 primitive 都是 indexed 且帶 position/normal/uv，可以直接合。
 */
function bake(parts: Part[]): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4();
  const euler = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  const prepared = parts.map((part) => {
    const geometry = part.geometry;
    position.set(...(part.pos ?? [0, 0, 0]));
    euler.set(...(part.rot ?? [0, 0, 0]));
    quaternion.setFromEuler(euler);
    scale.set(...(part.scale ?? [1, 1, 1]));
    matrix.compose(position, quaternion, scale);
    geometry.applyMatrix4(matrix);

    const color = dim(part.color);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3 + 0] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // uv 用不到（材質沒有貼圖），但留著才好跟其他零件合併。
    return geometry;
  });

  const merged = mergeGeometries(prepared, false);
  for (const geometry of prepared) geometry.dispose();
  if (!merged) throw new Error("道具幾何合併失敗");
  merged.computeBoundingSphere();
  return merged;
}

// 低段數就好：道具最大只有 5~6 公分，在畫面上不過幾十個像素。
const SPHERE = (r: number, seg = 12, ring = 8) => new THREE.SphereGeometry(r, seg, ring);

/** 彈跳球：主體 + 兩圈撞色的環，才不會只是一顆素球。 */
function buildBall(s: number): PropBuild {
  const band = new THREE.TorusGeometry(s * 0.99, s * 0.13, 6, 20);
  return {
    geometry: bake([
      { geometry: SPHERE(s, 16, 12), color: 0xff7fa8 },
      { geometry: band, color: 0xfff2d6, rot: [Math.PI / 2, 0, 0] },
      {
        geometry: new THREE.TorusGeometry(s * 0.99, s * 0.13, 6, 20),
        color: 0x7fd8ff,
        rot: [Math.PI / 2, 0, Math.PI / 2],
      },
    ]),
    collider: { kind: "sphere", radius: s },
    restitution: 0.62,
    massScale: 0.8,
    gravityScale: 1,
    label: "彈跳球",
  };
}

/**
 * 玩偶：頭、身體、耳朵、四肢、口鼻、眼睛。
 *
 * 這是使用者點名的那個 ——「你說娃娃，上面也只是塊木頭而已」。
 * 讓它成立的關鍵是**頭要大、四肢要短**：Q 版比例才讀得出是玩偶而不是人形。
 */
function buildPlush(s: number): PropBuild {
  const fur = 0xd9a273;
  const cream = 0xf4dcc0;
  const dark = 0x3a2a24;
  const parts: Part[] = [
    // 身體：稍微壓扁的球
    { geometry: SPHERE(s * 0.72), color: fur, pos: [0, -s * 0.25, 0], scale: [1, 0.92, 0.88] },
    // 頭：比身體大，Q 版比例
    { geometry: SPHERE(s * 0.62), color: fur, pos: [0, s * 0.62, 0] },
    // 耳朵
    { geometry: SPHERE(s * 0.24, 10, 7), color: fur, pos: [-s * 0.44, s * 1.02, -s * 0.05] },
    { geometry: SPHERE(s * 0.24, 10, 7), color: fur, pos: [s * 0.44, s * 1.02, -s * 0.05] },
    { geometry: SPHERE(s * 0.13, 8, 6), color: cream, pos: [-s * 0.44, s * 1.02, s * 0.12] },
    { geometry: SPHERE(s * 0.13, 8, 6), color: cream, pos: [s * 0.44, s * 1.02, s * 0.12] },
    // 口鼻
    { geometry: SPHERE(s * 0.26, 10, 7), color: cream, pos: [0, s * 0.48, s * 0.44], scale: [1, 0.72, 0.62] },
    { geometry: SPHERE(s * 0.09, 8, 6), color: dark, pos: [0, s * 0.55, s * 0.58] },
    // 眼睛
    { geometry: SPHERE(s * 0.08, 8, 6), color: dark, pos: [-s * 0.24, s * 0.74, s * 0.5] },
    { geometry: SPHERE(s * 0.08, 8, 6), color: dark, pos: [s * 0.24, s * 0.74, s * 0.5] },
    // 手
    { geometry: SPHERE(s * 0.26, 10, 7), color: fur, pos: [-s * 0.74, -s * 0.12, s * 0.06] },
    { geometry: SPHERE(s * 0.26, 10, 7), color: fur, pos: [s * 0.74, -s * 0.12, s * 0.06] },
    // 腳
    { geometry: SPHERE(s * 0.3, 10, 7), color: fur, pos: [-s * 0.38, -s * 0.86, s * 0.14], scale: [1, 0.8, 1.15] },
    { geometry: SPHERE(s * 0.3, 10, 7), color: fur, pos: [s * 0.38, -s * 0.86, s * 0.14], scale: [1, 0.8, 1.15] },
    // 圍巾，讓正面有一條撞色
    {
      geometry: new THREE.TorusGeometry(s * 0.5, s * 0.11, 6, 16),
      color: 0xc85a6e,
      pos: [0, s * 0.2, 0],
      rot: [Math.PI / 2, 0, 0],
    },
  ];
  return {
    geometry: bake(parts),
    collider: { kind: "sphere", radius: s * 0.95 },
    restitution: 0.1, // 布偶不彈
    massScale: 0.6,
    gravityScale: 1,
    label: "玩偶",
  };
}

/** 積木：木頭底色 + 三面不同顏色的貼片，看得出是兒童積木不是灰盒子。 */
function buildCube(s: number): PropBuild {
  const wood = 0xc99a63;
  const plate = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const t = s * 0.06; // 貼片厚度
  const f = s * 1.34; // 貼片邊長
  return {
    geometry: bake([
      { geometry: plate(s * 1.7, s * 1.7, s * 1.7), color: wood },
      { geometry: plate(f, f, t), color: 0xe4564f, pos: [0, 0, s * 0.85] },
      { geometry: plate(t, f, f), color: 0x4f92e4, pos: [s * 0.85, 0, 0] },
      { geometry: plate(f, t, f), color: 0xf0c246, pos: [0, s * 0.85, 0] },
    ]),
    collider: { kind: "box", half: [s * 0.85, s * 0.85, s * 0.85] },
    restitution: 0.18,
    massScale: 1.1,
    gravityScale: 1,
    label: "積木",
  };
}

/** 甜甜圈：麵包體 + 糖霜 + 巧克力米。 */
function buildDonut(s: number): PropBuild {
  const parts: Part[] = [
    {
      geometry: new THREE.TorusGeometry(s * 0.72, s * 0.36, 8, 20),
      color: 0xd9a05a,
      rot: [Math.PI / 2, 0, 0],
    },
    {
      geometry: new THREE.TorusGeometry(s * 0.72, s * 0.34, 8, 20),
      color: 0xf2a0c0,
      rot: [Math.PI / 2, 0, 0],
      pos: [0, s * 0.14, 0],
      scale: [1.04, 0.7, 1.04],
    },
  ];
  // 巧克力米：黃金角散開，不必亂數也不會排成一直線
  const sprinkleColors = [0xfff3d0, 0x8ad6ff, 0xffe066, 0x9df0a8];
  for (let i = 0; i < 8; i++) {
    const angle = i * 2.399963;
    const radius = s * (0.5 + ((i % 3) * 0.18));
    parts.push({
      geometry: new THREE.BoxGeometry(s * 0.16, s * 0.05, s * 0.05),
      color: sprinkleColors[i % sprinkleColors.length],
      pos: [Math.cos(angle) * radius, s * 0.31, Math.sin(angle) * radius],
      rot: [0, -angle, 0],
    });
  }
  return {
    geometry: bake(parts),
    collider: { kind: "cylinder", half: [s * 1.08, s * 0.36, s * 1.08] },
    restitution: 0.24,
    massScale: 0.7,
    gravityScale: 1,
    label: "甜甜圈",
  };
}

/** 馬克杯：杯身 + 杯口 + 裡面的飲料 + 把手。 */
function buildCup(s: number): PropBuild {
  const body = 0xf1ece1;
  return {
    geometry: bake([
      {
        geometry: new THREE.CylinderGeometry(s * 0.62, s * 0.54, s * 1.3, 16),
        color: body,
      },
      // 杯口一圈，讓上緣不是一片平的
      {
        geometry: new THREE.TorusGeometry(s * 0.6, s * 0.06, 6, 18),
        color: 0xd8cfbe,
        pos: [0, s * 0.65, 0],
        rot: [Math.PI / 2, 0, 0],
      },
      // 飲料：略低於杯口
      {
        geometry: new THREE.CylinderGeometry(s * 0.55, s * 0.55, s * 0.06, 16),
        color: 0x7a4a2c,
        pos: [0, s * 0.5, 0],
      },
      // 把手
      {
        geometry: new THREE.TorusGeometry(s * 0.34, s * 0.09, 6, 14, Math.PI * 1.35),
        color: body,
        pos: [s * 0.62, 0, 0],
        rot: [0, Math.PI / 2, -Math.PI * 0.32],
      },
    ]),
    collider: { kind: "cylinder", half: [s * 0.68, s * 0.65, s * 0.68] },
    restitution: 0.16,
    massScale: 1.3,
    gravityScale: 1,
    label: "馬克杯",
  };
}

/** 書：封面 + 露出來的白色書頁 + 書背 + 書籤帶。 */
function buildBook(s: number): PropBuild {
  const cover = 0x5f6fa8;
  const w = s * 1.25;
  const h = s * 1.6;
  const d = s * 0.42;
  return {
    geometry: bake([
      { geometry: new THREE.BoxGeometry(w, d, h), color: cover },
      // 書頁比封面小一點點，三面露出白邊
      {
        geometry: new THREE.BoxGeometry(w * 0.93, d * 0.72, h * 0.94),
        color: 0xf6f1e4,
        pos: [s * 0.04, 0, 0],
      },
      // 書背：整條不被書頁蓋住
      {
        geometry: new THREE.BoxGeometry(s * 0.1, d * 1.02, h * 1.01),
        color: 0x47548a,
        pos: [-w * 0.5 + s * 0.05, 0, 0],
      },
      // 書籤帶
      {
        geometry: new THREE.BoxGeometry(s * 0.08, s * 0.02, h * 0.75),
        color: 0xd8686e,
        pos: [w * 0.18, d * 0.52, h * 0.2],
      },
    ]),
    collider: { kind: "box", half: [w * 0.5, d * 0.5, h * 0.5] },
    restitution: 0.05, // 書不會跳
    massScale: 1.8,
    gravityScale: 1,
    label: "書",
  };
}

/** 氣球：球體 + 打結的小錐 + 一段線。落得比別的慢。 */
function buildBalloon(s: number): PropBuild {
  return {
    geometry: bake([
      {
        geometry: SPHERE(s * 0.85, 16, 12),
        color: 0xff8fb1,
        pos: [0, s * 0.45, 0],
        scale: [1, 1.18, 1],
      },
      // 高光：一小塊亮面，球體才不會是一顆均勻的果凍
      {
        geometry: SPHERE(s * 0.22, 8, 6),
        color: 0xffd9e4,
        pos: [-s * 0.32, s * 0.85, s * 0.6],
        scale: [1, 1.4, 0.4],
      },
      {
        geometry: new THREE.ConeGeometry(s * 0.16, s * 0.26, 10),
        color: 0xe8749b,
        pos: [0, -s * 0.5, 0],
        rot: [Math.PI, 0, 0],
      },
      {
        geometry: new THREE.CylinderGeometry(s * 0.02, s * 0.02, s * 1.1, 5),
        color: 0xf0e6d8,
        pos: [0, -s * 1.15, 0],
      },
    ]),
    collider: { kind: "sphere", radius: s * 0.85 },
    restitution: 0.42,
    massScale: 0.25,
    gravityScale: 0.18,
    label: "氣球",
  };
}

const BUILDERS: Record<PropKind, (size: number) => PropBuild> = {
  ball: buildBall,
  plush: buildPlush,
  cube: buildCube,
  donut: buildDonut,
  cup: buildCup,
  book: buildBook,
  balloon: buildBalloon,
};

/**
 * 造一個道具的幾何與物理參數。
 *
 * `size` 是場景單位（公尺）的基準半徑，各道具會依自己的比例放大縮小 ——
 * 書比球大一點、玩偶比球高一點，這樣一排放在地上看起來才像一堆不同的東西，
 * 而不是同一個模子印出來的。
 */
export function buildProp(kind: PropKind, size: number): PropBuild {
  return (BUILDERS[kind] ?? buildBall)(size);
}
