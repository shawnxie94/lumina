from pathlib import Path
import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.db_migrations import resolve_database_url
from models import Base, PromptConfig, now_str


def test_resolve_database_url_prefers_explicit_override():
    assert (
        resolve_database_url(
            override_url="sqlite:///override.db",
            env_url="sqlite:///env.db",
            ini_url="sqlite:///ini.db",
            settings_url="sqlite:///settings.db",
        )
        == "sqlite:///override.db"
    )


def test_resolve_database_url_prefers_env_over_ini():
    assert (
        resolve_database_url(
            env_url="sqlite:///env.db",
            ini_url="sqlite:///ini.db",
            settings_url="sqlite:///settings.db",
        )
        == "sqlite:///env.db"
    )


def test_resolve_database_url_falls_back_to_ini_then_settings():
    assert (
        resolve_database_url(
            ini_url="sqlite:///ini.db",
            settings_url="sqlite:///settings.db",
        )
        == "sqlite:///ini.db"
    )
    assert (
        resolve_database_url(settings_url="sqlite:///settings.db")
        == "sqlite:///settings.db"
    )


def test_infographic_related_migrations_are_ordered_and_explicit():
    versions_dir = Path(__file__).resolve().parents[3] / "alembic" / "versions"
    infographic_migrations = sorted(versions_dir.glob("*infographic*.py"))

    assert [path.name for path in infographic_migrations] == [
        "20260326_0011_ai_infographic.py",
        "20260326_0012_rss_toggle_and_infographic_image.py",
    ]


def test_prompt_protocol_text_migration_updates_existing_builtin_prompts(tmp_path):
    db_path = tmp_path / "migration-prompts.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        session.add_all(
            [
                PromptConfig(
                    id=str(uuid.uuid4()),
                    name="默认-分类",
                    type="classification",
                    prompt="""请根据以下文章内容与分类列表选择最匹配的分类。

硬性要求：
1) 仅输出分类 ID（UUID），不要输出任何解释或多余字符。
2) 若无合适分类输出空字符串。
3) 只允许输出分类列表中出现的 ID。

分类列表：
{categories}

文章内容：
{content}""",
                    system_prompt="你是内容分类助手，只输出分类 ID。",
                    is_enabled=True,
                    is_default=True,
                    created_at=now_str(),
                    updated_at=now_str(),
                ),
                PromptConfig(
                    id=str(uuid.uuid4()),
                    name="默认-标签",
                    type="tagging",
                    prompt="""请根据以下文章内容生成 3-5 个中文标签。

硬性要求：
1) 仅输出 JSON 数组，例如 [\"AI 产品\", \"浏览器插件\", \"知识管理\"]。
2) 不能输出解释、Markdown 代码块或额外文字。
3) 标签要具体、可检索、信息密度高，避免“文章/内容/思考”等空泛词。
4) 尽量避免与参考分类完全重复，除非它本身就是最关键标签。
5) 每个标签不超过 5 个字。

参考分类：{category_name}

文章内容：
{content}""",
                    system_prompt="你是内容标签助手，只输出 JSON 数组。",
                    is_enabled=True,
                    is_default=True,
                    created_at=now_str(),
                    updated_at=now_str(),
                ),
            ]
        )
        session.commit()

        backend_dir = Path(__file__).resolve().parents[3]
        config = Config(str(backend_dir / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
        config.attributes["database_url_override"] = f"sqlite:///{db_path}"
        command.stamp(config, "20260331_0013")
        command.upgrade(config, "head")

        rows = session.execute(
            text(
                """
                SELECT type, prompt, system_prompt
                FROM prompt_configs
                WHERE name IN ('默认-分类', '默认-标签')
                ORDER BY type
                """
            )
        ).fetchall()
        rows_by_type = {
            row.type: {"prompt": row.prompt, "system_prompt": row.system_prompt}
            for row in rows
        }

        assert "仅输出分类 ID" not in rows_by_type["classification"]["prompt"]
        assert "只输出分类 ID" not in rows_by_type["classification"]["system_prompt"]
        assert "仅输出 JSON 数组" not in rows_by_type["tagging"]["prompt"]
        assert "只输出 JSON 数组" not in rows_by_type["tagging"]["system_prompt"]
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_prompt_protocol_text_migration_keeps_user_modified_builtin_prompts(tmp_path):
    db_path = tmp_path / "migration-custom-prompts.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        custom_prompt = "这是用户手动改过的分类提示词，请不要覆盖。"
        custom_system_prompt = "这是用户手动改过的分类 system prompt。"
        session.add(
            PromptConfig(
                id=str(uuid.uuid4()),
                name="默认-分类",
                type="classification",
                prompt=custom_prompt,
                system_prompt=custom_system_prompt,
                is_enabled=True,
                is_default=True,
                created_at=now_str(),
                updated_at=now_str(),
            )
        )
        session.commit()

        backend_dir = Path(__file__).resolve().parents[3]
        config = Config(str(backend_dir / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
        config.attributes["database_url_override"] = f"sqlite:///{db_path}"
        command.stamp(config, "20260331_0013")
        command.upgrade(config, "head")

        row = session.execute(
            text(
                """
                SELECT prompt, system_prompt
                FROM prompt_configs
                WHERE name = '默认-分类'
                  AND type = 'classification'
                """
            )
        ).one()

        assert row.prompt == custom_prompt
        assert row.system_prompt == custom_system_prompt
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_ai_analysis_version_migration_backfills_existing_content(tmp_path):
    db_path = tmp_path / "migration-ai-analysis-versions.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE articles (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    slug VARCHAR
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE ai_analyses (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    article_id VARCHAR,
                    summary TEXT,
                    outline TEXT,
                    key_points TEXT,
                    mindmap TEXT,
                    error_message TEXT,
                    updated_at VARCHAR,
                    quotes TEXT,
                    summary_status VARCHAR,
                    key_points_status VARCHAR,
                    outline_status VARCHAR,
                    quotes_status VARCHAR,
                    classification_status VARCHAR,
                    cleaned_md_draft TEXT,
                    tagging_status VARCHAR,
                    tagging_source_hash VARCHAR,
                    tagging_manual_override BOOLEAN,
                    infographic_html TEXT,
                    infographic_status VARCHAR,
                    infographic_image_url VARCHAR,
                    FOREIGN KEY(article_id) REFERENCES articles (id)
                )
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO articles (id, slug)
                VALUES ('article-1', 'legacy-article')
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO ai_analyses (
                    id,
                    article_id,
                    summary,
                    summary_status,
                    updated_at
                )
                VALUES (
                    'analysis-1',
                    'article-1',
                    '升级前已有摘要',
                    'completed',
                    '2026-04-01T10:00:00'
                )
                """
            )
        )

    backend_dir = Path(__file__).resolve().parents[3]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    config.attributes["database_url_override"] = f"sqlite:///{db_path}"
    command.stamp(config, "20260331_0015")
    command.upgrade(config, "head")

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT content_type, version_number, content_text
                FROM ai_analysis_versions
                WHERE article_id = 'article-1'
                ORDER BY version_number ASC
                """
            )
        ).fetchall()
        current_version_id = conn.execute(
            text(
                """
                SELECT current_summary_version_id
                FROM ai_analyses
                WHERE article_id = 'article-1'
                """
            )
        ).scalar_one()

    assert rows == [("summary", 1, "升级前已有摘要")]
    assert current_version_id

    engine.dispose()
