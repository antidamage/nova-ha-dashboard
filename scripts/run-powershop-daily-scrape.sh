#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${NOVA_DASHBOARD_DIR:-/opt/nova-ha-dashboard}"
DATA_DIR="${POWERSHOP_DATA_DIR:-$APP_DIR/data/power/powershop}"
IMAGE="${POWERSHOP_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:latest}"
LOG_DIR="$DATA_DIR/logs"
ENV_FILE="$APP_DIR/.env.local"

mkdir -p "$DATA_DIR" "$LOG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE; POWERSHOP_EMAIL and POWERSHOP_PASSWORD must be configured there." >&2
  exit 1
fi

docker run --rm \
  --network host \
  --env-file "$ENV_FILE" \
  -e TZ=Pacific/Auckland \
  -e POWERSHOP_DATA_DIR=/data \
  -e POWERSHOP_TEMPLATE_PATH=/app/config/powershop-usage-template.json \
  -v "$APP_DIR:/app:ro" \
  -v "$DATA_DIR:/data" \
  -w /app \
  "$IMAGE" \
  node /app/scripts/powershop-daily-scrape.mjs "$@" \
  >> "$LOG_DIR/powershop-daily-scrape.log" 2>&1
