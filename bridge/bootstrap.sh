#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
PID_FILE="$ROOT/.bridge/bridge.pid"
LOG_FILE="$ROOT/.bridge/bridge.log"
PYTHON_BIN="${PYTHON_BIN:-python3}"

mkdir -p "$ROOT/.bridge"

ensure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ROOT/.env.example" "$ENV_FILE"
    echo "[bootstrap] created .env from .env.example"
  fi
}

load_env() {
  ensure_env
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

bridge_health() {
  local base="http://${BRIDGE_HOST:-127.0.0.1}:${BRIDGE_PORT:-8787}"
  curl -fsS "$base/health" >/dev/null 2>&1
}

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

cmd_status() {
  load_env
  echo "bridge_dir=$ROOT"
  echo "env=$ENV_FILE"
  echo "project=${LLM_WIKI_PROJECT_PATH:-}"
  if bridge_health; then
    echo "bridge=online"
    curl -fsS "http://${BRIDGE_HOST:-127.0.0.1}:${BRIDGE_PORT:-8787}/setup" || true
    echo
  else
    echo "bridge=offline"
  fi
  if curl -fsS "${LLM_WIKI_API_URL:-http://127.0.0.1:19828}/health" >/dev/null 2>&1; then
    echo "llm_wiki=online"
  else
    echo "llm_wiki=offline"
  fi
}

cmd_init_project() {
  load_env
  "$PYTHON_BIN" - <<'PY'
from topic_bridge.config import load_config
from topic_bridge.bootstrap import ensure_project
import json
print(json.dumps(ensure_project(load_config()), ensure_ascii=False, indent=2))
PY
}

cmd_start_llm_wiki() {
  load_env
  if curl -fsS "${LLM_WIKI_API_URL:-http://127.0.0.1:19828}/health" >/dev/null 2>&1; then
    echo "[bootstrap] llm_wiki already online"
    return 0
  fi
  if [[ -d "/Applications/LLM Wiki.app" ]]; then
    open -a "/Applications/LLM Wiki.app"
    echo "[bootstrap] launched /Applications/LLM Wiki.app"
    return 0
  fi
  if [[ -d "$HOME/Applications/LLM Wiki.app" ]]; then
    open -a "$HOME/Applications/LLM Wiki.app"
    echo "[bootstrap] launched $HOME/Applications/LLM Wiki.app"
    return 0
  fi
  if command -v llm-wiki >/dev/null 2>&1; then
    nohup llm-wiki >/dev/null 2>&1 &
    echo "[bootstrap] launched llm-wiki CLI"
    return 0
  fi
  echo "[bootstrap] LLM Wiki not installed."
  echo "Download: https://github.com/nashsu/llm_wiki/releases/latest"
  return 1
}

cmd_start() {
  load_env
  if bridge_health; then
    echo "[bootstrap] bridge already online on ${BRIDGE_HOST:-127.0.0.1}:${BRIDGE_PORT:-8787}"
    return 0
  fi
  if is_running; then
    echo "[bootstrap] stale pid file cleaned"
    rm -f "$PID_FILE"
  fi
  # Ensure module import works regardless of caller cwd/PYTHONPATH
  export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
  nohup env PYTHONUNBUFFERED=1 PYTHONPATH="$ROOT" "$PYTHON_BIN" -u -m topic_bridge >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if bridge_health; then
      echo "[bootstrap] bridge started pid=$(cat "$PID_FILE") log=$LOG_FILE"
      return 0
    fi
    # if process died, fail fast
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "[bootstrap] bridge process exited early; see $LOG_FILE" >&2
      return 1
    fi
    sleep 0.2
  done
  echo "[bootstrap] bridge start requested but health check failed; see $LOG_FILE" >&2
  return 1
}

cmd_stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "[bootstrap] bridge stopped"
  else
    echo "[bootstrap] bridge not running via pid file"
  fi
}

cmd_setup() {
  load_env
  cmd_init_project
  cmd_start_llm_wiki || true
  cmd_start
  cmd_status
}

usage() {
  cat <<'USAGE'
Lumina Topic Bridge bootstrap

Usage:
  ./bootstrap.sh setup            # init project + start llm_wiki(if present) + start bridge
  ./bootstrap.sh start            # start bridge in background
  ./bootstrap.sh stop             # stop background bridge
  ./bootstrap.sh status           # print local status
  ./bootstrap.sh init-project     # create knowledge project skeleton
  ./bootstrap.sh start-llm-wiki   # open/start LLM Wiki app if installed

Notes:
  - Browser cannot silently install desktop apps.
  - First-time LLM Wiki install still needs GitHub Releases / official installer.
  - This script is the local half of Lumina settings "guided install".
USAGE
}

main() {
  local cmd="${1:-setup}"
  case "$cmd" in
    setup) cmd_setup ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    status) cmd_status ;;
    init-project) cmd_init_project ;;
    start-llm-wiki) cmd_start_llm_wiki ;;
    help|-h|--help) usage ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
