from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from ..config import AppConfig, Profile, Project, ProviderConfig


@dataclass
class ProviderInfo:
    name: str
    title: str
    description: str
    homepage: str = ""
    install_url: str = ""


class KnowledgeProvider(Protocol):
    info: ProviderInfo

    def status(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        ...

    def doctor(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        ...

    def install_guidance(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        ...

    def start(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        ...

    def stop(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        ...

    def init_project(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig, path: str | None = None) -> dict[str, Any]:
        ...
