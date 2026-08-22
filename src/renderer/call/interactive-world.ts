/**
 * 可互動的物理場景：地板、道具，以及角色與道具之間的碰撞。
 *
 * 接在 `MMDPhysics` 的同一個 Bullet 世界上，而不是另開一個 —— 角色身上那 39 個
 * 「骨骼追隨」剛體本來就是她的身體形狀，共用世界才推得動道具。
 *
 * ## 座標
 *
 * 物理世界跑在 **PMX 空間**（見 mmd-physics.ts 的說明）。所以：
 *   - 地板放在 PMX y = `space.minY`，換算到場景剛好是 y = 0（模型腳底）
 *   - 道具的尺寸用場景單位（公尺）指定，內部除以 `space.scale` 轉成 PMX
 *   - 每幀把剛體變換換算回場景空間，寫進對應的 three.js mesh
 *
 * ## 碰撞群組
 *
 * PMX 用 0~15 這 16 個群組，這顆模型用掉了 0,1,3,4,6,7,8,9,10,11,13,14 ——
 * 2、5、12、15 是空的，所以道具放在 **15**。
 *
 * 但光是選一個空群組還不夠：Bullet 要兩邊互相同意才會碰撞
 * （`(groupA & maskB) && (groupB & maskA)`），而角色身上那些剛體的遮罩是
 * 作者按 MMD 的需求設的，有 4 個根本是 0（完全不碰任何東西）、也有只開兩三個
 * 位元的。照原樣的話道具會直接穿過她。
 *
 * 所以 `enableCharacterCollision` 會把角色**骨骼追隨**剛體的遮罩就地補上道具
 * 那一位元。只動 kinematic 的那些（她的身體），不碰布料的動力學剛體 ——
 * 布料本來就該用作者調好的遮罩，亂加會讓裙襬被自己的身體彈開。
 */

import * as THREE from "three";
import type AmmoNamespace from "ammojs-typed";
import { pmxToScenePosition, type PMXPhysicsSpace } from "./mmd-physics";
import { buildProp, type PropCollider, type PropKind } from "./prop-models";

export { PROP_KINDS, type PropKind } from "./prop-models";

type AmmoLib = typeof AmmoNamespace;

/** 道具的碰撞群組（模型沒用到 15）。 */
export const PROP_GROUP = 15;
const PROP_GROUP_BIT = 1 << PROP_GROUP;
/** 地板自己的群組，跟道具分開，這樣可以只讓道具落地、布料不被地板頂。 */
const GROUND_GROUP_BIT = 1 << 12;

/** 道具要碰的東西：地板、其他道具，以及角色（群組 0 與 1）。 */
const PROP_MASK = PROP_GROUP_BIT | GROUND_GROUP_BIT | 1 | 2;

export interface SpawnPropOptions {
  /** 場景座標（公尺）。省略時從角色頭頂上方隨機落下。 */
  position?: THREE.Vector3;
  /** 場景單位的半徑／半邊長。 */
  size?: number;
  /** 公斤。太輕會被布料的碰撞推飛。實際質量還會乘上道具自己的 massScale。 */
  mass?: number;
}

interface Prop {
  body: AmmoNamespace.btRigidBody;
  mesh: THREE.Mesh;
  /** 幾何是每個道具各自烘出來的，回收時要一起釋放。 */
  shape: AmmoNamespace.btCollisionShape;
  motionState: AmmoNamespace.btMotionState;
}

const DEFAULT_SIZE = 0.055;
const DEFAULT_MASS = 1.6;

/**
 * 預設落點：角色**身前**一小段距離，而不是繞著她撒一圈。
 *
 * 兩個都踩過的坑：
 *
 * 1. 生成在 y=1.7 的頭頂正上方 → 卡進頭飾與髮飾的碰撞體裡，Bullet 解穿透時
 *    把道具彈射出去，實測有飛到 x = −5 的。生成點必須**一開始就不與任何
 *    碰撞體重疊**。
 * 2. 改成半徑 0.5 的圓周撒開 → 不再彈飛了，但通話畫面是直式、取景又貼著
 *    角色，那一圈全部落在畫面外（實測 7 個道具的 NDC 只有 1 個勉強在框內）。
 *    物理是對的，使用者卻什麼都看不到。
 *
 * 3. z=0.38 還是太近：**手腕落在 z≈0.30**，道具等於貼著手掌的碰撞體往下掉，
 *    被打飛出去。實測丟 7 個只剩 3 個活著，而且都被彈到 x=±0.75（生成散佈
 *    只有 ±0.22）。手垂在身側時手腕的碰撞體就在落點上，這條路一定要讓開。
 *
 * 所以落點在身前 0.58：離身體碰撞體（半徑約 0.12，位在 z≈0）與手腕
 * （z≈0.30）都夠遠，x 只給 ±0.22 的散佈，仍在直式取景的可見範圍內。
 */
