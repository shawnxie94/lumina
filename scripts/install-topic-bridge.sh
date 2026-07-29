#!/usr/bin/env bash
# Lumina Topic Bridge one-click installer
# curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-topic-bridge.sh | bash
# curl -fsSL ... | bash -s -- --lumina-url http://127.0.0.1:8000/backend --port 8787 --yes
set -euo pipefail

REPO_OWNER="${LUMINA_REPO_OWNER:-shawnxie94}"
REPO_NAME="${LUMINA_REPO_NAME:-lumina}"
REPO_REF="${LUMINA_REPO_REF:-main}"
INSTALL_ROOT="${LUMINA_BRIDGE_HOME:-$HOME/.lumina/topic-bridge}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

BRIDGE_HOST="127.0.0.1"
BRIDGE_PORT="8787"
BRIDGE_TOKEN=""
LUMINA_BASE_URL="http://127.0.0.1:8000/backend"
LUMINA_INTERNAL_TOKEN="dev-internal-token-change-me"
LLM_WIKI_API_URL="http://127.0.0.1:19828"
LLM_WIKI_PROJECT_PATH="$HOME/.lumina/knowledge/Lumina-Knowledge"
LLM_WIKI_PROJECT_NAME="Lumina-Knowledge"
START_AFTER_INSTALL=1
INIT_PROJECT=1
NON_INTERACTIVE=0
FORCE_REINSTALL=0

usage() {
  cat <<'USAGE'
Lumina Topic Bridge installer

Installs only the local bridge runtime (not full Lumina repo) into:
  ~/.lumina/topic-bridge

Examples:
  curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-topic-bridge.sh | bash
  curl -fsSL ... | bash -s -- --lumina-url http://127.0.0.1:8000/backend --port 8787 --yes

Options:
  --home PATH --host HOST --port PORT --bridge-token TOKEN
  --lumina-url URL --internal-token TOKEN --llm-wiki-url URL
  --project-path PATH --project-name NAME --ref REF
  --no-start --no-init-project --force --yes|-y --help
USAGE
}

prompt() {
  local label="$1"
  local current="$2"
  local var="$3"
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    printf -v "$var" '%s' "$current"
    return
  fi
  local input=""
  read -r -p "$label [$current]: " input || true
  if [[ -n "${input}" ]]; then
    printf -v "$var" '%s' "$input"
  else
    printf -v "$var" '%s' "$current"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) INSTALL_ROOT="$2"; shift 2 ;;
    --host) BRIDGE_HOST="$2"; shift 2 ;;
    --port) BRIDGE_PORT="$2"; shift 2 ;;
    --bridge-token) BRIDGE_TOKEN="$2"; shift 2 ;;
    --lumina-url) LUMINA_BASE_URL="$2"; shift 2 ;;
    --internal-token) LUMINA_INTERNAL_TOKEN="$2"; shift 2 ;;
    --llm-wiki-url) LLM_WIKI_API_URL="$2"; shift 2 ;;
    --project-path) LLM_WIKI_PROJECT_PATH="$2"; shift 2 ;;
    --project-name) LLM_WIKI_PROJECT_NAME="$2"; shift 2 ;;
    --ref) REPO_REF="$2"; shift 2 ;;
    --no-start) START_AFTER_INSTALL=0; shift ;;
    --no-init-project) INIT_PROJECT=0; shift ;;
    --force) FORCE_REINSTALL=1; shift ;;
    --yes|-y) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[install] missing dependency: $1" >&2
    exit 1
  fi
}
need_cmd curl
need_cmd tar
need_cmd "$PYTHON_BIN"

"$PYTHON_BIN" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 9) else 1)
PY
if [[ $? -ne 0 ]]; then echo "[install] Python >= 3.9 required" >&2; exit 1; fi

