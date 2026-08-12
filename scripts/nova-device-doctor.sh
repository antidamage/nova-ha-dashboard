#!/usr/bin/env bash
# Find smart-home devices that have gone missing, and say WHY before anything
# is "fixed".
#
# The expensive mistake this script exists to prevent: assuming a device that
# reads `unavailable` in Home Assistant has fallen off the network. Often it
# has not. On 2026-08-12 the bedroom heater was sitting on its reserved IP,
# answering 382 consecutive pings, while HA showed it flapping unavailable --
# the real cause was a telemetry-freshness gate in the MQTT bridge. Diagnosing
# that from scratch took hours. This script classifies first.
#
# Six things a "missing" device actually turns out to be:
#
#   A. availability gate  - device is present and reporting, but a staleness or
#                           freshness rule in the bridge marks the entity
#                           unavailable. A CODE bug. Power-cycling won't help.
#   B. tuya_local drift   - device roamed to a new DHCP address, or a re-pair in
#                           the Tuya app rotated its local_key. Repaired by
#                           tuya-local-repair.sh, which this script delegates to.
#   C. off the network    - no protocol-level response at all. Genuinely down;
#                           needs power or WiFi attention. No automated fix.
#   D. address drift      - present, but not on the address we reserved for it.
#   E. disabled entry     - a config entry was disabled by an earlier failure and
#                           never re-enabled, while the device is healthy again.
#   F. retired            - SUPPOSED to be unavailable. Listed in
#                           nova-device-expectations.json, never repaired.
#
# Device identity comes from protocol-level discovery (Tuya UDP 6666/6667, LIFX
# UDP 56700, TP-Link/kasa), never from ARP. Under the 2.4GHz IoT-SSID AP
# isolation most IoT addresses ARP-resolve to the access point's own MAC, so ARP
# will confidently tell you nonsense.
#
# Tuya devices have BOTH a tuya_local half and a cloud twin, and the dashboard
# shows whichever works. A device with one half down and the other up is
# DEGRADED, not DOWN -- it still works, and the repair is not urgent. Never
# delete either half.
#
# Run on nova:
#   bash /opt/nova-ha-dashboard/scripts/nova-device-doctor.sh           # report
#   bash /opt/nova-ha-dashboard/scripts/nova-device-doctor.sh --apply   # repair
#   bash /opt/nova-ha-dashboard/scripts/nova-device-doctor.sh --json    # machine-readable
#   sudo bash /opt/nova-ha-dashboard/scripts/nova-device-doctor.sh --install-timer
#
# --apply only ever does two things: delegates tier B to tuya-local-repair.sh
# (which stops HA, backs up core.config_entries, patches, restarts), and
# re-enables a tier E entry whose device now probes healthy. Tiers A, C, D and F
# are never touched automatically -- A is a code fix, C needs a human at the
# device, D is informational, F is intentional.

set -euo pipefail

APPLY=0
JSON=0
INSTALL_TIMER=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --json) JSON=1 ;;
    --install-timer) INSTALL_TIMER=1 ;;
    -h|--help) sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EXPECTATIONS="$SCRIPT_DIR/nova-device-expectations.json"
REPAIR="$SCRIPT_DIR/tuya-local-repair.sh"
CONFIG_DIR=/var/lib/homectrl/homeassistant/config

# ---------------------------------------------------------------- timer install
if [ "$INSTALL_TIMER" = "1" ]; then
  if [ "$(id -u)" != "0" ]; then echo "--install-timer needs root" >&2; exit 1; fi
  cat > /etc/systemd/system/nova-device-doctor.service <<UNIT
[Unit]
Description=Nova smart-home device doctor (report only)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
# Report only, on purpose. A scheduled run must never stop Home Assistant or
# rewrite config entries behind the user's back; repairs stay a deliberate act.
ExecStart=/usr/bin/env bash $SCRIPT_DIR/nova-device-doctor.sh
User=root
UNIT
  cat > /etc/systemd/system/nova-device-doctor.timer <<'UNIT'
