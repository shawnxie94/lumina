from __future__ import annotations

from datetime import datetime, timezone


def parse_iso_timestamp(value: str | None) -> datetime | None:
    """Parse ISO timestamps robustly for stale checks.

    Accepts Z/+offset and naive values. Naive timestamps are treated as UTC.
    """
    text = str(value or "").strip()
    if not text:
        return None
    raw = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                dt = None
        if dt is None:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def is_newer_timestamp(left: str | None, right: str | None) -> bool:
    """Return True when left timestamp is strictly newer than right."""
    left_dt = parse_iso_timestamp(left)
    right_dt = parse_iso_timestamp(right)
    if left_dt is not None and right_dt is not None:
        return left_dt > right_dt
    if left and right and left_dt is None and right_dt is None:
        return str(left) > str(right)
    return False
