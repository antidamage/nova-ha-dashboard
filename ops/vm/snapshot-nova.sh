#!/usr/bin/env bash
#
# snapshot-nova.sh — capture everything the VM appliance needs from the live
# nova host into a staging directory. READ-ONLY against nova; never stops or
# modifies anything there.
#
#   bash ops/vm/snapshot-nova.sh /path/to/staging [user@host]
#
# The staging dir then feeds ops/vm/bootstrap.sh inside the VM. Run it twice:
# once for the parallel-run build (HA live = its DB copy is crash-consistent,
# fine for rehearsal), and once more during the cutover window AFTER nova's
# stack is stopped (that delta pass is the authoritative state).
#
# SECURITY: the result contains .env.local and full `docker inspect` dumps
# (container env vars include live credentials). Treat the staging dir as a
# secret store; keep it off shared paths and delete after bootstrap.
set -euo pipefail

# Real user@host and key name: see PRIVATEREF.md#1.1 and #2.
DEST="${1:?usage: snapshot-nova.sh <staging-dir> <user@host>}"
NOVA="${2:?usage: snapshot-nova.sh <staging-dir> <user@host> (see PRIVATEREF.md#1.1)}"
SSH_KEY="${NOVA_SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes)
RS=(rsync -aH --delete -e "ssh -i $SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes" --rsync-path="sudo rsync")

# Stack containers that move to the VM. linux-voice-assistant is EXCLUDED on
# purpose: it is bound to nova's physical mic/speakers and stays behind.
CONTAINERS=(homeassistant matter-server mosquitto tuya-mobile-mqtt-bridge nova-ha-dashboard)

mkdir -p "$DEST"/{state,docker}
chmod 700 "$DEST"

echo "== rsync state trees (sudo rsync on the nova side) =="
mkdir -p "$DEST/state/homectrl" "$DEST/state/mosquitto-etc" "$DEST/state/mosquitto-var" "$DEST/state/app"
"${RS[@]}" "$NOVA:/var/lib/homectrl/homeassistant/"  "$DEST/state/homectrl/homeassistant/"
"${RS[@]}" "$NOVA:/var/lib/homectrl/matter-server/"  "$DEST/state/homectrl/matter-server/"
"${RS[@]}" "$NOVA:/etc/mosquitto/"                   "$DEST/state/mosquitto-etc/"
"${RS[@]}" "$NOVA:/var/lib/mosquitto/"               "$DEST/state/mosquitto-var/"
# App shared state only — releases/repo are rebuilt by nova-release inside the
# VM; the rolling DVR segments are ephemeral and excluded.
"${RS[@]}" --exclude 'camera/' "$NOVA:/opt/nova-ha-dashboard/data/" "$DEST/state/app/data/"
"${RS[@]}" "$NOVA:/opt/nova-ha-dashboard/.env.local" "$DEST/state/app/.env.local"

echo "== container specs (docker inspect -> files; contains secrets) =="
for c in "${CONTAINERS[@]}"; do
  "${SSH[@]}" "$NOVA" "docker inspect $c" > "$DEST/docker/$c.json" 2>/dev/null \
    || echo "  (container $c not present — skipped)"
done

echo "== image digests (pin the VM to nova's exact image versions) =="
# nova's login shell is fish — pipe the script into bash explicitly.
"${SSH[@]}" "$NOVA" bash -s > "$DEST/docker/image-digests.txt" <<'RSCRIPT'
for c in homeassistant matter-server mosquitto tuya-mobile-mqtt-bridge; do
  img=$(docker inspect -f "{{.Config.Image}}" "$c" 2>/dev/null) || continue
  dig=$(docker image inspect -f "{{index .RepoDigests 0}}" "$img" 2>/dev/null || echo "")
  echo "$c $img $dig"
done
RSCRIPT

echo "== crontab (reference; bootstrap installs its own, scrapers stay OFF until cutover) =="
"${SSH[@]}" "$NOVA" 'crontab -l' > "$DEST/crontab.txt" 2>/dev/null || true

date -u +%Y-%m-%dT%H:%M:%SZ > "$DEST/.snapshot-at"
echo "Snapshot complete: $DEST ($(du -sh "$DEST" 2>/dev/null | cut -f1))"
