#!/usr/bin/env bash
#
# Install the guarded Tuya Local repair timer on Nova. The repair itself only
# writes entries whose current LAN endpoint and fresh local key pass a live
# tinytuya probe; it backs up core.config_entries before restarting HA.
#
# Run from the deployed dashboard checkout:
#   bash /opt/nova-ha-dashboard/ops/install-tuya-local-repair.sh

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVICE=nova-tuya-local-repair.service
TIMER=nova-tuya-local-repair.timer

sudo install -m 0644 "$HERE/$SERVICE" "/etc/systemd/system/$SERVICE"
sudo install -m 0644 "$HERE/$TIMER" "/etc/systemd/system/$TIMER"
sudo systemctl daemon-reload
sudo systemctl enable --now "$TIMER"
sudo systemctl is-enabled "$TIMER"
sudo systemctl is-active "$TIMER"

echo "Installed $TIMER; verified Tuya Local drift will be repaired hourly."

