from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    Boolean,
    ForeignKey,
    Float,
    create_engine,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from datetime import date, datetime, timezone
import json
import uuid
from app.core.db_migrations import run_db_migrations
from app.core.settings import get_settings

Base = declarative_base()

settings = get_settings()
DATABASE_URL = settings.database_url

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def generate_uuid():
    return str(uuid.uuid4())


def today_str():
    return date.today().isoformat()


def now_str():
    return datetime.now(timezone.utc).isoformat()


class Category(Base):
    __tablename__ = "categories"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text)
    color = Column(String)
    sort_order = Column(Integer, default=0)
    created_at = Column(String, default=today_str)

    articles = relationship("Article", back_populates="category")
    prompt_configs = relationship("PromptConfig", back_populates="category")


class Article(Base):
    __tablename__ = "articles"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False, index=True)  # SEO友好的URL slug
    content_html = Column(Text, nullable=True)
    content_structured = Column(Text, nullable=True)
    content_md = Column(Text)
    content_trans = Column(Text)
    translation_status = Column(
        String, default=None
    )  # None, pending, processing, completed, failed
    translation_error = Column(Text, nullable=True)  # 翻译失败时的错误信息
    source_url = Column(String, unique=True, nullable=True)
    top_image = Column(String)
    author = Column(String)
    published_at = Column(String)
    source_domain = Column(String)
    status = Column(String, default="pending")
    is_visible = Column(Boolean, default=False)
    category_id = Column(String, ForeignKey("categories.id"))
    created_at = Column(String, default=now_str)
    updated_at = Column(String, default=now_str)
    note_content = Column(Text, nullable=True)
    note_annotations = Column(Text, nullable=True)
    original_language = Column(String, nullable=True)  # 原文语言：zh, en, ja, etc.

    category = relationship("Category", back_populates="articles")
    ai_analysis = relationship("AIAnalysis", back_populates="article", uselist=False)
    comments = relationship(
        "ArticleComment", back_populates="article", cascade="all, delete-orphan"
    )
    media_assets = relationship(
        "MediaAsset", back_populates="article", cascade="all, delete-orphan"
    )
    embedding = relationship(
        "ArticleEmbedding",
        back_populates="article",
        uselist=False,
        cascade="all, delete-orphan",
    )


