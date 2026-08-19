#!/usr/bin/env bash
# Find WHERE in the chain a device's reported state stops being true, when the
# entity's own `unavailable` flag is not a reliable signal.
#
# nova-device-doctor.sh answers "why is this entity unavailable" -- it is
# triggered by the entity's own availability flag. This script answers a
# different, sneakier question: "is what this entity confidently reports still
# true right now", for an entity that looks perfectly normal. Many Nova
# integrations (the built-in `gree` one included) do not flip to `unavailable`
# when they silently lose a device -- they just stop updating and keep serving
# the last value forever, looking exactly as healthy as a live one.
#
# Origin: 2026-08-19. The lounge Gree aircon was told off, twice, and stayed
# on. `climate.c6780cad` read `off` throughout and its "estimated power"
# sensor read 15W (idle) throughout -- both wrong, because both were
# downstream of the same frozen integration. The device had silently dropped
# off WiFi; every command HA logged as "success" never reached it. Confirming
# that took a ping, an ARP lookup, and a raw UDP broadcast scan run BY HAND,
# after telling Adeline she was wrong once already on the strength of the
# cached state alone. This script is that sequence, so it runs the same way
# every time and the first answer is the right one.
#
# THE RULE THIS SCRIPT ENFORCES: a cached/derived value is a hypothesis to
# verify against something the cache does not control, never a verdict to
# hand back to a user who is reporting something different. See the
# claude-code memory feedback_debug_verify_live_believe_user.md ("BELIEVE THE
# USER" -- Adeline's own words, given twice).
#
# Run on nova:
#   bash /opt/nova-ha-dashboard/scripts/nova-device-route-check.sh <entity_id>
#
# What it does, in order, printing evidence at each step rather than a single
# verdict:
#   1. Fetch the cached state via the HA API. Note last_changed/last_updated.
#   2. Force a refresh (homeassistant.update_entity) and fetch again. Did the
#      timestamp actually ADVANCE? A cache that doesn't move even when told to
#      refresh is itself the finding -- the poll loop is stuck, independent of
#      whether the device is reachable.
#   3. Identify the integration/platform behind the entity (from HA's own
#      config-entry + device registry, not a guess) and probe the device
#      directly, bypassing HA entirely:
#        - gree: ping + ARP (it lives on the main LAN, not the isolated IoT
#          SSID, so ARP is meaningful here) AND a raw UDP broadcast scan of
#          the whole subnet on port 7000 -- catches both "off the network" and
#          "moved to a new IP", where a single ping would miss the second.
#        - tuya_local / lifx / tplink,kasa: these sit on the 2.4GHz IoT SSID
#          under AP isolation, where ARP resolves everything to the access
#          point's own MAC and proves nothing (see project_tuya_ap_isolation).
#          This script does NOT reimplement that protocol discovery --
#          nova-device-doctor.sh already has it, tested, in one place. It
#          tells you to run that instead and stops rather than giving a wrong
#          answer from the wrong tool.
#        - anything else on the main LAN: ping + ARP as a best-effort check.
#   4. Pull the dashboard's own command trail for the entity from
#      nova-ha-dashboard's logs over the lookback window -- who (which
#      client/session) sent what, and whether HA's "success" was ever
#      confirmed by anything the integration doesn't control.
#
# It prints evidence and a plain-English diagnosis. It changes nothing and
# fixes nothing -- pair it with nova-device-doctor.sh (tuya_local repair) or a
# human at the device (off-network, needs power/WiFi attention) once you know
# which one this is.

set -euo pipefail

