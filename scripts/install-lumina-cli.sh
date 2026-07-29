#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="${LUMINA_REPO_OWNER:-shawnxie94}"
REPO_NAME="${LUMINA_REPO_NAME:-lumina}"
REPO_REF="${LUMINA_REPO_REF:-main}"
INSTALL_HOME="${LUMINA_HOME:-$HOME/.lumina}"
BIN_DIR="$INSTALL_HOME/bin"
PYTHON_BIN="${PYTHON_BIN:-python3}"
FORCE=0
NON_INTERACTIVE=0
SKIP_INIT=0
SKIP_BRIDGE=0
INSTALL_BRIDGE=0
ADD_PATH=0
NO_ADD_PATH=0

# Optional preseed values (also accepted via env)
LUMINA_BASE_URL_VALUE="${LUMINA_BASE_URL:-}"
LUMINA_TOKEN_VALUE="${LUMINA_TOKEN:-${LUMINA_INTERNAL_TOKEN:-}}"
LUMINA_PROJECT_PATH_VALUE="${LUMINA_PROJECT_PATH:-}"
LUMINA_PROVIDER_VALUE="${LUMINA_PROVIDER:-}"
BRIDGE_HOST_VALUE="${LUMINA_BRIDGE_HOST:-}"
BRIDGE_PORT_VALUE="${LUMINA_BRIDGE_PORT:-}"
BRIDGE_TOKEN_VALUE="${LUMINA_BRIDGE_TOKEN:-}"

usage() {
  cat <<USAGE
Install Lumina CLI into ~/.lumina/bin/lumina and guide first-time config.

Interactive (default on TTY):
  ./scripts/install-lumina-cli.sh

Non-interactive / scripted:
  ./scripts/install-lumina-cli.sh --yes \\
    --base-url http://127.0.0.1:8000/backend \\
    --token dev-internal-token-change-me \\
    --project-path "\$HOME/.lumina/knowledge/Lumina-Knowledge" \\
    --install-bridge

Options:
  --home PATH            install home (default: ~/.lumina)
  --ref REF              repo ref when downloading (default: main)
  --force                re-copy package even if present
  --yes|-y               non-interactive install + init
  --skip-init            only install binary, do not run setup wizard
  --install-bridge       install local knowledge runtime (Bridge + project) after setup
  --skip-bridge          never install Bridge during setup
  --add-path             append ~/.lumina/bin to shell rc (default)
  --no-add-path          do not modify shell rc
  --base-url URL         Lumina API base url
  --token TOKEN          Lumina internal/API token
  --project-path PATH    local knowledge project path
  --provider NAME        knowledge provider (default: llm_wiki)
  --bridge-host HOST     bridge host
  --bridge-port PORT     bridge port
  --bridge-token TOKEN   optional bridge auth token
  -h|--help              help

Env alternatives:
  LUMINA_BASE_URL, LUMINA_TOKEN/LUMINA_INTERNAL_TOKEN,
  LUMINA_PROJECT_PATH, LUMINA_PROVIDER,
  LUMINA_BRIDGE_HOST, LUMINA_BRIDGE_PORT, LUMINA_BRIDGE_TOKEN
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) INSTALL_HOME="$2"; BIN_DIR="$INSTALL_HOME/bin"; shift 2 ;;
    --ref) REPO_REF="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --yes|-y) NON_INTERACTIVE=1; shift ;;
    --skip-init) SKIP_INIT=1; shift ;;
    --install-bridge) INSTALL_BRIDGE=1; shift ;;
    --skip-bridge) SKIP_BRIDGE=1; shift ;;
    --add-path) ADD_PATH=1; shift ;;
    --no-add-path) NO_ADD_PATH=1; shift ;;
    --base-url) LUMINA_BASE_URL_VALUE="$2"; shift 2 ;;
    --token) LUMINA_TOKEN_VALUE="$2"; shift 2 ;;
    --project-path) LUMINA_PROJECT_PATH_VALUE="$2"; shift 2 ;;
    --provider) LUMINA_PROVIDER_VALUE="$2"; shift 2 ;;
    --bridge-host) BRIDGE_HOST_VALUE="$2"; shift 2 ;;
    --bridge-port) BRIDGE_PORT_VALUE="$2"; shift 2 ;;
    --bridge-token) BRIDGE_TOKEN_VALUE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[install-lumina-cli] missing dependency: $1" >&2
    exit 1
  fi
}
need_cmd "$PYTHON_BIN"
need_cmd curl
need_cmd tar
need_cmd install

"$PYTHON_BIN" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 9) else 1)
PY
if [[ $? -ne 0 ]]; then
  echo "[install-lumina-cli] Python >= 3.9 required" >&2
  exit 1
fi

INSTALL_HOME="${INSTALL_HOME/#\~/$HOME}"
BIN_DIR="$INSTALL_HOME/bin"
PKG_DIR="$INSTALL_HOME/cli"
mkdir -p "$BIN_DIR" "$PKG_DIR" "$INSTALL_HOME/logs" "$INSTALL_HOME/cache"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_CLI=""
if [[ -d "$SCRIPT_DIR/../cli/lumina_cli" ]]; then
  LOCAL_CLI="$(cd "$SCRIPT_DIR/../cli" && pwd)"
