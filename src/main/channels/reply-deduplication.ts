/**
 * 移除模型偶爾把整段答案原樣輸出兩次的情況。
 * 只在分隔線兩側完全相同時處理，不碰正常的相似句或不同段落。
 */
export function collapseExactRepeatedReply(text: string): string {
  const trimmed = text.trim();
  const separator = /\n\s*\n/gu;

  for (const match of trimmed.matchAll(separator)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const left = trimmed.slice(0, index).trim();
    const right = trimmed.slice(index + match[0].length).trim();
    if (left && left === right) return left;
  }

  return trimmed;
}
