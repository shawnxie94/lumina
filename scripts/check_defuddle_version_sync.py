#!/usr/bin/env python3
"""Fail if extension/backend Defuddle pins drift apart."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN_FILE = ROOT / "scripts" / "defuddle-version.txt"


def read_pkg_version(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = str(data.get("dependencies", {}).get("defuddle") or "").strip()
    if not raw:
        raise SystemExit(f"missing defuddle dependency in {path}")
    # allow exact or caret/tilde; compare numeric core
    m = re.search(r"(\d+\.\d+\.\d+)", raw)
    if not m:
        raise SystemExit(f"unparseable defuddle version {raw!r} in {path}")
    return m.group(1)


def read_engine_const() -> str:
    text = (ROOT / "extension/utils/defuddleExtract.ts").read_text(encoding="utf-8")
    m = re.search(r'export const DEFUDDLE_ENGINE_VERSION\s*=\s*"([^"]+)"', text)
    if not m:
        raise SystemExit("DEFUDDLE_ENGINE_VERSION not found in defuddleExtract.ts")
    return m.group(1)


def main() -> int:
    pin = PIN_FILE.read_text(encoding="utf-8").strip() if PIN_FILE.is_file() else ""
    ext = read_pkg_version(ROOT / "extension/package.json")
    be = read_pkg_version(ROOT / "backend/package.json")
    engine = read_engine_const()
    versions = {"pin_file": pin or None, "extension": ext, "backend": be, "engine_const": engine}
    print(json.dumps(versions, ensure_ascii=False, indent=2))
    core = {ext, be, engine}
    if pin:
        core.add(pin)
    if len(core) != 1:
        print("ERROR: Defuddle versions are out of sync", file=sys.stderr)
        return 1
    print("OK: Defuddle versions aligned at", ext)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
