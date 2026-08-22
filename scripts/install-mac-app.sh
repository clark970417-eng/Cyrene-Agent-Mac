#!/bin/bash
# Atomically update the one canonical installed copy of Cyrene.
# Relaunch only when explicitly requested with --restart.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_APP="${1:-$PROJECT_ROOT/release/mac-arm64/昔漣桌寵.app}"
RESTART_AFTER_INSTALL=false
RESTART_BLOCKED=false
# Matches both the canonical install and the preserved per-user duplicates.
RUNNING_APP_PATTERN='/(昔漣桌寵|user-copy-[^/]+)\.app/Contents/MacOS/Agent$'
if [ "${2:-}" = "--restart" ]; then
  RESTART_AFTER_INSTALL=true
elif [ -n "${2:-}" ]; then
  echo "error: unknown option: $2" >&2
  exit 2
fi
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

if [ "$RESTART_AFTER_INSTALL" = true ]; then
  # Stop project-local and installed instances only for an explicitly requested
  # restart. A normal install must leave every running process untouched.
  while IFS= read -r runner_pid; do
    [ -n "$runner_pid" ] || continue
    npm_pid="$(ps -o ppid= -p "$runner_pid" | tr -d ' ')"
    kill -TERM "$runner_pid" 2>/dev/null || true
    if [ -n "$npm_pid" ] && ps -o command= -p "$npm_pid" | grep -Eq '^npm start[[:space:]]*$'; then
      kill -TERM "$npm_pid" 2>/dev/null || true
    fi
  done < <(pgrep -f "^node $PROJECT_ROOT/node_modules/\.bin/electron \\.$" || true)

  while IFS= read -r pid; do
    [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  done < <(pgrep -f "$RUNNING_APP_PATTERN" || true)

  for _ in {1..50}; do
    if ! pgrep -f "$RUNNING_APP_PATTERN" >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done

  # SIGTERM alone is not enough: the app installs a before-quit handler (it is a
  # desktop pet and hides to the tray instead of exiting), so it survives the
  # signal. The script used to give up here, run `open`, and print
  # "installed and restarted" -- but `open` on an already-running app just
  # foregrounds the STALE instance, so the user kept looking at the previous
  # build and reasonably concluded the packaging had not worked.
  #
  # Ask the app to quit through AppleScript instead: that goes through the
  # normal termination path, so it gets to flush chat history and memory.
  #
  # `osascript` has to be bounded. When the app ignores the request, the call
  # blocks indefinitely (measured: still hanging after 90s), which would wedge
  # the whole install.
  if pgrep -f "$RUNNING_APP_PATTERN" >/dev/null 2>&1; then
    echo "app ignored SIGTERM; asking it to quit via AppleScript"
    osascript -e 'quit app "昔漣桌寵"' >/dev/null 2>&1 &
    osascript_pid=$!
    for _ in {1..40}; do
      kill -0 "$osascript_pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -TERM "$osascript_pid" 2>/dev/null || true
    wait "$osascript_pid" 2>/dev/null || true

    for _ in {1..40}; do
      if ! pgrep -f "$RUNNING_APP_PATTERN" >/dev/null 2>&1; then
        break
      fi
      sleep 0.25
    done
  fi

  # Never escalate to SIGKILL. A hard kill costs the user unsaved chat history
  # and memory writes, which is a worse outcome than "quit and reopen it".
  if pgrep -f "$RUNNING_APP_PATTERN" >/dev/null 2>&1; then
    RESTART_BLOCKED=true
  fi
fi

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
# Preserve the package signature. Re-signing after installation changes the
# designated requirement and makes macOS forget Keychain/TCC authorization.
codesign --verify --deep --strict "$INSTALL_APP"
touch "$INSTALL_APP"
"$LSREGISTER" -f "$INSTALL_APP"
trap - ERR
if [ "$RESTART_AFTER_INSTALL" = true ] && [ "$RESTART_BLOCKED" != true ]; then
  open "$INSTALL_APP"
  echo "installed and restarted: $INSTALL_APP"
elif [ "$RESTART_AFTER_INSTALL" = true ]; then
  # Deliberately do NOT run `open` here: the old process is still alive, so
  # `open` would only bring the stale build to the front while printing a
  # success message. Say plainly that the new build is on disk but not running.
  echo "installed: $INSTALL_APP"
  echo "WARNING: the running app refused to quit, so it is STILL THE OLD BUILD." >&2
  echo "WARNING: quit 昔漣桌寵 from the Dock and reopen it to pick up this build." >&2
else
  echo "installed without restarting: $INSTALL_APP"
fi
