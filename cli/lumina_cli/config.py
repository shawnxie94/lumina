from __future__ import annotations

import os
import re
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .errors import ConfigError

try:
    import yaml  # type: ignore
except Exception:  # noqa: BLE001
    yaml = None


DEFAULT_HOME = Path.home() / ".lumina"
DEFAULT_CONFIG_PATH = DEFAULT_HOME / "config.yaml"
DEFAULT_BRIDGE_ROOT = DEFAULT_HOME / "topic-bridge"


def mask_secret(value: str | None) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:2]}***{value[-2:]}"


@dataclass
class LuminaRemoteConfig:
    base_url: str = "http://127.0.0.1:8000/backend"
    token: str = ""
    timeout_sec: int = 30


@dataclass
class BridgeConfig:
    host: str = "127.0.0.1"
    port: int = 8787
    token: str = ""
    autostart: bool = True
    root: str = str(DEFAULT_BRIDGE_ROOT)


@dataclass
class ProfileDefaults:
    output: str = "table"
    sync_mode: str = "incremental"


@dataclass
class Profile:
    lumina: LuminaRemoteConfig = field(default_factory=LuminaRemoteConfig)
    bridge: BridgeConfig = field(default_factory=BridgeConfig)
    defaults: ProfileDefaults = field(default_factory=ProfileDefaults)


@dataclass
class Project:
    provider: str = "llm_wiki"
    path: str = str(Path.home() / ".lumina" / "knowledge" / "Lumina-Knowledge")
    name: str = "Lumina-Knowledge"
    options: dict[str, Any] = field(default_factory=dict)
    linked_profile: str = "default"


@dataclass
class ProviderConfig:
    enabled: bool = True
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class AppConfig:
    active_profile: str = "default"
    active_project: str = "main"
    profiles: dict[str, Profile] = field(default_factory=dict)
    projects: dict[str, Project] = field(default_factory=dict)
    providers: dict[str, ProviderConfig] = field(default_factory=dict)

    def ensure_defaults(self) -> None:
        if not self.profiles:
            self.profiles["default"] = Profile()
        if self.active_profile not in self.profiles:
            self.active_profile = next(iter(self.profiles.keys()))
        if not self.projects:
            self.projects["main"] = Project()
        if self.active_project not in self.projects:
            self.active_project = next(iter(self.projects.keys()))
        if "llm_wiki" not in self.providers:
            self.providers["llm_wiki"] = ProviderConfig(
                enabled=True,
                options={"api_url": "http://127.0.0.1:19828"},
            )
        if "generic_fs" not in self.providers:
            self.providers["generic_fs"] = ProviderConfig(
                enabled=True,
                options={},
            )

    def profile(self, name: str | None = None) -> Profile:
        self.ensure_defaults()
        key = name or self.active_profile
        if key not in self.profiles:
            raise ConfigError(f"profile not found: {key}", hint="Run `lumina profile list`")
        return self.profiles[key]

    def project(self, name: str | None = None) -> Project:
        self.ensure_defaults()
        key = name or self.active_project
        if key not in self.projects:
            raise ConfigError(f"project not found: {key}", hint="Run `lumina knowledge status`")
        return self.projects[key]


def config_path_from_env() -> Path:
    raw = os.environ.get("LUMINA_CONFIG") or os.environ.get("LUMINA_CLI_CONFIG")
    if raw:
        return Path(raw).expanduser()
    return DEFAULT_CONFIG_PATH


def default_config() -> AppConfig:
    cfg = AppConfig(
        active_profile="default",
        active_project="main",
        profiles={"default": Profile()},
        projects={"main": Project()},
        providers={
            "llm_wiki": ProviderConfig(enabled=True, options={"api_url": "http://127.0.0.1:19828"}),
            "generic_fs": ProviderConfig(enabled=True, options={}),
        },
    )
    cfg.ensure_defaults()
    return cfg


