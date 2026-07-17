#!/usr/bin/env bash
# verify-nova.sh — deployment / regression contract check for the Nova host.
#
# Run on nova (or via ssh) after any deploy. Exits non-zero if a CONTRACT check
# fails. Two contracts are mandatory and permanent:
#
#   1. Hardware ffmpeg (VAAPI) encode/decode. The Outside camera MUST use the
#      GPU (h264_vaapi + VAAPI decode), never software x264 — software encoding
#      at 1080p saturates the CPU and starves the kiosk. This is a permanent
#      feature of the software contract; a regression to x264 is a FAILURE.
#      (When camera ingestion is DISABLED in config, no ffmpeg runs — we then
#      assert the *capability* is intact: vaapi image, render node, env.)
#
#   2. Known device presence + connectivity. The render node must be present and
#      passed into the container; Home Assistant must be reachable and serving
#      entities; the capture device presence is reported (its absence is a known
#      intermittent handled by the camera watchdog, so it's a WARN, not a FAIL).
#
# Usage:  bash /opt/nova-ha-dashboard/ops/verify-nova.sh
#         ssh nova 'bash /opt/nova-ha-dashboard/ops/verify-nova.sh'
set -u

APP=/opt/nova-ha-dashboard
CONTAINER=nova-ha-dashboard
RENDER_NODE=/dev/dri/renderD128
CAPTURE_BYID=/dev/v4l/by-id/usb-MACROSILICON_2109-video-index0
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

echo "== Contract 1: hardware ffmpeg (VAAPI) =="
# 1a. Runtime image must be the VAAPI image.
img=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || echo "?")
case "$img" in
  *vaapi*) pass "container image is VAAPI ($img)" ;;
  *) fail "container image is '$img' — expected the :vaapi image (ops/Dockerfile.vaapi)" ;;
esac
# 1b. Render node present on host and mapped into the container.
[ -e "$RENDER_NODE" ] && pass "render node $RENDER_NODE present" || fail "render node $RENDER_NODE missing"
if docker inspect -f '{{range .HostConfig.Devices}}{{.PathOnHost}} {{end}}' "$CONTAINER" 2>/dev/null | grep -q "$RENDER_NODE"; then
  pass "render node passed into container"
else
  fail "render node NOT passed into container (--device $RENDER_NODE)"
fi
# 1c. Encoder configured for VAAPI (env in the running container).
enc=$(docker exec "$CONTAINER" printenv NOVA_CAMERA_OUTSIDE_ENCODER 2>/dev/null || echo "")
hwa=$(docker exec "$CONTAINER" printenv NOVA_CAMERA_OUTSIDE_HWACCEL 2>/dev/null || echo "")
[ "$enc" = "vaapi" ] && pass "NOVA_CAMERA_OUTSIDE_ENCODER=vaapi" || fail "NOVA_CAMERA_OUTSIDE_ENCODER='$enc' (expected vaapi)"
[ "$hwa" = "vaapi" ] && pass "NOVA_CAMERA_OUTSIDE_HWACCEL=vaapi" || warn "NOVA_CAMERA_OUTSIDE_HWACCEL='$hwa' (expected vaapi for full-GPU decode)"
# 1d. If ingestion is running, the live ffmpeg MUST be h264_vaapi, never libx264.
ff=$(ps -eo args 2>/dev/null | grep -E 'ffmpeg.*camera|ffmpeg.*index\.m3u8' | grep -v grep | head -1)
if [ -n "$ff" ]; then
  if echo "$ff" | grep -q 'h264_vaapi'; then
    pass "live ffmpeg is using h264_vaapi (hardware encode)"
  elif echo "$ff" | grep -q 'libx264'; then
    fail "live ffmpeg is using libx264 (SOFTWARE) — VAAPI contract regressed"
  else
    warn "ffmpeg running but encoder not identified in cmdline"
  fi
  echo "$ff" | grep -q 'hwaccel vaapi' && pass "live ffmpeg is using VAAPI hardware decode" || warn "ffmpeg not using hwaccel vaapi decode"
else
  warn "no camera ffmpeg running (ingestion disabled or device absent) — capability verified above, live encode not checked"
fi

echo "== Contract 2: device presence + connectivity =="
# 2a. Capture device presence (intermittent by design — watchdog recovers it).
if [ -e "$CAPTURE_BYID" ] || ls /dev/v4l/by-id/ 2>/dev/null | grep -qi 'MACROSILICON'; then
  pass "MS2109 capture device present on USB"
else
  warn "MS2109 capture device absent (known intermittent; camera watchdog handles replug)"
fi
# 2b. Home Assistant reachable and serving entities.
ha=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:8123/api/ 2>/dev/null)
[ "$ha" = "200" ] || [ "$ha" = "401" ] && pass "Home Assistant API reachable (HTTP $ha)" || fail "Home Assistant API unreachable (HTTP $ha)"
# 2c. Dashboard is actually seeing HA entities (not an all-unavailable snapshot).
ent=$(curl -sS --max-time 8 http://127.0.0.1/api/state 2>/dev/null | grep -o '"entity_id"' | wc -l)
[ "$ent" -gt 0 ] 2>/dev/null && pass "dashboard sees $ent entities" || fail "dashboard sees 0 entities"

echo "== Monitoring pipeline =="
for unit in nova-monitor-agent.service nova-events-drain.timer nova-temp-collector.timer nova-camera-watchdog.service; do
  state=$(systemctl is-active "$unit" 2>/dev/null || echo "inactive")
  [ "$state" = "active" ] && pass "$unit active" || warn "$unit is $state"
done

echo
if [ "$fails" -gt 0 ]; then
  printf '\033[31mVERIFY FAILED: %d contract failure(s), %d warning(s)\033[0m\n' "$fails" "$warns"
  exit 1
fi
printf '\033[32mVERIFY OK: all contracts satisfied (%d warning(s))\033[0m\n' "$warns"
exit 0
