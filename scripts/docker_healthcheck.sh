#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_CMD="${COMPOSE_CMD:-docker-compose}"
API_URL="${API_URL:-http://localhost:8000}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-90}"

log() {
  printf '[healthcheck] %s\n' "$1"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local timeout="$3"
  local elapsed=0

  while (( elapsed < timeout )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "$name 已就绪: $url"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  log "$name 未在 ${timeout}s 内就绪: $url"
  return 1
}

log "启动 docker-compose 服务"
"$COMPOSE_CMD" up -d

log "检查服务状态"
"$COMPOSE_CMD" ps

wait_for_http "API" "$API_URL/api/auth/status" "$WAIT_TIMEOUT"
wait_for_http "Web" "$WEB_URL" "$WAIT_TIMEOUT"

log "检查列表页筛选依赖接口"
curl -fsS "$API_URL/api/sources" >/dev/null
curl -fsS "$API_URL/api/authors" >/dev/null

log "执行路由覆盖检查（modular vs legacy）"
"$COMPOSE_CMD" exec -T api python /app/scripts/check_route_coverage.py --verbose

log "健康检查通过"
