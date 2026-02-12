from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    Boolean,
    ForeignKey,
    Float,
    create_engine,
    event,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from datetime import date, datetime, timezone
import uuid
from app.core.db_migrations import run_db_migrations
from app.core.settings import get_settings

Base = declarative_base()

settings = get_settings()
DATABASE_URL = settings.database_url

IS_SQLITE = DATABASE_URL.startswith("sqlite")
engine_connect_args = {}
if IS_SQLITE:
    engine_connect_args = {
        "check_same_thread": False,
        "timeout": max(settings.sqlite_busy_timeout_ms, 1000) / 1000,
    }

engine = create_engine(DATABASE_URL, connect_args=engine_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _apply_sqlite_pragmas(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        try:
            if settings.sqlite_wal_enabled:
                cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute(f"PRAGMA synchronous={settings.sqlite_synchronous.upper()}")
            cursor.execute(f"PRAGMA busy_timeout={settings.sqlite_busy_timeout_ms}")
            cursor.execute(f"PRAGMA temp_store={settings.sqlite_temp_store}")
        finally:
            cursor.close()


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
    finish_reason = Column(String, nullable=True)
    truncated = Column(Boolean, nullable=True)
    chunk_index = Column(Integer, nullable=True)
    continue_round = Column(Integer, nullable=True)
    estimated_input_tokens = Column(Integer, nullable=True)
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
    context_window_tokens = Column(Integer, nullable=True)
    reserve_output_tokens = Column(Integer, nullable=True)
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
    chunk_size_tokens = Column(Integer, nullable=True)
    chunk_overlap_tokens = Column(Integer, nullable=True)
    max_continue_rounds = Column(Integer, nullable=True)
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
    run_db_migrations(DATABASE_URL)
