#!/bin/bash
# Full mac packaging pipeline: clean build -> electron-builder -> stable local sign -> verify -> install.
set -euo pipefail
cd "$(dirname "$0")/.."

RESTART_AFTER_INSTALL=false
if [ "${1:-}" = "--restart" ]; then
  RESTART_AFTER_INSTALL=true
  shift
fi
if [ "$#" -ne 0 ]; then
  echo "error: unknown option: $1" >&2
  exit 2
fi

PACKAGE_LOCK="/private/tmp/cyrene-package-mac.lock"
if ! mkdir "$PACKAGE_LOCK" 2>/dev/null; then
  echo "error: another Cyrene macOS package is already running ($PACKAGE_LOCK)" >&2
  exit 1
fi
trap 'rmdir "$PACKAGE_LOCK" 2>/dev/null || true' EXIT

if [ -d "release" ]; then
  chmod -R 777 release 2>/dev/null || true
  chflags -R 0 release 2>/dev/null || true
  rm -rf release
fi
npm run build
npm run build:music-component

CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir

APP_DIR="release/mac-arm64"
FINAL_APP="$APP_DIR/昔漣桌寵.app"

if [ ! -d "$FINAL_APP" ] && [ -d "$APP_DIR/Agent.app" ]; then
  mv "$APP_DIR/Agent.app" "$FINAL_APP"
elif [ ! -d "$FINAL_APP" ] && [ -d "$APP_DIR/Electron.app" ]; then
  mv "$APP_DIR/Electron.app" "$FINAL_APP"
fi

if [ ! -d "$FINAL_APP" ]; then
  echo "error: expected $FINAL_APP after electron-builder run" >&2
  exit 1
fi

# electron-builder can finalize app.asar after its first integrity snapshot.
# Refresh the final hash immediately before signing and installing the bundle.
node scripts/after-pack.cjs "$FINAL_APP"
node scripts/verify-packaged-app.cjs "$FINAL_APP"

xattr -cr "$FINAL_APP"
LOGIN_KEYCHAIN="$(security default-keychain -d user | tr -d '"[:space:]')"
SIGNING_IDENTITY="${CYRENE_CODESIGN_IDENTITY:-Cyrene Local Code Signing}"
if [ -n "$SIGNING_IDENTITY" ] && security find-identity -v -p codesigning "$LOGIN_KEYCHAIN" | grep -Fq "\"$SIGNING_IDENTITY\""; then
  echo "signing with stable identity: $SIGNING_IDENTITY"
  codesign --deep --force \
    --sign "$SIGNING_IDENTITY" \
    --keychain "$LOGIN_KEYCHAIN" \
    --timestamp=none \
    "$FINAL_APP"
else
  echo "warning: stable identity '$SIGNING_IDENTITY' is unavailable; using ad-hoc signing" >&2
  echo "warning: macOS may ask for Keychain and privacy permissions again after updates" >&2
  codesign --deep --force --sign - "$FINAL_APP"
fi
codesign --verify --deep --strict "$FINAL_APP"

echo "packaged: $FINAL_APP"

# Keep a single canonical installed copy. Restart only when explicitly requested.
if [ "$RESTART_AFTER_INSTALL" = true ]; then
  bash scripts/install-mac-app.sh "$FINAL_APP" --restart
else
  bash scripts/install-mac-app.sh "$FINAL_APP"
fi
