#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

DEFAULT_DATABASE_URL = "sqlite:///./data/articles.db"
CHINESE_PATTERN = re.compile(r"[\u4e00-\u9fff]")


def detect_language(title: str | None, content_md: str | None, content_html: str | None) -> str:
    sample = f"{title or ''} {content_md or ''} {content_html or ''}"
    return "zh" if CHINESE_PATTERN.search(sample) else "en"


def resolve_sqlite_path(database_url: str) -> Path:
    if not database_url.startswith("sqlite:///"):
        raise ValueError(f"仅支持 sqlite DATABASE_URL，当前为: {database_url}")

    raw_path = database_url[len("sqlite:///") :]
    if raw_path.startswith("/"):
        return Path(raw_path)
    return (Path.cwd() / raw_path).resolve()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill articles.original_language based on title + content"
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Override DATABASE_URL for this run",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply updates (default is dry-run)",
    )
    args = parser.parse_args()

    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url

    database_url = args.database_url or os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    db_path = resolve_sqlite_path(database_url)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    try:
        rows = conn.execute(
            """
            SELECT id, title, content_md, content_html
            FROM articles
            WHERE original_language IS NULL OR TRIM(original_language) = ''
            ORDER BY created_at ASC, id ASC
            """
        ).fetchall()

        total = len(rows)
        zh_count = 0
        en_count = 0
        updates: list[tuple[str, str]] = []

        for row in rows:
            language = detect_language(row["title"], row["content_md"], row["content_html"])
            if language == "zh":
                zh_count += 1
            else:
                en_count += 1
            updates.append((language, row["id"]))

        print(f"DATABASE_URL={database_url}")
        print(f"db_path={db_path}")
        print(f"missing_original_language={total}")
        print(f"backfill_zh={zh_count}")
        print(f"backfill_en={en_count}")

        if not args.apply:
            print("dry_run=true (use --apply to persist updates)")
            return 0

        if not updates:
            print("updated_rows=0")
            return 0

        conn.executemany(
            """
            UPDATE articles
            SET original_language = ?
            WHERE id = ?
            """,
            updates,
        )
        conn.commit()

        remaining = conn.execute(
            """
            SELECT COUNT(*)
            FROM articles
            WHERE original_language IS NULL OR TRIM(original_language) = ''
            """
        ).fetchone()[0]

        print(f"updated_rows={len(updates)}")
        print(f"remaining_missing={remaining}")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