[Unit]
Description=Run the Nova device doctor every 6 hours

[Timer]
# Devices drift when they power-cycle, not continuously, so a slow cadence is
# enough to catch a lost device within a few hours of it going missing.
OnCalendar=*-*-* 02,08,14,20:15:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now nova-device-doctor.timer
  echo "installed: nova-device-doctor.timer"
  systemctl list-timers nova-device-doctor.timer --no-pager
  exit 0
fi

if [ ! -f "$EXPECTATIONS" ]; then
  echo "missing $EXPECTATIONS" >&2; exit 1
fi

WORK=$(mktemp -d /tmp/device-doctor.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

log() { [ "$JSON" = "1" ] || echo "$@"; }

# ------------------------------------------------------------------- 1. gather
log "[1/4] reading Home Assistant state and registries..."
HA_TOKEN=$(docker exec nova-ha-dashboard sh -lc 'printf %s "$HA_TOKEN"')
export HA_TOKEN

docker exec -e HA_TOKEN="$HA_TOKEN" -i homeassistant python3 - > "$WORK/ha.json" <<'PY'
import json, os, pathlib, urllib.request
base = pathlib.Path('/config/.storage')
def store(name):
    return json.loads((base / name).read_text())['data']
req = urllib.request.Request('http://127.0.0.1:8123/api/states',
                             headers={'Authorization': 'Bearer ' + os.environ['HA_TOKEN']})
with urllib.request.urlopen(req, timeout=20) as r:
    states = json.loads(r.read())
print(json.dumps({
    'states': [{'entity_id': s['entity_id'], 'state': s['state'],
                'friendly_name': s.get('attributes', {}).get('friendly_name'),
                'source_reported_at': s.get('attributes', {}).get('source_reported_at')}
               for s in states],
    'entities': [{'entity_id': e.get('entity_id'), 'device_id': e.get('device_id'),
                  'config_entry_id': e.get('config_entry_id'), 'disabled_by': e.get('disabled_by')}
                 for e in store('core.entity_registry')['entities']],
    'devices': [{'id': d.get('id'), 'name': d.get('name_by_user') or d.get('name'),
                 'identifiers': d.get('identifiers'), 'config_entries': d.get('config_entries'),
                 'disabled_by': d.get('disabled_by')}
                for d in store('core.device_registry')['devices']],
    'entries': [{'entry_id': e.get('entry_id'), 'domain': e.get('domain'), 'title': e.get('title'),
                 'disabled_by': e.get('disabled_by'),
                 'host': (e.get('data') or {}).get('host'),
                 'device_id': (e.get('data') or {}).get('device_id')}
                for e in store('core.config_entries')['entries']],
}))
PY

# Protocol-level discovery. Runs inside the HA container because tinytuya,
# aiolifx and kasa already live there -- no new dependencies on the host.
log "[2/4] protocol discovery on the LAN (Tuya UDP 6666/6667, LIFX 56700, kasa)..."
docker exec -i homeassistant python3 - > "$WORK/lan.json" 2>"$WORK/lan.err" <<'PY'
import asyncio, json, socket, time

# --- Tuya: listen for the devices' own broadcasts. This is what sees through
# --- the IoT-SSID AP isolation; an active scan or ARP sweep does not.
tuya = {}
socks = []
for port in (6666, 6667):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('0.0.0.0', port))
        s.settimeout(0.5)
        socks.append(s)
    except OSError:
        pass  # another repair run may hold the port
import tinytuya
end = time.time() + 20
while time.time() < end:
    for s in socks:
        try:
            data, addr = s.recvfrom(4096)
        except (socket.timeout, OSError):
            continue
        payload = data[20:-8]
        try:
            text = payload.decode()
        except UnicodeDecodeError:
            try:
                text = tinytuya.decrypt_udp(data)
            except Exception:
                continue
        try:
            j = json.loads(text)
        except Exception:
            continue
        if j.get('gwId'):
            tuya[j['gwId']] = j.get('ip') or addr[0]