class ArticleComment(Base):
    __tablename__ = "article_comments"

    id = Column(String, primary_key=True, default=generate_uuid)
    article_id = Column(
        String, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(String, nullable=False)
    user_name = Column(String, nullable=False)
    user_avatar = Column(String, nullable=True)
    provider = Column(String, nullable=True)
    content = Column(Text, nullable=False)
    reply_to_id = Column(String, nullable=True)
    is_hidden = Column(Boolean, default=False)
    created_at = Column(String, default=now_str)
    updated_at = Column(String, default=now_str)

    article = relationship("Article", back_populates="comments")


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id = Column(String, primary_key=True, default=generate_uuid)
    article_id = Column(
        String, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    original_url = Column(Text, nullable=True)
    storage_path = Column(Text, nullable=False)
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=True)
    created_at = Column(String, default=now_str)

    article = relationship("Article", back_populates="media_assets")


class AIAnalysis(Base):
    __tablename__ = "ai_analyses"

    id = Column(String, primary_key=True, default=generate_uuid)
    article_id = Column(
        String,
        ForeignKey("articles.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    summary = Column(Text)
    summary_status = Column(String, default=None)
    outline = Column(Text)
    outline_status = Column(String, default=None)
    key_points = Column(Text)
    key_points_status = Column(String, default=None)
    quotes = Column(Text)
    quotes_status = Column(String, default=None)
    mindmap = Column(Text)
    classification_status = Column(String, default=None)
    cleaned_md_draft = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    updated_at = Column(String, default=today_str)

    article = relationship("Article", back_populates="ai_analysis")


class AITask(Base):
    __tablename__ = "ai_tasks"

    id = Column(String, primary_key=True, default=generate_uuid)
    article_id = Column(String, ForeignKey("articles.id"), nullable=True)
    task_type = Column(String, nullable=False)
    content_type = Column(String, nullable=True)
    status = Column(String, default="pending")
    payload = Column(Text, nullable=True)
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=3)
    run_at = Column(String, default=now_str)
    locked_at = Column(String, nullable=True)
    locked_by = Column(String, nullable=True)
    last_error = Column(Text, nullable=True)
    last_error_type = Column(String, nullable=True)
    created_at = Column(String, default=now_str)
    updated_at = Column(String, default=now_str)
    finished_at = Column(String, nullable=True)

    events = relationship(
        "AITaskEvent",
        back_populates="task",
        cascade="all, delete-orphan",
    )


class AITaskEvent(Base):
    __tablename__ = "ai_task_events"

    id = Column(String, primary_key=True, default=generate_uuid)
    task_id = Column(
        String,
        ForeignKey("ai_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type = Column(String, nullable=False)
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    error_type = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(String, default=now_str)

    task = relationship("AITask", back_populates="events")


class AIUsageLog(Base):
    __tablename__ = "ai_usage_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    model_api_config_id = Column(
        String, ForeignKey("model_api_configs.id", ondelete="SET NULL"), nullable=True
    )
    task_id = Column(String, nullable=True)
    article_id = Column(
        String, ForeignKey("articles.id", ondelete="SET NULL"), nullable=True
    )
    task_type = Column(String, nullable=True)
    content_type = Column(String, nullable=True)
    status = Column(String, nullable=False, default="completed")
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    cost_input = Column(Float, nullable=True)
    cost_output = Column(Float, nullable=True)
    cost_total = Column(Float, nullable=True)
    currency = Column(String, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    request_payload = Column(Text, nullable=True)
    response_payload = Column(Text, nullable=True)
    created_at = Column(String, default=now_str)


class ArticleEmbedding(Base):
    __tablename__ = "article_embeddings"

    id = Column(String, primary_key=True, default=generate_uuid)
    article_id = Column(
        String,
        ForeignKey("articles.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    model = Column(String, nullable=True)
    embedding = Column(Text, nullable=False)
    source_hash = Column(String, nullable=True)
    created_at = Column(String, default=now_str)
    updated_at = Column(String, default=now_str)

    article = relationship("Article", back_populates="embedding")


class ModelAPIConfig(Base):
    __tablename__ = "model_api_configs"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    base_url = Column(String, nullable=False, default="https://api.openai.com/v1")
    api_key = Column(String, nullable=False)
    provider = Column(String, nullable=False, default="openai")
    model_name = Column(String, nullable=False, default="gpt-4o")
    model_type = Column(String, nullable=False, default="general")
    price_input_per_1k = Column(Float, nullable=True)
    price_output_per_1k = Column(Float, nullable=True)
    currency = Column(String, nullable=True)
    is_enabled = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(String, default=today_str)
    updated_at = Column(String, default=today_str)


class PromptConfig(Base):
    __tablename__ = "prompt_configs"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    category_id = Column(
        String, ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )
    type = Column(String, nullable=False)  # summary, outline, key_points, mindmap, etc.
    prompt = Column(Text, nullable=False)
    system_prompt = Column(Text, nullable=True)
    response_format = Column(String, nullable=True)
    temperature = Column(Float, nullable=True)
    max_tokens = Column(Integer, nullable=True)
    top_p = Column(Float, nullable=True)
    model_api_config_id = Column(
        String, ForeignKey("model_api_configs.id", ondelete="SET NULL"), nullable=True
    )
    is_enabled = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(String, default=today_str)
    updated_at = Column(String, default=today_str)

    category = relationship("Category", back_populates="prompt_configs")
    model_api_config = relationship("ModelAPIConfig", backref="prompt_configs")


class AdminSettings(Base):
    """存储管理员认证信息，系统只有一个管理员账户"""

    __tablename__ = "admin_settings"

    id = Column(String, primary_key=True, default=generate_uuid)
    password_hash = Column(String, nullable=False)
    jwt_secret = Column(String, nullable=False)  # 用于签名 JWT token
    comments_enabled = Column(Boolean, default=True)
    github_client_id = Column(String, nullable=True)
    github_client_secret = Column(String, nullable=True)
    google_client_id = Column(String, nullable=True)
    google_client_secret = Column(String, nullable=True)
    nextauth_secret = Column(String, nullable=True)
    sensitive_filter_enabled = Column(Boolean, default=True)
    sensitive_words = Column(Text, nullable=True)
    media_storage_enabled = Column(Boolean, default=False)
    media_compress_threshold = Column(Integer, default=1536 * 1024)
    media_max_dim = Column(Integer, default=2000)
    media_webp_quality = Column(Integer, default=80)
    recommendations_enabled = Column(Boolean, default=False)
    recommendation_model_config_id = Column(String, nullable=True)
    default_language = Column(String, default="zh-CN")
    site_name = Column(String, default="Lumina")
    site_description = Column(Text, default="信息灯塔")
    site_logo_url = Column(String, nullable=True)
    home_badge_text = Column(Text, default="")
    home_tagline_text = Column(Text, default="")
    home_primary_button_text = Column(String, default="")
    home_primary_button_url = Column(String, default="")
    home_secondary_button_text = Column(String, default="")
    home_secondary_button_url = Column(String, default="")
    created_at = Column(String, default=now_str)
    updated_at = Column(String, default=now_str)


def init_db():
    Base.metadata.create_all(bind=engine)
    run_db_migrations(DATABASE_URL)

    from sqlalchemy import text

    # Create indexes for better query performance
    with engine.connect() as conn:
        if engine.dialect.name == "sqlite":

            def ensure_columns(table_name: str, columns: list[tuple[str, str]]):
                existing = conn.execute(
                    text(f"PRAGMA table_info({table_name})")
                ).fetchall()
                existing_names = {row[1] for row in existing}
                for name, col_type in columns:
                    if name not in existing_names:
                        conn.execute(
                            text(
                                f"ALTER TABLE {table_name} ADD COLUMN {name} {col_type}"
                            )
                        )

            ensure_columns(
                "prompt_configs",
                [
                    ("system_prompt", "TEXT"),
                    ("response_format", "TEXT"),
                    ("temperature", "REAL"),
                    ("max_tokens", "INTEGER"),
                    ("top_p", "REAL"),
                ],
            )

            ensure_columns(
                "ai_tasks",
                [
                    ("content_type", "TEXT"),
                    ("payload", "TEXT"),
                    ("attempts", "INTEGER"),
                    ("max_attempts", "INTEGER"),
                    ("run_at", "TEXT"),
                    ("locked_at", "TEXT"),
                    ("locked_by", "TEXT"),
                    ("last_error", "TEXT"),
                    ("last_error_type", "TEXT"),
                    ("created_at", "TEXT"),
                    ("updated_at", "TEXT"),
                    ("finished_at", "TEXT"),
                ],
            )

            ensure_columns(
                "model_api_configs",
                [
                    ("provider", "TEXT"),
                    ("price_input_per_1k", "REAL"),
                    ("price_output_per_1k", "REAL"),
                    ("currency", "TEXT"),
                    ("model_type", "TEXT"),
                ],
            )

            ensure_columns(
                "ai_usage_logs",
                [
                    ("request_payload", "TEXT"),
                    ("response_payload", "TEXT"),
                ],
            )

            ensure_columns(
                "articles",
                [
                    ("note_content", "TEXT"),
                    ("note_annotations", "TEXT"),
                    ("slug", "TEXT"),
                    ("content_structured", "TEXT"),
                ],
            )

            ensure_columns(
                "ai_analyses",
                [
                    ("classification_status", "TEXT"),
                    ("cleaned_md_draft", "TEXT"),
                ],
            )

            ensure_columns(
                "article_embeddings",
                [
                    ("source_hash", "TEXT"),
                ],
            )

            ensure_columns(
                "admin_settings",
                [
                    ("comments_enabled", "INTEGER"),
                    ("github_client_id", "TEXT"),
                    ("github_client_secret", "TEXT"),
                    ("google_client_id", "TEXT"),
                    ("google_client_secret", "TEXT"),
                    ("nextauth_secret", "TEXT"),
                    ("sensitive_filter_enabled", "INTEGER"),
                    ("sensitive_words", "TEXT"),
                    ("media_storage_enabled", "INTEGER"),
                    ("media_compress_threshold", "INTEGER"),
                    ("media_max_dim", "INTEGER"),
                    ("media_webp_quality", "INTEGER"),
                    ("recommendations_enabled", "INTEGER"),
                    ("recommendation_model_config_id", "TEXT"),
                    ("default_language", "TEXT"),
                    ("site_name", "TEXT"),
                    ("site_description", "TEXT"),
                    ("site_logo_url", "TEXT"),
                    ("home_badge_text", "TEXT"),
                    ("home_tagline_text", "TEXT"),
                    ("home_primary_button_text", "TEXT"),
                    ("home_primary_button_url", "TEXT"),
                    ("home_secondary_button_text", "TEXT"),
                    ("home_secondary_button_url", "TEXT"),
                ],
            )
            ensure_columns(
                "article_comments",
                [
                    ("reply_to_id", "TEXT"),
                    ("is_hidden", "INTEGER"),
                ],
            )
            ensure_columns(
                "article_comments",
                [
                    ("reply_to_id", "TEXT"),
                ],
            )

            rows = conn.execute(
                text(
                    "SELECT id, slug FROM articles ORDER BY created_at ASC, id ASC"
                )
            ).mappings().all()
            seen_slugs: set[str] = set()
            for row in rows:
                article_id = row["id"]
                current_slug = (row.get("slug") or "").strip()
                base_slug = current_slug or f"article-{article_id.split('-')[0]}"
                candidate = base_slug
                sequence = 1
                while candidate in seen_slugs:
                    suffix = article_id.replace("-", "")[:8]
                    if sequence == 1:
                        candidate = f"{base_slug}-{suffix}"
                    else:
                        candidate = f"{base_slug}-{suffix}-{sequence}"
                    sequence += 1
                seen_slugs.add(candidate)
                if candidate != row.get("slug"):
                    conn.execute(
                        text("UPDATE articles SET slug = :slug WHERE id = :id"),
                        {"slug": candidate, "id": article_id},
                    )

            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_slug_unique ON articles (slug)"
                )
            )

            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_run_at ON ai_tasks (status, run_at)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_ai_tasks_article_id ON ai_tasks (article_id)"
                )
            )

            active_task_rows = conn.execute(
                text(
                    "SELECT id, article_id, task_type, content_type, ifnull(payload, '') AS payload FROM ai_tasks WHERE status IN ('pending', 'processing') ORDER BY created_at ASC, id ASC"
                )
            ).mappings().all()
            seen_active_keys: set[tuple[str, str, str, str]] = set()
            dedupe_now = now_str()
            for row in active_task_rows:
                key = (
                    row.get("article_id") or "",
                    row.get("task_type") or "",
                    row.get("content_type") or "",
                    row.get("payload") or "",
                )
                if key in seen_active_keys:
                    conn.execute(
                        text(
                            "UPDATE ai_tasks SET status = 'cancelled', finished_at = :now, updated_at = :now, locked_at = NULL, locked_by = NULL, last_error = :error, last_error_type = 'data' WHERE id = :id"
                        ),
                        {
                            "id": row["id"],
                            "now": dedupe_now,
                            "error": "重复任务已在迁移时自动取消",
                        },
                    )
                else:
                    seen_active_keys.add(key)

            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_tasks_active_dedupe_unique ON ai_tasks (ifnull(article_id, ''), task_type, ifnull(content_type, ''), ifnull(payload, '')) WHERE status IN ('pending', 'processing')"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_ai_task_events_task_created_at ON ai_task_events (task_id, created_at)"
                )
            )

            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_model ON ai_usage_logs (model_api_config_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs (created_at)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_status ON ai_usage_logs (status)"
                )
            )

            def migrate_ai_configs_to_prompt_configs():
                table_exists = conn.execute(
                    text(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='ai_configs'"
                    )
                ).fetchone()
                if not table_exists:
                    return

                rows = conn.execute(text("SELECT * FROM ai_configs")).mappings().all()

                default_prompts = {
                    "summary": "为提供的文本创作一份“快读摘要”，旨在让读者在30秒内掌握核心情报。\n\n要求：\n1) 极简主义：剔除背景铺垫、案例细节、营销话术及修饰性词汇，直奔主题。\n2) 内容密度：必须包含核心主体、关键动作/事件、最终影响/结论。\n3) 篇幅：严格控制在50-150字之间。\n\n待摘要内容：\n{content}",
                    "outline": '请阅读提供的文本，并按指定 JSON 结构提取文章大纲（思维导图友好版）。\n\n要求：\n1) 根节点 title 简洁概括主题，可附领域/对象（如“增长策略｜SaaS”）。\n2) 核心观点：2-3 个主要立论。\n3) 关键概念：用“概念：极简释义”格式。\n4) 结论与启示：输出结论与启示；如有明确行动建议，可额外增加“行动：...”节点。\n5) 叶子节点不要使用“观点A/概念1”等前缀，直接给内容。\n6) 叶子节点建议不超过 30 字，便于缩略图展示。\n\n输出结构（只替换内容）：\n{\n  "title": "文章标题",\n  "children": [\n    {\n      "title": "核心观点",\n      "children": [\n        { "title": "核心观点内容" },\n        { "title": "核心观点内容" }\n      ]\n    },\n    {\n      "title": "关键概念",\n      "children": [\n        { "title": "概念：极简释义" },\n        { "title": "概念：极简释义" }\n      ]\n    },\n    {\n      "title": "结论与启示",\n      "children": [\n        { "title": "结论：..." },\n        { "title": "启示：..." },\n        { "title": "行动：..." }\n      ]\n    }\n  ]\n}\n\n待解析内容：\n{content}',
                    "key_points": '请阅读提供的文本内容，生成一份干练、客观的中文总结。\n\n要求：\n1) 彻底去噪：剔除营销推广、招聘信息、课程宣传、免责声明、社交媒体引导语等无关内容。\n2) 聚焦核心：只保留核心观点、关键事实与重要结论。\n3) 逻辑重构：不要摘抄原句，重组语言，信息密度高、行文连贯。\n4) 段落衔接：段落内自然衔接（可用"此外/另一方面/综上所述"等连接词）。\n5) 格式强化：善用 Markdown 格式突出关键信息，具体规则如下：\n - **加粗**：用于核心概念、关键术语、重要人名/机构名、关键数据（如"**GDP 增长 5.2%**"、"**OpenAI**"）。\n- *斜体*：用于需要特别区分或存在争议/不确定性的表述（如"*据未经证实的消息*"、"*该观点尚存分歧*"），也可用于对比场景中标注对立面。\n - **加粗 + 斜体结合**（***文字***）：仅用于全文最核心的结论或转折性判断，不超过 1–2 处。\n\n字数：300–500 字。\n\n待总结内容：\n{content}',
                    "quotes": "请阅读提供的文本内容，从中筛选并提炼出最具有传播力、深度或启发性的金句。\n\n要求：\n1) 标准：深刻性、共鸣感、精炼性。\n2) 拒绝平庸：不要事实陈述句，选择观点句/结论句/修辞优美的句子。\n3) 允许润色：可在不改变原意下微调，使其更像独立名言。\n4) 多样化：覆盖不同维度（趋势判断/价值坚守/行动号召等）。\n\n输出格式：\n- 使用无序列表（-），每句单独一行\n- 数量 3-5 条\n- 仅输出金句列表，不要解释\n\n待提炼内容：\n{content}",
                    "translation": "将输入的英文文章翻译成中文。\n\n要求：\n1) 严格保留原始 Markdown 格式（标题、列表、链接、代码块、换行等）。\n2) 专业术语使用业界通用中文表达，必要时可在中文后保留英文原词。\n3) 语言风格地道、通顺，避免翻译腔。\n4) 只输出译文，不要前后缀。\n\n请直接开始翻译：\n{content}",
                    "content_cleaning": "请将以下 HTML 内容清洗为结构化的 GFM Markdown。\n\n硬性要求：\n1) 仅输出 Markdown 正文，禁止任何解释/前后缀。\n2) 必须保留：标题层级、列表、引用、表格、链接、图片、代码块、段落换行。\n3) 必须去除：导航、广告、版权声明、推荐阅读、分享按钮、评论区、相关链接、页脚。\n4) 不要改写内容，只做结构化与去噪。\n5) 链接使用标准 Markdown 形式，图片使用 ![]()。\n\nHTML：\n{content}",
                    "content_validation": '你是内容质检员，只输出 JSON。\n\n硬性要求：\n1) 仅输出 JSON，不要解释/Markdown 代码块。\n2) JSON 结构：{"is_valid": true/false, "error": "错误原因"}。\n3) 若合规：is_valid=true，error 为空字符串。\n4) 若不合规：is_valid=false，error 使用“错误类型：说明”格式，错误类型仅限以下之一：空内容、广告/导航、结构混乱、格式异常、语言混杂、其他。\n5) 合规标准：必须包含正文内容；标题/段落格式合理；无明显广告/导航；无空输出。\n\n待校验内容：\n{content}',
                    "classification": "请根据以下文章内容与分类列表选择最匹配的分类。\n\n硬性要求：\n1) 仅输出分类 ID（UUID），不要输出任何解释或多余字符。\n2) 若无合适分类输出空字符串。\n3) 只允许输出分类列表中出现的 ID。\n\n分类列表：\n{categories}\n\n文章内容：\n{content}",
                }

                model_cache = {}

                for row in rows:
                    dimension = row.get("dimension") or "summary"
                    category_id = row.get("category_id")
                    prompt = row.get("prompt_template") or default_prompts.get(
                        dimension, "请根据以下内容生成：\n\n{content}"
                    )

                    base_url = row.get("base_url") or "https://api.openai.com/v1"
                    api_key = row.get("api_key") or ""
                    model_name = row.get("model_name") or "gpt-4o"
                    model_key = f"{base_url}|{api_key}|{model_name}"

                    model_id = model_cache.get(model_key)
                    if not model_id:
                        existing_model = conn.execute(
                            text(
                                """
                                SELECT id FROM model_api_configs
                                WHERE base_url = :base_url AND api_key = :api_key AND model_name = :model_name
                                LIMIT 1
                                """
                            ),
                            {
                                "base_url": base_url,
                                "api_key": api_key,
                                "model_name": model_name,
                            },
                        ).fetchone()

                        if existing_model:
                            model_id = existing_model[0]
                        else:
                            model_id = generate_uuid()
                            conn.execute(
                                text(
                                    """
                                    INSERT INTO model_api_configs
                                    (id, name, base_url, api_key, model_name, is_enabled, is_default, created_at, updated_at)
                                    VALUES (:id, :name, :base_url, :api_key, :model_name, :is_enabled, :is_default, :created_at, :updated_at)
                                    """
                                ),
                                {
                                    "id": model_id,
                                    "name": f"迁移-{model_name}",
                                    "base_url": base_url,
                                    "api_key": api_key,
                                    "model_name": model_name,
                                    "is_enabled": bool(row.get("is_enabled", True)),
                                    "is_default": False,
                                    "created_at": today_str(),
                                    "updated_at": today_str(),
                                },
                            )
                        model_cache[model_key] = model_id

                    params = {}
                    for key in [
                        "system_prompt",
                        "response_format",
                        "temperature",
                        "max_tokens",
                        "top_p",
                    ]:
                        if key in row and row.get(key) is not None:
                            params[key] = row.get(key)

                    raw_params = row.get("parameters")
                    if raw_params:
                        try:
                            parsed = (
                                json.loads(raw_params)
                                if isinstance(raw_params, str)
                                else raw_params
                            )
                            if isinstance(parsed, dict):
                                for key in [
                                    "system_prompt",
                                    "response_format",
                                    "temperature",
                                    "max_tokens",
                                    "top_p",
                                ]:
                                    if (
                                        key not in params
                                        and parsed.get(key) is not None
                                    ):
                                        params[key] = parsed.get(key)
                        except json.JSONDecodeError:
                            pass

                    if category_id is None:
                        existing_prompt = conn.execute(
                            text(
                                """
                                SELECT id FROM prompt_configs
                                WHERE category_id IS NULL AND type = :type AND prompt = :prompt
                                LIMIT 1
                                """
                            ),
                            {"type": dimension, "prompt": prompt},
                        ).fetchone()
                    else:
                        existing_prompt = conn.execute(
                            text(
                                """
                                SELECT id FROM prompt_configs
                                WHERE category_id = :category_id AND type = :type AND prompt = :prompt
                                LIMIT 1
                                """
                            ),
                            {
                                "category_id": category_id,
                                "type": dimension,
                                "prompt": prompt,
                            },
                        ).fetchone()

                    if existing_prompt:
                        continue

                    conn.execute(
                        text(
                            """
                            INSERT INTO prompt_configs
                            (id, name, category_id, type, prompt, system_prompt, response_format, temperature, max_tokens, top_p,
                             model_api_config_id, is_enabled, is_default, created_at, updated_at)
                            VALUES (:id, :name, :category_id, :type, :prompt, :system_prompt, :response_format, :temperature,
                                    :max_tokens, :top_p, :model_api_config_id, :is_enabled, :is_default, :created_at, :updated_at)
                            """
                        ),
                        {
                            "id": generate_uuid(),
                            "name": f"迁移-{dimension}",
                            "category_id": category_id,
                            "type": dimension,
                            "prompt": prompt,
                            "system_prompt": params.get("system_prompt"),
                            "response_format": params.get("response_format"),
                            "temperature": params.get("temperature"),
                            "max_tokens": params.get("max_tokens"),
                            "top_p": params.get("top_p"),
                            "model_api_config_id": model_id,
                            "is_enabled": bool(row.get("is_enabled", True)),
                            "is_default": bool(row.get("is_default", False)),
                            "created_at": today_str(),
                            "updated_at": today_str(),
                        },
                    )

                conn.execute(text("DROP TABLE IF EXISTS ai_configs"))

            migrate_ai_configs_to_prompt_configs()

            def seed_default_prompt_configs():
                default_configs = [
                    {
                        "type": "summary",
                        "name": "默认-快读摘要",
                        "system_prompt": "你是一名资深内容分析师，擅长用最极简的语言精准捕捉文章灵魂。输出必须为中文、客观、单段长句（可用逗号句号，禁止分段/换行），禁止任何列表符号（- * 1.等），禁止出现“这篇文章讲了/摘要如下”等前置废话。",
                        "prompt": "为提供的文本创作一份“快读摘要”，旨在让读者在30秒内掌握核心情报。\n\n要求：\n1) 极简主义：剔除背景铺垫、案例细节、营销话术及修饰性词汇，直奔主题。\n2) 内容密度：必须包含核心主体、关键动作/事件、最终影响/结论。\n3) 篇幅：严格控制在50-150字之间。\n\n待摘要内容：\n{content}",
                        "response_format": "text",
                        "temperature": 0.3,
                        "max_tokens": 400,
                        "top_p": 1.0,
                    },
                    {
                        "type": "key_points",
                        "name": "默认-总结",
                        "system_prompt": "你是一名资深内容分析师，擅长从复杂信息中剥离噪音，提取核心价值并进行专业重构。输出必须为中文、客观、无主观评价；禁止任何开场白/结束语或解释性文字；严禁使用任何列表符号；段落数量严格控制在2-3段。",
                        "prompt": '请阅读提供的文本内容，生成一份干练、客观的中文总结。\n\n要求：\n1) 彻底去噪：剔除营销推广、招聘信息、课程宣传、免责声明、社交媒体引导语等无关内容。\n2) 聚焦核心：只保留核心观点、关键事实与重要结论。\n3) 逻辑重构：不要摘抄原句，重组语言，信息密度高、行文连贯。\n4) 段落衔接：段落内自然衔接（可用"此外/另一方面/综上所述"等连接词）。\n5) 格式强化：善用 Markdown 格式突出关键信息，具体规则如下：\n - **加粗**：用于核心概念、关键术语、重要人名/机构名、关键数据（如"**GDP 增长 5.2%**"、"**OpenAI**"）。\n- *斜体*：用于需要特别区分或存在争议/不确定性的表述（如"*据未经证实的消息*"、"*该观点尚存分歧*"），也可用于对比场景中标注对立面。\n - **加粗 + 斜体结合**（***文字***）：仅用于全文最核心的结论或转折性判断，不超过 1–2 处。\n\n字数：300–500 字。\n\n待总结内容：\n{content}',
                        "response_format": "text",
                        "temperature": 0.4,
                        "max_tokens": 1000,
                        "top_p": 0.9,
                    },
                    {
                        "type": "outline",
                        "name": "默认-大纲",
                        "system_prompt": "你是一名结构化数据转换专家，擅长将长篇文章解析为思维导图专用的 JSON 格式。输出必须为合法 JSON，禁止任何解释性文字、开场白、Markdown 代码块。",
                        "prompt": '请阅读提供的文本，并按指定 JSON 结构提取文章大纲（思维导图友好版）。\n\n要求：\n1) 根节点 title 简洁概括主题，可附领域/对象（如“增长策略｜SaaS”）。\n2) 核心观点：2-3 个主要立论。\n3) 关键概念：用“概念：极简释义”格式。\n4) 结论与启示：输出结论与启示；如有明确行动建议，可额外增加“行动：...”节点。\n5) 叶子节点不要使用“观点A/概念1”等前缀，直接给内容。\n6) 叶子节点建议不超过 30 字，便于缩略图展示。\n\n输出结构（只替换内容）：\n{\n  "title": "文章标题",\n  "children": [\n    {\n      "title": "核心观点",\n      "children": [\n        { "title": "核心观点内容" },\n        { "title": "核心观点内容" }\n      ]\n    },\n    {\n      "title": "关键概念",\n      "children": [\n        { "title": "概念：极简释义" },\n        { "title": "概念：极简释义" }\n      ]\n    },\n    {\n      "title": "结论与启示",\n      "children": [\n        { "title": "结论：..." },\n        { "title": "启示：..." },\n        { "title": "行动：..." }\n      ]\n    }\n  ]\n}\n\n待解析内容：\n{content}',
                        "response_format": "json_object",
                        "temperature": 0.3,
                        "max_tokens": 1200,
                        "top_p": 1.0,
                    },
                    {
                        "type": "quotes",
                        "name": "默认-金句",
                        "system_prompt": "你是一名资深文案金句捕手，擅长从长篇内容中提炼传播力强的金句。输出必须为中文，仅输出金句列表，不要任何解释或前后缀。",
                        "prompt": "请阅读提供的文本内容，从中筛选并提炼出最具有传播力、深度或启发性的金句。\n\n要求：\n1) 标准：深刻性、共鸣感、精炼性。\n2) 拒绝平庸：不要事实陈述句，选择观点句/结论句/修辞优美的句子。\n3) 允许润色：可在不改变原意下微调，使其更像独立名言。\n4) 多样化：覆盖不同维度（趋势判断/价值坚守/行动号召等）。\n\n输出格式：\n- 使用无序列表（-），每句单独一行\n- 数量 3-5 条\n- 仅输出金句列表，不要解释\n\n待提炼内容：\n{content}",
                        "response_format": "text",
                        "temperature": 0.7,
                        "max_tokens": 700,
                        "top_p": 1.0,
                    },
                    {
                        "type": "translation",
                        "name": "默认-中英翻译",
                        "system_prompt": "你是一位精通中英文互译的专业翻译官，擅长科技、文化及商业领域的信达雅翻译。必须仅输出中文译文，禁止任何额外话语。",
                        "prompt": "将输入的英文文章翻译成中文。\n\n要求：\n1) 严格保留原始 Markdown 格式（标题、列表、链接、代码块、换行等）。\n2) 专业术语使用业界通用中文表达，必要时可在中文后保留英文原词。\n3) 语言风格地道、通顺，避免翻译腔。\n4) 只输出译文，不要前后缀。\n\n请直接开始翻译：\n{content}",
                        "response_format": "text",
                        "temperature": 0.2,
                        "max_tokens": 14000,
                        "top_p": 1.0,
                    },
                    {
                        "type": "content_cleaning",
                        "name": "默认-内容清洗",
                        "system_prompt": "你是严谨的内容清洗专家，专注输出稳定、结构化的 GFM Markdown。",
                        "prompt": "请将以下 HTML 内容清洗为结构化的 GFM Markdown。\n\n硬性要求：\n1) 仅输出 Markdown 正文，禁止任何解释/前后缀。\n2) 必须保留：标题层级、列表、引用、表格、链接、图片、代码块、段落换行。\n3) 必须去除：导航、广告、版权声明、推荐阅读、分享按钮、评论区、相关链接、页脚。\n4) 不要改写内容，只做结构化与去噪。\n5) 链接使用标准 Markdown 形式，图片使用 ![]()。\n\nHTML：\n{content}",
                        "response_format": "text",
                        "temperature": 0.1,
                        "max_tokens": 12000,
                        "top_p": 1.0,
                    },
                    {
                        "type": "content_validation",
                        "name": "默认-内容校验",
                        "system_prompt": "你是内容质检员，只输出 JSON。",
                        "prompt": '你是内容质检员，只输出 JSON。\n\n硬性要求：\n1) 仅输出 JSON，不要解释/Markdown 代码块。\n2) JSON 结构：{"is_valid": true/false, "error": "错误原因"}。\n3) 若合规：is_valid=true，error 为空字符串。\n4) 若不合规：is_valid=false，error 使用“错误类型：说明”格式，错误类型仅限以下之一：空内容、广告/导航、结构混乱、格式异常、语言混杂、其他。\n5) 合规标准：必须包含正文内容；标题/段落格式合理；无明显广告/导航；无空输出。\n\n待校验内容：\n{content}',
                        "response_format": "json_object",
                        "temperature": 0.0,
                        "max_tokens": 800,
                        "top_p": 1.0,
                    },
                    {
                        "type": "classification",
                        "name": "默认-分类",
                        "system_prompt": "你是内容分类助手，只输出分类 ID。",
                        "prompt": "请根据以下文章内容与分类列表选择最匹配的分类。\n\n硬性要求：\n1) 仅输出分类 ID（UUID），不要输出任何解释或多余字符。\n2) 若无合适分类输出空字符串。\n3) 只允许输出分类列表中出现的 ID。\n\n分类列表：\n{categories}\n\n文章内容：\n{content}",
                        "response_format": "text",
                        "temperature": 0.1,
                        "max_tokens": 200,
                        "top_p": 0.9,
                    },
                ]

                for config in default_configs:
                    exists = conn.execute(
                        text(
                            """
                            SELECT id FROM prompt_configs
                            WHERE category_id IS NULL AND type = :type
                            LIMIT 1
                            """
                        ),
                        {"type": config["type"]},
                    ).fetchone()
                    if exists:
                        continue

                    conn.execute(
                        text(
                            """
                            INSERT INTO prompt_configs
                            (id, name, category_id, type, prompt, system_prompt, response_format, temperature, max_tokens, top_p,
                             model_api_config_id, is_enabled, is_default, created_at, updated_at)
                            VALUES (:id, :name, :category_id, :type, :prompt, :system_prompt, :response_format, :temperature,
                                    :max_tokens, :top_p, :model_api_config_id, :is_enabled, :is_default, :created_at, :updated_at)
                            """
                        ),
                        {
                            "id": generate_uuid(),
                            "name": config["name"],
                            "category_id": None,
                            "type": config["type"],
                            "prompt": config["prompt"],
                            "system_prompt": config["system_prompt"],
                            "response_format": config["response_format"],
                            "temperature": config["temperature"],
                            "max_tokens": config["max_tokens"],
                            "top_p": config["top_p"],
                            "model_api_config_id": None,
                            "is_enabled": True,
                            "is_default": True,
                            "created_at": today_str(),
                            "updated_at": today_str(),
                        },
                    )

            seed_default_prompt_configs()

        # Article table indexes
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id)"
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)")
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_articles_source_url ON articles(source_url)"
            )
        )
        # AI Analysis table indexes
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_ai_analysis_article_id ON ai_analyses(article_id)"
            )
        )
        conn.commit()