if [ $# -lt 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  sed -n '2,55p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

ENTITY_ID="$1"
WINDOW_MIN="${2:-15}"

log() { echo "$@"; }
section() { echo; echo "== $* =="; }

WORK=$(mktemp -d /tmp/device-route-check.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

HA_TOKEN=$(docker exec nova-ha-dashboard sh -lc 'printf %s "$HA_TOKEN"')
export HA_TOKEN

# --------------------------------------------------------------- 1. cached state
section "1/4 cached state (as HA/the dashboard report it right now)"
docker exec -e HA_TOKEN="$HA_TOKEN" -e ENTITY_ID="$ENTITY_ID" -i homeassistant python3 - > "$WORK/before.json" <<'PY'
import json, os, urllib.request
req = urllib.request.Request(f"http://127.0.0.1:8123/api/states/{os.environ['ENTITY_ID']}",
                              headers={'Authorization': 'Bearer ' + os.environ['HA_TOKEN']})
with urllib.request.urlopen(req, timeout=10) as r:
    print(r.read().decode())
PY
python3 -c "
import json
d = json.load(open('$WORK/before.json'))
print('state:', d.get('state'))
print('last_changed:', d.get('last_changed'))
print('last_updated:', d.get('last_updated'))
"

# ---------------------------------------------------------- 2. force a refresh
section "2/4 forcing a refresh, then re-checking whether anything actually moved"
docker exec -e HA_TOKEN="$HA_TOKEN" -e ENTITY_ID="$ENTITY_ID" -i homeassistant python3 - <<'PY' >/dev/null
import json, os, urllib.request
req = urllib.request.Request(
    "http://127.0.0.1:8123/api/services/homeassistant/update_entity",
    data=json.dumps({"entity_id": os.environ['ENTITY_ID']}).encode(),
    headers={'Authorization': 'Bearer ' + os.environ['HA_TOKEN'], 'Content-Type': 'application/json'})
urllib.request.urlopen(req, timeout=10).read()
PY
sleep 2
docker exec -e HA_TOKEN="$HA_TOKEN" -e ENTITY_ID="$ENTITY_ID" -i homeassistant python3 - > "$WORK/after.json" <<'PY'
import json, os, urllib.request
req = urllib.request.Request(f"http://127.0.0.1:8123/api/states/{os.environ['ENTITY_ID']}",
                              headers={'Authorization': 'Bearer ' + os.environ['HA_TOKEN']})
with urllib.request.urlopen(req, timeout=10) as r:
    print(r.read().decode())
PY
CACHE_MOVED=$(python3 -c "
import json
b = json.load(open('$WORK/before.json'))
a = json.load(open('$WORK/after.json'))
moved = a.get('last_updated') != b.get('last_updated')
print('state:', a.get('state'))
print('last_updated:', a.get('last_updated'))
print('MOVED' if moved else 'FROZEN -- forcing a refresh did not change the timestamp')
print('yes' if moved else 'no')
" | tee /dev/stderr | tail -1)

# --------------------------------------------------- 3. identify the platform
section "3/4 identifying the integration behind this entity"
docker exec -e HA_TOKEN="$HA_TOKEN" -e ENTITY_ID="$ENTITY_ID" -i homeassistant python3 - > "$WORK/platform.json" <<'PY'
import json, os, pathlib
base = pathlib.Path('/config/.storage')
def store(name):
    return json.loads((base / name).read_text())['data']
entity_id = os.environ['ENTITY_ID']
ent = next((e for e in store('core.entity_registry')['entities'] if e.get('entity_id') == entity_id), None)
entry = None
if ent:
    entry = next((e for e in store('core.config_entries')['entries']
                  if e.get('entry_id') == ent.get('config_entry_id')), None)
print(json.dumps({'entity': ent, 'entry': entry}))
PY
DOMAIN=$(python3 -c "
import json
d = json.load(open('$WORK/platform.json'))
entry = d.get('entry') or {}
print(entry.get('domain') or 'unknown')
")
log "platform (config-entry domain): $DOMAIN"

# ------------------------------------------------------------- 4. live probe
section "4/4 probing the device directly, bypassing HA entirely"
case "$DOMAIN" in
  gree)
    HOST=$(python3 -c "
import json
d = json.load(open('$WORK/platform.json'))
entry = d.get('entry') or {}
print((entry.get('host')) or '')
" 2>/dev/null || true)
    PING_OK="no"
    if [ -n "$HOST" ]; then
      log "known host: $HOST"
      log "-- ping --"
      if ping -c 3 -W 2 "$HOST"; then PING_OK="yes"; fi
      log "-- ARP (meaningful here -- gree is on the main LAN, not the isolated IoT SSID) --"
      arp -a | grep -i "$HOST" || echo "(no ARP entry)"
    fi
    log "-- raw Gree UDP broadcast scan, whole subnet, port 7000, up to 3 tries --"
    log "(catches both off-the-network AND moved-to-a-new-IP, which a single ping to"
    log " the known host would miss -- but the protocol is UDP over broadcast, so a"
    log " single attempt can miss a device that IS there. Retry before trusting a miss.)"
    SUBNET=$(ip -4 addr show scope global | awk '/inet /{print $2}' | head -1 | sed -E 's#\.[0-9]+/.*$#.255#')
    SCAN_OK="no"
    for attempt in 1 2 3; do
      RESULT=$(python3 -c "
import socket, json, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
s.settimeout(3)
s.sendto(json.dumps({'t':'scan'}).encode(), ('$SUBNET', 7000))
start = time.time()
found = []
while time.time() - start < 3:
    try:
        data, addr = s.recvfrom(4096)
        found.append(addr)
    except socket.timeout:
        break
print('responses:', len(found))
for a in found:
    print(' ', a)
print('yes' if found else 'no')
")
      echo "$RESULT" | head -n -1
      if [ "$(echo "$RESULT" | tail -1)" = "yes" ]; then SCAN_OK="yes"; break; fi
      log "(attempt $attempt: no responses -- UDP is lossy, retrying)"
    done
    # Ping is the reliable primary signal for a plain-LAN device like this one;
    # the broadcast scan is corroborating (and catches an IP move) but its
    # single-shot-per-attempt UDP nature makes it the weaker of the two on its
    # own. Either one answering is enough to call the device present.
    if [ "$PING_OK" = "yes" ] || [ "$SCAN_OK" = "yes" ]; then
      LIVE_RESPONDED="yes"
    else
      LIVE_RESPONDED="no"
    fi
    ;;
  tuya_local|lifx|tplink|kasa)
    log "This entity sits on the 2.4GHz IoT SSID under AP isolation -- ARP will"
    log "confidently lie about it (everything resolves to the access point's own"
    log "MAC). Do not trust a ping/ARP check for this platform."
    log
    log "Protocol-level discovery for $DOMAIN already exists, tested, in"
    log "nova-device-doctor.sh -- run that instead of duplicating it here:"
    log "  bash \$(dirname \"\$0\")/nova-device-doctor.sh --json | grep -A5 '\"entity_id\": \"$ENTITY_ID\"'"
    LIVE_RESPONDED="unknown"
    ;;
  *)
    log "Unrecognised platform ($DOMAIN) -- falling back to a best-effort"
    log "ping/ARP against the entry's known host, if it has one. Treat a miss"
    log "here as inconclusive, not proof, unless you know this device is on the"
    log "main LAN rather than the isolated IoT SSID."
    HOST=$(python3 -c "
import json
d = json.load(open('$WORK/platform.json'))
entry = d.get('entry') or {}
print((entry.get('host')) or '')
" 2>/dev/null || true)
    LIVE_RESPONDED="unknown"
    if [ -n "$HOST" ]; then
      if ping -c 3 -W 2 "$HOST"; then LIVE_RESPONDED="yes"; else LIVE_RESPONDED="no"; fi
      arp -a | grep -i "$HOST" || echo "(no ARP entry)"
    else
      log "(no known host on the config entry -- nothing to probe)"
    fi
    ;;
esac

# -------------------------------------------------------- command trail
section "dashboard command trail, last ${WINDOW_MIN}m (who sent what, and did HA merely accept it or confirm it)"
SINCE_TS=$(date -u -d "-${WINDOW_MIN} minutes" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
docker logs -t nova-ha-dashboard --since "$SINCE_TS" 2>&1 \
  | grep -F "$ENTITY_ID" -B1 -A1 || echo "(no dashboard log lines mention this entity in the window)"

section "diagnosis"
echo "cache moved on forced refresh: $CACHE_MOVED   |   device answered a live probe: $LIVE_RESPONDED"
echo
if [ "$LIVE_RESPONDED" = "unknown" ]; then
  echo "No live probe actually ran for this platform ($DOMAIN) -- either it was"
  echo "delegated to nova-device-doctor.sh (tuya_local/lifx/tplink/kasa: go run"
  echo "that) or there was no known host to ping (a wrapper/template config entry"
  echo "like switch_as_x, which is not itself a device platform -- the real"
  echo "integration is whatever it wraps; nova-device-doctor.sh resolves that"
  echo "twin/wrapper indirection, this script does not)."
  echo
  echo "Treat the cached state above as UNVERIFIED, not confirmed, no matter what"
  echo "cache-moved says. A moving timestamp only proves the integration's poll"
  echo "loop is alive, never that the value it's polling is correct -- that needs"
  echo "an actual device answer, which this run does not have."
elif [ "$CACHE_MOVED" = "no" ] && [ "$LIVE_RESPONDED" = "no" ]; then
  echo "Cache frozen AND the device is unreachable. Genuinely off-network -- see"
  echo "2026-08-19 (this script's origin case): the lounge Gree stayed 'off' in HA"
  echo "for 30+ minutes while actually running, because it had dropped WiFi and"
  echo "nothing (dashboard, API, this script) has any path to a device that isn't"
  echo "on the network. No code fix exists. Needs a human at the device: its own"
  echo "remote/onboard controls (fastest, no network dependency), or a power cycle"
  echo "to force it to reassociate. Re-run this script afterward -- both numbers"
  echo "should flip to yes once it's back."
elif [ "$CACHE_MOVED" = "no" ] && [ "$LIVE_RESPONDED" = "yes" ]; then
  echo "Cache frozen but the device DID answer -- do not jump straight to \"the"
  echo "integration is broken\". homeassistant.update_entity does not force a real"
  echo "device poll for every platform (confirmed on gree: it left the cache"
  echo "untouched even though the unit was reachable and healthy). Before calling"
  echo "this a bug, check the integration's configured scan_interval and wait for"
  echo "one full interval, then re-run this script. If it is STILL frozen after a"
  echo "full poll interval has genuinely elapsed, THEN it's a stuck poll loop"
  echo "(nova-device-doctor's tier A) -- restart the narrowest thing that owns it"
  echo "for this integration, never the whole stack, and confirm the timestamp"
  echo "starts advancing on its own afterward."
elif [ "$CACHE_MOVED" = "yes" ] && [ "$LIVE_RESPONDED" = "no" ]; then
  echo "Cache just advanced but the device didn't answer THIS probe -- likely a"
  echo "timing/protocol miss (UDP is lossy; a scan can miss a device that answered"
  echo "HA moments ago) rather than a real fault. Re-run the live probe alone"
  echo "once or twice before concluding anything; trust the cache-moved result"
  echo "over a single missed broadcast."
else
  echo "Cache is current and the device answered directly -- this entity's state"
  echo "is genuinely live right now. If a user's report still disagrees with it,"
  echo "the discrepancy is upstream of the device entirely: a different tab/client"
  echo "showing stale UI state, a different physical device than they think, or a"
  echo "dashboard bug in how this value gets displayed or written. Keep looking --"
  echo "do NOT tell them they're wrong on the strength of this check alone. Check"
  echo "the command trail above for who last actually sent what."
fi
