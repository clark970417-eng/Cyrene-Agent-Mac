// Repo-Map -- 全局代码拓扑索引与符号依赖图谱 (Aider / Claude Code 架构)
//
// 为工作区构建紧凑的高价值符号拓扑地图（Classes, Interfaces, Functions, Exports）。
// 使 Coding Agent 在编写代码前掌握全工程架构脉络与跨文件调用关系。

import * as fs from "fs";
import * as path from "path";

export interface SymbolDefinition {
  name: string;
  kind: "class" | "interface" | "function" | "type" | "const" | "enum";
  line: number;
}

export interface FileSymbolEntry {
  relativePath: string;
  symbols: SymbolDefinition[];
  importedFiles: string[];
  referenceRank: number; // 引用热度分
}

export interface RepoMapOptions {
  maxCharacters?: number;
  maxFiles?: number;
  includeExtensions?: string[];
  excludeDirs?: string[];
}

const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java"]);
const DEFAULT_EXCLUDES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "__pycache__",
]);

/** 从文件源码中快速提取核心定义符号 */
export function extractFileSymbols(content: string): SymbolDefinition[] {
  const symbols: SymbolDefinition[] = [];
  const lines = content.split("\n");

  const patterns: Array<{ kind: SymbolDefinition["kind"]; regex: RegExp }> = [
    { kind: "class", regex: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/ },
    { kind: "interface", regex: /^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/ },
    { kind: "type", regex: /^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/ },
    { kind: "enum", regex: /^(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/ },
    { kind: "function", regex: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/ },
    { kind: "const", regex: /^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*[:=]\s*(?:async\s*)?\(/ },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

    for (const p of patterns) {
      const match = line.match(p.regex);
      if (match && match[1]) {
        symbols.push({
          name: match[1],
          kind: p.kind,
          line: i + 1,
        });
        break;
      }
    }
  }

  return symbols;
}

export class RepoMapIndexer {
  private cache = new Map<string, { mtimeMs: number; entry: FileSymbolEntry }>();

  /** 递归扫描目录提取符号图谱 */
  scanWorkspace(workspaceRoot: string, options: RepoMapOptions = {}): FileSymbolEntry[] {
    const maxFiles = options.maxFiles ?? 150;
    const entries: FileSymbolEntry[] = [];
    const excludes = new Set([...DEFAULT_EXCLUDES, ...(options.excludeDirs || [])]);

    const traverse = (dir: string) => {
      if (entries.length >= maxFiles) return;

      let fileNames: string[] = [];
      try {
        fileNames = fs.readdirSync(dir);
      } catch {
        return;
      }

      for (const name of fileNames) {
        if (excludes.has(name) || name.startsWith(".")) continue;
        const fullPath = path.join(dir, name);

        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          traverse(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(name);
          if (DEFAULT_EXTENSIONS.has(ext)) {
            const relPath = path.relative(workspaceRoot, fullPath);
            const cached = this.cache.get(fullPath);

            if (cached && cached.mtimeMs === stat.mtimeMs) {
              entries.push(cached.entry);
            } else {
              try {
                const content = fs.readFileSync(fullPath, "utf-8");
                const symbols = extractFileSymbols(content);
                const entry: FileSymbolEntry = {
                  relativePath: relPath,
                  symbols,
                  importedFiles: [],
                  referenceRank: symbols.length, // 初始分：符号越多权重越高
                };
                this.cache.set(fullPath, { mtimeMs: stat.mtimeMs, entry });
                entries.push(entry);
              } catch {
                // skip unreadable
              }
            }
          }
        }
      }
    };

    traverse(workspaceRoot);

    // 依权重排序
    return entries.sort((a, b) => b.referenceRank - a.referenceRank);
  }

  /** 生成精简格式的 Repo-Map 字符串 */
  generateRepoMapPrompt(workspaceRoot: string, options: RepoMapOptions = {}): string {
    const maxChars = options.maxCharacters ?? 3000;
    const entries = this.scanWorkspace(workspaceRoot, options);

    if (entries.length === 0) {
      return "";
    }

    const lines: string[] = ["[REPOSITORY TOPOLOGY MAP]"];
    let currentLength = lines[0].length;

    for (const entry of entries) {
      if (entry.symbols.length === 0) continue;

      const fileHeader = `\n${entry.relativePath}:`;
      const symbolLines = entry.symbols.map((s) => `  ${s.kind} ${s.name}`).join("\n");
      const block = `${fileHeader}\n${symbolLines}`;

      if (currentLength + block.length > maxChars) {
        lines.push("\n... [更多次要文件已省略]");
        break;
      }

      lines.push(block);
      currentLength += block.length;
    }

    return lines.join("\n");
  }
}

export const repoMapIndexer = new RepoMapIndexer();
