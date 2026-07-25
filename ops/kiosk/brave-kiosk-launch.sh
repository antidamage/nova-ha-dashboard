#!/usr/bin/env bash
# Launch the Brave kiosk with a SINGLE fresh dashboard tab.
#
# Brave defaults to "restore last session", so after any crash/kill it reopens
# every previously-open tab -- including crashed ones. Over repeated
# crash -> relaunch cycles this accumulates N copies of the dashboard (each with
# its own SSE stream + timers), compounding GPU/memory pressure and the hangs.
# This wrapper wipes the session-restore state and marks a clean exit before
# starting Brave, so a relaunch is always exactly one tab. Called by the
# brave-nova autostart unit (login) and by brave-kiosk-guard (recovery).
#
# The dashboard backend is PARAMETERIZED: ~/.config/nova-kiosk/backend.env sets
# NOVA_BACKEND_URL (default http://127.0.0.1/ = the local hosting role). The
# CDP probe reads the same file, so flipping that one line moves the whole
# kiosk between backends.
set -u

BACKEND_ENV="$HOME/.config/nova-kiosk/backend.env"
# shellcheck disable=SC1090
[ -f "$BACKEND_ENV" ] && . "$BACKEND_ENV"
NOVA_BACKEND_URL="${NOVA_BACKEND_URL:-http://127.0.0.1/}"
NOVA_KIOSK_START_FULLSCREEN="${NOVA_KIOSK_START_FULLSCREEN:-1}"

PROFILE="$HOME/snap/brave/current/.config/BraveSoftware/Brave-Browser"
DEF="$PROFILE/Default"

# Clear a stale profile lock. SingletonLock is a symlink named "<hostname>-<pid>";
# Brave refuses to start (silently, exit 0 -- it cannot draw its message box in
# the kiosk session) if that hostname is not the current one, believing another
# COMPUTER holds the profile. A host rename once orphaned the
# lock exactly this way and left the guard relaunching into nothing. With no
# brave process running, any lock is by definition stale.
if ! pgrep -x brave >/dev/null 2>&1; then
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonCookie" "$PROFILE/SingletonSocket" 2>/dev/null
fi

# Drop tab/session restore artifacts.
rm -f "$DEF/Current Session" "$DEF/Current Tabs" "$DEF/Last Session" "$DEF/Last Tabs" 2>/dev/null
rm -rf "$DEF/Sessions" 2>/dev/null

# Mark the last exit clean and pin startup to NTP so only the URL arg opens.
if [ -f "$DEF/Preferences" ]; then
  python3 - "$DEF/Preferences" <<'PY' 2>/dev/null || true
import json, os, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception:
    sys.exit(0)
d.setdefault('profile', {})['exit_type'] = 'Normal'
d['profile']['exited_cleanly'] = True
d.setdefault('session', {})['restore_on_startup'] = 5  # 5 = New Tab Page (no restore)
tmp = p + '.kiosk.tmp'
json.dump(d, open(tmp, 'w'))
os.replace(tmp, p)
PY
fi

# Quiet flags for an unattended kiosk. Managed-policy JSON is NOT an option
# here: snap confinement denies Brave any read of /etc/brave/policies, and
# brave://policy confirms nothing loads from it. The command line is the only
# supported control surface for a snap install.
#   --disable-component-update  no background component fetches (the browser
#       binary itself is updated by snapd, which is held for brave on kiosks)
#   --disable-session-crashed-bubble / --noerrdialogs / --disable-infobars
#       no "Brave didn't shut down correctly" or update/error nags, which a
#       kiosk has no one to dismiss them
# The dashboard's per-device fullscreen preference calls the Fullscreen API,
# which every browser refuses without user activation -- so an unattended kiosk
# sat windowed (desktop panel visible) until someone tapped the screen. A window
# the browser OPENS fullscreen needs no gesture, and the page is fullscreen from
# first paint. Not --kiosk: that also removes the escape hatch out of the
# dashboard, which the recovery panel depends on.
FULLSCREEN_ARGS=()
[ "$NOVA_KIOSK_START_FULLSCREEN" = "1" ] && FULLSCREEN_ARGS=(--start-fullscreen)

exec /snap/bin/brave \
  "${FULLSCREEN_ARGS[@]}" \
  --no-first-run \
  --disable-component-update \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --noerrdialogs \
  --remote-debugging-port=9223 --remote-allow-origins=* "$NOVA_BACKEND_URL"
