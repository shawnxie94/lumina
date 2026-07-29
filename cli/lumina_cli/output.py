from __future__ import annotations

import json
import sys
from typing import Any


def emit(data: Any, *, output: str = "table", ok: bool = True) -> None:
    if output == "json":
        payload = data
        if not isinstance(data, dict) or "ok" not in data:
            payload = {"ok": ok, "data": data}
        print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        return
    if isinstance(data, str):
        print(data)
        return
    if isinstance(data, dict):
        _print_dict(data)
        return
    if isinstance(data, list):
        if not data:
            print("(empty)")
            return
        if all(isinstance(x, dict) for x in data):
            _print_table(data)
            return
        for item in data:
            print(f"- {item}")
        return
    print(str(data))


def emit_error(err: Exception, *, output: str = "table") -> None:
    message = getattr(err, "message", str(err))
    hint = getattr(err, "hint", None)
    error_code = getattr(err, "error_code", "error")
    if output == "json":
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": error_code,
                        "message": message,
                        "hint": hint,
                    },
                },
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return
    print(f"Error: {message}", file=sys.stderr)
    if hint:
        print(f"Next: {hint}", file=sys.stderr)


def _print_dict(data: dict[str, Any]) -> None:
    width = max((len(str(k)) for k in data.keys()), default=0)
    for key, value in data.items():
        if isinstance(value, (dict, list)):
            print(f"{str(key).ljust(width)}  {json.dumps(value, ensure_ascii=False, default=str)}")
        else:
            print(f"{str(key).ljust(width)}  {value}")


def _print_table(rows: list[dict[str, Any]]) -> None:
    keys: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in keys:
                keys.append(str(key))
    widths = {k: len(k) for k in keys}
    str_rows: list[dict[str, str]] = []
    for row in rows:
        item = {}
        for k in keys:
            val = row.get(k, "")
            text = val if isinstance(val, str) else json.dumps(val, ensure_ascii=False, default=str)
            item[k] = text
            widths[k] = max(widths[k], len(text))
        str_rows.append(item)
    header = "  ".join(k.ljust(widths[k]) for k in keys)
    print(header)
    print("  ".join("-" * widths[k] for k in keys))
    for row in str_rows:
        print("  ".join(row[k].ljust(widths[k]) for k in keys))
