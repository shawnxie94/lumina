from sqlalchemy import Column, String, Text, Integer, Boolean, ForeignKey, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from datetime import datetime
import uuid
import os

Base = declarative_base()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/articles.db")

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


class Category(Base):
    __tablename__ = "categories"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text)
    color = Column(String)
    sort_order = Column(Integer, default=0)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())

    articles = relationship("Article", back_populates="category")
    ai_configs = relationship("AIConfig", back_populates="category")
    prompt_configs = relationship("PromptConfig", back_populates="category")


class Article(Base):
    __tablename__ = "articles"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False)
    content_html = Column(Text, nullable=False)
    content_md = Column(Text)
    content_trans = Column(Text)
    source_url = Column(String, unique=True, nullable=False)
    top_image = Column(String)
    author = Column(String)
    published_at = Column(String)
    source_domain = Column(String)
    status = Column(String, default="pending")
    category_id = Column(String, ForeignKey("categories.id"))
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.utcnow().isoformat())

    category = relationship("Category", back_populates="articles")
    ai_analysis = relationship("AIAnalysis", back_populates="article", uselist=False)


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
    outline = Column(Text)
    key_points = Column(Text)
    mindmap = Column(Text)
    error_message = Column(Text, nullable=True)
    updated_at = Column(String, default=lambda: datetime.utcnow().isoformat())

    article = relationship("Article", back_populates="ai_analysis")


class ModelAPIConfig(Base):
    __tablename__ = "model_api_configs"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    base_url = Column(String, nullable=False, default="https://api.openai.com/v1")
    api_key = Column(String, nullable=False)
    model_name = Column(String, nullable=False, default="gpt-4o")
    is_enabled = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.utcnow().isoformat())


class PromptConfig(Base):
    __tablename__ = "prompt_configs"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    category_id = Column(
        String, ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )
    type = Column(String, nullable=False)  # summary, outline, key_points, mindmap, etc.
    prompt = Column(Text, nullable=False)
    model_api_config_id = Column(
        String, ForeignKey("model_api_configs.id", ondelete="SET NULL"), nullable=True
    )
    is_enabled = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.utcnow().isoformat())

    category = relationship("Category", back_populates="prompt_configs")
    model_api_config = relationship("ModelAPIConfig", backref="prompt_configs")


# Keep AIConfig for backwards compatibility (deprecated)
class AIConfig(Base):
    __tablename__ = "ai_configs"

    id = Column(String, primary_key=True, default=generate_uuid)
    category_id = Column(
        String, ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )
    dimension = Column(String, nullable=False)
    is_enabled = Column(Boolean, default=True)
    base_url = Column(String, nullable=False, default="https://api.openai.com/v1")
    api_key = Column(String, nullable=False)
    model_name = Column(String, default="gpt-4o")
    prompt_template = Column(Text)
    parameters = Column(Text)
    is_default = Column(Boolean, default=False)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.utcnow().isoformat())

    category = relationship("Category", back_populates="ai_configs")


def init_db():
    Base.metadata.create_all(bind=engine)

    from sqlalchemy import text

    # Create indexes for better query performance
    with engine.connect() as conn:
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
