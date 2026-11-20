#!/usr/bin/env bash
#
# install-kiosk-backlight.sh: install (or, with --uninstall, remove) the kiosk
# backlight service on the kiosk box. Run as the kiosk's desktop user from a
# directory holding the files below; uses sudo for /opt and the udev rule.
# Idempotent. See specs/kiosk-backlight.md.
#
#   scp ops/kiosk/{nova-kiosk-backlight.py,nova_kiosk_backlight_hw.py,nova_kiosk_backlight_page.py,nova_kiosk_backlight_settings.py,nova-kiosk-backlight.service,70-nova-kiosk-touch.rules,install-kiosk-backlight.sh} <user>@<kiosk>:/tmp/kiosk-backlight/
#   ssh <user>@<kiosk> 'bash /tmp/kiosk-backlight/install-kiosk-backlight.sh'
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OPT=/opt/nova-ha-dashboard/ops/kiosk
UNIT="$HOME/.config/systemd/user/nova-kiosk-backlight.service"
RULE=/etc/udev/rules.d/70-nova-kiosk-touch.rules
CONF="$HOME/.config/nova-kiosk"
PREV="$CONF/powerdevil-dim.prev"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
DIM_KEY=(--file powerdevilrc --group AC --group Display --key DimDisplayWhenIdle)

refresh_powerdevil() {
  qdbus6 org.kde.Solid.PowerManagement /org/kde/Solid/PowerManagement refreshStatus >/dev/null 2>&1 || true
}

if [ "${1:-}" = "--uninstall" ]; then
  systemctl --user disable --now nova-kiosk-backlight.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  sudo rm -f "$RULE" "$OPT/nova-kiosk-backlight.py" "$OPT/nova_kiosk_backlight_hw.py" "$OPT/nova_kiosk_backlight_page.py" "$OPT/nova_kiosk_backlight_settings.py"
  sudo udevadm control --reload
  sudo udevadm trigger --subsystem-match=input --action=change
  if [ -f "$PREV" ]; then
    previous="$(cat "$PREV")"
    if [ -n "$previous" ]; then
      kwriteconfig6 "${DIM_KEY[@]}" --type bool "$previous"
    else
      kwriteconfig6 "${DIM_KEY[@]}" --delete
    fi
    rm -f "$PREV"
    refresh_powerdevil
  fi
  echo "Kiosk backlight removed."
  exit 0
fi

for f in nova-kiosk-backlight.py nova_kiosk_backlight_hw.py nova_kiosk_backlight_page.py nova_kiosk_backlight_settings.py nova-kiosk-backlight.service 70-nova-kiosk-touch.rules; do
  [ -f "$HERE/$f" ] || { echo "missing $HERE/$f" >&2; exit 1; }
done
dpkg -s python3-websocket >/dev/null 2>&1 || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-websocket
python3 -m py_compile "$HERE/nova-kiosk-backlight.py" "$HERE/nova_kiosk_backlight_hw.py" "$HERE/nova_kiosk_backlight_page.py" "$HERE/nova_kiosk_backlight_settings.py"

sudo install -D -m 0755 "$HERE/nova-kiosk-backlight.py" "$OPT/nova-kiosk-backlight.py"
sudo install -D -m 0644 "$HERE/nova_kiosk_backlight_hw.py" "$OPT/nova_kiosk_backlight_hw.py"
sudo install -D -m 0644 "$HERE/nova_kiosk_backlight_page.py" "$OPT/nova_kiosk_backlight_page.py"
sudo install -D -m 0644 "$HERE/nova_kiosk_backlight_settings.py" "$OPT/nova_kiosk_backlight_settings.py"
sudo rm -rf "$OPT/__pycache__"

sudo install -D -m 0644 "$HERE/70-nova-kiosk-touch.rules" "$RULE"
sudo udevadm control --reload
sudo udevadm trigger --subsystem-match=input --action=change
sudo udevadm settle || true

# Save powerdevil's idle-dim value once, before the first change, so
# --uninstall puts back what was there.
mkdir -p "$CONF"
if [ ! -f "$PREV" ]; then
  kreadconfig6 "${DIM_KEY[@]}" > "$PREV" || true
fi
kwriteconfig6 "${DIM_KEY[@]}" --type bool false
refresh_powerdevil

install -D -m 0644 "$HERE/nova-kiosk-backlight.service" "$UNIT"
systemctl --user daemon-reload
systemctl --user enable nova-kiosk-backlight.service
systemctl --user restart nova-kiosk-backlight.service
sleep 3
systemctl --user is-active nova-kiosk-backlight.service
journalctl --user -u nova-kiosk-backlight.service -n 8 --no-pager || true
