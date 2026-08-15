#!/bin/bash
# Atomically update the one canonical installed copy of Cyrene, then relaunch it.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_APP="${1:-$PROJECT_ROOT/release/mac-arm64/昔漣桌寵.app}"
INSTALL_APP="/Applications/昔漣桌寵.app"
USER_APPLICATIONS="/Users/$(id -un)/Applications"
DUPLICATE_APP="$USER_APPLICATIONS/昔漣桌寵.app"
UPDATE_APP="/Applications/.昔漣桌寵.update.$$.app"
BACKUP_ROOT="/private/tmp/cyrene-app-updates"
PREVIOUS_APP="$BACKUP_ROOT/previous.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [ ! -d "$SOURCE_APP" ]; then
  echo "error: source app not found: $SOURCE_APP" >&2
  exit 1
fi

# Refuse to replace a working installation with a malformed ASAR archive.
node "$PROJECT_ROOT/scripts/verify-packaged-app.cjs" "$SOURCE_APP"

mkdir -p "$BACKUP_ROOT"

restore_previous_on_error() {
  if [ ! -d "$INSTALL_APP" ] && [ -d "$PREVIOUS_APP" ]; then
    mv "$PREVIOUS_APP" "$INSTALL_APP" || true
  fi
}
trap restore_previous_on_error ERR

# A project-local `npm start` instance uses the same userData directory and
# single-instance lock as the packaged app. Stop that exact project's runner
# (and its npm parent) so it cannot intercept the relaunch below.
while IFS= read -r runner_pid; do
  [ -n "$runner_pid" ] || continue
  npm_pid="$(ps -o ppid= -p "$runner_pid" | tr -d ' ')"
  kill -TERM "$runner_pid" 2>/dev/null || true
  if [ -n "$npm_pid" ] && ps -o command= -p "$npm_pid" | grep -Eq '^npm start[[:space:]]*$'; then
    kill -TERM "$npm_pid" 2>/dev/null || true
  fi
done < <(pgrep -f "^node $PROJECT_ROOT/node_modules/\.bin/electron \\.$" || true)

# Installed copies and preserved user-copy backups share one bundle identifier
# and one userData directory. Stop every main process before replacing the
# bundle, otherwise LaunchServices can reopen the stale backup or its process
# can win Electron's single-instance lock.
while IFS= read -r pid; do
  [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
done < <(pgrep -f '/(昔漣桌寵|user-copy-[^/]+)\.app/Contents/MacOS/Agent$' || true)

for _ in {1..50}; do
  if ! pgrep -f '/(昔漣桌寵|user-copy-[^/]+)\.app/Contents/MacOS/Agent$' >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

# Preserve, but unregister, the accidental per-user installation. Keeping only
# one installed location makes Dock/Finder consistently resolve the same app.
if [ -d "$DUPLICATE_APP" ]; then
  duplicate_backup="$BACKUP_ROOT/user-copy-$(date +%Y%m%d-%H%M%S).app.backup"
  mv "$DUPLICATE_APP" "$duplicate_backup"
  echo "moved duplicate app to: $duplicate_backup"
fi

# Older installer versions preserved duplicates with a launchable .app suffix.
# Make those backups non-launchable so Dock/LaunchServices cannot select them
# instead of the canonical installation.
for old_backup in "$BACKUP_ROOT"/user-copy-*.app; do
  [ -d "$old_backup" ] || continue
  mv "$old_backup" "$old_backup.backup"
  echo "disabled launchable backup: $old_backup.backup"
done

# Remove every stale copy with the same bundle identifier from LaunchServices.
# The backups remain on disk; this only prevents macOS from resolving launches
# to an older bundle. Re-register the canonical app after it is installed.
while IFS= read -r registered_app; do
  [ "$registered_app" = "$INSTALL_APP" ] && continue
  [ -d "$registered_app" ] || continue
  "$LSREGISTER" -u "$registered_app" || true
done < <(mdfind 'kMDItemCFBundleIdentifier == "com.cyrene.desktop"')

# Copy and verify the new bundle before touching the working installation.
ditto "$SOURCE_APP" "$UPDATE_APP"
codesign --verify --deep --strict "$UPDATE_APP"

if [ -d "$INSTALL_APP" ]; then
  if [ -d "$PREVIOUS_APP" ]; then
    rm -rf "$PREVIOUS_APP"
  fi
  mv "$INSTALL_APP" "$PREVIOUS_APP"
  echo "backed up previous app to: $PREVIOUS_APP"
fi

mv "$UPDATE_APP" "$INSTALL_APP"
xattr -cr "$INSTALL_APP"
codesign --deep --force --sign - "$INSTALL_APP"
touch "$INSTALL_APP"
"$LSREGISTER" -f "$INSTALL_APP"
trap - ERR
open "$INSTALL_APP"

echo "installed and opened: $INSTALL_APP"
