import { describe, expect, it } from "vitest";
import { SandboxSimulationCanvas } from "./sandbox-simulation-canvas";

describe("Sandbox Simulation Canvas (Dry-run Tree Impact Analysis)", () => {
  const canvas = new SandboxSimulationCanvas();

  it("simulates mutations and assesses risk level", () => {
    const mutations = [
      { type: "add" as const, path: "src/new-feature/index.ts", summary: "新增功能入口" },
      { type: "modify" as const, path: "src/main.ts", summary: "引入新路由" },
      { type: "delete" as const, path: "src/deprecated/old.ts", summary: "清理旧文件" },
    ];

    const result = canvas.simulate(mutations);
    expect(result.totalAffectedFiles).toBe(3);
    expect(result.addedCount).toBe(1);
    expect(result.modifiedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(result.riskLevel).toBe("high"); // Delete triggers high risk
    expect(result.treeRoot.children?.length).toBeGreaterThan(0);
  });
});
