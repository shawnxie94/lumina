from pathlib import Path
import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.db_migrations import (
    migration_lock,
    resolve_database_url,
    sqlite_database_path,
)
from models import AdminSettings, Base, PromptConfig, now_str


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


def test_sqlite_database_path_resolves_relative_path_from_backend_dir(tmp_path):
    assert sqlite_database_path("sqlite:///./data/articles.db", base_dir=tmp_path) == (
        tmp_path / "data" / "articles.db"
    )


def test_sqlite_database_path_ignores_non_file_sqlite_urls(tmp_path):
    assert sqlite_database_path("sqlite:///:memory:", base_dir=tmp_path) is None
    assert sqlite_database_path("postgresql://db/lumina", base_dir=tmp_path) is None


def test_migration_lock_creates_shared_sqlite_lock_file(tmp_path):
    db_path = tmp_path / "data" / "articles.db"

    with migration_lock(f"sqlite:///{db_path}", base_dir=tmp_path):
        assert (tmp_path / "data" / ".articles.db.migration.lock").exists()


def test_infographic_related_migrations_are_ordered_and_explicit():
    versions_dir = Path(__file__).resolve().parents[3] / "alembic" / "versions"
    infographic_migrations = sorted(versions_dir.glob("*infographic*.py"))

    assert [path.name for path in infographic_migrations] == [
        "20260326_0011_ai_infographic.py",
        "20260326_0012_rss_toggle_and_infographic_image.py",
    ]


def test_ai_continuation_migration_is_ordered_and_explicit():
    versions_dir = Path(__file__).resolve().parents[3] / "alembic" / "versions"
    ai_continuation_migrations = sorted(
        versions_dir.glob("*ai_continuation_and_task_chain*.py")
    )

    assert [path.name for path in ai_continuation_migrations] == [
        "20260412_0019_ai_continuation_and_task_chain.py",
    ]


def test_default_ai_strategy_migration_enables_default_toggles(tmp_path):
    db_path = tmp_path / "migration-default-ai-strategy.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        session.add(
            AdminSettings(
                password_hash="hash",
                jwt_secret="secret",
                auto_ai_cleaning_enabled=True,
                auto_ai_classification_enabled=False,
                auto_ai_summary_enabled=False,
                auto_ai_tagging_enabled=False,
                auto_translation_enabled=False,
            )
        )
        session.commit()

        backend_dir = Path(__file__).resolve().parents[3]
        config = Config(str(backend_dir / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
        config.attributes["database_url_override"] = f"sqlite:///{db_path}"
        command.stamp(config, "20260413_0020")
        command.upgrade(config, "head")

        row = session.execute(
            text(
                """
                SELECT
                  auto_ai_cleaning_enabled,
                  auto_ai_classification_enabled,
                  auto_ai_summary_enabled,
                  auto_ai_outline_enabled,
                  auto_ai_quotes_enabled,
                  auto_ai_tagging_enabled,
                  auto_translation_enabled
                FROM admin_settings
                """
            )
        ).one()

        assert row.auto_ai_cleaning_enabled == 0
        assert row.auto_ai_classification_enabled == 1
        assert row.auto_ai_summary_enabled == 1
        assert row.auto_ai_outline_enabled == 1
        assert row.auto_ai_quotes_enabled == 0
        assert row.auto_ai_tagging_enabled == 1
        assert row.auto_translation_enabled == 1
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_article_interpretation_bundle_migration_adds_columns_without_user_prompt(
    tmp_path,
):
    db_path = tmp_path / "migration-article-interpretation.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE admin_settings (
                    id INTEGER NOT NULL PRIMARY KEY,
                    password_hash VARCHAR,
                    jwt_secret VARCHAR
                )
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO admin_settings (id, password_hash, jwt_secret)
                VALUES (1, 'hash', 'secret')
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE ai_analyses (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    article_id VARCHAR NOT NULL,
                    summary TEXT,
                    summary_status VARCHAR,
                    updated_at VARCHAR
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE prompt_configs (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    category_id VARCHAR,
                    type VARCHAR NOT NULL,
                    prompt TEXT NOT NULL,
                    system_prompt TEXT,
                    temperature FLOAT,
                    max_tokens INTEGER,
                    top_p FLOAT,
                    chunk_size_tokens INTEGER,
                    chunk_overlap_tokens INTEGER,
                    max_continue_rounds INTEGER,
                    model_api_config_id VARCHAR,
                    is_enabled BOOLEAN,
                    is_default BOOLEAN,
                    created_at VARCHAR,
                    updated_at VARCHAR
                )
                """
            )
        )

    backend_dir = Path(__file__).resolve().parents[3]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    config.attributes["database_url_override"] = f"sqlite:///{db_path}"
    command.stamp(config, "20260413_0023")
    command.upgrade(config, "head")

    with engine.begin() as conn:
        ai_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(ai_analyses)")).all()
        }
        interpretation_prompt_count = conn.execute(
            text(
                """
                SELECT COUNT(*)
                FROM prompt_configs
                WHERE type = 'interpretation'
                """
            )
        ).scalar_one()

    assert {"interpretation_status", "interpretation_error"}.issubset(ai_columns)
    assert interpretation_prompt_count == 0
    engine.dispose()


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


def test_prompt_task_instruction_migration_updates_only_unchanged_defaults(tmp_path):
    db_path = tmp_path / "migration-task-instruction-prompts.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        custom_prompt = "用户已经改过的摘要提示词，不能覆盖。"
        session.add_all(
            [
                PromptConfig(
                    id=str(uuid.uuid4()),
                    name="默认-快读摘要",
                    type="summary",
                    prompt="""为提供的文本创作一份“快读摘要”，旨在让读者在30秒内掌握核心情报。

要求：
1) 极简主义：剔除背景铺垫、案例细节、营销话术及修饰性词汇，直奔主题。
2) 内容密度：必须包含核心主体、关键动作/事件、最终影响/结论。
3) 篇幅：严格控制在50-150字之间。