def _to_dict(cfg: AppConfig) -> dict[str, Any]:
    raw = asdict(cfg)
    return raw


def _from_dict(data: dict[str, Any]) -> AppConfig:
    profiles: dict[str, Profile] = {}
    for name, item in (data.get("profiles") or {}).items():
        lumina_raw = item.get("lumina") or {}
        bridge_raw = item.get("bridge") or {}
        defaults_raw = item.get("defaults") or {}
        profiles[name] = Profile(
            lumina=LuminaRemoteConfig(
                base_url=str(lumina_raw.get("base_url") or "http://127.0.0.1:8000/backend"),
                token=str(lumina_raw.get("token") or ""),
                timeout_sec=int(lumina_raw.get("timeout_sec") or 30),
            ),
            bridge=BridgeConfig(
                host=str(bridge_raw.get("host") or "127.0.0.1"),
                port=int(bridge_raw.get("port") or 8787),
                token=str(bridge_raw.get("token") or ""),
                autostart=bool(bridge_raw.get("autostart", True)),
                root=str(bridge_raw.get("root") or DEFAULT_BRIDGE_ROOT),
            ),
            defaults=ProfileDefaults(
                output=str(defaults_raw.get("output") or "table"),
                sync_mode=str(defaults_raw.get("sync_mode") or "incremental"),
            ),
        )

    projects: dict[str, Project] = {}
    for name, item in (data.get("projects") or {}).items():
        projects[name] = Project(
            provider=str(item.get("provider") or "llm_wiki"),
            path=str(item.get("path") or Path.home() / ".lumina" / "knowledge" / "Lumina-Knowledge"),
            name=str(item.get("name") or name),
            options=dict(item.get("options") or {}),
            linked_profile=str(item.get("linked_profile") or data.get("active_profile") or "default"),
        )

    providers: dict[str, ProviderConfig] = {}
    for name, item in (data.get("providers") or {}).items():
        providers[name] = ProviderConfig(
            enabled=bool(item.get("enabled", True)),
            options=dict(item.get("options") or {}),
        )

    cfg = AppConfig(
        active_profile=str(data.get("active_profile") or "default"),
        active_project=str(data.get("active_project") or "main"),
        profiles=profiles,
        projects=projects,
        providers=providers,
    )
    cfg.ensure_defaults()
    return cfg


def _dump_yaml(data: dict[str, Any]) -> str:
    if yaml is not None:
        return yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    # minimal fallback serializer
    return _simple_yaml_dump(data)


def _load_yaml(text: str) -> dict[str, Any]:
    if yaml is not None:
        data = yaml.safe_load(text) or {}
        if not isinstance(data, dict):
            raise ConfigError("config root must be a mapping")
        return data
    return _simple_yaml_load(text)


def _simple_yaml_dump(data: Any, indent: int = 0) -> str:
    sp = "  " * indent
    if isinstance(data, dict):
        lines = []
        for k, v in data.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{sp}{k}:")
                lines.append(_simple_yaml_dump(v, indent + 1).rstrip())
            else:
                lines.append(f"{sp}{k}: {_format_scalar(v)}")
        return "\n".join(lines) + "\n"
    if isinstance(data, list):
        lines = []
        for item in data:
            if isinstance(item, (dict, list)):
                lines.append(f"{sp}-")
                lines.append(_simple_yaml_dump(item, indent + 1).rstrip())
            else:
                lines.append(f"{sp}- {_format_scalar(item)}")
        return "\n".join(lines) + "\n"
    return f"{sp}{_format_scalar(data)}\n"


def _format_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "" or any(ch in text for ch in [":", "#", "{", "}", "[", "]", ",", "&", "*", "!", "|", ">", "'", "%", "@", "`"]) or text.strip() != text:
        return json_dumps(text)
    return text


def json_dumps(value: str) -> str:
    import json
    return json.dumps(value, ensure_ascii=False)