echo "[install] Lumina Topic Bridge"
echo "[install] target: $INSTALL_ROOT"
if [[ "$NON_INTERACTIVE" -ne 1 ]]; then echo; echo "按回车使用默认值，或输入新值："; fi
prompt "Bridge host" "$BRIDGE_HOST" BRIDGE_HOST
prompt "Bridge port" "$BRIDGE_PORT" BRIDGE_PORT
prompt "Bridge token (optional)" "$BRIDGE_TOKEN" BRIDGE_TOKEN
prompt "Lumina base URL" "$LUMINA_BASE_URL" LUMINA_BASE_URL
prompt "Lumina internal token" "$LUMINA_INTERNAL_TOKEN" LUMINA_INTERNAL_TOKEN
prompt "LLM Wiki API URL" "$LLM_WIKI_API_URL" LLM_WIKI_API_URL
prompt "Knowledge project path" "$LLM_WIKI_PROJECT_PATH" LLM_WIKI_PROJECT_PATH
prompt "Knowledge project name" "$LLM_WIKI_PROJECT_NAME" LLM_WIKI_PROJECT_NAME

LUMINA_BASE_URL="${LUMINA_BASE_URL%/}"
LLM_WIKI_API_URL="${LLM_WIKI_API_URL%/}"
LLM_WIKI_PROJECT_PATH="${LLM_WIKI_PROJECT_PATH/#\~/$HOME}"
INSTALL_ROOT="${INSTALL_ROOT/#\~/$HOME}"
mkdir -p "$INSTALL_ROOT" "$INSTALL_ROOT/bin" "$INSTALL_ROOT/.bridge"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BRIDGE=""
if [[ -d "$SCRIPT_DIR/../bridge/topic_bridge" ]]; then
  LOCAL_BRIDGE="$(cd "$SCRIPT_DIR/../bridge" && pwd)"
fi

install_from_local() {
  echo "[install] using local bridge package: $LOCAL_BRIDGE"
  rm -rf "$INSTALL_ROOT/topic_bridge"
  mkdir -p "$INSTALL_ROOT/topic_bridge"
  cp -R "$LOCAL_BRIDGE/topic_bridge/." "$INSTALL_ROOT/topic_bridge/"
  [[ -f "$LOCAL_BRIDGE/bootstrap.sh" ]] && cp "$LOCAL_BRIDGE/bootstrap.sh" "$INSTALL_ROOT/bootstrap.sh" && chmod +x "$INSTALL_ROOT/bootstrap.sh"
  [[ -f "$LOCAL_BRIDGE/.env.example" ]] && cp "$LOCAL_BRIDGE/.env.example" "$INSTALL_ROOT/.env.example"
  [[ -f "$LOCAL_BRIDGE/README.md" ]] && cp "$LOCAL_BRIDGE/README.md" "$INSTALL_ROOT/README.md"
  echo "local" > "$INSTALL_ROOT/VERSION"
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$INSTALL_ROOT/INSTALLED_AT"
}

install_from_github() {
  local tmp archive url extracted
  tmp="$(mktemp -d)"
  archive="$tmp/lumina.tar.gz"
  url="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${REPO_REF}"
  echo "[install] downloading bridge package from ${REPO_OWNER}/${REPO_NAME}@${REPO_REF}"
  if ! curl -fsSL "$url" -o "$archive"; then
    echo "[install] download failed: $url" >&2
    rm -rf "$tmp"
    exit 1
  fi
  tar -xzf "$archive" -C "$tmp"
  extracted="$(find "$tmp" -maxdepth 1 -type d -name "${REPO_NAME}-*" | head -1)"
  if [[ -z "$extracted" || ! -d "$extracted/bridge/topic_bridge" ]]; then
    echo "[install] bridge package missing in archive" >&2
    rm -rf "$tmp"
    exit 1
  fi
  rm -rf "$INSTALL_ROOT/topic_bridge"
  mkdir -p "$INSTALL_ROOT/topic_bridge"
  cp -R "$extracted/bridge/topic_bridge/." "$INSTALL_ROOT/topic_bridge/"
  [[ -f "$extracted/bridge/bootstrap.sh" ]] && cp "$extracted/bridge/bootstrap.sh" "$INSTALL_ROOT/bootstrap.sh" && chmod +x "$INSTALL_ROOT/bootstrap.sh"
  [[ -f "$extracted/bridge/.env.example" ]] && cp "$extracted/bridge/.env.example" "$INSTALL_ROOT/.env.example"
  [[ -f "$extracted/bridge/README.md" ]] && cp "$extracted/bridge/README.md" "$INSTALL_ROOT/README.md"
  printf '%s\n' "$REPO_REF" > "$INSTALL_ROOT/VERSION"
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$INSTALL_ROOT/INSTALLED_AT"
  rm -rf "$tmp"
}

