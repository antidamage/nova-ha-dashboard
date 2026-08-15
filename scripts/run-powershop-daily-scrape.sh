#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${NOVA_DASHBOARD_DIR:-/opt/nova-ha-dashboard}"
DATA_DIR="${POWERSHOP_DATA_DIR:-$APP_DIR/data/power/powershop}"
IMAGE="${POWERSHOP_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-jammy}"
LOG_DIR="$DATA_DIR/logs"
ENV_FILE="$APP_DIR/.env.local"
LOCK_FILE="$DATA_DIR/powershop-scrape.lock"

mkdir -p "$DATA_DIR" "$LOG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE; POWERSHOP_EMAIL and POWERSHOP_PASSWORD must be configured there." >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -w "${POWERSHOP_LOCK_TIMEOUT_SECONDS:-30}" 9; then
  echo "Another Powershop scrape or login refresh still holds $LOCK_FILE." >&2
  exit 1
fi

POWERSHOP_ENV_FILE="$(mktemp "$DATA_DIR/.powershop-env.XXXXXX")"
cleanup() {
  rm -f "$POWERSHOP_ENV_FILE"
}
trap cleanup EXIT
chmod 600 "$POWERSHOP_ENV_FILE"
grep -E '^POWERSHOP_[A-Z0-9_]+=' "$ENV_FILE" > "$POWERSHOP_ENV_FILE" || true
EMAIL_COUNT="$(grep -c '^POWERSHOP_EMAIL=' "$POWERSHOP_ENV_FILE" || true)"
PASSWORD_COUNT="$(grep -c '^POWERSHOP_PASSWORD=' "$POWERSHOP_ENV_FILE" || true)"
if [[ "$EMAIL_COUNT" -ne 1 || "$PASSWORD_COUNT" -ne 1 ]]; then
  echo "POWERSHOP_EMAIL and POWERSHOP_PASSWORD must each appear exactly once in $ENV_FILE." >&2
  exit 1
fi

docker run --rm \
  --init \
  --network host \
  --env-file "$POWERSHOP_ENV_FILE" \
  -e TZ=Pacific/Auckland \
  -e POWERSHOP_DATA_DIR=/data \
  -e POWERSHOP_TEMPLATE_PATH=/app/config/powershop-usage-template.json \
  -v "$APP_DIR:/app:ro" \
  -v "$DATA_DIR:/data" \
  -w /app \
  "$IMAGE" \
  node /app/scripts/powershop-daily-scrape.mjs "$@" \
  >> "$LOG_DIR/powershop-daily-scrape.log" 2>&1