const SPAWN_FORWARD = 0.58;
const SPAWN_SPREAD_X = 0.22;
const SPAWN_HEIGHT = 1.25;

/** 掉出這個範圍（公尺）的道具直接回收 —— 它們已經在畫面外了。 */
const CULL_RADIUS = 3;
const CULL_FLOOR = -1;

/** 道具數量上限。每個道具都是一顆剛體，不設限的話點久了會拖垮幀率。 */
const MAX_PROPS = 24;

export class InteractiveWorld {
  private readonly props: Prop[] = [];
  private ground: {
    body: AmmoNamespace.btRigidBody;
    shape: AmmoNamespace.btCollisionShape;
    motionState: AmmoNamespace.btMotionState;
  } | null = null;
  private shadowCatcher: THREE.Mesh | null = null;
  private readonly scratchTransform: AmmoNamespace.btTransform;
  private readonly scratchVec: AmmoNamespace.btVector3;
  private readonly scratchQuat: AmmoNamespace.btQuaternion;
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private disposed = false;
  /** 用來讓每次生成的顏色與落點不同，但不依賴亂數（測試才好重現）。 */
  private spawnCounter = 0;

  constructor(
    private readonly ammo: AmmoLib,
    private readonly world: AmmoNamespace.btDiscreteDynamicsWorld,
    private readonly space: PMXPhysicsSpace,
    private readonly scene: THREE.Scene
  ) {
    this.scratchTransform = new ammo.btTransform();
    this.scratchVec = new ammo.btVector3(0, 0, 0);
    this.scratchQuat = new ammo.btQuaternion(0, 0, 0, 1);
  }

  public get propCount(): number {
    return this.props.length;
  }

  public get hasGround(): boolean {
    return this.ground !== null;
  }

  /** 場景公尺 → PMX 單位。 */
  private toPmx(meters: number): number {
    return meters / this.space.scale;
  }

  /**
   * 鋪地板。
   *
   * 用薄盒子而不是 `btStaticPlaneShape`：無限平面在 Bullet 裡的接觸生成比較
   * 容易讓小物體抖動，而且我們也不需要無限大 —— 角色腳下幾公尺就夠了。
   */
  public addGround(halfExtentMeters = 6): void {
    if (this.ground || this.disposed) return;
    const ammo = this.ammo;

    const half = this.toPmx(halfExtentMeters);
    const thickness = this.toPmx(0.5);

    const halfExtents = new ammo.btVector3(half, thickness, half);
    const shape = new ammo.btBoxShape(halfExtents);
    ammo.destroy(halfExtents);

    const form = this.scratchTransform;
    form.setIdentity();
    // 盒子的中心要沉下去半個厚度，上表面才剛好落在 minY（＝場景的 y = 0）。
    this.scratchVec.setValue(0, this.space.minY - thickness, 0);
    form.setOrigin(this.scratchVec);

    const motionState = new ammo.btDefaultMotionState(form);
    const inertia = new ammo.btVector3(0, 0, 0);
    const info = new ammo.btRigidBodyConstructionInfo(0, motionState, shape, inertia);
    info.set_m_friction(0.8);
    info.set_m_restitution(0.15);
    const body = new ammo.btRigidBody(info);
    ammo.destroy(inertia);
    ammo.destroy(info);

    // 地板只跟道具碰，不碰角色的布料 —— 裙襬本來就靠關節吊著，
    // 再被地板頂一次會整片翹起來。
    this.world.addRigidBody(body, GROUND_GROUP_BIT, PROP_GROUP_BIT);
    this.ground = { body, shape, motionState };
  }