for s in socks:
    s.close()

# --- LIFX: the standard GetService broadcast; responders identify themselves.
lifx = []
try:
    GET_SERVICE = bytes.fromhex('24000034' + '00000000' + '00' * 24 + '02000000')
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(0.5)
    s.sendto(GET_SERVICE, ('255.255.255.255', 56700))
    end = time.time() + 5
    while time.time() < end:
        try:
            _, addr = s.recvfrom(1024)
        except socket.timeout:
            continue
        if addr[0] not in lifx:
            lifx.append(addr[0])
    s.close()
except Exception:
    pass

# --- TP-Link / Tapo
kasa_found = {}
try:
    import kasa
    async def go():
        found = await kasa.Discover.discover(timeout=6)
        out = {}
        for ip, dev in found.items():
            try:
                await dev.update()
                out[ip] = dev.alias
            except Exception:
                out[ip] = None
            finally:
                # kasa leaves aiohttp sessions open; without this the GC prints
                # pages of "Unclosed client session" over the report.
                try:
                    await dev.disconnect()
                except Exception:
                    pass
        return out
    kasa_found = asyncio.run(go())
except Exception:
    pass

print(json.dumps({'tuya': tuya, 'lifx': lifx, 'kasa': kasa_found}))
PY
# Discovery noise is swallowed above, but a discovery that produced nothing
# usable is a real failure and must not be mistaken for "every device is gone".
if ! python3 -c "import json;d=json.load(open('$WORK/lan.json'));assert isinstance(d.get('tuya'),dict)" 2>/dev/null; then
  echo "discovery failed -- refusing to report devices as missing on bad data:" >&2
  tail -20 "$WORK/lan.err" >&2
  exit 1
fi

