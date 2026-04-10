from __future__ import annotations

import re

GITHUB_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")


def _normalize_github_username(value: str | None) -> str | None:
    normalized = (value or "").strip()
    if not normalized:
        return None
    if GITHUB_USERNAME_PATTERN.fullmatch(normalized) is None:
        return None
    return normalized


def build_user_github_url(
    provider: str | None,
    user_id: str | None,
    github_username: str | None = None,
    user_name: str | None = None,
) -> str | None:
    if provider != "github":
        return None

    resolved_username = _normalize_github_username(github_username)
    if resolved_username is None:
        resolved_username = _normalize_github_username(user_name)

    if resolved_username:
        return f"https://github.com/{resolved_username}"
    return None
