import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/main/**/*.test.ts",
      "src/renderer/**/*.test.ts",
      "src/shared/**/*.test.ts",
      "src/cli/**/*.test.ts",
      "skills/**/tests/**/*.test.ts",
      "scripts/cline-poc/**/*.test.ts",
    ],
    // 單 fork 單 worker，避免大量檔案監聽與計時器測試互相干擾。
    pool: "forks",
    singleFork: true,
    maxWorkers: 1,
    minWorkers: 1,
    // 明確停用 watch/cache，減少 macOS FSEvents 干擾。
    watch: false,
    cache: false,
    fileParallelism: false,
  },
});
