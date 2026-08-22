import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  exec: vi.fn((_cmd: string, cb: (err: any) => void) => cb(null)),
}));

import { killProcessTree } from "./process-tree-killer";

describe("Process Tree Killer (Cascading Process Termination)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles invalid pids safely", async () => {
    const res = await killProcessTree(0);
    expect(res).toBe(false);
  });

  it("attempts to kill process tree for valid positive pid", async () => {
    const res = await killProcessTree(99999);
    expect(typeof res).toBe("boolean");
  });
});
