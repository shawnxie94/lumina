from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_HOME = Path.home() / ".lumina"
DEFAULT_CLI_CONFIG = DEFAULT_HOME / "config.yaml"
DEFAULT_PROJECT = DEFAULT_HOME / "knowledge" / "Lumina-Knowledge"
DEFAULT_LLM_WIKI_URL = "http://127.0.0.1:19828"
DEFAULT_LUMINA_URL = "http://127.0.0.1:8000/backend"
DEFAULT_INTERNAL_TOKEN = "dev-internal-token-change-me"

_CACHE_LOCK = threading.RLock()
_CACHE: dict[str, Any] = {
    "config": None,
    "signature": None,
}


def _load_dotenv_file(path: Path) -> dict[str, str]:
    """Parse a dotenv file into a dict without mutating process env."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')
    return values


def _read_yaml(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
    except Exception:
        yaml = None
    if yaml is not None:
        data = yaml.safe_load(text) or {}
        return data if isinstance(data, dict) else {}
    # Minimal fallback for the flat keys we care about if PyYAML is missing.
    return _parse_simple_yaml_subset(text)


def _parse_simple_yaml_subset(text: str) -> dict[str, Any]:
    """Very small indentation-aware parser for our known config shape."""
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if ":" not in raw:
            continue
        key, value = raw.lstrip(" ").split(":", 1)
        key = key.strip()
        value = value.strip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if value == "" or value in {"|", ">"}:
            child: dict[str, Any] = {}
            parent[key] = child
            stack.append((indent, child))
        else:
            if (
                (value.startswith('"') and value.endswith('"'))
                or (value.startswith("'") and value.endswith("'"))
            ):
                value = value[1:-1]
            parent[key] = value
    return root


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _cli_config_path() -> Path:
    override = (os.environ.get("LUMINA_CONFIG") or "").strip()
    if override:
        return Path(override).expanduser()
    return DEFAULT_CLI_CONFIG


def _bridge_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _env_layer() -> dict[str, str]:
    """Compatibility layer: process env wins over legacy bridge .env file."""
    file_vals = _load_dotenv_file(_bridge_root() / ".env")
    merged = dict(file_vals)
    for key, value in os.environ.items():
        if value is not None:
            merged[key] = value
    return merged


def _provider_api_url(providers: dict[str, Any], project_provider: str, fallback: str) -> str:
    provider_cfg = _as_dict(providers.get(project_provider))
    options = _as_dict(provider_cfg.get("options"))
    api_url = str(options.get("api_url") or "").strip()
    if api_url:
        return api_url.rstrip("/")
    llm_wiki = _as_dict(providers.get("llm_wiki"))
    llm_opts = _as_dict(llm_wiki.get("options"))
    api_url = str(llm_opts.get("api_url") or "").strip()
    if api_url:
        return api_url.rstrip("/")
    return fallback.rstrip("/")


def _from_cli_yaml(path: Path) -> dict[str, Any] | None:
    data = _read_yaml(path)
    if not data:
        return None

    active_profile = str(data.get("active_profile") or "default")
    active_project = str(data.get("active_project") or "main")
    profiles = _as_dict(data.get("profiles"))
    projects = _as_dict(data.get("projects"))
    providers = _as_dict(data.get("providers"))

    profile = _as_dict(profiles.get(active_profile) or profiles.get("default") or next(iter(profiles.values()), {}))
    project = _as_dict(projects.get(active_project) or projects.get("main") or next(iter(projects.values()), {}))
    lumina = _as_dict(profile.get("lumina"))
    bridge = _as_dict(profile.get("bridge"))

    project_path = Path(
        str(project.get("path") or DEFAULT_PROJECT)
    ).expanduser()
    project_name = str(project.get("name") or project_path.name or "Lumina-Knowledge")
    project_provider = str(project.get("provider") or "llm_wiki")
    project_options = _as_dict(project.get("options"))

    return {
        "source": "cli_config",
        "config_path": str(path),
        "host": str(bridge.get("host") or "127.0.0.1"),
        "port": int(bridge.get("port") or 8787),
        "bridge_token": (str(bridge.get("token") or "").strip() or None),
        "lumina_base_url": str(lumina.get("base_url") or DEFAULT_LUMINA_URL).rstrip("/"),
        "lumina_internal_token": str(lumina.get("token") or ""),
        "llm_wiki_api_url": _provider_api_url(providers, project_provider, DEFAULT_LLM_WIKI_URL),
        "project_path": project_path,
        "project_id": str(project_options.get("project_id") or project.get("id") or ""),
        "project_name": project_name,
        "raw_subdir": str(project_options.get("raw_subdir") or "raw/sources/lumina"),
        "bridge_root": str(bridge.get("root") or DEFAULT_HOME / "topic-bridge"),
    }


def _from_env(env: dict[str, str]) -> dict[str, Any]:
    project_path = Path(
        env.get(
            "LLM_WIKI_PROJECT_PATH",
            str(DEFAULT_PROJECT),
        )
    ).expanduser()
    token = (env.get("BRIDGE_TOKEN") or "").strip() or None
    return {
        "source": "env",
        "config_path": None,
        "host": env.get("BRIDGE_HOST", "127.0.0.1"),
        "port": int(env.get("BRIDGE_PORT", "8787")),
        "bridge_token": token,
        "lumina_base_url": env.get("LUMINA_BASE_URL", DEFAULT_LUMINA_URL).rstrip("/"),
        "lumina_internal_token": env.get("LUMINA_INTERNAL_TOKEN", DEFAULT_INTERNAL_TOKEN),
        "llm_wiki_api_url": env.get("LLM_WIKI_API_URL", DEFAULT_LLM_WIKI_URL).rstrip("/"),
        "project_path": project_path,
        "project_id": env.get("LLM_WIKI_PROJECT_ID", ""),
        "project_name": env.get("LLM_WIKI_PROJECT_NAME", project_path.name),
        "raw_subdir": env.get("RAW_SUBDIR", "raw/sources/lumina"),
        "bridge_root": str(_bridge_root()),
    }


def _resolve_state_path(raw: str | None, bridge_root: Path) -> Path:
    state_env = (raw or ".bridge/state.json").strip() or ".bridge/state.json"
    state_path = Path(state_env).expanduser()
    if not state_path.is_absolute():
        state_path = (bridge_root / state_path).resolve()
    return state_path


def _signature() -> tuple[Any, ...]:
    cli_path = _cli_config_path()
    env_path = _bridge_root() / ".env"
    return (
        str(cli_path),
        cli_path.stat().st_mtime_ns if cli_path.exists() else None,
        env_path.stat().st_mtime_ns if env_path.exists() else None,
        # Selected process env knobs that should bust cache when tests set them.
        os.environ.get("LUMINA_CONFIG"),
        os.environ.get("LUMINA_BASE_URL"),
        os.environ.get("LUMINA_INTERNAL_TOKEN"),
        os.environ.get("LLM_WIKI_PROJECT_PATH"),
        os.environ.get("LLM_WIKI_API_URL"),
        os.environ.get("BRIDGE_HOST"),
        os.environ.get("BRIDGE_PORT"),
        os.environ.get("BRIDGE_TOKEN"),
        os.environ.get("STATE_PATH"),
    )


@dataclass(frozen=True)
class BridgeConfig:
    host: str
    port: int
    bridge_token: str | None
    lumina_base_url: str
    lumina_internal_token: str
    llm_wiki_api_url: str
    project_path: Path
    project_id: str
    project_name: str
    raw_subdir: str
    state_path: Path
    config_source: str = "env"
    config_path: str | None = None

    @property
    def raw_dir(self) -> Path:
        return self.project_path / self.raw_subdir

    @property
    def wiki_dir(self) -> Path:
        return self.project_path / "wiki"


def _build_config() -> BridgeConfig:
    env = _env_layer()
    cli_path = _cli_config_path()
    values = _from_cli_yaml(cli_path)
    if values is None:
        values = _from_env(env)
    else:
        # CLI yaml is the source of truth. Process env / legacy .env must NOT
        # override it — LaunchAgent wrappers commonly `source .env`, which would
        # otherwise freeze remote URL/token until restart.
        #
        # Escape hatch for tests/one-offs:
        #   LUMINA_BRIDGE_ENV_OVERRIDE=1
        force_env = (os.environ.get("LUMINA_BRIDGE_ENV_OVERRIDE") or "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if force_env:
            if "LUMINA_BASE_URL" in os.environ:
                values["lumina_base_url"] = os.environ["LUMINA_BASE_URL"].rstrip("/")
            if "LUMINA_INTERNAL_TOKEN" in os.environ:
                values["lumina_internal_token"] = os.environ["LUMINA_INTERNAL_TOKEN"]
            if "LLM_WIKI_PROJECT_PATH" in os.environ:
                values["project_path"] = Path(os.environ["LLM_WIKI_PROJECT_PATH"]).expanduser()
            if "LLM_WIKI_PROJECT_NAME" in os.environ:
                values["project_name"] = os.environ["LLM_WIKI_PROJECT_NAME"]
            if "LLM_WIKI_PROJECT_ID" in os.environ:
                values["project_id"] = os.environ["LLM_WIKI_PROJECT_ID"]
            if "LLM_WIKI_API_URL" in os.environ:
                values["llm_wiki_api_url"] = os.environ["LLM_WIKI_API_URL"].rstrip("/")
            if "BRIDGE_HOST" in os.environ:
                values["host"] = os.environ["BRIDGE_HOST"]
            if "BRIDGE_PORT" in os.environ:
                values["port"] = int(os.environ["BRIDGE_PORT"])
            if "BRIDGE_TOKEN" in os.environ:
                values["bridge_token"] = (os.environ["BRIDGE_TOKEN"] or "").strip() or None
            if "RAW_SUBDIR" in os.environ:
                values["raw_subdir"] = os.environ["RAW_SUBDIR"]

    bridge_root = Path(str(values.get("bridge_root") or _bridge_root())).expanduser()
    state_path = _resolve_state_path(os.environ.get("STATE_PATH") or env.get("STATE_PATH"), bridge_root)
    token = values.get("lumina_internal_token") or ""
    if not token and values.get("source") != "cli_config":
        token = DEFAULT_INTERNAL_TOKEN

    return BridgeConfig(
        host=str(values.get("host") or "127.0.0.1"),
        port=int(values.get("port") or 8787),
        bridge_token=(str(values.get("bridge_token") or "").strip() or None),
        lumina_base_url=str(values.get("lumina_base_url") or DEFAULT_LUMINA_URL).rstrip("/"),
        lumina_internal_token=str(token),
        llm_wiki_api_url=str(values.get("llm_wiki_api_url") or DEFAULT_LLM_WIKI_URL).rstrip("/"),
        project_path=Path(values["project_path"]).expanduser(),
        project_id=str(values.get("project_id") or ""),
        project_name=str(values.get("project_name") or "Lumina-Knowledge"),
        raw_subdir=str(values.get("raw_subdir") or "raw/sources/lumina"),
        state_path=state_path,
        config_source=str(values.get("source") or "env"),
        config_path=values.get("config_path"),
    )


def load_config(*, force_reload: bool = False) -> BridgeConfig:
    """Load Bridge config with ~/.lumina/config.yaml as source of truth.

    Hot-reloads when the CLI config (or legacy .env / selected env vars) change.
    Legacy bridge `.env` is only a fallback when CLI config is absent, or for
    process-env overrides during tests/one-offs.
    """
    sig = _signature()
    with _CACHE_LOCK:
        cached = _CACHE.get("config")
        if (
            not force_reload
            and cached is not None
            and _CACHE.get("signature") == sig
        ):
            return cached
        config = _build_config()
        _CACHE["config"] = config
        _CACHE["signature"] = sig
        return config


def clear_config_cache() -> None:
    with _CACHE_LOCK:
        _CACHE["config"] = None
        _CACHE["signature"] = None