def _simple_yaml_load(text: str) -> dict[str, Any]:
    # Very small YAML subset loader for our config only.
    try:
        import json
        # if user wrote json by mistake
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    if yaml is None:
        # Prefer PyYAML if present; otherwise require JSON-compatible fallback for complex edits.
        # For bootstrap we write with our dumper and parse via a tolerant line parser.
        return _line_yaml_load(text)
    raise ConfigError("PyYAML is required to parse config", hint="pip install pyyaml")


def _line_yaml_load(text: str) -> dict[str, Any]:
    """Parse the limited YAML we ourselves dump."""
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    root: dict[str, Any] = {}
    stack: list[tuple[int, Any]] = [(-1, root)]
    for raw in lines:
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if line.startswith("- "):
            # lists not used heavily; skip advanced
            continue
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip()
        if val == "":
            node: Any = {}
            if isinstance(parent, dict):
                parent[key] = node
            stack.append((indent, node))
        else:
            parsed = _parse_scalar(val)
            if isinstance(parent, dict):
                parent[key] = parsed
    return root


def _parse_scalar(text: str) -> Any:
    import json
    if text in {"null", "Null", "NULL", "~"}:
        return None
    if text in {"true", "True"}:
        return True
    if text in {"false", "False"}:
        return False
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d+", text):
        return float(text)
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        try:
            return json.loads(text) if text.startswith('"') else text[1:-1]
        except Exception:
            return text[1:-1]
    return text


def load_config(path: Path | None = None) -> AppConfig:
    cfg_path = path or config_path_from_env()
    if not cfg_path.exists():
        return default_config()
    try:
        data = _load_yaml(cfg_path.read_text(encoding="utf-8"))
    except ConfigError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ConfigError(f"failed to read config: {exc}", hint=f"Check {cfg_path}") from exc
    return _from_dict(data)


def save_config(cfg: AppConfig, path: Path | None = None) -> Path:
    cfg.ensure_defaults()
    cfg_path = path or config_path_from_env()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    content = _dump_yaml(_to_dict(cfg))
    cfg_path.write_text(content, encoding="utf-8")
    try:
        os.chmod(cfg_path, 0o600)
    except Exception:
        pass
    return cfg_path


def ensure_config(path: Path | None = None) -> tuple[AppConfig, Path, bool]:
    cfg_path = path or config_path_from_env()
    if cfg_path.exists():
        return load_config(cfg_path), cfg_path, False
    cfg = default_config()
    save_config(cfg, cfg_path)
    return cfg, cfg_path, True


def set_by_path(cfg: AppConfig, key: str, value: str) -> None:
    cfg.ensure_defaults()
    parts = key.split(".")
    if not parts:
        raise ConfigError("empty config key")

    # Convenience aliases
    aliases = {
        "base_url": "lumina.base_url",
        "token": "lumina.token",
        "bridge.port": "bridge.port",
        "bridge.host": "bridge.host",
        "bridge.token": "bridge.token",
        "knowledge.provider": "project.provider",
        "knowledge.path": "project.path",
        "project_path": "project.path",
        "provider": "project.provider",
    }
    key = aliases.get(key, key)
    parts = key.split(".")

    profile = cfg.profile()
    project = cfg.project()

    if parts[0] == "active_profile" and len(parts) == 1:
        if value not in cfg.profiles:
            raise ConfigError(f"profile not found: {value}")
        cfg.active_profile = value
        return
    if parts[0] == "active_project" and len(parts) == 1:
        if value not in cfg.projects:
            raise ConfigError(f"project not found: {value}")
        cfg.active_project = value
        return

    if parts[0] == "lumina" and len(parts) == 2:
        field = parts[1]
        if field == "base_url":
            profile.lumina.base_url = value.rstrip("/")
        elif field == "token":
            profile.lumina.token = value
        elif field == "timeout_sec":
            profile.lumina.timeout_sec = int(value)
        else:
            raise ConfigError(f"unknown key: {key}")
        return

    if parts[0] == "bridge" and len(parts) == 2:
        field = parts[1]
        if field == "host":
            profile.bridge.host = value
        elif field == "port":
            profile.bridge.port = int(value)
        elif field == "token":
            profile.bridge.token = value
        elif field == "root":
            profile.bridge.root = str(Path(value).expanduser())
        elif field == "autostart":
            profile.bridge.autostart = value.lower() in {"1", "true", "yes", "on"}
        else:
            raise ConfigError(f"unknown key: {key}")
        return

    if parts[0] == "project" and len(parts) == 2:
        field = parts[1]
        if field == "provider":
            project.provider = value
        elif field == "path":
            project.path = str(Path(value).expanduser())
        elif field == "name":
            project.name = value
        else:
            raise ConfigError(f"unknown key: {key}")
        return

    if parts[0] == "defaults" and len(parts) == 2:
        field = parts[1]
        if field == "output":
            profile.defaults.output = value
        elif field == "sync_mode":
            profile.defaults.sync_mode = value
        else:
            raise ConfigError(f"unknown key: {key}")
        return

    raise ConfigError(
        f"unknown key: {key}",
        hint="Examples: lumina.base_url, lumina.token, bridge.port, project.provider, project.path",
    )