待摘要内容：
{content}""",
                    system_prompt="你是一名资深内容分析师，擅长用最极简的语言精准捕捉文章灵魂。输出必须为中文、客观、单段长句（可用逗号、句号，禁止分段/换行），禁止任何列表符号（- * 1.等），禁止出现“这篇文章讲了/摘要如下”等前置废话。",
                    is_enabled=True,
                    is_default=True,
                    created_at=now_str(),
                    updated_at=now_str(),
                ),
                PromptConfig(
                    id=str(uuid.uuid4()),
                    name="默认-金句",
                    type="quotes",
                    prompt="""请阅读提供的文本内容，从中筛选并提炼出最具有传播力、深度或启发性的金句。

要求：
1) 标准：深刻性、共鸣感、精炼性。
2) 拒绝平庸：不要事实陈述句，选择观点句/结论句/修辞优美的句子。
3) 允许润色：可在不改变原意下微调，使其更像独立名言。
4) 多样化：覆盖不同维度（趋势判断/价值坚守/行动号召等）。

输出格式：
- 使用无序列表（-），每句单独一行
- 数量 3-5 条
- 仅输出金句列表，不要解释

待提炼内容：
{content}""",
                    system_prompt="你是一名资深文案金句捕手，擅长从长篇内容中提炼传播力强的金句。输出必须为中文，仅输出金句列表，不要任何解释或前后缀。",
                    is_enabled=True,
                    is_default=True,
                    created_at=now_str(),
                    updated_at=now_str(),
                ),
                PromptConfig(
                    id=str(uuid.uuid4()),
                    name="默认-中英翻译",
                    type="translation",
                    prompt="""将输入的英文文章翻译成中文。

要求：
1) 严格保留原始 Markdown 格式（标题、列表、链接、代码块、换行等）。
2) 专业术语使用业界通用中文表达，必要时可在中文后保留英文原词。
3) 语言风格地道、通顺，避免翻译腔。
4) 只输出译文，不要前后缀。

