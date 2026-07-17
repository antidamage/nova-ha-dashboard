#!/usr/bin/env bash
#
# bootstrap.sh — turn a fresh Ubuntu 24.04 VM into the Nova hosting appliance
# from a snapshot-nova.sh staging directory. Idempotent; safe to re-run.
#
#   sudo -v && bash ops/vm/bootstrap.sh /path/to/staging [--ha-url URL]
#
# --ha-url overrides HA_URL in .env.local for PARALLEL-RUN PHASE A, where this
# VM's dashboard is pointed at nova's still-live HA (http://192.168.8.14:8123)
# and the VM's own HA stack stays stopped — full plumbing rehearsal with zero
# device contention. Omit it (or pass --ha-url http://127.0.0.1:8123) for the
# real thing.
#
# Deliberate defaults for a SAFE first boot alongside the live house:
#   * stack containers are created with --restart=no and left STOPPED
#   * scraper crons are installed COMMENTED OUT
#   * nova-release cron pins NOVA_UPDATE_BRANCH=vm-appliance (flip to main
#     after the post-soak merge)
# Cutover promotes all three (see ops/vm/README.md runbook).
set -euo pipefail

STAGING="${1:?usage: bootstrap.sh <staging-dir> [--ha-url URL]}"
HA_URL_OVERRIDE=""
[ "${2:-}" = "--ha-url" ] && HA_URL_OVERRIDE="${3:?--ha-url needs a value}"

APP_ROOT=/opt/nova-ha-dashboard
REPO_URL="${NOVA_REPO_URL:-https://github.com/antidamage/nova-ha-dashboard.git}"
BRANCH="${NOVA_UPDATE_BRANCH:-vm-appliance}"
STACK_CONTAINERS=(mosquitto matter-server homeassistant tuya-mobile-mqtt-bridge)

log() { printf '\n\033[36m== %s ==\033[0m\n' "$*"; }

log "base packages"
sudo apt-get update -qq
sudo apt-get install -y -qq docker.io avahi-daemon git rsync curl jq python3
sudo systemctl enable --now docker avahi-daemon
sudo usermod -aG docker "$USER" || true

log "restore state trees"
sudo mkdir -p /var/lib/homectrl
sudo rsync -aH "$STAGING/state/homectrl/homeassistant/" /var/lib/homectrl/homeassistant/
sudo rsync -aH "$STAGING/state/homectrl/matter-server/" /var/lib/homectrl/matter-server/
sudo rsync -aH "$STAGING/state/mosquitto-etc/" /etc/mosquitto/
sudo rsync -aH "$STAGING/state/mosquitto-var/" /var/lib/mosquitto/

log "app root: clone + shared state (nova-release migrate builds the farm)"
if [ ! -d "$APP_ROOT/.git" ] && [ ! -d "$APP_ROOT/repo" ]; then
  sudo mkdir -p "$APP_ROOT" && sudo chown "$USER:$USER" "$APP_ROOT"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_ROOT"
fi
rsync -aH "$STAGING/state/app/data/" "$APP_ROOT/data/"
install -m 0600 "$STAGING/state/app/.env.local" "$APP_ROOT/.env.local"
if [ -n "$HA_URL_OVERRIDE" ]; then
  sed -i "s|^HA_URL=.*|HA_URL=$HA_URL_OVERRIDE|" "$APP_ROOT/.env.local"
  echo "  HA_URL overridden for parallel-run: $HA_URL_OVERRIDE"
fi

log "build runtime image (plain, non-VAAPI)"
sudo docker build -t nova-ha-dashboard:plain -f "$APP_ROOT/ops/Dockerfile" "$APP_ROOT/ops/"

log "build the app (flat install; nova-release migrate erects the farm later)"
# Same build container nova-release uses; artifacts run unchanged on trixie.
current_sha="$(git -C "$APP_ROOT" log -1 --format=%H 2>/dev/null || echo dev)"
if [ ! -d "$APP_ROOT/.next" ] || [ "$(cat "$APP_ROOT/.nova-built-sha" 2>/dev/null)" != "$current_sha" ]; then
  sudo docker run --rm -v "$APP_ROOT":/app -w /app node:20-bookworm-slim \
    sh -c "npm ci --no-audit --no-fund && npm run build"
  printf '%s' "$current_sha" > "$APP_ROOT/.nova-built-sha"
fi

log "pull pinned images (docker create does not auto-pull)"
awk 'NF>=2 {print ($3=="" ? $2 : $3)}' "$STAGING/docker/image-digests.txt" | sort -u \
  | while read -r ref; do sudo docker pull -q "$ref"; done

