#!/usr/bin/env bash
#
# install-kiosk.sh — install/refresh the parameterized kiosk launcher + CDP
# probe on the kiosk box (nova). No sudo. Behavior is IDENTICAL to the
# previously hand-installed scripts while backend.env holds the default
# http://127.0.0.1/ — installing this is inert until that value changes.
#
#   scp ops/kiosk/{brave-kiosk-launch.sh,kiosk-cdp-probe.py,install-kiosk.sh,backend.env.example} <user>@<nova-host>:/tmp/
#   ssh <user>@<nova-host> 'bash /tmp/install-kiosk.sh'
#
# Does NOT touch: the brave-nova autostart entry or the guard timer — they
# already invoke these files by path.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/bin"
CONF="$HOME/.config/nova-kiosk"

mkdir -p "$BIN" "$CONF"

# Keep one rollback copy of whatever was installed before.
for f in brave-kiosk-launch.sh kiosk-cdp-probe.py brave-kiosk-guard.sh; do
  [ -f "$BIN/$f" ] && cp -f "$BIN/$f" "$BIN/$f.pre-param"
done

install -m 0755 "$HERE/brave-kiosk-launch.sh" "$BIN/brave-kiosk-launch.sh"
install -m 0755 "$HERE/kiosk-cdp-probe.py"    "$BIN/kiosk-cdp-probe.py"
install -m 0755 "$HERE/brave-kiosk-guard.sh"  "$BIN/brave-kiosk-guard.sh"

# Never clobber an existing backend choice.
if [ ! -f "$CONF/backend.env" ]; then
  install -m 0644 "$HERE/backend.env.example" "$CONF/backend.env"
  echo "Installed default backend.env (http://127.0.0.1/)."
else
  echo "Existing backend.env kept: $(grep '^NOVA_BACKEND_URL=' "$CONF/backend.env")"
fi

echo "Kiosk launcher + probe installed. Flip $CONF/backend.env to cut over."
