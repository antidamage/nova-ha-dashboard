#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${NOVA_DASHBOARD_DIR:-/opt/nova-ha-dashboard}"
APP_DATA_DIR="$APP_DIR/data"
DATA_DIR="${GYMMASTER_DATA_DIR:-$APP_DATA_DIR/gymmaster}"
IMAGE="${GYMMASTER_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-jammy}"
LOG_DIR="$DATA_DIR/logs"
ENV_FILE="$APP_DIR/.env.local"
LOCK_FILE="$DATA_DIR/gymmaster-attendance-scrape.lock"

mkdir -p "$DATA_DIR" "$LOG_DIR" "$APP_DATA_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE; GYMMASTER_EMAIL and GYMMASTER_PASSWORD must be configured there." >&2
  exit 1
fi

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "GymMaster attendance scrape already running; skipping." >> "$LOG_DIR/gymmaster-attendance-scrape.log"
    exit 0
  fi
fi

docker run --rm \
  --network host \
  --env-file "$ENV_FILE" \
  -e TZ=Pacific/Auckland \
  -e GYMMASTER_DASHBOARD_URL="${GYMMASTER_DASHBOARD_URL:-http://127.0.0.1}" \
  -e GYMMASTER_DATA_DIR=/gymmaster-data \
  -e NOVA_DASHBOARD_PREFERENCES=/dashboard-data/dashboard-preferences.json \
  -v "$APP_DIR:/app:ro" \
  -v "$APP_DATA_DIR:/dashboard-data" \
  -v "$DATA_DIR:/gymmaster-data" \
  -w /app \
  "$IMAGE" \
  node /app/scripts/gymmaster-attendance-scrape.mjs "$@" \
  >> "$LOG_DIR/gymmaster-attendance-scrape.log" 2>&1
