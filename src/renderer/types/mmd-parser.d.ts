/**
 * `mmd-parser` 沒有附型別宣告，DefinitelyTyped 上也沒有 @types 套件。
 *
 * 這裡只宣告我們實際用到的部分：PMX 的解析結果欄位極多（頂點、面、材質、
 * 骨骼、表情、剛體、關節…），逐一精確建模的維護成本遠高於收益，所以解析
 * 結果維持 unknown-ish 的寬鬆型別，由呼叫端自行 narrow。
 */
declare module "mmd-parser" {
  export class Parser {
    parsePmx(buffer: ArrayBuffer, leftToRight?: boolean): any;
    parsePmd(buffer: ArrayBuffer, leftToRight?: boolean): any;
    parseVmd(buffer: ArrayBuffer, leftToRight?: boolean): any;
    parseVpd(text: string, leftToRight?: boolean): any;
    mergeVmds(vmds: any[]): any;
  }

  /**
   * Shift_JIS → Unicode 的碼表。
   *
   * 只有測試會用到：VMD 的骨頭名稱是 Shift_JIS，要合成測試用的 VMD 檔就得
   * 反過來編碼，而 `s2uTable` 反轉之後剛好可以當編碼表用。
   */
  export class CharsetEncoder {
    s2u(bytes: Uint8Array): string;
    s2uTable: Record<string, number>;
  }
}
