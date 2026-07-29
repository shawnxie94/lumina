from __future__ import annotations

from typing import Dict

from ..errors import CliError
from .base import KnowledgeProvider
from .generic_fs import GenericFsProvider
from .llm_wiki import LlmWikiProvider

_PROVIDERS: Dict[str, KnowledgeProvider] = {
    "llm_wiki": LlmWikiProvider(),
    "generic_fs": GenericFsProvider(),
}


def list_providers() -> list[KnowledgeProvider]:
    return list(_PROVIDERS.values())


def get_provider(name: str) -> KnowledgeProvider:
    key = (name or "").strip()
    if key not in _PROVIDERS:
        known = ", ".join(sorted(_PROVIDERS))
        raise CliError(
            f"unknown knowledge provider: {name}",
            hint=f"Supported: {known}",
            error_code="unknown_provider",
        )
    return _PROVIDERS[key]
