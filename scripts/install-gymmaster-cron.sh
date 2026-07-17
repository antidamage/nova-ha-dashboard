#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${NOVA_DASHBOARD_DIR:-/opt/nova-ha-dashboard}"
RUNNER="$APP_DIR/scripts/run-gymmaster-attendance-scrape.sh"

chmod +x "$RUNNER"
mkdir -p "$APP_DIR/data/gymmaster/logs"

(
  crontab -l 2>/dev/null | grep -v 'run-gymmaster-attendance-scrape.sh' || true
  echo "0 3-19 * * * bash $RUNNER"
  echo "*/15 20-23 * * * bash $RUNNER"
  echo "*/15 0-1 * * * bash $RUNNER"
  echo "0 2 * * * bash $RUNNER"
) | crontab -

cat <<EOF
Installed GymMaster attendance scrape cron:
  hourly outside the evening window: 0 3-19 * * *
  every 15 minutes from 20:00-01:45: */15 20-23,0-1 * * *
  final evening-window scrape at 02:00: 0 2 * * *
EOF
