#!/usr/bin/env bash
# Keep the Brave kiosk both ALIVE and RESPONSIVE.
#
# The 2026-07-13 incident showed a plain `pgrep brave` liveness check is not
# enough: Brave can sit with a live process while the dashboard page is frozen
# behind a "Page Unresponsive" dialog. This guard therefore also probes the
# page over CDP (:9223) and escalates recovery: gentle Page.reload first, then
# a full kill + relaunch. Every cycle emits a heartbeat verdict to the indium
# monitoring pipeline via nova-event so hangs are visible in Grafana.
#
# HYSTERESIS (2026-07-26). The original guard acted on a SINGLE bad probe and
# judged the gentle reload only 8s later, while the page was still hydrating.
# That fired ~25 reload+kill cycles a day on a kiosk nobody was complaining
# about, which the user sees as the browser "quitting and reloading" by itself.
# Recovery now requires the page to fail CONSECUTIVE cycles, and a reload is
# given a real settling window before it can be judged a failure:
#
#   dead process            -> relaunch immediately (unambiguous)
#   FAILS_BEFORE_RELOAD bad cycles in a row  -> gentle Page.reload
#   still bad, after RELOAD_GRACE, for another FAILS_BEFORE_RELOAD cycles
#                                            -> kill + relaunch
#
# Any single good probe clears the counters.
set -u

PROBE="$HOME/.local/bin/kiosk-cdp-probe.py"
UNIT='app-brave\x2dnova@autostart.service'
EVENT=/usr/local/bin/nova-event

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/nova-kiosk-guard"
FAIL_FILE="$STATE_DIR/consecutive_failures"
RELOAD_FILE="$STATE_DIR/last_reload_epoch"

FAILS_BEFORE_RELOAD=3   # x 2min timer = ~6 minutes of unresponsiveness
RELOAD_GRACE=120        # seconds a freshly reloaded page gets before judging
RELOAD_WINDOW=1800      # a reload counts as "already tried" for 30 minutes

mkdir -p "$STATE_DIR"

read_int() {  # read_int <file>
  local v
  v="$(cat "$1" 2>/dev/null || echo 0)"
  case "$v" in (*[!0-9]*|'') echo 0 ;; (*) echo "$v" ;; esac
}

emit() {  # emit <event> <phase> <detail...>
  local ev="$1" phase="$2"; shift 2
  local args=()
  for d in "$@"; do args+=(--detail "$d"); done
  "$EVENT" --service kiosk --event "$ev" --phase "$phase" --source watchdog "${args[@]}" 2>/dev/null || true
}

clear_state() {
  echo 0 >"$FAIL_FILE"
}

relaunch() {  # relaunch <reason>
  emit relaunch point "reason=$1"
  pkill -x brave; sleep 3; pkill -9 -x brave 2>/dev/null; sleep 2
  systemctl --user start "$UNIT"
  clear_state
  echo 0 >"$RELOAD_FILE"
}

# Only act inside a live graphical session.
systemctl --user is-active --quiet graphical-session.target || exit 0

# 1) Dead process -> relaunch.
if ! pgrep -x brave >/dev/null; then
  relaunch brave_not_running
  exit 0
fi

# 2) Alive: probe the page for responsiveness.
verdict="$(timeout 60 python3 "$PROBE" 2>/dev/null)"; rc=$?
# Heartbeat every cycle so indium has a continuous responsiveness signal.
emit heartbeat point "probe_rc=$rc" "verdict=${verdict:-none}"

if [ "$rc" = 0 ]; then
  clear_state
  exit 0
fi

now="$(date +%s)"
last_reload="$(read_int "$RELOAD_FILE")"

# A page reloaded moments ago is loading, not hung. Do not count that cycle.
if [ "$last_reload" -gt 0 ] && [ "$((now - last_reload))" -lt "$RELOAD_GRACE" ]; then
  emit heartbeat point "suppressed=reload_grace" "age=$((now - last_reload))"
  exit 0
fi

fails="$(read_int "$FAIL_FILE")"
fails=$((fails + 1))
echo "$fails" >"$FAIL_FILE"

if [ "$fails" -lt "$FAILS_BEFORE_RELOAD" ]; then
  emit heartbeat point "pending=$fails/$FAILS_BEFORE_RELOAD" "verdict=${verdict:-none}"
  exit 0
fi

reason="$(echo "$verdict" | sed -n 's/.*"reason": *"\([^"]*\)".*/\1/p')"

# The page has failed every cycle for long enough to be a real hang. If a
# gentle reload was already tried recently and did not fix it, escalate.
if [ "$last_reload" -gt 0 ] && [ "$((now - last_reload))" -lt "$RELOAD_WINDOW" ]; then
  emit page-hang point "recovery=reload_failed" "verdict=${verdict:-none}"
  relaunch "page_hang_reload_failed:${reason:-unknown}"
  emit page-hang end "recovery=kill_relaunch"
  exit 0
fi

emit page-hang start "verdict=${verdict:-none}"
timeout 20 python3 "$PROBE" reload >/dev/null 2>&1
echo "$now" >"$RELOAD_FILE"
clear_state
exit 0
