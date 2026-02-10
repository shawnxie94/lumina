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
    args = parser.parse_args()

    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url

    run_db_migrations(args.database_url)
    print("Migration upgrade complete: head")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
