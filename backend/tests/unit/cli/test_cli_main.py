from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.cli.main import main
from models import AIAnalysis, AdminSettings, Article, Base, Category, now_str


def build_database_url(db_path: Path) -> str:
    return f"sqlite:///{db_path}"


def setup_cli_db(db_path: Path) -> None:
    engine = create_engine(
        build_database_url(db_path),
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        category = Category(
            id="category-1",
            name="CLI",
            color="#123456",
            sort_order=1,
            created_at=now_str(),
        )
        session.add(category)
        article = Article(
            id="article-1",
            title="CLI article",
            slug="cli-article",
            content_md="cli body",
            top_image="https://example.com/cover.png",
            author="Lumina Bot",
            source_domain="example.com",
            status="completed",
            is_visible=True,
            category_id=category.id,
            created_at=now_str(),
            updated_at=now_str(),
        )
        session.add(article)
        session.add(
            AIAnalysis(
                id="analysis-1",
                article_id=article.id,
                summary="CLI summary",
                updated_at=now_str(),
            )
        )
        session.add(
            AdminSettings(
                id="admin-1",
                password_hash="bcrypt$fake",
                jwt_secret="secret",
                created_at=now_str(),
                updated_at=now_str(),
            )
        )
        session.commit()
    finally:
        session.close()
        engine.dispose()


def test_cli_article_list_json_output(tmp_path, capsys):
    db_path = tmp_path / "cli-list.db"
    setup_cli_db(db_path)

    exit_code = main(
        [
            "--mode",
            "local",
            "--database-url",
            build_database_url(db_path),
            "--json",
            "article",
            "list",
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert exit_code == 0
    assert payload["ok"] is True
    assert payload["command"] == "article.list"
    assert payload["data"]["items"][0]["slug"] == "cli-article"
    assert payload["data"]["items"][0]["summary"] == "CLI summary"
    assert payload["data"]["pagination"]["total"] == 1


def test_cli_local_command_reports_missing_tables(tmp_path, capsys):
    db_path = tmp_path / "empty.db"
    db_path.touch()

    exit_code = main(
        [
            "--mode",
            "local",
            "--database-url",
            build_database_url(db_path),
            "--json",
            "article",
            "list",
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert exit_code == 3
    assert payload["ok"] is False
    assert payload["error"]["code"] == "database_not_ready"
    assert "articles" in payload["error"]["details"]["database"]["missing_tables"]


def test_cli_invalid_input_json_returns_exit_code_2(tmp_path, capsys):
    input_path = tmp_path / "bad.json"
    input_path.write_text("{not-json", encoding="utf-8")

    exit_code = main(
        [
            "--mode",
            "local",
            "--json",
            "article",
            "create",
            "--input",
            str(input_path),
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert exit_code == 2
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_input_json"
