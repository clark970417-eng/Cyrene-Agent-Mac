import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeFileAtomic, writeJsonAtomic } from "./fs-atomic";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-atomic-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("寫入新檔案並自動建立缺失的父目錄", () => {
    const target = path.join(dir, "nested", "deep", "state.txt");
    writeFileAtomic(target, "hello");
    expect(fs.readFileSync(target, "utf8")).toBe("hello");
  });

  it("覆蓋既有檔案", () => {
    const target = path.join(dir, "state.txt");
    writeFileAtomic(target, "old");
    writeFileAtomic(target, "new");
    expect(fs.readFileSync(target, "utf8")).toBe("new");
  });

  it("不留下 .tmp 殘骸", () => {
    const target = path.join(dir, "state.txt");
    writeFileAtomic(target, "value");
    expect(fs.readdirSync(dir)).toEqual(["state.txt"]);
  });

  it("寫入失敗時保留舊內容，不會把目標檔截斷", () => {
    const target = path.join(dir, "state.txt");
    writeFileAtomic(target, "good");
    // 循環結構讓 JSON.stringify 在碰到目標檔之前就丟出。
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => writeJsonAtomic(target, cyclic)).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("good");
  });

  it("mode 會套用到落盤後的檔案", () => {
    if (process.platform === "win32") return; // Windows 沒有 POSIX 權限位
    const target = path.join(dir, "secret.json");
    writeJsonAtomic(target, { token: "x" }, { mode: 0o600 });
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });
});

describe("writeJsonAtomic", () => {
  it("以 2 空格縮排序列化，與既有落盤格式一致", () => {
    const target = path.join(dir, "state.json");
    writeJsonAtomic(target, { a: 1, b: { c: 2 } });
    expect(fs.readFileSync(target, "utf8")).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}');
  });

  it("round-trip 後結構不變", () => {
    const target = path.join(dir, "state.json");
    const value = { list: [1, 2, 3], nested: { flag: true, text: "中文" } };
    writeJsonAtomic(target, value);
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual(value);
  });
});
