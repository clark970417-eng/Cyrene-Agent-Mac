import { describe, expect, it } from "vitest";
import { DailyStandupReporter } from "./daily-standup-reporter";

describe("Daily Standup Reporter (Autonomous Health Check & Morning Standup)", () => {
  const reporter = new DailyStandupReporter();

  it("generates structured standup report with commit summaries and health score", () => {
    const report = reporter.generateStandupReport({
      userName: "Clark",
      yesterdayCommits: [
        { hash: "abc1234567", message: "feat: 新增 Coding-Agent 子代理" },
        { hash: "def7890123", message: "perf: 實現 React 流式 RAF 節流" },
      ],
      codeHealth: {
        totalTests: 50,
        passingTests: 50,
        unresolvedTodos: 2,
        lintWarnings: 0,
      },
      todayTasks: ["完成沙盤推演畫布實作", "進行端到端集成測試"],
      obsidianDailyNoteSummary: "昨日重點學習了 Rust 異步模型與 WebGPU 著色器",
    });

    expect(report.healthScore).toBeGreaterThanOrEqual(90);
    expect(report.spokenGreeting).toContain("Clark");
    expect(report.spokenGreeting).toContain("2 次代碼提交");
    expect(report.reportMarkdown).toContain("昨日代碼提交成果");
    expect(report.reportMarkdown).toContain("今日核心待辦事項");
    expect(report.reportMarkdown).toContain("Obsidian 筆記同步摘要");
  });
});
