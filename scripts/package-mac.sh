#!/bin/bash
# Full mac packaging pipeline: clean build -> electron-builder -> ad-hoc sign -> verify -> rename to 昔漣桌寵.app.
# No Developer ID on this machine, so we deliberately skip electron-builder's own signing
# (CSC_IDENTITY_AUTO_DISCOVERY=false) and ad-hoc sign ourselves afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

PACKAGE_LOCK="/private/tmp/cyrene-package-mac.lock"
if ! mkdir "$PACKAGE_LOCK" 2>/dev/null; then
  echo "error: another Cyrene macOS package is already running ($PACKAGE_LOCK)" >&2
  exit 1
fi
trap 'rmdir "$PACKAGE_LOCK" 2>/dev/null || true' EXIT

npm run build

CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64

APP_DIR="release/mac-arm64"
BUILT_APP="$APP_DIR/Agent.app"
FINAL_APP="$APP_DIR/昔漣桌寵.app"

if [ ! -d "$BUILT_APP" ]; then
  echo "error: expected $BUILT_APP after electron-builder run" >&2
  exit 1
fi

# electron-builder can finalize app.asar after its first integrity snapshot.
# Refresh the final hash immediately before signing and installing the bundle.
node scripts/after-pack.cjs "$BUILT_APP"
node scripts/verify-packaged-app.cjs "$BUILT_APP"

mv "$BUILT_APP" "$FINAL_APP"
xattr -cr "$FINAL_APP"
codesign --deep --force --sign - "$FINAL_APP"
codesign --verify --deep --strict "$FINAL_APP"

echo "packaged: $FINAL_APP"

# Keep a single canonical installed copy and relaunch it after every package.
bash scripts/install-mac-app.sh "$FINAL_APP"
