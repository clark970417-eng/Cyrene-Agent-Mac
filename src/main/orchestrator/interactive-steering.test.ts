import { describe, expect, it, beforeEach } from "vitest";
import { InteractiveSteeringManager } from "./interactive-steering";

describe("Interactive Steering Manager (Human-in-the-loop Mid-run Guidance)", () => {
  let manager: InteractiveSteeringManager;

  beforeEach(() => {
    manager = new InteractiveSteeringManager();
  });

  it("queues and polls steering cues correctly", () => {
    expect(manager.hasPendingCues("run-001")).toBe(false);

    manager.addSteeringCue("run-001", "请使用 TypeScript 5.5 语法", "urgent");
    expect(manager.hasPendingCues("run-001")).toBe(true);

    const cues = manager.pollSteeringCues("run-001");
    expect(cues.length).toBe(1);
    expect(cues[0].text).toBe("请使用 TypeScript 5.5 语法");
    expect(cues[0].priority).toBe("urgent");

    // Polling consumes and clears the queue
    expect(manager.hasPendingCues("run-001")).toBe(false);
  });

  it("formats prompt context with clear user instructions", () => {
    const cues = [
      manager.addSteeringCue("run-002", "改用 Tailwind CSS 样式", "normal"),
    ];

    const prompt = manager.formatSteeringPrompt(cues);
    expect(prompt).toContain("[USER MID-RUN STEERING GUIDANCE");
    expect(prompt).toContain('1. [NORMAL] "改用 Tailwind CSS 样式"');
  });
});