elif [[ -d "$SCRIPT_DIR/lumina_cli" ]]; then
  LOCAL_CLI="$(cd "$SCRIPT_DIR" && pwd)"
fi

echo "[install-lumina-cli] home: $INSTALL_HOME"

if [[ -n "$LOCAL_CLI" ]]; then
  echo "[install-lumina-cli] using local checkout: $LOCAL_CLI"
  rm -rf "$PKG_DIR/lumina_cli"
  mkdir -p "$PKG_DIR"
  cp -R "$LOCAL_CLI/lumina_cli" "$PKG_DIR/lumina_cli"
  [[ -f "$LOCAL_CLI/README.md" ]] && cp "$LOCAL_CLI/README.md" "$PKG_DIR/README.md" || true
else
  echo "[install-lumina-cli] downloading cli package from GitHub ($REPO_REF)"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${REPO_REF}"
  curl -fsSL "$ARCHIVE_URL" -o "$TMP_DIR/src.tar.gz"
  tar -xzf "$TMP_DIR/src.tar.gz" -C "$TMP_DIR"
  SRC_DIR="$(find "$TMP_DIR" -maxdepth 1 -type d -name "${REPO_NAME}-*" | head -n 1)"
  if [[ -z "$SRC_DIR" || ! -d "$SRC_DIR/cli/lumina_cli" ]]; then
    echo "[install-lumina-cli] cli package not found in archive" >&2
    exit 1
  fi
  rm -rf "$PKG_DIR/lumina_cli"
  mkdir -p "$PKG_DIR"
  cp -R "$SRC_DIR/cli/lumina_cli" "$PKG_DIR/lumina_cli"
  [[ -f "$SRC_DIR/cli/README.md" ]] && cp "$SRC_DIR/cli/README.md" "$PKG_DIR/README.md" || true
fi

# wrapper
cat > "$BIN_DIR/lumina" <<WRAP
#!/usr/bin/env bash
set -euo pipefail
HOME_DIR="$INSTALL_HOME"
export LUMINA_HOME="\$HOME_DIR"
export PYTHONPATH="\$HOME_DIR/cli\${PYTHONPATH:+:\$PYTHONPATH}"
exec "${PYTHON_BIN}" -m lumina_cli "\$@"
WRAP
chmod +x "$BIN_DIR/lumina"

# Ensure current process can call lumina even before rc update
export PATH="$BIN_DIR:$PATH"

if [[ "$SKIP_INIT" -ne 1 ]]; then
  echo
  echo "[install-lumina-cli] configuring CLI (base URL / token / project are per-user)"
  INIT_ARGS=()
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    INIT_ARGS+=(--non-interactive --yes)
  else
    # TTY guided wizard by default
    INIT_ARGS+=(--guided --force)
  fi
  [[ -n "$LUMINA_BASE_URL_VALUE" ]] && INIT_ARGS+=(--base-url "$LUMINA_BASE_URL_VALUE")
  [[ -n "$LUMINA_TOKEN_VALUE" ]] && INIT_ARGS+=(--token "$LUMINA_TOKEN_VALUE")
  [[ -n "$LUMINA_PROJECT_PATH_VALUE" ]] && INIT_ARGS+=(--project-path "$LUMINA_PROJECT_PATH_VALUE")
  [[ -n "$LUMINA_PROVIDER_VALUE" ]] && INIT_ARGS+=(--provider "$LUMINA_PROVIDER_VALUE")
  [[ -n "$BRIDGE_HOST_VALUE" ]] && INIT_ARGS+=(--bridge-host "$BRIDGE_HOST_VALUE")
  [[ -n "$BRIDGE_PORT_VALUE" ]] && INIT_ARGS+=(--bridge-port "$BRIDGE_PORT_VALUE")
  [[ -n "$BRIDGE_TOKEN_VALUE" ]] && INIT_ARGS+=(--bridge-token "$BRIDGE_TOKEN_VALUE")
  if [[ "$INSTALL_BRIDGE" -eq 1 ]]; then
    INIT_ARGS+=(--install-bridge)
  fi
  if [[ "$SKIP_BRIDGE" -eq 1 ]]; then
    INIT_ARGS+=(--skip-bridge)
  fi
  if [[ "$NO_ADD_PATH" -eq 1 ]]; then
    INIT_ARGS+=(--no-add-path)
  else
    # default: write PATH automatically
    INIT_ARGS+=(--add-path)
  fi

  # For non-interactive without token, still create config but warn later via init
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    INIT_ARGS+=(--allow-empty-token)
  fi

  "$BIN_DIR/lumina" init "${INIT_ARGS[@]}"
else
  echo "[install-lumina-cli] skip init (--skip-init)"
fi

if ! command -v lumina >/dev/null 2>&1; then
  echo "[install-lumina-cli] add to PATH:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

cat <<EOF

[install-lumina-cli] done
CLI:     $BIN_DIR/lumina
Config:  $INSTALL_HOME/config.yaml

Next:
  lumina whoami
  lumina doctor
  lumina up
  lumina sync

Reconfigure later:
  lumina init --guided --force
EOF
