import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  extractSymbolsFromCode,
  generateRepoMap,
} from "./repo-map-generator";

describe("extractSymbolsFromCode", () => {
  it("extracts TypeScript interfaces, classes, functions, and types", () => {
    const tsCode = `
export interface UserConfig {
  name: string;
}

export type ThemeMode = "dark" | "light";

export class AgentManager {
  init() {}
}

export async function startService(port: number): Promise<void> {
  console.log(port);
}

export const helper = (x: number): number => x * 2;
`;
    const symbols = extractSymbolsFromCode(tsCode, ".ts");
    expect(symbols).toHaveLength(5);
    expect(symbols[0]).toMatchObject({ name: "UserConfig", kind: "interface", line: 2 });
    expect(symbols[1]).toMatchObject({ name: "ThemeMode", kind: "type", line: 6 });
    expect(symbols[2]).toMatchObject({ name: "AgentManager", kind: "class", line: 8 });
    expect(symbols[3]).toMatchObject({ name: "startService", kind: "function", line: 12 });
    expect(symbols[4]).toMatchObject({ name: "helper", kind: "function", line: 16 });
  });

  it("extracts Python classes and functions", () => {
    const pyCode = `
class DataPipeline:
    pass

def process_batch(items: list) -> dict:
    return {}
`;
    const symbols = extractSymbolsFromCode(pyCode, ".py");
    expect(symbols).toHaveLength(2);
    expect(symbols[0]).toMatchObject({ name: "DataPipeline", kind: "class", line: 2 });
    expect(symbols[1]).toMatchObject({ name: "process_batch", kind: "function", line: 5 });
  });
});

describe("generateRepoMap", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "repomap-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("generates structured repo map from files in workspace", () => {
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, "auth.ts"),
      "export interface Session {}\nexport function login() {}\n",
    );

    const map = generateRepoMap({ rootPath: tempDir });
    expect(map).toContain("## 專案代碼拓撲圖 (Repository Map)");
    expect(map).toContain("src/auth.ts");
    expect(map).toContain("export interface Session");
    expect(map).toContain("export function login()");
  });

  it("respects maxChars budget and truncates gracefully", () => {
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(
        path.join(srcDir, `module_${i}.ts`),
        `export function func_${i}() {}\nexport class Class_${i} {}\n`,
      );
    }

    const map = generateRepoMap({ rootPath: tempDir, maxChars: 250 });
    expect(map.length).toBeLessThan(400);
    expect(map).toContain("已截斷");
  });
});