请直接开始翻译：
{content}""",
                    system_prompt="你是一位精通中英文互译的专业翻译官，擅长科技、文化及商业领域的信达雅翻译。必须仅输出中文译文，禁止任何额外话语。",
                    is_enabled=True,
                    is_default=True,
                    created_at=now_str(),
                    updated_at=now_str(),
                ),
                PromptConfig(
                    id=str(uuid.uuid4()),
                    name="默认-内容清洗",
                    type="content_cleaning",
                    prompt="""请将以下 HTML 内容清洗为结构化的 GFM Markdown。

硬性要求：
1) 仅输出 Markdown 正文，禁止任何解释/前后缀。
2) 必须保留：标题层级、列表、引用、表格、链接、图片、代码块、段落换行。
3) 必须去除：导航、广告、版权声明、推荐阅读、分享按钮、评论区、相关链接、页脚。
4) 不要改写内容，只做结构化与去噪。
5) 链接使用标准 Markdown 形式，图片使用 ![]()。
6) 若内容中包含视频/音频，必须保留其链接；视频使用 [▶ 标题](URL)，音频使用 [🎧 标题](URL)。
7) 若内容中包含数学公式，必须完整保留，不得改写；行内公式使用 $...$，独立公式使用 $$...$$。

HTML：
{content}""",
                    system_prompt="你是严谨的内容清洗专家，专注输出稳定、结构化的 GFM Markdown。",
                    is_enabled=True,
                    is_default=True,
                    created_at=now_str(),
                    updated_at=now_str(),
                ),
                PromptConfig(
                    id=str(uuid.uuid4()),
                    name="默认-快读摘要",
                    type="summary",
                    prompt=custom_prompt,
                    system_prompt="用户 system",
                    is_enabled=True,
                    is_default=False,
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
        command.stamp(config, "20260413_0023")
        command.upgrade(config, "head")

        rows = session.execute(
            text(
                """
                SELECT name, type, prompt, system_prompt, is_default
                FROM prompt_configs
                WHERE type IN ('summary', 'quotes', 'translation', 'content_cleaning')
                ORDER BY is_default DESC, type ASC
                """
            )
        ).fetchall()
        default_rows = [row for row in rows if row.is_default]
        defaults_by_type = {row.type: row for row in default_rows}
        custom_row = [row for row in rows if not row.is_default][0]

        assert all("{content}" not in row.prompt for row in default_rows)
        assert "输出必须为中文、客观、单段长句" in defaults_by_type["summary"].prompt
        assert "输出必须为中文" not in defaults_by_type["summary"].system_prompt
        assert "输出格式" not in defaults_by_type["quotes"].prompt
        assert "单条生成" not in defaults_by_type["quotes"].prompt
        assert "合并生成" not in defaults_by_type["quotes"].prompt
        assert "仅输出金句列表" not in defaults_by_type["quotes"].system_prompt
        assert "必须仅输出中文译文" in defaults_by_type["translation"].prompt
        assert "必须仅输出中文译文" not in defaults_by_type["translation"].system_prompt
        assert "HTML：" not in defaults_by_type["content_cleaning"].prompt
        assert "运行时提供的 HTML 或 Markdown 内容" in defaults_by_type[
            "content_cleaning"
        ].prompt
        assert custom_row.prompt == custom_prompt
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


def test_ai_call_sessions_table_and_api_type_column_exist_after_upgrade(tmp_path):
    db_path = tmp_path / "migration-ai-call-sessions.db"
    backend_dir = Path(__file__).resolve().parents[3]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    config.attributes["database_url_override"] = f"sqlite:///{db_path}"

    command.upgrade(config, "head")

    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    with engine.begin() as conn:
        model_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(model_api_configs)")).fetchall()
        }
        session_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(ai_call_sessions)")).fetchall()
        }

    assert "api_type" in model_columns
    assert {
        "usage_log_id",
        "api_type",
        "input_snapshot",
        "output_snapshot",
    } <= session_columns

    engine.dispose()


def test_ai_task_chain_columns_exist_after_upgrade(tmp_path):
    db_path = tmp_path / "migration-ai-task-chain.db"
    backend_dir = Path(__file__).resolve().parents[3]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    config.attributes["database_url_override"] = f"sqlite:///{db_path}"

    command.upgrade(config, "head")

    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    with engine.begin() as conn:
        task_columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(ai_tasks)")).fetchall()
        }
        task_indexes = {
            row[1] for row in conn.execute(text("PRAGMA index_list(ai_tasks)")).fetchall()
        }

    assert {"parent_task_id", "root_task_id"} <= task_columns
    assert any("root_task_id" in index_name for index_name in task_indexes)

    engine.dispose()


def test_ai_continuation_migration_backfills_existing_task_chain_and_api_type(tmp_path):
    db_path = tmp_path / "migration-ai-continuation-backfill.db"
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
                CREATE TABLE model_api_configs (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    base_url VARCHAR NOT NULL,
                    api_key VARCHAR NOT NULL,
                    provider VARCHAR,
                    model_name VARCHAR NOT NULL,
                    model_type VARCHAR,
                    price_input_per_1k FLOAT,
                    price_output_per_1k FLOAT,
                    currency VARCHAR,
                    context_window_tokens INTEGER,
                    reserve_output_tokens INTEGER,
                    is_enabled BOOLEAN,
                    is_default BOOLEAN,
                    created_at VARCHAR,
                    updated_at VARCHAR
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE ai_usage_logs (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    model_api_config_id VARCHAR,
                    task_id VARCHAR,
                    article_id VARCHAR,
                    task_type VARCHAR,
                    content_type VARCHAR,
                    status VARCHAR NOT NULL,
                    prompt_tokens INTEGER,
                    completion_tokens INTEGER,
                    total_tokens INTEGER,
                    cost_input FLOAT,
                    cost_output FLOAT,
                    cost_total FLOAT,
                    currency VARCHAR,
                    latency_ms INTEGER,
                    finish_reason VARCHAR,
                    truncated BOOLEAN,
                    chunk_index INTEGER,
                    continue_round INTEGER,
                    estimated_input_tokens INTEGER,
                    error_message TEXT,
                    request_payload TEXT,
                    response_payload TEXT,
                    created_at VARCHAR
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE ai_tasks (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    article_id VARCHAR,
                    task_type VARCHAR NOT NULL,
                    content_type VARCHAR,
                    status VARCHAR,
                    payload TEXT,
                    attempts INTEGER,
                    max_attempts INTEGER,
                    run_at VARCHAR,
                    locked_at VARCHAR,
                    locked_by VARCHAR,
                    last_error TEXT,
                    last_error_type VARCHAR,
                    created_at VARCHAR,
                    updated_at VARCHAR,
                    finished_at VARCHAR
                )
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO model_api_configs (
                    id, name, base_url, api_key, provider, model_name, model_type,
                    is_enabled, is_default, created_at, updated_at
                )
                VALUES (
                    'model-1', 'Default model', 'https://example.com', 'secret',
                    'openai', 'gpt-4o', 'general', 1, 1,
                    '2026-04-12T00:00:00', '2026-04-12T00:00:00'
                )
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO ai_tasks (
                    id, article_id, task_type, content_type, status, payload,
                    attempts, max_attempts, run_at, created_at, updated_at, finished_at
                )
                VALUES (
                    'task-1', NULL, 'process_ai_content', 'summary', 'completed', '{}',
                    1, 1, '2026-04-12T00:00:00', '2026-04-12T00:00:00',
                    '2026-04-12T00:00:00', '2026-04-12T00:00:00'
                )
                """
            )
        )

    backend_dir = Path(__file__).resolve().parents[3]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    config.attributes["database_url_override"] = f"sqlite:///{db_path}"
    command.stamp(config, "20260410_0018")
    command.upgrade(config, "head")

    with engine.begin() as conn:
        api_type = conn.execute(
            text("SELECT api_type FROM model_api_configs WHERE id = 'model-1'")
        ).scalar_one()
        row = conn.execute(
            text(
                """
                SELECT parent_task_id, root_task_id
                FROM ai_tasks
                WHERE id = 'task-1'
                """
            )
        ).one()

    assert api_type == "chat_completions"
    assert row.parent_task_id is None
    assert row.root_task_id == "task-1"

    engine.dispose()
