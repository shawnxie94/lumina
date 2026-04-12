#!/usr/bin/env bash
set -euo pipefail

CHECKOUT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$CHECKOUT_ROOT" rev-parse --git-common-dir)"
PRIMARY_ROOT="$(cd "$GIT_COMMON_DIR/.." && pwd)"

if [[ -f "$CHECKOUT_ROOT/docker-compose.yml" ]]; then
  BASE_COMPOSE_FILE="$CHECKOUT_ROOT/docker-compose.yml"
  COMPOSE_ROOT="$CHECKOUT_ROOT"
else
  BASE_COMPOSE_FILE="$PRIMARY_ROOT/docker-compose.yml"
  COMPOSE_ROOT="$PRIMARY_ROOT"
fi

if [[ ! -f "$BASE_COMPOSE_FILE" ]]; then
  printf '[docker-up-worktree] 未找到 docker-compose.yml，已检查: %s\n' "$BASE_COMPOSE_FILE" >&2
  exit 1
fi

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(git -C "$CHECKOUT_ROOT" rev-parse --abbrev-ref HEAD | tr '/.' '-' )}"
DATA_DIR="${DATA_DIR:-$COMPOSE_ROOT/data}"
COMPOSE_BIN="${COMPOSE_BIN:-docker}"

OVERRIDE_FILE="$(mktemp -t lumina-worktree-compose.XXXXXX.yml)"
cleanup() {
  rm -f "$OVERRIDE_FILE"
}
trap cleanup EXIT

cat >"$OVERRIDE_FILE" <<EOF
services:
  web:
    build: "$CHECKOUT_ROOT/frontend"
  api:
    build: "$CHECKOUT_ROOT/backend"
    volumes:
      - "$DATA_DIR:/app/data"
  worker:
    build: "$CHECKOUT_ROOT/backend"
    volumes:
      - "$DATA_DIR:/app/data"
EOF

printf '[docker-up-worktree] checkout: %s\n' "$CHECKOUT_ROOT"
printf '[docker-up-worktree] compose:  %s\n' "$BASE_COMPOSE_FILE"
printf '[docker-up-worktree] data:     %s\n' "$DATA_DIR"
printf '[docker-up-worktree] project:  %s\n' "$PROJECT_NAME"

"$COMPOSE_BIN" compose \
  -f "$BASE_COMPOSE_FILE" \
  -f "$OVERRIDE_FILE" \
  -p "$PROJECT_NAME" \
  up -d --build

"$COMPOSE_BIN" compose \
  -f "$BASE_COMPOSE_FILE" \
  -f "$OVERRIDE_FILE" \
  -p "$PROJECT_NAME" \
  ps
