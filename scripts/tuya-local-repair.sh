#!/usr/bin/env bash
# Detect and repair drifted tuya_local devices on nova.
#
# Tuya devices drift in two ways: they roam to a new DHCP address, and a
# re-pair in the Tuya app rotates the device's local_key. Either one strands
# the tuya_local config entry (entity goes unavailable; the dashboard falls
# back to the cloud twin). This script re-derives the truth and patches the
# stranded entries:
#
#   1. fresh local keys come from the Tuya mobile API (the tuya-mobile-mqtt-
#      bridge container already holds the account credentials),
#   2. current LAN IPs come from the devices' own UDP discovery broadcasts
#      (ports 6666/6667),
#   3. every proposed host/key change is proven with a live tinytuya status
#      call before it is written.
#
# Run on nova:
#   bash /opt/nova-ha-dashboard/scripts/tuya-local-repair.sh          # report only
#   bash /opt/nova-ha-dashboard/scripts/tuya-local-repair.sh --apply  # fix + restart HA
#
# --apply stops Home Assistant, backs up core.config_entries into
# /var/lib/homectrl/homeassistant/config/backups/, patches the entries, and
# starts Home Assistant again. Entries whose device is not on the LAN (no UDP
# broadcast) are left alone — the cloud twin keeps covering them.

set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

CONFIG_DIR=/var/lib/homectrl/homeassistant/config
WORK=$(mktemp -d /tmp/tuya-repair.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

echo "[1/3] fetching fresh local keys from the Tuya mobile API..."
docker exec -w /app -i tuya-mobile-mqtt-bridge python3 - > "$WORK/keys.json" <<'PY'
from bridge import TuyaMobileApi
import os, json
api = TuyaMobileApi(os.environ['TUYA_EMAIL'], os.environ['TUYA_PASSWORD'])
api.login()
out = {}
for group in api._api('tuya.m.location.list'):
    for dev in api._api('tuya.m.my.group.device.list', extra_params={'gid': str(group['groupId'])}):
        out[dev['devId']] = dev.get('localKey')
print(json.dumps(out))
PY

echo "[2/3] listening for LAN UDP discovery broadcasts (20s)..."
docker exec -i homeassistant python3 - > "$WORK/lan.json" <<'PY'
import json, socket, time
found = {}
socks = []
for port in (6666, 6667):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('0.0.0.0', port))
    s.settimeout(0.5)
    socks.append(s)
import tinytuya
end = time.time() + 20
while time.time() < end:
    for s in socks:
        try:
            data, addr = s.recvfrom(4096)
        except socket.timeout:
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
            found[j['gwId']] = j.get('ip')
print(json.dumps(found))
PY

echo "[3/3] comparing tuya_local entries against reality..."
docker cp "$WORK/keys.json" homeassistant:/tmp/tuya_repair_keys.json >/dev/null
docker cp "$WORK/lan.json" homeassistant:/tmp/tuya_repair_lan.json >/dev/null
docker exec -i homeassistant python3 - > "$WORK/plan.json" <<'PY'
import json, pathlib, tinytuya
keys = json.load(open('/tmp/tuya_repair_keys.json'))
lan = json.load(open('/tmp/tuya_repair_lan.json'))
entries = json.loads(pathlib.Path('/config/.storage/core.config_entries').read_text())['data']['entries']

def probe(dev_id, ip, key, version):
    try:
        d = tinytuya.OutletDevice(dev_id, ip, key)
        d.set_version(float(version))
        d.set_socketTimeout(4)
        status = d.status()
        return isinstance(status, dict) and 'dps' in status
    except Exception:
        return False

plan = []
for e in entries:
    if e.get('domain') != 'tuya_local':
        continue
    data = e.get('data') or {}
    dev_id = data.get('device_id')
    title = e.get('title')
    version = data.get('protocol_version') or 3.3
    lan_ip = lan.get(dev_id)
    cloud_key = keys.get(dev_id)
    if not lan_ip:
        plan.append({'title': title, 'action': 'skip', 'reason': 'not broadcasting on LAN (cloud twin covers it)'})
        continue
    want_host = lan_ip
    want_key = cloud_key or data.get('local_key')
    if data.get('host') == want_host and data.get('local_key') == want_key:
        ok = probe(dev_id, want_host, want_key, version)
        plan.append({'title': title, 'action': 'ok' if ok else 'attention',
                     'reason': 'entry matches reality' if ok else 'entry matches cloud data but device did not answer'})
        continue
    if probe(dev_id, want_host, want_key, version):
        plan.append({'title': title, 'action': 'fix', 'entry_id': e['entry_id'],
                     'host': want_host, 'key_changes': data.get('local_key') != want_key,
                     'reason': f"host {data.get('host')} -> {want_host}" + (', key rotated' if data.get('local_key') != want_key else '')})
    else:
        plan.append({'title': title, 'action': 'attention',
                     'reason': f'candidate {want_host} + cloud key did not verify; not touching it'})
print(json.dumps(plan))
PY
docker exec homeassistant rm -f /tmp/tuya_repair_keys.json /tmp/tuya_repair_lan.json

python3 - "$WORK/plan.json" <<'PY'
import json, sys
plan = json.load(open(sys.argv[1]))
for p in plan:
    print(f"  {p['action'].upper():9} {p['title']}: {p['reason']}")
PY

FIXES=$(python3 -c "import json,sys; print(sum(1 for p in json.load(open('$WORK/plan.json')) if p['action']=='fix'))")
if [ "$FIXES" = "0" ]; then
  echo "nothing to repair."
  exit 0
fi
if [ "$APPLY" != "1" ]; then
  echo "$FIXES entry(ies) need repair. Re-run with --apply to fix (stops/starts Home Assistant)."
  exit 0
fi

echo "applying: stopping Home Assistant..."
IMG=$(docker inspect homeassistant --format '{{.Config.Image}}')
docker stop homeassistant >/dev/null
STAMP=$(date +%Y%m%d-%H%M%S)
docker run --rm -i \
  -v "$CONFIG_DIR":/config \
  -v "$WORK/keys.json":/keys.json:ro \
  -v "$WORK/plan.json":/plan.json:ro \
  -e STAMP="$STAMP" "$IMG" python3 - <<'PY'
import json, os, pathlib, shutil
stamp = os.environ['STAMP']
cfg = pathlib.Path('/config/.storage/core.config_entries')
backups = pathlib.Path('/config/backups'); backups.mkdir(exist_ok=True)
shutil.copy2(cfg, backups / f'core.config_entries.{stamp}')
keys = json.load(open('/keys.json'))
plan = {p['entry_id']: p for p in json.load(open('/plan.json')) if p['action'] == 'fix'}
doc = json.loads(cfg.read_text())
for e in doc['data']['entries']:
    p = plan.get(e.get('entry_id'))
    if not p:
        continue
    e['data']['host'] = p['host']
    fresh = keys.get(e['data'].get('device_id'))
    if fresh:
        e['data']['local_key'] = fresh
    print('patched:', e.get('title'), '->', p['host'])
cfg.write_text(json.dumps(doc, indent=2, ensure_ascii=False))
print('backup:', f'core.config_entries.{stamp}')
PY
docker start homeassistant >/dev/null
echo "Home Assistant restarted. Give it a minute, then check the dashboard."
