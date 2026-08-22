# 发布资源

此目錄只承載 Electron 發布包的額外資源。正式版本僅支援 macOS Apple Silicon。

| 路径 | 来源 | Git 状态 | 用途 |
| --- | --- | --- | --- |
| `components/music/` | `npm run build:music-component` | 忽略 | macOS arm64 可攜式音樂 MCP；正式打包時由 `dist/components/music/` 複製。 |

Git 功能直接使用 macOS 的系統 Git／Xcode Command Line Tools，不再內建 MinGit。
