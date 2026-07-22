"""Run Defuddle via Node for backend local HTML extraction (aligned with extension)."""

from __future__ import annotations

import json
import re
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger("article_extraction")

DEFAULT_TIMEOUT_SECONDS = 15.0
BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCRIPT_PATH = BACKEND_ROOT / "scripts" / "defuddle_extract.mjs"


@dataclass(frozen=True)
class DefuddleLocalResult:
    title: str
    content_html: str
    author: str
    published: str
    image: str
    description: str
    word_count: int
    parse_time_ms: int
    engine_version: str


class DefuddleLocalExtractionError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


@lru_cache(maxsize=1)
def _resolve_node_bin() -> str | None:
    configured = (os.environ.get("LUMINA_NODE_BIN") or "").strip()
    if configured and Path(configured).exists():
        return configured
    return shutil.which("node")


def _resolve_script_path() -> Path:
    configured = (os.environ.get("LUMINA_DEFUDDLE_SCRIPT") or "").strip()
    if configured:
        return Path(configured)
    return DEFAULT_SCRIPT_PATH


def _resolve_defuddle_package_dir() -> Path | None:
    """Prefer backend/node_modules/defuddle installed via npm ci."""
    candidate = BACKEND_ROOT / "node_modules" / "defuddle"
    if candidate.is_dir():
        return candidate
    return None


def is_defuddle_local_available() -> bool:
    """True only when Node, extract script, and defuddle package are all present.

    Avoid reporting "available" when the script exists but ``npm ci`` was never
    run, which would otherwise fail at runtime and silently fall back to regex.
    """
    if not _resolve_node_bin():
        return False
    if not _resolve_script_path().is_file():
        return False
    if _resolve_defuddle_package_dir() is None:
        return False
    return True


def describe_defuddle_local_status() -> dict:
    """Diagnostic snapshot for logs / health checks."""
    node_bin = _resolve_node_bin()
    script = _resolve_script_path()
    package_dir = _resolve_defuddle_package_dir()
    return {
        "available": is_defuddle_local_available(),
        "node_bin": node_bin,
        "script_path": str(script),
        "script_exists": script.is_file(),
        "package_dir": str(package_dir) if package_dir else None,
        "package_exists": package_dir is not None,
        "expected_engine_version": _expected_engine_version(),
    }


@lru_cache(maxsize=1)
def _expected_engine_version() -> str:
    pkg = BACKEND_ROOT / "package.json"
    try:
        raw = json.loads(pkg.read_text(encoding="utf-8"))
        ver = str(raw.get("dependencies", {}).get("defuddle") or "").strip()
        m = re.search(r"(\d+\.\d+\.\d+)", ver)
        return m.group(1) if m else ver
    except Exception:
        return ""


def extract_with_defuddle_local(
    *,
    html: str,
    url: str,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> DefuddleLocalResult:
    """Extract main content from raw HTML using Defuddle (Node).

    Raises DefuddleLocalExtractionError on hard failures so callers can fall back.
    """
    node_bin = _resolve_node_bin()
    script_path = _resolve_script_path()
    if not node_bin:
        raise DefuddleLocalExtractionError("node binary not found")
    if not script_path.is_file():
        raise DefuddleLocalExtractionError(f"defuddle script missing: {script_path}")
    if _resolve_defuddle_package_dir() is None:
        raise DefuddleLocalExtractionError(
            "defuddle package missing under backend/node_modules "
            "(run: cd backend && npm ci)"
        )

    payload = json.dumps(
        {"html": html or "", "url": url or "https://example.invalid/"},
        ensure_ascii=False,
    ).encode("utf-8")

    try:
        completed = subprocess.run(
            [node_bin, str(script_path)],
            input=payload,
            capture_output=True,
            timeout=max(1.0, float(timeout_seconds)),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise DefuddleLocalExtractionError("defuddle extraction timed out") from exc
    except OSError as exc:
        raise DefuddleLocalExtractionError(f"failed to spawn node: {exc}") from exc

    if completed.returncode != 0:
        err = (completed.stderr or b"").decode("utf-8", errors="replace").strip()
        raise DefuddleLocalExtractionError(err or f"defuddle exit {completed.returncode}")

    raw_out = (completed.stdout or b"").decode("utf-8", errors="replace").strip()
    if not raw_out:
        raise DefuddleLocalExtractionError("defuddle returned empty stdout")

    try:
        data = json.loads(raw_out)
    except json.JSONDecodeError as exc:
        raise DefuddleLocalExtractionError("defuddle returned invalid json") from exc

    content_html = str(data.get("content_html") or "").strip()
    if not content_html:
        raise DefuddleLocalExtractionError("defuddle returned empty content")

    return DefuddleLocalResult(
        title=str(data.get("title") or "").strip(),
        content_html=content_html,
        author=str(data.get("author") or "").strip(),
        published=str(data.get("published") or "").strip(),
        image=str(data.get("image") or "").strip(),
        description=str(data.get("description") or "").strip(),
        word_count=int(data.get("word_count") or 0),
        parse_time_ms=int(data.get("parse_time_ms") or 0),
        engine_version=str(data.get("engine_version") or "").strip(),
    )