  /**
   * 讓角色的身體推得動道具。
   *
   * 只改「骨骼追隨」（kinematic）剛體的遮罩 —— 那些是她的身體形狀。
   * 布料的動力學剛體維持作者原本的設定。
   */
  public enableCharacterCollision(bodies: AmmoNamespace.btRigidBody[]): number {
    let patched = 0;
    for (const body of bodies) {
      const proxy = body.getBroadphaseHandle();
      if (!proxy) continue;
      const mask = proxy.get_m_collisionFilterMask();
      proxy.set_m_collisionFilterMask(mask | PROP_GROUP_BIT);
      patched++;
    }
    return patched;
  }

  /** 在場景裡放一個會掉下來的道具。 */
  public spawnProp(kind: PropKind = "ball", options: SpawnPropOptions = {}): boolean {
    if (this.disposed) return false;
    if (this.props.length >= MAX_PROPS) this.removeOldest();

    const ammo = this.ammo;
    const index = this.spawnCounter++;
    const size = options.size ?? DEFAULT_SIZE;
    const mass = options.mass ?? DEFAULT_MASS;

    // 沒指定落點就在身前左右散開，不會每次都疊在同一點。
    // 用黃金角取 sin 當散佈量，序列不會重複、也不必靠亂數（測試才好重現）。
    const angle = index * 2.399963;
    const position =
      options.position ??
      new THREE.Vector3(
        Math.sin(angle) * SPAWN_SPREAD_X,
        SPAWN_HEIGHT + (index % 3) * 0.15,
        SPAWN_FORWARD + Math.cos(angle) * 0.06
      );

    const build = buildProp(kind, size);
    const shape = this.createShape(build.collider);
    const geometry = build.geometry;

    const inertia = new ammo.btVector3(0, 0, 0);
    shape.calculateLocalInertia(mass * build.massScale, inertia);

    const form = this.scratchTransform;
    form.setIdentity();
    // 場景 → PMX
    this.scratchVec.setValue(
      position.x / this.space.scale + this.space.centerX,
      position.y / this.space.scale + this.space.minY,
      -position.z / this.space.scale + this.space.centerZ
    );
    form.setOrigin(this.scratchVec);

    const motionState = new ammo.btDefaultMotionState(form);
    const info = new ammo.btRigidBodyConstructionInfo(
      mass * build.massScale,
      motionState,
      shape,
      inertia
    );
    info.set_m_friction(0.6);
    info.set_m_restitution(build.restitution);
    const body = new ammo.btRigidBody(info);
    ammo.destroy(inertia);
    ammo.destroy(info);

    body.setDamping(0.05, 0.25);
    // 讓它靜止之後可以睡著，堆了二十幾個才不會一直吃 CPU。
    body.setSleepingThresholds(0.6, 0.6);

    this.world.addRigidBody(body, PROP_GROUP_BIT, PROP_MASK);

    // 氣球要慢慢飄下來 —— 見 PropBuild.gravityScale。
    if (build.gravityScale !== 1) {
      const g = new ammo.btVector3(0, this.world.getGravity().y() * build.gravityScale, 0);
      body.setGravity(g);
      ammo.destroy(g);
    }

    // Lambert 而不是 Toon：道具沒有 toon ramp 貼圖，MeshToonMaterial 在
    // 沒有 gradientMap 時只會給一片死平的色塊，看不出立體。
    //
    // 顏色走**頂點色**：每個道具是好幾個零件烘成一顆幾何（見 prop-models），
    // 配色已經烘在頂點上，材質本身維持白色不去乘它。
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.name = `cyrene-prop-${index}`;
    this.scene.add(mesh);

    this.props.push({ body, mesh, shape, motionState });
    return true;
  }

  /** 把 prop-models 的碰撞描述翻成 ammo 的 shape（座標要換回 PMX 尺度）。 */
  private createShape(collider: PropCollider): AmmoNamespace.btCollisionShape {
    const ammo = this.ammo;
    switch (collider.kind) {
      case "sphere":
        return new ammo.btSphereShape(this.toPmx(collider.radius));
      case "cylinder": {
        const half = new ammo.btVector3(
          this.toPmx(collider.half[0]),
          this.toPmx(collider.half[1]),
          this.toPmx(collider.half[2])
        );
        const shape = new ammo.btCylinderShape(half);
        ammo.destroy(half);
        return shape;
      }
      case "box":
      default: {
        const half = new ammo.btVector3(
          this.toPmx(collider.half[0]),
          this.toPmx(collider.half[1]),
          this.toPmx(collider.half[2])
        );
        const shape = new ammo.btBoxShape(half);
        ammo.destroy(half);
        return shape;
      }
    }
  }

