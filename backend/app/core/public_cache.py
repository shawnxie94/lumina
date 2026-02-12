from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Generic, TypeVar

from fastapi import Response

PUBLIC_CACHE_TTL_SECONDS = 30
PUBLIC_CACHE_CONTROL = (
    f"public, max-age={PUBLIC_CACHE_TTL_SECONDS}, "
    f"stale-while-revalidate={PUBLIC_CACHE_TTL_SECONDS}"
)

CACHE_KEY_SETTINGS_BASIC_PUBLIC = "settings:basic:public"
CACHE_KEY_SETTINGS_COMMENTS_PUBLIC = "settings:comments:public"
CACHE_KEY_CATEGORIES_PUBLIC = "categories:public"
CACHE_KEY_AUTHORS_PUBLIC = "authors:public"
CACHE_KEY_SOURCES_PUBLIC = "sources:public"

T = TypeVar("T")


@dataclass
class _CacheEntry(Generic[T]):
    expire_at: float
    value: T


class PublicTTLCache:
    def __init__(self) -> None:
        self._lock = Lock()
        self._store: dict[str, _CacheEntry[object]] = {}

    def get_or_set(
        self,
        key: str,
        loader: Callable[[], T],
        ttl_seconds: int = PUBLIC_CACHE_TTL_SECONDS,
    ) -> T:
        now = monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry and entry.expire_at > now:
                return deepcopy(entry.value)
            if entry and entry.expire_at <= now:
                self._store.pop(key, None)

        value = loader()
        expire_at = now + max(1, ttl_seconds)
        cached_value = deepcopy(value)
        with self._lock:
            self._store[key] = _CacheEntry(expire_at=expire_at, value=cached_value)
        return deepcopy(cached_value)

    def invalidate(self, *keys: str) -> None:
        if not keys:
            return
        with self._lock:
            for key in keys:
                self._store.pop(key, None)

    def invalidate_prefix(self, *prefixes: str) -> None:
        if not prefixes:
            return
        with self._lock:
            stale_keys = [
                key
                for key in self._store
                if any(key.startswith(prefix) for prefix in prefixes)
            ]
            for key in stale_keys:
                self._store.pop(key, None)


_public_cache = PublicTTLCache()


def get_public_cached(
    key: str,
    loader: Callable[[], T],
    ttl_seconds: int = PUBLIC_CACHE_TTL_SECONDS,
) -> T:
    return _public_cache.get_or_set(key=key, loader=loader, ttl_seconds=ttl_seconds)


def invalidate_public_cache(*keys: str) -> None:
    _public_cache.invalidate(*keys)


def invalidate_public_cache_prefix(*prefixes: str) -> None:
    _public_cache.invalidate_prefix(*prefixes)


def apply_public_cache_headers(response: Response) -> None:
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    existing_vary = response.headers.get("Vary", "")
    vary_values = [item.strip() for item in existing_vary.split(",") if item.strip()]
    if "Authorization" not in vary_values:
        vary_values.append("Authorization")
    response.headers["Vary"] = ", ".join(vary_values)
