#!/usr/bin/env python3
"""Check route coverage between modular app routers and route contract baseline.

Usage:
  cd backend
  python scripts/check_route_coverage.py
  python scripts/check_route_coverage.py --write-baseline
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from fastapi.routing import APIRoute

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app as modular_app

BASELINE_DEFAULT_PATH = BACKEND_DIR / "scripts" / "route_contract_baseline.json"


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


def load_baseline_routes(baseline_path: Path) -> tuple[set[RouteKey], Counter[RouteKey]]:
    raw = json.loads(baseline_path.read_text(encoding="utf-8"))
    keys: list[RouteKey] = []
    for item in raw:
        path = item.get("path")
        methods = tuple(item.get("methods") or [])
        if not isinstance(path, str):
            raise ValueError("route baseline item missing path")
        keys.append(RouteKey(path=path, methods=methods))
    return set(keys), Counter(keys)


def write_baseline_routes(baseline_path: Path, routes: set[RouteKey]) -> None:
    payload = [{"path": route.path, "methods": list(route.methods)} for route in sorted(routes)]
    baseline_path.parent.mkdir(parents=True, exist_ok=True)
    baseline_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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
    parser.add_argument(
        "--baseline",
        default=str(BASELINE_DEFAULT_PATH),
        help="Route contract baseline json file path",
    )
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="Refresh route contract baseline from current modular routes",
    )
    args = parser.parse_args()

    baseline_path = Path(args.baseline)
    modular_routes, modular_counter = collect_routes(modular_app)

    if args.write_baseline:
        write_baseline_routes(baseline_path, modular_routes)
        print(f"Baseline refreshed from modular routes: {baseline_path}")

    if not baseline_path.exists():
        print(f"FAIL: baseline file not found: {baseline_path}")
        return 1

    baseline_routes, baseline_counter = load_baseline_routes(baseline_path)

    missing = sorted(baseline_routes - modular_routes)
    extra = sorted(modular_routes - baseline_routes)
    baseline_dupes = sorted([key for key, count in baseline_counter.items() if count > 1])
    modular_dupes = sorted([key for key, count in modular_counter.items() if count > 1])

    print("Route coverage check")
    print(f"  baseline routes: {len(baseline_routes)}")
    print(f"  modular routes : {len(modular_routes)}")
    print(f"  missing        : {len(missing)}")
    print(f"  extra          : {len(extra)}")
    print(f"  baseline dupes : {len(baseline_dupes)}")
    print(f"  modular dupes  : {len(modular_dupes)}")

    if args.verbose and missing:
        print_routes("Missing routes in modular app:", missing)
    if args.verbose and extra:
        print_routes("Extra routes in modular app:", extra)
    if args.verbose and modular_dupes:
        print_routes("Duplicate signatures in modular app:", modular_dupes)

    has_error = bool(missing or extra or modular_dupes or baseline_dupes)
    if has_error:
        print("\nFAIL: route coverage mismatch detected.")
        print("Tip: run with --verbose to inspect route signatures.")
        return 1

    print("\nPASS: modular routes fully cover route contract baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
