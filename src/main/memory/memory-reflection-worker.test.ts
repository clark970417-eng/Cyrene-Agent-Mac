import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/mock/userData"),
  },
}));

vi.mock("./entity-graph", () => ({
  entityGraph: {
    ingestEntities: vi.fn(),
  },
}));

import { MemoryReflectionWorker } from "./memory-reflection-worker";
import { entityGraph } from "./entity-graph";
import type { L1Profile } from "./memory-types";

describe("Memory Reflection Worker (DMAE & Proactive Care)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks DND periods accurately (overnight window 23:00 - 08:00)", () => {
    const worker = new MemoryReflectionWorker({ dndStartHour: 23, dndEndHour: 8 });

    const nightTime = new Date("2026-08-21T01:30:00");
    expect(worker.isDndTime(nightTime)).toBe(true);

    const dayTime = new Date("2026-08-21T14:30:00");
    expect(worker.isDndTime(dayTime)).toBe(false);
  });

  it("extracts learning insights and triggers entity graph ingestion", async () => {
    const worker = new MemoryReflectionWorker();
    const l1: L1Profile = {
      userName: "Clark",
      userNickname: "Clark",
      aiNickname: "Cyrene",
      userProfile: "",
      aiPersona: "",
      roundCount: 10,
    };

    const memories = [
      { text: "正在学习 Rust 异步网络编程", category: "work" },
      { text: "用户喜欢在下午喝无糖黑咖啡", category: "habit" },
    ];

    const res = await worker.runReflection(l1, memories);
    expect(res.newInsights.length).toBe(2);
    expect(entityGraph.ingestEntities).toHaveBeenCalled();
  });
});
