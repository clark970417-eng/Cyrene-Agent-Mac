import { describe, expect, it } from "vitest";
import { RollingScratchpad } from "./rolling-scratchpad";

describe("Rolling Scratchpad (Multi-round Task Working Memory)", () => {
  it("tracks steps, findings, and determines summarization interval", () => {
    const pad = new RollingScratchpad("task-100", "重构数据库访问层", 4);

    pad.recordStep("搜索现有 database.ts 引用", "找到 12 处引用");
    expect(pad.needsSummarization()).toBe(false);

    pad.recordStep("编写 migration 脚本", "完成 SQL 适配");
    pad.recordStep("运行单元测试", "发现 1 个 mock 失败");
    expect(pad.needsSummarization()).toBe(false);

    pad.recordStep("修复 mock 适配问题", "所有测试通过");
    expect(pad.needsSummarization()).toBe(true);

    const promptContext = pad.formatPromptContext();
    expect(promptContext).toContain("重构数据库访问层");
    expect(promptContext).toContain("✅ 已完成步骤:");
    expect(promptContext).toContain("💡 关键产出与发现:");

    pad.compact();
    expect(pad.needsSummarization()).toBe(false);
  });

  it("exports and restores state correctly for resume", () => {
    const pad1 = new RollingScratchpad("task-101", "生成报表");
    pad1.recordStep("读取 Excel 数据", "成功读取 100 行");
    pad1.addBlocker("缺少第三季度汇总表");

    const exported = pad1.exportState();

    const pad2 = new RollingScratchpad("task-101", "");
    pad2.restoreState(exported);

    const prompt = pad2.formatPromptContext();
    expect(prompt).toContain("生成报表");
    expect(prompt).toContain("⚠️ 当前阻碍/待解决问题:");
    expect(prompt).toContain("缺少第三季度汇总表");
  });
});