if [[ "$FORCE_REINSTALL" -eq 1 || ! -d "$INSTALL_ROOT/topic_bridge" ]]; then
  if [[ -n "$LOCAL_BRIDGE" ]]; then install_from_local; else install_from_github; fi
else
  echo "[install] existing package found, skip download (use --force to refresh)"
fi

# write manager
echo "IyEvdXNyL2Jpbi9lbnYgYmFzaApzZXQgLWV1byBwaXBlZmFpbApST09UPSIkKGNkICIkKGRpcm5hbWUgIiQwIikvLi4iICYmIHB3ZCkiCkVOVl9GSUxFPSIkUk9PVC8uZW52IgpQSURfRklMRT0iJFJPT1QvLmJyaWRnZS9icmlkZ2UucGlkIgpMT0dfRklMRT0iJFJPT1QvLmJyaWRnZS9icmlkZ2UubG9nIgpQWVRIT05fQklOPSIke1BZVEhPTl9CSU46LXB5dGhvbjN9IgpleHBvcnQgUFlUSE9OUEFUSD0iJFJPT1Qke1BZVEhPTlBBVEg6KzokUFlUSE9OUEFUSH0iCgpsb2FkX2VudigpIHsKICBpZiBbWyAhIC1mICIkRU5WX0ZJTEUiIF1dOyB0aGVuCiAgICBlY2hvICJbbHVtaW5hLWJyaWRnZV0gbWlzc2luZyAkRU5WX0ZJTEUiID4mMgogICAgZXhpdCAxCiAgZmkKICBzZXQgLWEKICAjIHNoZWxsY2hlY2sgZGlzYWJsZT1TQzEwOTAKICBzb3VyY2UgIiRFTlZfRklMRSIKICBzZXQgK2EKfQoKaGVhbHRoKCkgewogIGN1cmwgLWZzUyAiaHR0cDovLyR7QlJJREdFX0hPU1Q6LTEyNy4wLjAuMX06JHtCUklER0VfUE9SVDotODc4N30vaGVhbHRoIiA+L2Rldi9udWxsIDI+JjEKfQoKaXNfcnVubmluZygpIHsKICBbWyAtZiAiJFBJRF9GSUxFIiBdXSB8fCByZXR1cm4gMQogIGxvY2FsIHBpZAogIHBpZD0iJChjYXQgIiRQSURfRklMRSIgMj4vZGV2L251bGwgfHwgdHJ1ZSkiCiAgW1sgLW4gIiR7cGlkOi19IiBdXSAmJiBraWxsIC0wICIkcGlkIiAyPi9kZXYvbnVsbAp9CgpjbWRfc3RhcnQoKSB7CiAgbG9hZF9lbnYKICBta2RpciAtcCAiJFJPT1QvLmJyaWRnZSIKICBpZiBoZWFsdGg7IHRoZW4KICAgIGVjaG8gIltsdW1pbmEtYnJpZGdlXSBhbHJlYWR5IG9ubGluZSBvbiAke0JSSURHRV9IT1NUOi0xMjcuMC4wLjF9OiR7QlJJREdFX1BPUlQ6LTg3ODd9IgogICAgcmV0dXJuIDAKICBmaQogIGlmIGlzX3J1bm5pbmc7IHRoZW4KICAgIHJtIC1mICIkUElEX0ZJTEUiCiAgZmkKICBub2h1cCBlbnYgUFlUSE9OVU5CVUZGRVJFRD0xIFBZVEhPTlBBVEg9IiRST09UIiAiJFBZVEhPTl9CSU4iIC11IC1tIHRvcGljX2JyaWRnZSA+PiIkTE9HX0ZJTEUiIDI+JjEgJgogIGVjaG8gJCEgPiIkUElEX0ZJTEUiCiAgbG9jYWwgXwogIGZvciBfIGluIDEgMiAzIDQgNSA2IDcgOCA5IDEwIDExIDEyIDEzIDE0IDE1IDE2IDE3IDE4IDE5IDIwOyBkbwogICAgaWYgaGVhbHRoOyB0aGVuCiAgICAgIGVjaG8gIltsdW1pbmEtYnJpZGdlXSBzdGFydGVkIHBpZD0kKGNhdCAiJFBJRF9GSUxFIikgbG9nPSRMT0dfRklMRSIKICAgICAgcmV0dXJuIDAKICAgIGZpCiAgICBpZiAhIGtpbGwgLTAgIiQoY2F0ICIkUElEX0ZJTEUiKSIgMj4vZGV2L251bGw7IHRoZW4KICAgICAgZWNobyAiW2x1bWluYS1icmlkZ2VdIHByb2Nlc3MgZXhpdGVkIGVhcmx5OyBzZWUgJExPR19GSUxFIiA+JjIKICAgICAgcmV0dXJuIDEKICAgIGZpCiAgICBzbGVlcCAwLjIKICBkb25lCiAgZWNobyAiW2x1bWluYS1icmlkZ2VdIHN0YXJ0IGZhaWxlZDsgc2VlICRMT0dfRklMRSIgPiYyCiAgcmV0dXJuIDEKfQoKY21kX3N0b3AoKSB7CiAgaWYgaXNfcnVubmluZzsgdGhlbgogICAga2lsbCAiJChjYXQgIiRQSURfRklMRSIpIiAyPi9kZXYvbnVsbCB8fCB0cnVlCiAgICBybSAtZiAiJFBJRF9GSUxFIgogICAgZWNobyAiW2x1bWluYS1icmlkZ2VdIHN0b3BwZWQiCiAgZWxzZQogICAgZWNobyAiW2x1bWluYS1icmlkZ2VdIG5vdCBydW5uaW5nIgogIGZpCn0KCmNtZF9zdGF0dXMoKSB7CiAgbG9hZF9lbnYKICBlY2hvICJob21lPSRST09UIgogIGVjaG8gImJyaWRnZT1odHRwOi8vJHtCUklER0VfSE9TVDotMTI3LjAuMC4xfToke0JSSURHRV9QT1JUOi04Nzg3fSIKICBlY2hvICJwcm9qZWN0PSR7TExNX1dJS0lfUFJPSkVDVF9QQVRIOi19IgogIGlmIGhlYWx0aDsgdGhlbgogICAgZWNobyAiYnJpZGdlX3N0YXR1cz1vbmxpbmUiCiAgICBjdXJsIC1mc1MgImh0dHA6Ly8ke0JSSURHRV9IT1NUOi0xMjcuMC4wLjF9OiR7QlJJREdFX1BPUlQ6LTg3ODd9L3NldHVwIiB8fCB0cnVlCiAgICBlY2hvCiAgZWxzZQogICAgZWNobyAiYnJpZGdlX3N0YXR1cz1vZmZsaW5lIgogIGZpCiAgaWYgY3VybCAtZnNTICIke0xMTV9XSUtJX0FQSV9VUkw6LWh0dHA6Ly8xMjcuMC4wLjE6MTk4Mjh9L2hlYWx0aCIgPi9kZXYvbnVsbCAyPiYxOyB0aGVuCiAgICBlY2hvICJsbG1fd2lraT1vbmxpbmUiCiAgZWxzZQogICAgZWNobyAibGxtX3dpa2k9b2ZmbGluZSIKICBmaQp9CgpjbWRfaW5pdF9wcm9qZWN0KCkgewogIGxvYWRfZW52CiAgIiRQWVRIT05fQklOIiAtIDw8J1BZJwpmcm9tIHRvcGljX2JyaWRnZS5jb25maWcgaW1wb3J0IGxvYWRfY29uZmlnCmZyb20gdG9waWNfYnJpZGdlLmJvb3RzdHJhcCBpbXBvcnQgZW5zdXJlX3Byb2plY3QKaW1wb3J0IGpzb24KcHJpbnQoanNvbi5kdW1wcyhlbnN1cmVfcHJvamVjdChsb2FkX2NvbmZpZygpKSwgZW5zdXJlX2FzY2lpPUZhbHNlLCBpbmRlbnQ9MikpClBZCn0KCmNtZF9zdGFydF9sbG1fd2lraSgpIHsKICBsb2FkX2VudgogIGlmIGN1cmwgLWZzUyAiJHtMTE1fV0lLSV9BUElfVVJMOi1odHRwOi8vMTI3LjAuMC4xOjE5ODI4fS9oZWFsdGgiID4vZGV2L251bGwgMj4mMTsgdGhlbgogICAgZWNobyAiW2x1bWluYS1icmlkZ2VdIGxsbV93aWtpIGFscmVhZHkgb25saW5lIgogICAgcmV0dXJuIDAKICBmaQogIGlmIFtbIC1kICIvQXBwbGljYXRpb25zL0xMTSBXaWtpLmFwcCIgXV07IHRoZW4KICAgIG9wZW4gLWEgIi9BcHBsaWNhdGlvbnMvTExNIFdpa2kuYXBwIgogICAgZWNobyAiW2x1bWluYS1icmlkZ2VdIGxhdW5jaGVkIC9BcHBsaWNhdGlvbnMvTExNIFdpa2kuYXBwIgogICAgcmV0dXJuIDAKICBmaQogIGlmIFtbIC1kICIkSE9NRS9BcHBsaWNhdGlvbnMvTExNIFdpa2kuYXBwIiBdXTsgdGhlbgogICAgb3BlbiAtYSAiJEhPTUUvQXBwbGljYXRpb25zL0xMTSBXaWtpLmFwcCIKICAgIGVjaG8gIltsdW1pbmEtYnJpZGdlXSBsYXVuY2hlZCAkSE9NRS9BcHBsaWNhdGlvbnMvTExNIFdpa2kuYXBwIgogICAgcmV0dXJuIDAKICBmaQogIGlmIGNvbW1hbmQgLXYgbGxtLXdpa2kgPi9kZXYvbnVsbCAyPiYxOyB0aGVuCiAgICBub2h1cCBsbG0td2lraSA+L2Rldi9udWxsIDI+JjEgJgogICAgZWNobyAiW2x1bWluYS1icmlkZ2VdIGxhdW5jaGVkIGxsbS13aWtpIENMSSIKICAgIHJldHVybiAwCiAgZmkKICBlY2hvICJbbHVtaW5hLWJyaWRnZV0gTExNIFdpa2kgbm90IGluc3RhbGxlZCIKICBlY2hvICJEb3dubG9hZDogaHR0cHM6Ly9naXRodWIuY29tL25hc2hzdS9sbG1fd2lraS9yZWxlYXNlcy9sYXRlc3QiCiAgcmV0dXJuIDEKfQoKY21kX2VudigpIHsKICBpZiBbWyAhIC1mICIkRU5WX0ZJTEUiIF1dOyB0aGVuCiAgICBlY2hvICJtaXNzaW5nICRFTlZfRklMRSIgPiYyCiAgICBleGl0IDEKICBmaQogIGVjaG8gIiRFTlZfRklMRSIKICBzZWQgJ3MvXlwoTFVNSU5BX0lOVEVSTkFMX1RPS0VOXHxCUklER0VfVE9LRU5cKT0uKi9cMT0qKiovJyAiJEVOVl9GSUxFIgp9CgpjbWRfcmVjb25maWd1cmUoKSB7CiAgbG9jYWwgbm9uX2ludGVyYWN0aXZlPSIkezE6LTB9IgogIGlmIFtbIC1mICIkRU5WX0ZJTEUiIF1dOyB0aGVuCiAgICBzZXQgLWEKICAgIHNvdXJjZSAiJEVOVl9GSUxFIgogICAgc2V0ICthCiAgZmkKICBsb2NhbCBob3N0IHBvcnQgdG9rZW4gbHVtaW5hX3VybCBpbnRlcm5hbCB3aWtpX3VybCBwcm9qZWN0X3BhdGggcHJvamVjdF9uYW1lIGkKICBob3N0PSIke0JSSURHRV9IT1NUOi0xMjcuMC4wLjF9IgogIHBvcnQ9IiR7QlJJREdFX1BPUlQ6LTg3ODd9IgogIHRva2VuPSIke0JSSURHRV9UT0tFTjotfSIKICBsdW1pbmFfdXJsPSIke0xVTUlOQV9CQVNFX1VSTDotaHR0cDovLzEyNy4wLjAuMTo4MDAwL2JhY2tlbmR9IgogIGludGVybmFsPSIke0xVTUlOQV9JTlRFUk5BTF9UT0tFTjotfSIKICB3aWtpX3VybD0iJHtMTE1fV0lLSV9BUElfVVJMOi1odHRwOi8vMTI3LjAuMC4xOjE5ODI4fSIKICBwcm9qZWN0X3BhdGg9IiR7TExNX1dJS0lfUFJPSkVDVF9QQVRIOi0kSE9NRS9Eb2N1bWVudHMvTHVtaW5hLUtub3dsZWRnZX0iCiAgcHJvamVjdF9uYW1lPSIke0xMTV9XSUtJX1BST0pFQ1RfTkFNRTotTHVtaW5hLUtub3dsZWRnZX0iCiAgaWYgW1sgIiRub25faW50ZXJhY3RpdmUiICE9ICIxIiBdXTsgdGhlbgogICAgcmVhZCAtciAtcCAiQnJpZGdlIGhvc3QgWyRob3N0XTogIiBpOyBob3N0PSIke2k6LSRob3N0fSIKICAgIHJlYWQgLXIgLXAgIkJyaWRnZSBwb3J0IFskcG9ydF06ICIgaTsgcG9ydD0iJHtpOi0kcG9ydH0iCiAgICByZWFkIC1yIC1wICJCcmlkZ2UgdG9rZW4gWyR0b2tlbl06ICIgaTsgdG9rZW49IiR7aTotJHRva2VufSIKICAgIHJlYWQgLXIgLXAgIkx1bWluYSBVUkwgWyRsdW1pbmFfdXJsXTogIiBpOyBsdW1pbmFfdXJsPSIke2k6LSRsdW1pbmFfdXJsfSIKICAgIHJlYWQgLXIgLXAgIkludGVybmFsIHRva2VuIFskaW50ZXJuYWxdOiAiIGk7IGludGVybmFsPSIke2k6LSRpbnRlcm5hbH0iCiAgICByZWFkIC1yIC1wICJMTE0gV2lraSBBUEkgWyR3aWtpX3VybF06ICIgaTsgd2lraV91cmw9IiR7aTotJHdpa2lfdXJsfSIKICAgIHJlYWQgLXIgLXAgIlByb2plY3QgcGF0aCBbJHByb2plY3RfcGF0aF06ICIgaTsgcHJvamVjdF9wYXRoPSIke2k6LSRwcm9qZWN0X3BhdGh9IgogICAgcmVhZCAtciAtcCAiUHJvamVjdCBuYW1lIFskcHJvamVjdF9uYW1lXTogIiBpOyBwcm9qZWN0X25hbWU9IiR7aTotJHByb2plY3RfbmFtZX0iCiAgZmkKICBjYXQgPiAiJEVOVl9GSUxFIiA8PEVPRgpCUklER0VfSE9TVD0kaG9zdApCUklER0VfUE9SVD0kcG9ydApCUklER0VfVE9LRU49JHRva2VuCgpMVU1JTkFfQkFTRV9VUkw9JHtsdW1pbmFfdXJsJS99CkxVTUlOQV9JTlRFUk5BTF9UT0tFTj0kaW50ZXJuYWwKCkxMTV9XSUtJX0FQSV9VUkw9JHt3aWtpX3VybCUvfQpMTE1fV0lLSV9QUk9KRUNUX1BBVEg9JHByb2plY3RfcGF0aApMTE1fV0lLSV9QUk9KRUNUX0lEPQpMTE1fV0lLSV9QUk9KRUNUX05BTUU9JHByb2plY3RfbmFtZQoKUkFXX1NVQkRJUj1yYXcvc291cmNlcy9sdW1pbmEKU1RBVEVfUEFUSD0uYnJpZGdlL3N0YXRlLmpzb24KRU9GCiAgZWNobyAiW2x1bWluYS1icmlkZ2VdIHdyb3RlICRFTlZfRklMRSIKfQoKdXNhZ2UoKSB7CiAgY2F0IDw8J1VTQUdFJwpsdW1pbmEtYnJpZGdlIGNvbW1hbmRzOgogIHN0YXJ0IHwgc3RvcCB8IHJlc3RhcnQgfCBzdGF0dXMKICBpbml0LXByb2plY3QgfCBzdGFydC1sbG0td2lraQogIGVudiB8IHJlY29uZmlndXJlIHwgbG9ncwpVU0FHRQp9CgpjbWQ9IiR7MTotc3RhdHVzfSIKY2FzZSAiJGNtZCIgaW4KICBzdGFydCkgY21kX3N0YXJ0IDs7CiAgc3RvcCkgY21kX3N0b3AgOzsKICByZXN0YXJ0KSBjbWRfc3RvcCB8fCB0cnVlOyBjbWRfc3RhcnQgOzsKICBzdGF0dXMpIGNtZF9zdGF0dXMgOzsKICBpbml0LXByb2plY3QpIGNtZF9pbml0X3Byb2plY3QgOzsKICBzdGFydC1sbG0td2lraSkgY21kX3N0YXJ0X2xsbV93aWtpIDs7CiAgZW52KSBjbWRfZW52IDs7CiAgcmVjb25maWd1cmUpIHNoaWZ0IHx8IHRydWU7IGNtZF9yZWNvbmZpZ3VyZSAiJHsxOi0wfSIgOzsKICBsb2dzKSBta2RpciAtcCAiJFJPT1QvLmJyaWRnZSI7IHRhaWwgLW4gMTAwICIkTE9HX0ZJTEUiIDI+L2Rldi9udWxsIHx8IHRydWUgOzsKICBoZWxwfC1ofC0taGVscCkgdXNhZ2UgOzsKICAqKSB1c2FnZTsgZXhpdCAxIDs7CmVzYWMK" | base64 -d > "$INSTALL_ROOT/bin/lumina-bridge"
chmod +x "$INSTALL_ROOT/bin/lumina-bridge"
echo "[install] wrote lumina-bridge manager"

