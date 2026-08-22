// Sandbox Simulation Canvas -- 即时沙盘推演与安全可视化画布 (Dry-run Canvas)
//
// 在执行涉及多文件修改、重命名或高风险文件操作前，
// 在虚拟沙盒中推演目录树状态变化与受影响符号，并生成可视化树状图谱。

export type MutationType = "add" | "modify" | "delete" | "rename";

export interface ProposedFileMutation {
  type: MutationType;
  path: string;
  newPath?: string;
  summary?: string;
  affectedSymbols?: string[];
}

export interface VirtualTreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  status: "added" | "modified" | "deleted" | "renamed" | "unchanged";
  children?: VirtualTreeNode[];
  mutation?: ProposedFileMutation;
}

export interface SimulationResult {
  totalAffectedFiles: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  renamedCount: number;
  riskLevel: "low" | "medium" | "high";
  treeRoot: VirtualTreeNode;
}

export class SandboxSimulationCanvas {
  /**
   * 推演文件变更并构建虚拟目录树
   */
  simulate(mutations: ProposedFileMutation[]): SimulationResult {
    let addedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    let renamedCount = 0;

    const root: VirtualTreeNode = {
      name: "root",
      fullPath: "",
      isDirectory: true,
      status: "unchanged",
      children: [],
    };

    for (const m of mutations) {
      if (m.type === "add") addedCount++;
      else if (m.type === "modify") modifiedCount++;
      else if (m.type === "delete") deletedCount++;
      else if (m.type === "rename") renamedCount++;

      this.insertNode(root, m);
    }

    const total = mutations.length;
    let riskLevel: SimulationResult["riskLevel"] = "low";
    if (deletedCount > 0 || total > 10) {
      riskLevel = "high";
    } else if (total > 3) {
      riskLevel = "medium";
    }

    return {
      totalAffectedFiles: total,
      addedCount,
      modifiedCount,
      deletedCount,
      renamedCount,
      riskLevel,
      treeRoot: root,
    };
  }

  private insertNode(root: VirtualTreeNode, mutation: ProposedFileMutation): void {
    const parts = mutation.path.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (!current.children) {
        current.children = [];
      }

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          fullPath: parts.slice(0, i + 1).join("/"),
          isDirectory: !isLast,
          status: isLast
            ? mutation.type === "add"
              ? "added"
              : mutation.type === "modify"
              ? "modified"
              : mutation.type === "delete"
              ? "deleted"
              : "renamed"
            : "unchanged",
          mutation: isLast ? mutation : undefined,
          children: isLast ? undefined : [],
        };
        current.children.push(child);
      } else if (isLast) {
        child.status =
          mutation.type === "add"
            ? "added"
            : mutation.type === "modify"
            ? "modified"
            : mutation.type === "delete"
            ? "deleted"
            : "renamed";
        child.mutation = mutation;
      }

      current = child;
    }
  }
}

export const sandboxSimulationCanvas = new SandboxSimulationCanvas();