def get_by_path(cfg: AppConfig, key: str | None = None, *, reveal: bool = False) -> Any:
    cfg.ensure_defaults()
    if not key:
        data = _to_dict(cfg)
        if not reveal:
            _mask_tokens(data)
        return data

    aliases = {
        "base_url": "lumina.base_url",
        "token": "lumina.token",
        "knowledge.provider": "project.provider",
        "knowledge.path": "project.path",
        "provider": "project.provider",
        "project_path": "project.path",
    }
    key = aliases.get(key, key)
    profile = cfg.profile()
    project = cfg.project()
    mapping = {
        "active_profile": cfg.active_profile,
        "active_project": cfg.active_project,
        "lumina.base_url": profile.lumina.base_url,
        "lumina.token": profile.lumina.token if reveal else mask_secret(profile.lumina.token),
        "lumina.timeout_sec": profile.lumina.timeout_sec,
        "bridge.host": profile.bridge.host,
        "bridge.port": profile.bridge.port,
        "bridge.token": profile.bridge.token if reveal else mask_secret(profile.bridge.token),
        "bridge.root": profile.bridge.root,
        "bridge.autostart": profile.bridge.autostart,
        "project.provider": project.provider,
        "project.path": project.path,
        "project.name": project.name,
        "defaults.output": profile.defaults.output,
        "defaults.sync_mode": profile.defaults.sync_mode,
    }
    if key not in mapping:
        raise ConfigError(f"unknown key: {key}")
    return mapping[key]


def _mask_tokens(data: Any) -> None:
    if isinstance(data, dict):
        for k, v in data.items():
            if k in {"token"} and isinstance(v, str):
                data[k] = mask_secret(v)
            else:
                _mask_tokens(v)
    elif isinstance(data, list):
        for item in data:
            _mask_tokens(item)


def validate_config(cfg: AppConfig) -> list[str]:
    cfg.ensure_defaults()
    errors: list[str] = []
    if cfg.active_profile not in cfg.profiles:
        errors.append(f"active_profile missing: {cfg.active_profile}")
    if cfg.active_project not in cfg.projects:
        errors.append(f"active_project missing: {cfg.active_project}")
    profile = cfg.profile()
    if not profile.lumina.base_url:
        errors.append("lumina.base_url is empty")
    if profile.bridge.port <= 0 or profile.bridge.port > 65535:
        errors.append("bridge.port is invalid")
    project = cfg.project()
    if not project.provider:
        errors.append("project.provider is empty")
    if not project.path:
        errors.append("project.path is empty")
    return errors


def bridge_base_url(profile: Profile) -> str:
    return f"http://{profile.bridge.host}:{profile.bridge.port}"
