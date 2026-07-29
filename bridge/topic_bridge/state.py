from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class BridgeState:
    last_article_sync_at: str | None = None
    last_writeback_at: str | None = None
    article_hashes: dict[str, str] = field(default_factory=dict)
    article_paths: dict[str, str] = field(default_factory=dict)
    topic_hashes: dict[str, str] = field(default_factory=dict)
    article_topic_hashes: dict[str, str] = field(default_factory=dict)
    # rel path -> {mtime:float, size:int, topic:dict}
    wiki_file_cache: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "BridgeState":
        if not path.exists():
            return cls()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return cls()
        if not isinstance(raw, dict):
            return cls()
        return cls(
            last_article_sync_at=raw.get("last_article_sync_at"),
            last_writeback_at=raw.get("last_writeback_at"),
            article_hashes={
                str(k): str(v) for k, v in (raw.get("article_hashes") or {}).items()
            },
            article_paths={
                str(k): str(v) for k, v in (raw.get("article_paths") or {}).items()
            },
            topic_hashes={
                str(k): str(v) for k, v in (raw.get("topic_hashes") or {}).items()
            },
            article_topic_hashes={
                str(k): str(v)
                for k, v in (raw.get("article_topic_hashes") or {}).items()
            },
            wiki_file_cache={
                str(k): v
                for k, v in (raw.get("wiki_file_cache") or {}).items()
                if isinstance(v, dict)
            },
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(asdict(self), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
