#!/bin/bash
set -euo pipefail

UPSTREAM_URL="https://github.com/Yec1/hsr-discord-bot.git"
UPSTREAM_BRANCH="rebuild"
TESTED_COMMIT="b3c107a42182946e9650484920de6cfb8a24ea8b"
INSTALL_BASE="${CYRENE_HSR_HOME:-$HOME/.local/share/cyrene-hsr}"
INSTALL_ROOT="$INSTALL_BASE/hsr-discord-bot"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "需要 Node.js 18 以上與 npm。"
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 版本過舊：$(node --version)（至少需要 18）"
  exit 1
fi

mkdir -p "$INSTALL_BASE/data"
chmod 700 "$INSTALL_BASE" "$INSTALL_BASE/data"

if [ ! -d "$INSTALL_ROOT/.git" ]; then
  git clone --branch "$UPSTREAM_BRANCH" "$UPSTREAM_URL" "$INSTALL_ROOT"
fi

git -C "$INSTALL_ROOT" fetch origin "$UPSTREAM_BRANCH"
git -C "$INSTALL_ROOT" checkout --detach "$TESTED_COMMIT"
npm --prefix "$INSTALL_ROOT" ci
# npm may resolve a direct dependency only after its vulnerable transitive parent
# is updated, so allow one second pass. Neither pass uses --force/major upgrades.
npm --prefix "$INSTALL_ROOT" audit fix || npm --prefix "$INSTALL_ROOT" audit fix
node "$SCRIPT_DIR/patch-upstream.mjs" "$INSTALL_ROOT"
npm --prefix "$INSTALL_ROOT" run build

echo "安裝完成：$INSTALL_ROOT"
echo "重新啟動昔漣後，星穹鐵道指令會自動註冊到同一隻 Discord Bot。"
