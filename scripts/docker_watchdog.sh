#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_URL="${API_URL:-http://localhost:8000/backend/}"
API_SERVICE="${API_SERVICE:-api}"
HTTP_TIMEOUT="${HTTP_TIMEOUT:-5}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-60}"

if [[ -n "${COMPOSE_CMD:-}" ]]; then
  read -r -a COMPOSE <<<"$COMPOSE_CMD"
elif docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
else
  COMPOSE=(docker-compose)
fi

log() {
  printf '[watchdog] %s\n' "$1"
}

probe_api() {
  curl -fsS --max-time "$HTTP_TIMEOUT" "$API_URL" >/dev/null
}

if probe_api; then
  log "API healthy: $API_URL"
  exit 0
fi

log "API unhealthy, restarting service: $API_SERVICE"
"${COMPOSE[@]}" restart "$API_SERVICE"

elapsed=0
while (( elapsed < WAIT_TIMEOUT )); do
  if probe_api; then
    log "API recovered: $API_URL"
    exit 0
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

log "API still unhealthy after restart: $API_URL"
exit 1
