// Granular Diff Applier -- 微颗粒度 Diff Hunk 审查与选择性补丁应用器 (Cursor / PR Style)
//
// 将 Unified Diff 拆解为独立的修改块 (Hunk)，
// 允许用户在 UI 中对每个 Hunk 进行单独的「接受 (Accept) / 拒绝 (Reject)」精细化决策。

export interface DiffHunkLine {
  type: "context" | "addition" | "deletion";
  text: string;
}

export interface ParsedDiffHunk {
  id: string;
  file: string;
  header: string;
  lines: DiffHunkLine[];
  accepted: boolean;
}

/**
 * 将 Unified Patch 解析为独立的 Hunk 清单
 */
export function parseUnifiedDiffToHunks(diffText: string): ParsedDiffHunk[] {
  const hunks: ParsedDiffHunk[] = [];
  const lines = diffText.split("\n");

  let currentFile = "unknown_file";
  let currentHunk: ParsedDiffHunk | null = null;
  let hunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("--- a/") || line.startsWith("+++ b/")) {
      const parts = line.slice(6).trim();
      if (parts) currentFile = parts;
      continue;
    }

    if (line.startsWith("@@")) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      currentHunk = {
        id: `hunk-${currentFile}-${++hunkIndex}`,
        file: currentFile,
        header: line,
        lines: [],
        accepted: true, // 默认推荐接受
      };
      continue;
    }

    if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "addition", text: line.slice(1) });
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "deletion", text: line.slice(1) });
      } else if (line.startsWith(" ")) {
        currentHunk.lines.push({ type: "context", text: line.slice(1) });
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * 将用户选中的 Hunk 组合应用到原始代码文本中
 */
export function applySelectedHunks(
  originalContent: string,
  hunks: ParsedDiffHunk[],
): {
  newContent: string;
  appliedCount: number;
  rejectedCount: number;
} {
  let content = originalContent;
  let appliedCount = 0;
  let rejectedCount = 0;

  for (const hunk of hunks) {
    if (!hunk.accepted) {
      rejectedCount++;
      continue;
    }

    const contextAndDeletions = hunk.lines
      .filter((l) => l.type === "context" || l.type === "deletion")
      .map((l) => l.text)
      .join("\n");

    const contextAndAdditions = hunk.lines
      .filter((l) => l.type === "context" || l.type === "addition")
      .map((l) => l.text)
      .join("\n");

    if (contextAndDeletions && content.includes(contextAndDeletions)) {
      content = content.replace(contextAndDeletions, contextAndAdditions);
      appliedCount++;
    } else {
      // 简单行级替换 fallback
      const deletions = hunk.lines.filter((l) => l.type === "deletion").map((l) => l.text);
      const additions = hunk.lines.filter((l) => l.type === "addition").map((l) => l.text).join("\n");

      if (deletions.length > 0 && content.includes(deletions.join("\n"))) {
        content = content.replace(deletions.join("\n"), additions);
        appliedCount++;
      } else {
        rejectedCount++;
      }
    }
  }

  return {
    newContent: content,
    appliedCount,
    rejectedCount,
  };
}