cat > "$INSTALL_ROOT/.env" <<EOF
BRIDGE_HOST=$BRIDGE_HOST
BRIDGE_PORT=$BRIDGE_PORT
BRIDGE_TOKEN=$BRIDGE_TOKEN

LUMINA_BASE_URL=$LUMINA_BASE_URL
LUMINA_INTERNAL_TOKEN=$LUMINA_INTERNAL_TOKEN

LLM_WIKI_API_URL=$LLM_WIKI_API_URL
LLM_WIKI_PROJECT_PATH=$LLM_WIKI_PROJECT_PATH
LLM_WIKI_PROJECT_ID=
LLM_WIKI_PROJECT_NAME=$LLM_WIKI_PROJECT_NAME

RAW_SUBDIR=raw/sources/lumina
STATE_PATH=.bridge/state.json
EOF
echo "[install] wrote $INSTALL_ROOT/.env"

if [[ "$INIT_PROJECT" -eq 1 ]]; then
  echo "[install] initializing knowledge project: $LLM_WIKI_PROJECT_PATH"
  "$INSTALL_ROOT/bin/lumina-bridge" init-project
fi

if ! command -v lumina-bridge >/dev/null 2>&1; then
  echo "[install] optional PATH setup:"
  echo "  export PATH=\"$INSTALL_ROOT/bin:\$PATH\""
