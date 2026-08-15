// channels/history-log 单元测试
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock electron
const HISTORY_TMP = path.join(os.tmpdir(), "cyrene-history-test");
fs.mkdirSync(HISTORY_TMP, { recursive: true });

vi.mock("electron", () => ({
  app: {
    getPath: () => HISTORY_TMP,
  },
}));

import { appendHistory, loadRecentHistory, searchOlderHistory } from "./history-log";

describe("channels/history-log", () => {
  beforeEach(() => {
    // 清理测试目录
    const dir = path.join(HISTORY_TMP, "channels", "history");
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  });

  it("loadRecentHistory: 不存在的 session → 空数组", () => {
    const r = loadRecentHistory("channel:feishu:notexist", 16);
    expect(r).toEqual([]);
  });

  it("appendHistory + loadRecentHistory round-trip", () => {
    const sid = "channel:feishu:abc123";
    appendHistory(sid, "user", "你好");
    appendHistory(sid, "assistant", "你好！有什么可以帮你的吗？");

    const history = loadRecentHistory(sid, 16);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("你好");
    expect(history[1].role).toBe("assistant");
    expect(history[1].content).toBe("你好！有什么可以帮你的吗？");
  });

  it("loadRecentHistory: limit 截断 (只取最近 N 条)", () => {
    const sid = "channel:feishu:limit-test";
    for (let i = 0; i < 10; i++) {
      appendHistory(sid, "user", `问题${i}`);
      appendHistory(sid, "assistant", `回答${i}`);
    }
    // 20 条写入，只取最近 4 条
    const history = loadRecentHistory(sid, 4);
    expect(history).toHaveLength(4);
    // 按时间顺序: 最后 2 轮 = [问9, 答9, 问10...不, 索引 0-9]
    // 第 9 轮: user="问题9", assistant="回答9"
    expect(history[0].content).toBe("问题8");
    expect(history[1].content).toBe("回答8");
    expect(history[2].content).toBe("问题9");
    expect(history[3].content).toBe("回答9");
  });

  it("appendHistory: 空 sessionId 或空 content 不落盘", () => {
    appendHistory("", "user", "hello");
    appendHistory("channel:feishu:x", "user", "");
    const history = loadRecentHistory("channel:feishu:x", 16);
    expect(history).toEqual([]);
  });

  it("多 session 隔离: 不同 sessionId 文件不同", () => {
    appendHistory("channel:feishu:userA", "user", "A 说的话");
    appendHistory("channel:feishu:userB", "user", "B 说的话");

    const a = loadRecentHistory("channel:feishu:userA", 16);
    const b = loadRecentHistory("channel:feishu:userB", 16);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].content).toBe("A 说的话");
    expect(b[0].content).toBe("B 说的话");
  });

  it("長期檢索會找回相關的完整對話輪次，並且不會跨 session", () => {
    const sid = "channel:discord:owner";
    appendHistory(sid, "user", "我最喜歡草莓蛋糕");
    appendHistory(sid, "assistant", "好呀，人家記住了♪");
    appendHistory(sid, "user", "今天天氣不錯");
    appendHistory(sid, "assistant", "很適合出門喔。");
    appendHistory("channel:discord:other", "user", "草莓蛋糕是我的秘密");

    const hits = searchOlderHistory(sid, "我之前說喜歡什麼蛋糕？", { topK: 2, excludeRecent: 0 });

    expect(hits).toHaveLength(1);
    expect(hits[0].entries.map((entry) => entry.content)).toEqual([
      "我最喜歡草莓蛋糕",
      "好呀，人家記住了♪",
    ]);
  });

  it("長期歷史不會在 200 則時過早截斷", () => {
    const sid = "channel:feishu:trunc";
    // 写 250 条 (> MAX_FILE_LINES 200)
    for (let i = 0; i < 250; i++) {
      appendHistory(sid, "user", `msg${i}`);
    }
    const history = loadRecentHistory(sid, 250);
    expect(history).toHaveLength(250);
    // 最新一条应该是 msg249
    expect(history[history.length - 1].content).toBe("msg249");
    expect(history[0].content).toBe("msg0");
  });
});