log "recreate stack containers from nova's specs (created STOPPED, --restart=no)"
# Idempotency: `docker create --name X` errors if X already exists (e.g. a
# re-run bootstrap after a partial failure, or a disaster-recovery replay).
# NOVA_VM_EXISTING_CONTAINERS lets the Python generator below skip names
# docker already knows about instead of failing.
NOVA_VM_EXISTING_CONTAINERS="$(sudo docker ps -a --format '{{.Names}}')" \
  python3 - "$STAGING" <<'PY' | while IFS= read -r cmd; do echo "  + $cmd"; eval "sudo $cmd"; done
import json, shlex, sys, os
staging = sys.argv[1]
order = ["mosquitto", "matter-server", "homeassistant", "tuya-mobile-mqtt-bridge"]
digests = {}
try:
    for line in open(os.path.join(staging, "docker", "image-digests.txt")):
        parts = line.split()
        if len(parts) >= 3 and parts[2]:
            digests[parts[0]] = parts[2]
except OSError:
    pass
existing = set(os.environ.get("NOVA_VM_EXISTING_CONTAINERS", "").splitlines())
for name in order:
    if name in existing:
        print(f"  (skip {name}: container already exists)", file=sys.stderr)
        continue
    path = os.path.join(staging, "docker", f"{name}.json")
    if not os.path.exists(path):
        continue
    spec = json.load(open(path))[0]
    cfg, host = spec["Config"], spec["HostConfig"]
    image = digests.get(name) or cfg["Image"]  # pin digest when known
    args = ["docker", "create", "--name", name, "--restart=no"]
    if host.get("NetworkMode") == "host":
        args += ["--network", "host"]
    if host.get("Privileged"):
        args += ["--privileged"]
    for cap in host.get("CapAdd") or []:
        args += ["--cap-add", cap]
    for dev in host.get("Devices") or []:
        args += ["--device", dev["PathOnHost"] + ":" + dev["PathInContainer"]]
    for m in spec.get("Mounts", []):
        if m["Type"] == "bind":
            args += ["-v", m["Source"] + ":" + m["Destination"] + ("" if m.get("RW", True) else ":ro")]
        elif m["Type"] == "volume":
            args += ["-v", m["Name"] + ":" + m["Destination"]]
    envfile = os.path.join(staging, "docker", f"{name}.env")
    with open(envfile, "w") as f:
        f.write("\n".join(cfg.get("Env") or []) + "\n")
    os.chmod(envfile, 0o600)
    args += ["--env-file", envfile]
    args += [image]
    if cfg.get("Cmd"):
        args += cfg["Cmd"]
    print(" ".join(shlex.quote(a) for a in args))
PY

log "dashboard systemd unit (VM variant)"
sudo install -m 0644 "$APP_ROOT/ops/vm/nova-ha-dashboard.service" /etc/systemd/system/nova-ha-dashboard.service
sudo systemctl daemon-reload
echo "  (unit installed but NOT enabled — parallel-run/cutover decides when)"

log "self-updater + power helper (branch-pinned cron)"
mkdir -p "$HOME/.local/bin" "$APP_ROOT/data/update/control"
install -m 0755 "$APP_ROOT/ops/nova-release" "$HOME/.local/bin/nova-release"
install -m 0755 "$APP_ROOT/ops/nova-system"  "$HOME/.local/bin/nova-system"
# NOTE: `crontab -l` exits 1 (with no stderr, since redirected) when the user
# has no crontab yet — the normal state on a fresh VM. Under `set -e`, letting
# that propagate would abort the subshell BEFORE the echo lines run, silently
# installing an empty crontab. `|| true` is load-bearing here, not decoration.
existing_cron="$(crontab -l 2>/dev/null || true)"
( printf '%s\n' "$existing_cron" | grep -vE "nova-release process|nova-system process" ;
  echo "* * * * * NOVA_UPDATE_BRANCH=$BRANCH $HOME/.local/bin/nova-release process >> $HOME/nova-release-cron.log 2>&1" ;
  echo "* * * * * $HOME/.local/bin/nova-system process >> $HOME/nova-system-cron.log 2>&1" ) \
  | grep -v '^$' | crontab -
crontab -l | grep -q 'nova-release process' || { echo "FATAL: nova-release cron did not install" >&2; exit 1; }

log "scraper crons (installed COMMENTED — enable at cutover)"
if [ -f "$STAGING/crontab.txt" ]; then
  existing_cron="$(crontab -l 2>/dev/null || true)"
  ( printf '%s\n' "$existing_cron" ;
    grep -E 'run-(powershop|gymmaster)' "$STAGING/crontab.txt" | grep -v '^#' | sed 's/^/#CUTOVER# /' ) \
    | grep -v '^$' | awk '!seen[$0]++' | crontab -
fi

log "tailscale (manual auth step)"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
echo "  run interactively when ready:  sudo tailscale up --hostname nova-vm"

log "bootstrap complete"
echo "Next: ops/vm/README.md runbook — parallel-run Phase A, then verify with ops/verify-vm.sh"
