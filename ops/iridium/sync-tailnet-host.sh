#!/usr/bin/env bash
#
# sync-tailnet-host.sh — point Nova's Caddy tailnet vhost at whatever MagicDNS
# name this node actually owns.
#
#   sudo bash ops/iridium/sync-tailnet-host.sh [/etc/caddy/nova.Caddyfile]
#
# WHY THIS EXISTS
#
# Caddy's `get_certificate tailscale` only works for the node's own MagicDNS
# name. Point it at any other name and Caddy fails to start, taking the
# dashboard's HTTPS and the browser voice satellite down with it.
#
# That name is not stable across a host migration. When Nova moved off the
# nova-vm guest, the short name `nova.tuatara-dory.ts.net` stayed attached to
# the retired node: logging that node out does NOT release the name, and a node
# that has already registered will not pick a released name up from the CLI
# (`tailscale set --hostname` and `up --reset` are both silent no-ops — verified
# again on 2026-08-03). Reclaiming it takes deleting the old device and renaming
# this one in the admin console.
#
# Rather than leave a hardcoded hostname that is wrong before that happens and
# wrong again after, this derives it from tailscaled at deploy time. Delete the
# old device, rename this node, redeploy — the vhost follows automatically with
# no file to remember to edit.
#
# Idempotent. Safe to run when nothing has changed.
set -euo pipefail

CADDYFILE="${1:-/etc/caddy/nova.Caddyfile}"

log() { printf '  %s\n' "$*"; }

[ -f "$CADDYFILE" ] || { echo "sync-tailnet-host: no such file: $CADDYFILE" >&2; exit 1; }

if ! command -v tailscale >/dev/null 2>&1; then
  log "tailscale not installed — leaving the tailnet vhost as-is"
  exit 0
fi

# The name tailscaled will actually issue a certificate for, trailing dot removed.
owned="$(tailscale status --json 2>/dev/null \
  | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))
except Exception:
    pass' || true)"

if [ -z "$owned" ]; then
  log "could not read this node's MagicDNS name (tailscaled down?) — leaving vhost as-is"
  exit 0
fi

current="$(grep -oE 'https://[A-Za-z0-9._-]+\.ts\.net:443' "$CADDYFILE" | head -1 | sed 's|https://||; s|:443$||' || true)"

if [ -z "$current" ]; then
  log "no *.ts.net vhost found in $CADDYFILE — nothing to sync"
  exit 0
fi

if [ "$current" = "$owned" ]; then
  log "tailnet vhost already correct: $owned"
  exit 0
fi

log "tailnet vhost $current -> $owned"
cp -a "$CADDYFILE" "$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"
python3 - "$CADDYFILE" "$current" "$owned" <<'PY'
import os, stat, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding="utf-8").read()
out = src.replace(f"https://{old}:443", f"https://{new}:443")
if out == src:
    raise SystemExit("sync-tailnet-host: substitution matched nothing")
# Write-and-rename rather than truncating in place: Caddy may be reading this
# file, and a half-written config is worse than an out-of-date one.
tmp = f"{path}.sync.{os.getpid()}"
with open(tmp, "w", encoding="utf-8") as handle:
    handle.write(out)
os.chmod(tmp, stat.S_IMODE(os.stat(path).st_mode))
os.replace(tmp, path)
PY

if command -v caddy >/dev/null 2>&1; then
  caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 \
    && log "caddy config still valid" \
    || { echo "sync-tailnet-host: rewritten config FAILED validation; restoring" >&2
         cp -a "$(ls -1t "$CADDYFILE".bak.* | head -1)" "$CADDYFILE"; exit 1; }
fi
