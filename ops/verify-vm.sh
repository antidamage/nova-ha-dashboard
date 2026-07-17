#!/usr/bin/env bash
# verify-vm.sh — deployment / regression contract check for the VM appliance
# host role (successor to verify-nova.sh's host contracts; the VAAPI encode
# contract moved to Nocturnium's camera service).
#
# Contracts:
#   1. Dashboard alive and serving real HA entities.
#   2. Camera is CONSUMED, never produced here: videoHostUrl is configured and
#      its remote playlist answers; a continuous camera-encode ffmpeg inside
#      this host is a FAILURE (that job belongs to Nocturnium).
#   3. The HA stack containers are running (skipped with --phase-a, where the
#      dashboard deliberately runs against nova's live HA and the local stack
#      is stopped).
#
# Usage:  bash /opt/nova-ha-dashboard/ops/verify-vm.sh [--phase-a]
set -u

APP=/opt/nova-ha-dashboard
CONTAINER=nova-ha-dashboard
PHASE_A=0; [ "${1:-}" = "--phase-a" ] && PHASE_A=1
fails=0
warns=0

pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$*"; warns=$((warns+1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; fails=$((fails+1)); }

echo "== Dashboard liveness =="
for path in /api/version /api/healthz /api/state; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1$path" 2>/dev/null)
  [ "$code" = "200" ] && pass "$path -> 200" || fail "$path -> $code (expected 200)"
done

echo "== Contract 1: runtime image + entities =="
img=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || echo "?")
case "$img" in
  *vaapi*) fail "container image is '$img' — the VM must run the plain image (ops/Dockerfile)" ;;
  *plain*) pass "container image is the plain runtime ($img)" ;;
  *) warn "container image is '$img' (expected nova-ha-dashboard:plain)" ;;
esac
ent=$(curl -sS --max-time 8 http://127.0.0.1/api/state 2>/dev/null | grep -o '"entity_id"' | wc -l)
[ "$ent" -gt 0 ] 2>/dev/null && pass "dashboard sees $ent entities" || fail "dashboard sees 0 entities"
ha_url=$(grep -m1 '^HA_URL=' "$APP/.env.local" 2>/dev/null | cut -d= -f2-)
ha=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "${ha_url:-http://127.0.0.1:8123}/api/" 2>/dev/null)
{ [ "$ha" = "200" ] || [ "$ha" = "401" ]; } && pass "HA API reachable at ${ha_url:-127.0.0.1:8123} (HTTP $ha)" \
  || fail "HA API unreachable at ${ha_url:-127.0.0.1:8123} (HTTP $ha)"

echo "== Contract 2: camera is consumed, not produced =="
vhost=$(python3 -c "
import json,sys
try: c=json.load(open('$APP/data/dashboard-config.json'))
except Exception: sys.exit(0)
def dig(d,*ks):
    for k in ks:
        d = d.get(k, {}) if isinstance(d, dict) else {}
    return d if isinstance(d, str) else ''
print(dig(c,'dashboard','camera','outside','videoHostUrl') or dig(c,'camera','outside','videoHostUrl'))" 2>/dev/null)
if [ -n "$vhost" ]; then
  pass "videoHostUrl configured: $vhost"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "${vhost%/}/healthz" 2>/dev/null)
  [ "$code" = "200" ] && pass "camera host healthz -> 200" || warn "camera host healthz -> $code"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "${vhost%/}/camera/outside/live/index.m3u8" 2>/dev/null)
  [ "$code" = "200" ] && pass "remote live playlist -> 200" || warn "remote live playlist -> $code (grabber offline?)"
else
  warn "videoHostUrl not set — dashboard would fall back to local ingestion paths"
fi
ff=$(ps -eo etimes,args 2>/dev/null | grep -E 'ffmpeg.*(camera|index\.m3u8)' | grep -v grep | awk '$1 > 60' | head -1)
if [ -n "$ff" ]; then
  fail "continuous camera ffmpeg running on the VM (>60s): encode belongs to Nocturnium — $ff"
else
  pass "no continuous camera encode on this host"
fi

echo "== Contract 3: HA stack containers =="
if [ "$PHASE_A" = 1 ]; then
  warn "--phase-a: local stack intentionally stopped (dashboard runs against nova's HA); skipping"
else
  for c in mosquitto matter-server homeassistant tuya-mobile-mqtt-bridge; do
    st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)
    [ "$st" = "running" ] && pass "$c running" || fail "$c is $st"
  done
fi

echo "== Monitoring + mDNS =="
st=$(systemctl is-active nova-monitor-agent.service 2>/dev/null || echo inactive)
[ "$st" = "active" ] && pass "nova-monitor-agent active" || warn "nova-monitor-agent is $st (install during VM port)"
command -v avahi-resolve >/dev/null && avahi-resolve -n "$(hostname).local" >/dev/null 2>&1 \
  && pass "$(hostname).local resolves via mDNS" || warn "mDNS name not resolving (avahi)"

echo
if [ "$fails" -gt 0 ]; then
  printf '\033[31mVERIFY FAILED: %d contract failure(s), %d warning(s)\033[0m\n' "$fails" "$warns"
  exit 1
fi
printf '\033[32mVERIFY OK: all contracts satisfied (%d warning(s))\033[0m\n' "$warns"
exit 0
