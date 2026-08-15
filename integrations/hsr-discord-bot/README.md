# 星穹鐵道 Discord 工具（昔漣 macOS 嵌入版）

這個整合會把 [Yec1/hsr-discord-bot](https://github.com/Yec1/hsr-discord-bot) 的指令載入昔漣現有的 Discord Client，不會啟動第二隻 Bot，也不需要把 Bot Token 複製到上游專案。

## 安裝

```bash
bash integrations/hsr-discord-bot/install-mac.sh
```

安裝器會固定使用已驗證的上游 `rebuild` 分支 commit `b3c107a42182946e9650484920de6cfb8a24ea8b`，安裝至：

```text
~/.local/share/cyrene-hsr/hsr-discord-bot
```

資料庫位於 `~/.local/share/cyrene-hsr/data/hsr.sqlite`。HoYoLAB Cookie 屬於敏感登入資料，請勿上傳、提交到 Git 或傳給他人。

完成後重新啟動昔漣。啟動紀錄應顯示已載入星穹鐵道工具；Discord 使用 `!account`、`!daily`、`!note check`、`!profile`、`!codes list`、`!warp log` 等訊息指令，不註冊星鐵斜線指令。

## 設計與安全

- 共用昔漣 Discord Gateway 與 Token。
- 星鐵指令及互動元件沿用昔漣的屋主/允許使用者名單。
- 中英文 `!` 指令名稱皆可使用；文字卡片與產生圖片固定為繁體中文。
- 上游不會覆蓋昔漣的 Presence，也不會自行註冊另一份全域指令。
- 上游未安裝或載入失敗時，昔漣原有功能仍可正常啟動。
- 重新執行安裝器可重建相依套件與再次套用相容修補。
- 安裝時會執行 npm 的同主版本安全修補，避免沿用上游鎖檔中的已知漏洞版本。

上游 README 宣告 MIT，但其目前 `package.json` 標示 ISC 且儲存庫未附獨立 LICENSE 檔；此整合保留來源連結與作者歸屬，對外散布前請向上游作者確認授權條款。
