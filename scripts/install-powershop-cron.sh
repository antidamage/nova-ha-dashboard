#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${NOVA_DASHBOARD_DIR:-/opt/nova-ha-dashboard}"
RUNNER="$APP_DIR/scripts/run-powershop-daily-scrape.sh"
CRON_LINE="8 5 * * * bash $RUNNER"

chmod +x "$RUNNER"
mkdir -p "$APP_DIR/data/power/powershop/logs"

(
  crontab -l 2>/dev/null | grep -v 'run-powershop-daily-scrape.sh' || true
  echo "$CRON_LINE"
) | crontab -

echo "Installed Powershop scrape cron: $CRON_LINE"