# Reservation sweep. Ping is only ever used to answer "is something answering at
# the address we reserved" -- never to identify what that something is.
log "[3/4] checking reserved addresses..."
python3 - "$EXPECTATIONS" > "$WORK/ping.json" <<'PY'
import json, subprocess, sys, concurrent.futures
exp = json.load(open(sys.argv[1]))
ips = list(exp['reservations'])
def alive(ip):
    return ip, subprocess.call(['ping', '-c', '2', '-W', '2', ip],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
    print(json.dumps(dict(pool.map(alive, ips))))
PY

# ----------------------------------------------------------------- 2. classify
log "[4/4] classifying..."
python3 - "$WORK/ha.json" "$WORK/lan.json" "$WORK/ping.json" "$EXPECTATIONS" > "$WORK/report.json" <<'PY'
import datetime, json, re, sys

ha = json.load(open(sys.argv[1]))
lan = json.load(open(sys.argv[2]))
ping = json.load(open(sys.argv[3]))
exp = json.load(open(sys.argv[4]))

entries = {e['entry_id']: e for e in ha['entries']}
devices = {d['id']: d for d in ha['devices']}
ent_reg = {e['entity_id']: e for e in ha['entities'] if e.get('entity_id')}
states = {s['entity_id']: s for s in ha['states']}
lan_tuya = lan.get('tuya', {})

WATCHED = ('light.', 'switch.', 'climate.', 'sensor.', 'lock.', 'time.', 'cover.', 'fan.')
DEAD = ('unavailable', 'unknown')


def tuya_id_for(entity_id):
    """Tuya device id from either half of a twin: the tuya_local entry's data,
    or the MQTT bridge's `tuya_mobile_<devId>` device identifier."""
    reg = ent_reg.get(entity_id) or {}
    dev = devices.get(reg.get('device_id')) or {}
    for ident in dev.get('identifiers') or []:
        if len(ident) == 2 and isinstance(ident[1], str):
            m = re.match(r'tuya_mobile_(.+)$', ident[1])
            if m:
                return m.group(1)
    for eid in dev.get('config_entries') or []:
        did = (entries.get(eid) or {}).get('device_id')
        if did:
            return did
    return (entries.get(reg.get('config_entry_id')) or {}).get('device_id')


def entry_for(entity_id):
    reg = ent_reg.get(entity_id) or {}
    if reg.get('config_entry_id') and reg['config_entry_id'] in entries:
        return entries[reg['config_entry_id']]
    dev = devices.get(reg.get('device_id')) or {}
    for eid in dev.get('config_entries') or []:
        if eid in entries:
            return entries[eid]
    return {}


def report_age(entity_id):
    raw = (states.get(entity_id) or {}).get('source_reported_at')
    if not raw:
        return None
    try:
        t = datetime.datetime.strptime(raw, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return None
    return int((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds())


def twin_healthy(tuya_id, this_entity):
    """Is the OTHER half of this Tuya twin working? Decides degraded vs down."""
    if not tuya_id:
        return False
    for eid in states:
        if eid == this_entity or not eid.startswith(WATCHED):
            continue
        if tuya_id_for(eid) == tuya_id and states[eid]['state'] not in DEAD:
            return True
    return False


DEVICE_DOMAINS = set(exp.get('device_domains', []))

findings = []
out_of_scope = []
for eid, s in sorted(states.items()):
    if not eid.startswith(WATCHED) or s['state'] not in DEAD:
        continue

    name = s.get('friendly_name') or eid
    tuya_id = tuya_id_for(eid)
    entry = entry_for(eid)
    domain = entry.get('domain')

    # Only grade things this tool can actually probe. Without this an HA backup
    # sensor gets reported as "off the network", which is nonsense and trains
    # everyone to ignore the report.
    if domain not in DEVICE_DOMAINS:
        out_of_scope.append({'entity_id': eid, 'name': name, 'domain': domain})
        continue
    # Nova's own MQTT helpers are not devices; the bridge's cloud twins are.
    if domain == 'mqtt' and not tuya_id:
        out_of_scope.append({'entity_id': eid, 'name': name, 'domain': 'mqtt (not a device)'})
        continue

    # Unavailable for a known reason, and may come back.
    if eid in exp.get('expected_unavailable_entities', {}):
        findings.append({'tier': 'F', 'severity': 'expected', 'entity_id': eid, 'name': name,
                         'reason': exp['expected_unavailable_entities'][eid], 'fixable': False})
        continue
    age = report_age(eid)
    on_lan = bool(tuya_id and tuya_id in lan_tuya)
    lan_ip = lan_tuya.get(tuya_id) if tuya_id else None

    # F -- supposed to be unavailable. Checked first so nothing below can
    # propose a repair for hardware that is intentionally gone.
    if eid in exp.get('retired_entities', {}):
        findings.append({'tier': 'F', 'severity': 'expected', 'entity_id': eid, 'name': name,
                         'reason': exp['retired_entities'][eid], 'fixable': False})
        continue
    if tuya_id and tuya_id in exp.get('retired_tuya_device_ids', {}):
        findings.append({'tier': 'F', 'severity': 'expected', 'entity_id': eid, 'name': name,
                         'reason': exp['retired_tuya_device_ids'][tuya_id], 'fixable': False})
        continue

    severity = 'degraded' if twin_healthy(tuya_id, eid) else 'down'

    # E -- an earlier failure disabled the entry and nobody turned it back on.
    if entry.get('disabled_by'):
        findings.append({'tier': 'E', 'severity': severity, 'entity_id': eid, 'name': name,
                         'entry_id': entry.get('entry_id'),
                         'reason': f"config entry '{entry.get('title')}' is disabled by {entry['disabled_by']}"
                                   + (f"; device IS on the LAN at {lan_ip}" if on_lan else "; device not seen on the LAN"),
                         'fixable': on_lan})
        continue

    # A -- device is present and reporting, but the entity is unavailable. This
    # is the bridge's own gating logic, not a network fault. Do not power-cycle.
    if on_lan or (age is not None and age < 1800):
        evidence = []
        if on_lan:
            evidence.append(f"broadcasting on the LAN at {lan_ip}")
        if age is not None:
            evidence.append(f"last reported {age}s ago")
        findings.append({'tier': 'A', 'severity': severity, 'entity_id': eid, 'name': name,
                         'reason': "device is present (" + ", ".join(evidence)
                                   + ") but the entity is unavailable -- suspect an availability/"
                                     "freshness gate in the bridge, not the network",
                         'fixable': False})
        continue

    # B -- tuya_local entry stranded by an address roam or a rotated local_key.
    if domain == 'tuya_local':
        if on_lan and entry.get('host') != lan_ip:
            reason = f"tuya_local host {entry.get('host')} but device is at {lan_ip}"
        elif on_lan:
            reason = f"tuya_local host {entry.get('host')} is correct but the entity is down -- local_key likely rotated"
        else:
            reason = None
        if reason:
            findings.append({'tier': 'B', 'severity': severity, 'entity_id': eid, 'name': name,
                             'reason': reason, 'fixable': True})
            continue

    # C -- nothing answered on any protocol. Genuinely gone.
    sleepy = exp.get('sleepy_tuya_device_ids', {})
    if tuya_id in sleepy:
        findings.append({'tier': 'C', 'severity': 'expected', 'entity_id': eid, 'name': name,
                         'reason': f"battery/sleepy device ({sleepy[tuya_id]}); silence is normal, not proof it is gone",
                         'fixable': False})
        continue
    findings.append({'tier': 'C', 'severity': severity, 'entity_id': eid, 'name': name,
                     'reason': "no response on any discovery protocol -- device appears genuinely off the "
                               "network; needs power or WiFi attention",
                     'fixable': False})

# D -- address drift. Independent of whether the entity is currently unavailable:
# a device on the wrong address is a fault waiting to happen.
title_to_ip = {}
for e in ha['entries']:
    if e.get('domain') == 'tuya_local' and e.get('device_id') in lan_tuya:
        title_to_ip[e.get('title')] = lan_tuya[e['device_id']]
reserved_for = {name: ip for ip, name in exp['reservations'].items()}
for title, actual in sorted(title_to_ip.items()):
    want = reserved_for.get(title)
    if want and actual != want:
        findings.append({'tier': 'D', 'severity': 'degraded', 'entity_id': None, 'name': title,
                         'reason': f"reserved {want} but currently at {actual} -- reservations only apply on "
                                   f"DHCP DISCOVER, so it will move when it next power-cycles",
                         'fixable': False})

reservation_report = []
for ip, name in sorted(exp['reservations'].items()):
    alive = ping.get(ip, False)
    if not alive and ip not in exp.get('pre_staged', []):
        reservation_report.append({'ip': ip, 'name': name, 'alive': False})
    elif alive:
        reservation_report.append({'ip': ip, 'name': name, 'alive': True})

print(json.dumps({
    'generated_at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'findings': findings,
    'out_of_scope': out_of_scope,
    'reservations': reservation_report,
    'pre_staged': exp.get('pre_staged', []),
    'discovered': {'tuya': len(lan_tuya), 'lifx': len(lan.get('lifx', [])), 'kasa': len(lan.get('kasa', {}))},
}, indent=2))
PY

if [ "$JSON" = "1" ]; then
  cat "$WORK/report.json"
  exit 0
fi

# ------------------------------------------------------------------- 3. report
TIER_NAMES="A=bridge-gate B=tuya-drift C=off-network D=address-drift E=disabled F=retired"
echo
echo "=== Nova device doctor ==="
python3 - "$WORK/report.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
d = r['discovered']
print(f"discovered on LAN: {d['tuya']} Tuya, {d['lifx']} LIFX, {d['kasa']} TP-Link/kasa")

missing = [x for x in r['reservations'] if not x['alive']]
total = len(r['reservations'])
print(f"\nreserved addresses: {total - len(missing)}/{total} answering"
      + (f" ({len(r['pre_staged'])} pre-staged, not expected to answer)" if r['pre_staged'] else ""))
for m in missing:
    print(f"  QUIET     {m['ip']:16} {m['name']}")

order = {'down': 0, 'degraded': 1}
real = sorted([f for f in r['findings'] if f['severity'] != 'expected'],
              key=lambda x: (order.get(x['severity'], 3), x['tier']))
expected = [f for f in r['findings'] if f['severity'] == 'expected']

if not real:
    print("\nno faults. every device is where it should be.")
else:
    print(f"\n{len(real)} fault(s) needing attention:")
    for f in real:
        print(f"  {f['tier']}/{f['severity']:11} {f['name']}")
        print(f"                 {f['reason']}")

if expected:
    print(f"\nexpected ({len(expected)}) -- unavailable on purpose, not repaired:")
    for f in expected:
        print(f"  {f['name']}: {f['reason']}")

if r['out_of_scope']:
    print(f"\nnot classified ({len(r['out_of_scope'])}) -- unavailable, but not devices this tool can probe:")
    for o in r['out_of_scope']:
        print(f"  {o['domain'] or 'no integration':22} {o['entity_id']}")
PY
echo
echo "tiers: $TIER_NAMES"

# --------------------------------------------------------- 4. emit + optionally fix
# Feed the monitoring pipeline so a scheduled run is visible in Grafana rather
# than dying silently in the journal.
if command -v nova-event >/dev/null 2>&1; then
  python3 - "$WORK/report.json" <<'PY' | while IFS= read -r args; do
import json, sys
for f in json.load(open(sys.argv[1]))['findings']:
    if f['severity'] == 'expected':
        continue
    print(f"{f['tier']}|{f['severity']}|{f['entity_id'] or f['name']}")
PY
    IFS='|' read -r tier sev target <<< "$args"
    nova-event --service devices --event degraded --source watchdog \
      --detail "entity=$target" --detail "tier=$tier" --detail "severity=$sev" >/dev/null 2>&1 || true
  done
fi

FIXABLE=$(python3 -c "import json;print(sum(1 for f in json.load(open('$WORK/report.json'))['findings'] if f.get('fixable')))")
if [ "$FIXABLE" = "0" ]; then
  echo "nothing here is automatically repairable."
  exit 0
fi
if [ "$APPLY" != "1" ]; then
  echo "$FIXABLE finding(s) are automatically repairable. Re-run with --apply."
  exit 0
fi

echo
echo "applying..."

# Tier B -> the existing repair tool. It already proves every host/key candidate
# with a live tinytuya call and backs up core.config_entries before writing.
if python3 -c "import json,sys; sys.exit(0 if any(f['tier']=='B' and f.get('fixable') for f in json.load(open('$WORK/report.json'))['findings']) else 1)"; then
  echo "-> tuya_local drift: delegating to tuya-local-repair.sh --apply"
  bash "$REPAIR" --apply
fi

# Tier E -> re-enable, but only where the device is provably back on the LAN.
python3 - "$WORK/report.json" <<'PY' | while IFS= read -r entry_id; do
import json, sys
for f in json.load(open(sys.argv[1]))['findings']:
    if f['tier'] == 'E' and f.get('fixable') and f.get('entry_id'):
        print(f['entry_id'])
PY
  echo "-> re-enabling config entry $entry_id"
  curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" -H 'Content-Type: application/json' \
    -d '{"disabled_by": null}' \
    "http://127.0.0.1:8123/api/config/config_entries/entry/$entry_id/disable" >/dev/null || \
    echo "   (failed; re-enable it from the HA UI)"
done

echo "done. re-run without --apply to confirm."
