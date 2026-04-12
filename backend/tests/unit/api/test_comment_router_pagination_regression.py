from pathlib import Path
import re


def read_router_source() -> str:
    project_root = Path(__file__).resolve().parents[4]
    return (project_root / "backend/app/api/routers/comment_router.py").read_text(
        encoding="utf-8"
    )


def test_comment_admin_list_keeps_db_side_union_count_and_pagination():
    source = read_router_source()

    assert "admin_comment_rows = _build_admin_comment_union(" in source
    assert "select(func.count()).select_from(admin_comment_rows)" in source
    assert ".offset((page - 1) * size)" in source
    assert ".limit(size)" in source


def test_comment_admin_notifications_keep_db_side_union_and_limit():
    source = read_router_source()

    notifications_block = re.search(
        r"async def get_comment_notifications\([\s\S]+?return \[_serialize_admin_comment_row\(row\) for row in rows\]",
        source,
    )

    assert notifications_block is not None
    block = notifications_block.group(0)
    assert "_build_admin_comment_union(after=after, visible_only=True)" in block
    assert ".limit(50)" in block
    assert "db.query(ArticleComment)" not in block
    assert "db.query(ReviewComment)" not in block