fi

if [[ "$START_AFTER_INSTALL" -eq 1 ]]; then
  "$INSTALL_ROOT/bin/lumina-bridge" stop >/dev/null 2>&1 || true
  if curl -fsS "http://$BRIDGE_HOST:$BRIDGE_PORT/health" >/dev/null 2>&1; then
    echo "[install] port $BRIDGE_PORT already healthy; skip restart"
  else
    "$INSTALL_ROOT/bin/lumina-bridge" start
  fi
fi

cat <<EOF

[install] done

Home:     $INSTALL_ROOT
Bridge:   http://$BRIDGE_HOST:$BRIDGE_PORT
Project:  $LLM_WIKI_PROJECT_PATH
Command:  $INSTALL_ROOT/bin/lumina-bridge

Fill Lumina Topic Settings with:
  Bridge URL = http://$BRIDGE_HOST:$BRIDGE_PORT
  Bridge Token = (same as installer, if set)
  Project path = $LLM_WIKI_PROJECT_PATH

Useful:
  $INSTALL_ROOT/bin/lumina-bridge status
  $INSTALL_ROOT/bin/lumina-bridge restart
  $INSTALL_ROOT/bin/lumina-bridge reconfigure
  $INSTALL_ROOT/bin/lumina-bridge logs

LLM Wiki desktop app still needs official install once:
  https://github.com/nashsu/llm_wiki/releases/latest
EOF
