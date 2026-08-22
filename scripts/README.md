# 项目脚本

这些脚本是项目的构建、打包与验证入口；脚本源码需要提交到 Git。

| 目录 | 用途 | 常用入口 |
| --- | --- | --- |
| `build/` | 构建 CLI 与原生截图辅助程序 | `npm run build:cli`、`npm run build:screenshot-helper` |
| `packaging/` | 為 macOS 發布包準備可攜式音樂元件 | `npm run build:music-component` |
| `verify/` | 手动或自动验证构建产物及运行链路 | `npm run verify:screenshot-helper`、`npm run smoke:music` |
| `diagnostics/` | 临时诊断脚本；不属于日常打包链路 | 按文件注释单独执行 |

`npm run build:music-component` 使用固定版本的 PyInstaller 將網易雲音樂 MCP 封裝為 macOS arm64 的 `dist/components/music/`，並由正式打包流程直接放進 App。
