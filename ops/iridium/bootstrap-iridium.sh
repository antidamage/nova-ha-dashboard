#!/usr/bin/env bash
#
# bootstrap-iridium.sh — stand the Nova hosting role up on iridium as bare metal.
#
#   bash ops/iridium/bootstrap-iridium.sh /path/to/staging
#
# This is a thin orchestrator over ops/vm/bootstrap.sh, which already knows how
# to restore state, build the runtime image, build the app, pull pinned images,
# recreate the stack containers STOPPED, and install the self-updater crons.
# Everything below it is the delta that makes iridium different from the VM:
#
#   * the iridium dashboard unit (docker-level memory caps, no camera devices)
#   * Nova's own Caddy on :443 reading /etc/caddy/nova.Caddyfile — deliberately
#     NOT /etc/caddy/Caddyfile, which belongs to iridium's existing user-scoped
#     OpenClaw caddy.service on :8443
#   * a household TLS certificate for iridium's names instead of nova-vm's
#   * the iridium.local mDNS compat alias (see nova-avahi-alias.service)
#
# Deliberately conservative, exactly like the VM bootstrap: stack containers are
# created STOPPED with --restart=no and nothing is enabled. The cutover runbook
# in README.md decides when the house actually moves.
#
# Safe to re-run.
set -euo pipefail

STAGING="${1:?usage: bootstrap-iridium.sh <staging-dir>}"
APP_ROOT=/opt/nova-ha-dashboard
HERE="$(cd "$(dirname "$0")" && pwd)"
IRIDIUM_IP="${NOVA_IRIDIUM_IP:-192.168.8.20}"
TLS_DIR="$APP_ROOT/data/nova-dashboard-tls"

log() { printf '\n\033[36m== %s ==\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

log "pre-flight"
[ -d "$STAGING" ] || fail "staging dir not found: $STAGING"
command -v docker >/dev/null || fail "docker is not installed"
docker ps >/dev/null 2>&1 || fail "cannot talk to docker as $USER — is '$USER' in the docker group, and is this a fresh login session?"
command -v mkcert >/dev/null || fail "mkcert not found; needed to reissue the household certificate"

# Nova wants these. Refuse to trample anything already listening — the whole
# point of choosing iridium was that they were free.
for port in 80 443 8123 1883 5580 18554 18555; do
  if ss -tlnH "sport = :$port" 2>/dev/null | grep -q .; then
    fail "port $port is already in use on this host; resolve before bootstrapping"
  fi
done
echo "  ports 80/443/8123/1883/5580/18554/18555 are free"

avail_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
[ "$avail_kb" -gt 41943040 ] || fail "less than 40 GB free on / (have $((avail_kb/1024/1024)) GB)"
echo "  disk: $((avail_kb/1024/1024)) GB free on /"

log "shared bootstrap (state restore, image build, app build, containers STOPPED)"
# Call the copy sitting next to THIS script, not $APP_ROOT/ops/vm/bootstrap.sh:
# on a fresh host $APP_ROOT is empty until that script's own `git clone` runs, so
# referencing it there is a chicken-and-egg failure. Staging the ops/ tree and
# running from it works on both a fresh and an already-populated host.
SHARED="$HERE/../vm/bootstrap.sh"
[ -f "$SHARED" ] || fail "shared bootstrap not found at $SHARED — stage the whole ops/ tree, not just ops/iridium/"
# main, not the VM's old vm-appliance pin: that merge happened 2026-07-14.
# NOVA_STAGE_ONLY=1 keeps the self-updater crons commented: this host is staged
# beside a still-live Nova, and two nova-release loops on one branch would both
# try to build and restart a dashboard. Cutover uncomments them.
NOVA_UPDATE_BRANCH=main NOVA_STAGE_ONLY="${NOVA_STAGE_ONLY:-1}" bash "$SHARED" "$STAGING"

log "iridium dashboard unit (replaces the VM variant the shared script installed)"
sudo install -m 0644 "$HERE/nova-ha-dashboard.service" /etc/systemd/system/nova-ha-dashboard.service

log "household TLS certificate for iridium's names"
# nova-vm's certificate covers nova.local/nova/nova-vm/192.168.8.14/100.66.54.105
# and is useless here. Reissue against the collapsed .20 identity. mkcert signs
# with the household CA that browsers and the kiosk already trust.
mkdir -p "$TLS_DIR"
mkcert -cert-file "$TLS_DIR/server.crt" -key-file "$TLS_DIR/server.key" \
  nova.local nova iridium.local iridium "$IRIDIUM_IP" 100.104.57.108
chmod 600 "$TLS_DIR/server.key"
openssl x509 -in "$TLS_DIR/server.crt" -noout -ext subjectAltName

log "Nova Caddy on :443 (own config path; OpenClaw keeps /etc/caddy/Caddyfile)"
sudo install -d -m 0755 /etc/caddy
sudo install -m 0644 "$HERE/nova.Caddyfile" /etc/caddy/nova.Caddyfile
# Point the tailnet vhost at the MagicDNS name this node actually owns before
# validating — Caddy will not start on a name tailscaled cannot certify.
sudo bash "$HERE/sync-tailnet-host.sh" /etc/caddy/nova.Caddyfile
sudo /usr/local/bin/caddy validate --config /etc/caddy/nova.Caddyfile --adapter caddyfile
sudo install -m 0644 "$HERE/nova-caddy.service" /etc/systemd/system/nova-caddy.service

log "mDNS compat alias unit (installed, not started — cutover owns the handover)"
sudo install -m 0644 "$HERE/nova-avahi-alias.service" /etc/systemd/system/nova-avahi-alias.service

sudo systemctl daemon-reload

log "bootstrap complete — NOTHING STARTED"
cat <<'NEXT'
Stack containers exist but are stopped with --restart=no; no Nova unit is
enabled. That is intentional: this host is staged, not live.

Verify the staging is sane, then run the cutover in ops/iridium/README.md.
NEXT
