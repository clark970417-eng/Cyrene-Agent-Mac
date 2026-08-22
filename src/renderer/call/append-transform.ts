import * as THREE from "three";

/**
 * PMX 的付与（append / grant）：一根骨頭按比例跟著另一根骨頭轉或移動。
 *
 * MMD 用它處理三類事情，這個模型三類都用到：
 * - **變形代理骨**：`足D / ひざD / 足首D` 才是掛蒙皮權重的骨頭，但它們掛在
 *   `腰キャンセル` 底下，不是 `足` 的子骨，只靠付与跟著 `足` 轉。少了這一步，
 *   轉 `足` 完全不會讓腿的網格動。
 * - **分散骨**：`腕捩1/2/3` 的比例是 0.25 / 0.5 / 0.75，把翻掌的扭轉平均分佈
 *   在前臂上，否則整段扭轉都擠在手腕，腕口會擰出一道摺痕。
 * - **反向抵銷骨**：比例 -1（`肩C`、`腰キャンセル`），用來抵掉父骨的旋轉。
 */
export interface AppendTransformEntry {
  bone: THREE.Bone;
  source: THREE.Bone;
  /** 跟隨比例，可為負（反向）。 */
  ratio: number;
  affectRotation: boolean;
  affectPosition: boolean;
  bindRotation: THREE.Quaternion;
  bindPosition: THREE.Vector3;
  sourceBindPosition: THREE.Vector3;
}

const scratchRotation = new THREE.Quaternion();

/**
 * 套用一份付与清單。每幀擺完姿勢、跑彈簧骨之前呼叫一次。
 *
 * 清單請照骨頭索引排序：PMX 的變形階層保證來源骨排在跟隨骨之前，
 * 照順序跑一趟就能把串接的付与（`足 → 足D → ひざD`）算完。
 */
export function applyAppendTransforms(entries: AppendTransformEntry[]): void {
  for (const entry of entries) {
    if (entry.affectRotation) {
      scratchRotation.copy(entry.source.quaternion);
      if (entry.ratio < 0) scratchRotation.invert();
      // 「比例」= 沿著旋轉角度縮放，從單位四元數 slerp 過去正好就是這個意思。
      entry.bone.quaternion
        .identity()
        .slerp(scratchRotation, Math.min(Math.abs(entry.ratio), 1))
        .multiply(entry.bindRotation);
    }
    if (entry.affectPosition) {
      entry.bone.position
        .copy(entry.source.position)
        .sub(entry.sourceBindPosition)
        .multiplyScalar(entry.ratio)
        .add(entry.bindPosition);
    }
  }
}
