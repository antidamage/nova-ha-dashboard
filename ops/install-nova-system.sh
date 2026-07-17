#!/usr/bin/env bash
#
# install-nova-system.sh — install/refresh nova-system and its trigger cron on
# the host. Run as the app owner on the Nova host, same as install-updater.sh.
#
#   scp ops/nova-system ops/install-nova-system.sh <user>@<nova-host>:/tmp/
#   ssh <user>@<nova-host> 'bash /tmp/install-nova-system.sh'
#
# Like nova-release, the binary goes in the HOME dir (~/.local/bin), NOT inside
# the app root, so a flat deploy over /opt/nova-ha-dashboard can't wipe it.
#
# Restarting the dashboard needs no privilege (docker stop). Rebooting the host
# does: the app owner has no sudo, so this script prints — and, with
# --install-sudoers, installs — a tight NOPASSWD rule for just `systemctl reboot`.
#
set -euo pipefail
APP_ROOT="${NOVA_APP_ROOT:-/opt/nova-ha-dashboard}"
BIN_DIR="${NOVA_BIN_DIR:-$HOME/.local/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALL_SUDOERS=0
[ "${1:-}" = "--install-sudoers" ] && INSTALL_SUDOERS=1

mkdir -p "$BIN_DIR" "$APP_ROOT/data/system/control"
install -m 0755 "$HERE/nova-system" "$BIN_DIR/nova-system"

# Per-minute processor that drains queued restart/reboot requests written by the
# dashboard. flock inside nova-system prevents overlap; an empty queue is a
# near-instant no-op.
CRON_LINE="* * * * * $BIN_DIR/nova-system process >> $HOME/nova-system-cron.log 2>&1"
# See install-updater.sh: `crontab -l` failing on a fresh user (no crontab
# yet) would, under `set -e`, abort this subshell before the echo runs and
# silently install an EMPTY crontab. `|| true` is load-bearing here.
existing_cron="$(crontab -l 2>/dev/null || true)"
( printf '%s\n' "$existing_cron" | grep -vF "nova-system process" ; echo "$CRON_LINE" ) \
  | grep -v '^$' | crontab -
crontab -l | grep -qF "nova-system process" || { echo "FATAL: nova-system cron did not install" >&2; exit 1; }

echo "Installed $BIN_DIR/nova-system and processor cron."

# --- reboot privilege -------------------------------------------------------
SUDO_USER_NAME="$(id -un)"
SUDOERS_LINE="$SUDO_USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl reboot, /sbin/reboot"
SUDOERS_FILE="/etc/sudoers.d/nova-system-reboot"

if [ "$INSTALL_SUDOERS" -eq 1 ]; then
  echo "Installing reboot sudoers rule (needs your sudo password once)…"
  printf '%s\n' "$SUDOERS_LINE" | sudo tee "$SUDOERS_FILE" >/dev/null
  sudo chmod 0440 "$SUDOERS_FILE"
  sudo visudo -cf "$SUDOERS_FILE"
  echo "Installed $SUDOERS_FILE — 'Restart Nova' will now work."
else
  echo
  echo "Dashboard restart works now. To enable the 'Restart Nova (the computer)'"
  echo "button, allow this user to reboot without a password — either re-run with"
  echo "  bash $0 --install-sudoers"
  echo "or add this line yourself via 'sudo visudo -f $SUDOERS_FILE':"
  echo "  $SUDOERS_LINE"
fi
