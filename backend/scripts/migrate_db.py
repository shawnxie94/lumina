#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.db_migrations import run_db_migrations


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Alembic DB migrations")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Override DATABASE_URL for this migration run",
    )
    parser.add_argument(
        "--stamp",
        dest="stamp_revision",
        default=None,
        metavar="REV",
        help=(
            "把 alembic_version 对齐到指定已知版本后再升级到 head。"
            "用于版本指向已从链上删除的历史迁移（悬空版本）时的手动恢复。"
        ),
    )
    args = parser.parse_args()

    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url

    run_db_migrations(args.database_url, stamp_revision=args.stamp_revision)
    print("Migration upgrade complete: head")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
