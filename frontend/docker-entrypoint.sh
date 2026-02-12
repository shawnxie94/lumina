#!/bin/sh
set -eu

RUNTIME_CONFIG_FILE="/app/public/runtime-config.js"
API_BASE_URL_VALUE="${API_BASE_URL:-}"
API_BASE_URL_ESCAPED="$(printf '%s' "$API_BASE_URL_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')"
ERROR_TASK_POLL_INTERVAL_MS_VALUE="${ERROR_TASK_POLL_INTERVAL_MS:-}"
ERROR_TASK_POLL_INTERVAL_MS_ESCAPED="$(printf '%s' "$ERROR_TASK_POLL_INTERVAL_MS_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')"

cat > "$RUNTIME_CONFIG_FILE" <<EOF
window.__LUMINA_RUNTIME_CONFIG__ = Object.assign(
  {},
  window.__LUMINA_RUNTIME_CONFIG__ || {},
  {
    apiBaseUrl: "$API_BASE_URL_ESCAPED",
    errorTaskPollIntervalMs: "$ERROR_TASK_POLL_INTERVAL_MS_ESCAPED"
  }
);
EOF

exec "$@"