  /**
   * 腳下的接觸陰影。
   *
   * 沒有它的話角色看起來是浮在背景照片前面的 —— 這是「在飄」最主要的來源，
   * 跟物理其實無關，純粹是缺少把她和地面連起來的視覺線索。
   *
   * 用 `ShadowMaterial` 當承接面：它只顯示落在上面的陰影、本身完全透明，
   * 所以不會擋住背景照片。角色設 `castShadow` 但**不設** `receiveShadow` ——
   * 我們要的是地上的影子，不是瀏海打在臉上的硬邊暗斑。
   */
  public addShadowCatcher(sizeMeters = 4): void {
    if (this.shadowCatcher || this.disposed) return;
    const geometry = new THREE.PlaneGeometry(sizeMeters, sizeMeters);
    const material = new THREE.ShadowMaterial({ opacity: 0.42 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.001; // 抬一點避免與道具的靜止面 z-fighting
    mesh.receiveShadow = true;
    mesh.name = "cyrene-shadow-catcher";
    this.scene.add(mesh);
    this.shadowCatcher = mesh;
  }

  /** 把剛體的變換同步到 three.js mesh。每幀在物理步進之後呼叫。 */
  public sync(): void {
    if (this.disposed) return;

    // 先回收跑掉的。被裙襬掃到或生成時被彈開的道具會飛很遠，
    // 留著只是白算物理、也讓上限提早用完。
    for (let i = this.props.length - 1; i >= 0; i--) {
      const mesh = this.props[i].mesh;
      const outOfBounds =
        mesh.position.y < CULL_FLOOR ||
        mesh.position.x * mesh.position.x + mesh.position.z * mesh.position.z >
          CULL_RADIUS * CULL_RADIUS;
      if (outOfBounds) {
        this.destroyProp(this.props[i]);
        this.props.splice(i, 1);
      }
    }

    for (const prop of this.props) {
      prop.body.getMotionState().getWorldTransform(this.scratchTransform);
      const o = this.scratchTransform.getOrigin();
      const r = this.scratchTransform.getRotation();

      this.v.set(o.x(), o.y(), o.z());
      pmxToScenePosition(this.v, this.space);
      prop.mesh.position.copy(this.v);

      // 與位置同一套鏡射：Z 翻面等於四元數的 (x, y) 取負。
      this.q.set(-r.x(), -r.y(), r.z(), r.w());
      prop.mesh.quaternion.copy(this.q);
    }
  }

  private removeOldest(): void {
    const prop = this.props.shift();
    if (prop) this.destroyProp(prop);
  }

  private destroyProp(prop: Prop): void {
    this.world.removeRigidBody(prop.body);
    this.scene.remove(prop.mesh);
    prop.mesh.geometry.dispose();
    (prop.mesh.material as THREE.Material).dispose();
    this.ammo.destroy(prop.body);
    this.ammo.destroy(prop.motionState);
    this.ammo.destroy(prop.shape);
  }

  /** 清掉所有道具，地板與陰影承接面留著。 */
  public clearProps(): void {
    for (const prop of this.props) this.destroyProp(prop);
    this.props.length = 0;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.clearProps();
    this.disposed = true;

    if (this.ground) {
      this.world.removeRigidBody(this.ground.body);
      this.ammo.destroy(this.ground.body);
      this.ammo.destroy(this.ground.motionState);
      this.ammo.destroy(this.ground.shape);
      this.ground = null;
    }
    if (this.shadowCatcher) {
      this.scene.remove(this.shadowCatcher);
      this.shadowCatcher.geometry.dispose();
      (this.shadowCatcher.material as THREE.Material).dispose();
      this.shadowCatcher = null;
    }

    this.ammo.destroy(this.scratchTransform);
    this.ammo.destroy(this.scratchVec);
    this.ammo.destroy(this.scratchQuat);
  }
}
