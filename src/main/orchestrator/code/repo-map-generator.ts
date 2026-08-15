import fs from "node:fs";
import path from "node:path";

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "export";
  line: number;
  signature: string;
}

export interface FileSummary {
  relativePath: string;
  symbols: CodeSymbol[];
  linesCount: number;
}

export interface RepoMapOptions {
  /** 目標專案根目錄路徑 */
  rootPath: string;
  /** 最大輸出字元長度 (預設 8,000 字元 / ~2000 tokens) */
  maxChars?: number;
  /** 忽略目錄清單 */
  ignorePatterns?: string[];
  /** 支援的檔案副檔名清單 */
  supportedExtensions?: string[];
  /** 最大掃描檔案數 (預設 200) */
  maxFiles?: number;
}

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".vscode",
  ".idea",
  "vendor",
];

const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".go",
  ".rs",
];

/**
 * 輕量正規化語法解析器，提取主要符號簽名
 */
export function extractSymbolsFromCode(code: string, ext: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = code.split("\n");

  const tsJsPatterns: Array<{ kind: CodeSymbol["kind"]; regex: RegExp }> = [
    { kind: "class", regex: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)(?:<[^>]+>)?(?:\s+extends\s+[^{]+)?(?:\s+implements\s+[^{]+)?/ },
    { kind: "interface", regex: /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)(?:<[^>]+>)?(?:\s+extends\s+[^{]+)?/ },
    { kind: "type", regex: /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)(?:<[^>]+>)?\s*=/ },
    { kind: "function", regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)(?::\s*([^{]+))?/ },
    { kind: "function", regex: /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/ },
    { kind: "variable", regex: /^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)(?:\s*:\s*([^=;]+))?/ },
  ];

  const pyPatterns: Array<{ kind: CodeSymbol["kind"]; regex: RegExp }> = [
    { kind: "class", regex: /^\s*class\s+([A-Za-z0-9_]+)(?:\(([^)]*)\))?:/ },
    { kind: "function", regex: /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/ },
  ];

  const patterns = ext === ".py" ? pyPatterns : tsJsPatterns;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { kind, regex } of patterns) {
      const match = line.match(regex);
      if (match) {
        const name = match[1];
        const trimmedSig = line.trim().replace(/{$/, "").trim();
        symbols.push({
          name,
          kind,
          line: i + 1,
          signature: trimmedSig,
        });
        break;
      }
    }
  }

  return symbols;
}

/**
 * 遞迴收集工作區內源碼檔案
 */
export function scanSourceFiles(
  dir: string,
  rootPath: string,
  options: {
    ignore: Set<string>;
    extensions: Set<string>;
    maxFiles: number;
  },
  result: string[] = [],
): string[] {
  if (result.length >= options.maxFiles) return result;
  if (!fs.existsSync(dir)) return result;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (result.length >= options.maxFiles) break;

      const name = entry.name;
      if (name.startsWith(".") && name !== ".github") continue;
      if (options.ignore.has(name)) continue;

      const fullPath = path.join(dir, name);
      if (entry.isDirectory()) {
        scanSourceFiles(fullPath, rootPath, options, result);
      } else if (entry.isFile()) {
        const ext = path.extname(name);
        if (options.extensions.has(ext)) {
          result.push(fullPath);
        }
      }
    }
  } catch {
    // 忽略讀取權限錯誤
  }

  return result;
}

/**
 * 生成緊湊高資訊密度的 Repo Map 拓撲字串
 */
export function generateRepoMap(options: RepoMapOptions): string {
  const rootPath = path.resolve(options.rootPath);
  const maxChars = options.maxChars ?? 8000;
  const ignoreSet = new Set(options.ignorePatterns ?? DEFAULT_IGNORE);
  const extSet = new Set(options.supportedExtensions ?? DEFAULT_EXTENSIONS);
  const maxFiles = options.maxFiles ?? 200;

  const files = scanSourceFiles(rootPath, rootPath, {
    ignore: ignoreSet,
    extensions: extSet,
    maxFiles,
  });

  const summaries: FileSummary[] = [];

  for (const filePath of files) {
    try {
      const code = fs.readFileSync(filePath, "utf8");
      const relativePath = path.relative(rootPath, filePath).replace(/\\/g, "/");
      const ext = path.extname(filePath);
      const symbols = extractSymbolsFromCode(code, ext);
      const linesCount = code.split("\n").length;

      summaries.push({
        relativePath,
        symbols,
        linesCount,
      });
    } catch {
      // 忽略單檔讀取異常
    }
  }

  if (summaries.length === 0) {
    return "";
  }

  const lines: string[] = [
    "## 專案代碼拓撲圖 (Repository Map)",
    "以下為專案結構與導出符號摘要：",
  ];

  let currentLength = lines.join("\n").length;

  for (const file of summaries) {
    const fileHeader = `\n📄 **${file.relativePath}** (${file.linesCount} lines)`;
    if (currentLength + fileHeader.length > maxChars) {
      lines.push("\n... [代碼拓撲過大，已截斷剩餘檔案]");
      break;
    }
    lines.push(fileHeader);
    currentLength += fileHeader.length;

    for (const sym of file.symbols) {
      const symLine = `  - [L${sym.line}] \`${sym.signature}\``;
      if (currentLength + symLine.length + 1 > maxChars) {
        lines.push("  - ... [符號過多已截斷]");
        currentLength += 30;
        break;
      }
      lines.push(symLine);
      currentLength += symLine.length + 1;
    }
  }

  return lines.join("\n");
}
