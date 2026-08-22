# Project agent instructions

## App lifecycle

- Do not quit, kill, open, relaunch, or restart the app while working by default.
- Build, test, package, sign, and install updates without restarting the app. If the app is already running, leave that process untouched and tell the user the update will take effect after their next manual restart.
- Restart or relaunch the app only when the user explicitly asks for it, or when the assigned task is explicitly monitoring the app and a restart is necessary for that monitoring.
- Never pass a restart flag to project scripts unless one of those two exceptions applies.

