#!/usr/bin/env bash
#
# install-updater.sh — install/refresh nova-release and its trigger cron on the
# host, with no sudo required. Run as the app owner on the Nova host (see PRIVATEREF.md#1.1, #2.1).
#
#   scp ops/nova-release ops/install-updater.sh <user>@<nova-host>:/tmp/
#   ssh <user>@<nova-host> 'bash /tmp/install-updater.sh'
#
# The updater binary is installed to the HOME dir (~/.local/bin), NOT inside the
# app root: a flat deploy that rsyncs over /opt/nova-ha-dashboard would wipe the
# releases layout and an in-app-root binary, but the home copy + the user cron
# survive, so the system can always be restored with `nova-release migrate`.
#
set -euo pipefail
APP_ROOT="${NOVA_APP_ROOT:-/opt/nova-ha-dashboard}"
BIN_DIR="${NOVA_BIN_DIR:-$HOME/.local/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$BIN_DIR" "$APP_ROOT/data/update/control"
install -m 0755 "$HERE/nova-release" "$BIN_DIR/nova-release"

# Per-minute processor that drains queued update/rollback requests written by the
# dashboard. flock inside nova-release prevents overlap; an empty queue is a
# near-instant no-op.
CRON_LINE="* * * * * $BIN_DIR/nova-release process >> $HOME/nova-release-cron.log 2>&1"
# `crontab -l` exits 1 (no output) when the user has no crontab yet. Under
# `set -e`, letting that failure propagate through the pipe would abort this
# subshell BEFORE the echo runs, silently installing an EMPTY crontab (i.e.
# no updater ever runs). `|| true` is load-bearing here, not decoration.
existing_cron="$(crontab -l 2>/dev/null || true)"
( printf '%s\n' "$existing_cron" | grep -vF "nova-release process" ; echo "$CRON_LINE" ) \
  | grep -v '^$' | crontab -
crontab -l | grep -qF "nova-release process" || { echo "FATAL: nova-release cron did not install" >&2; exit 1; }

echo "Installed $BIN_DIR/nova-release and processor cron."
echo "Next: $BIN_DIR/nova-release migrate   # one-time, converts the flat install"
