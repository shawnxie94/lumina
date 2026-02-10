from collections.abc import Callable
from typing import Iterable

from fastapi import APIRouter
from fastapi.routing import APIRoute

from app.legacy.legacy_main import app as legacy_app

PathMatcher = Callable[[str], bool]


def build_legacy_router(
    *,
    include: Iterable[PathMatcher],
    exclude: Iterable[PathMatcher] | None = None,
) -> APIRouter:
    """Build an APIRouter by reusing validated routes from the legacy app."""

    include_matchers = tuple(include)
    exclude_matchers = tuple(exclude or ())

    router = APIRouter()
    for route in legacy_app.routes:
        if not isinstance(route, APIRoute):
            continue
        path = route.path
        if include_matchers and not any(matcher(path) for matcher in include_matchers):
            continue
        if exclude_matchers and any(matcher(path) for matcher in exclude_matchers):
            continue
        router.routes.append(route)
    return router
