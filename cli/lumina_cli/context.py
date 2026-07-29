from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import (
    AppConfig,
    Profile,
    Project,
    bridge_base_url,
    config_path_from_env,
    load_config,
    save_config,
)
from .errors import ConfigError
from .http import HttpClient


@dataclass
class CliContext:
    config: AppConfig
    config_path: Path
    profile_name: str
    output: str = "table"
    yes: bool = False
    verbose: bool = False
    quiet: bool = False
    base_url_override: str | None = None
    token_override: str | None = None

    @property
    def profile(self) -> Profile:
        return self.config.profile(self.profile_name)

    @property
    def project(self) -> Project:
        return self.config.project()

    def save(self) -> Path:
        return save_config(self.config, self.config_path)

    def remote_client(self) -> HttpClient:
        profile = self.profile
        base_url = self.base_url_override or profile.lumina.base_url
        token = self.token_override if self.token_override is not None else profile.lumina.token
        return HttpClient(
            base_url=base_url,
            token=token or "",
            timeout_sec=profile.lumina.timeout_sec,
            token_header="X-Internal-Token",
            bearer=False,
        )

    def bridge_url(self) -> str:
        return bridge_base_url(self.profile)


def build_context(
    *,
    config_path: str | None,
    profile: str | None,
    output: str | None,
    yes: bool,
    verbose: bool,
    quiet: bool,
    base_url: str | None,
    token: str | None,
) -> CliContext:
    path = Path(config_path).expanduser() if config_path else config_path_from_env()
    cfg = load_config(path)
    cfg.ensure_defaults()
    profile_name = profile or cfg.active_profile
    if profile_name not in cfg.profiles:
        raise ConfigError(f"profile not found: {profile_name}", hint="Run `lumina profile list`")
    out = output or cfg.profile(profile_name).defaults.output or "table"
    return CliContext(
        config=cfg,
        config_path=path,
        profile_name=profile_name,
        output=out,
        yes=yes,
        verbose=verbose,
        quiet=quiet,
        base_url_override=base_url,
        token_override=token,
    )
