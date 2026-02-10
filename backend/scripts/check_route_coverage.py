#!/usr/bin/env python3
"""Check route coverage between modular app routers and legacy routes.

Usage:
  cd backend
  python scripts/check_route_coverage.py
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from fastapi.routing import APIRoute

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.legacy.legacy_main import app as legacy_app
from app.main import app as modular_app


@dataclass(frozen=True, order=True)
class RouteKey:
    path: str
    methods: tuple[str, ...]


def normalize_methods(route: APIRoute) -> tuple[str, ...]:
    methods = route.methods or set()
    return tuple(sorted(method for method in methods if method not in {"HEAD", "OPTIONS"}))


def collect_routes(app) -> tuple[set[RouteKey], Counter[RouteKey]]:
    keys: list[RouteKey] = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if not (route.path.startswith("/api") or route.path == "/"):
            continue
        key = RouteKey(path=route.path, methods=normalize_methods(route))
        keys.append(key)
    return set(keys), Counter(keys)


def print_routes(title: str, keys: list[RouteKey]) -> None:
    print(title)
    for key in keys:
        methods = ",".join(key.methods) if key.methods else "<none>"
        print(f"  - {methods:10s} {key.path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check modular router coverage")
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print all missing/extra/duplicate route signatures",
    )
    args = parser.parse_args()

    legacy_routes, legacy_counter = collect_routes(legacy_app)
    modular_routes, modular_counter = collect_routes(modular_app)

    missing = sorted(legacy_routes - modular_routes)
    extra = sorted(modular_routes - legacy_routes)
    legacy_dupes = sorted([key for key, count in legacy_counter.items() if count > 1])
    modular_dupes = sorted([key for key, count in modular_counter.items() if count > 1])

    print("Route coverage check")
    print(f"  legacy routes : {len(legacy_routes)}")
    print(f"  modular routes: {len(modular_routes)}")
    print(f"  missing       : {len(missing)}")
    print(f"  extra         : {len(extra)}")
    print(f"  legacy dupes  : {len(legacy_dupes)}")
    print(f"  modular dupes : {len(modular_dupes)}")

    if args.verbose and missing:
        print_routes("Missing routes in modular app:", missing)
    if args.verbose and extra:
        print_routes("Extra routes in modular app:", extra)
    if args.verbose and modular_dupes:
        print_routes("Duplicate signatures in modular app:", modular_dupes)

    has_error = bool(missing or extra or modular_dupes or legacy_dupes)
    if has_error:
        print("\nFAIL: route coverage mismatch detected.")
        print("Tip: run with --verbose to inspect route signatures.")
        return 1

    print("\nPASS: modular routes fully cover legacy API signatures.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
