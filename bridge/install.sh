#!/usr/bin/env bash
# Compatibility wrapper. Canonical installer:
#   scripts/install-topic-bridge.sh
# Prefer: lumina bridge install / lumina up --install
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT_DIR/scripts/install-topic-bridge.sh"

if [[ ! -f "$TARGET" ]]; then
  echo "[bridge/install.sh] missing $TARGET" >&2
  echo "Use: curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-topic-bridge.sh | bash" >&2
  exit 1
fi

exec bash "$TARGET" "$@"
