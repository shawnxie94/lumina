import hashlib
import json
import math
import re

from ai_client import ConfigurableAIClient
from models import (
    AdminSettings,
    Article,
    ArticleEmbedding,
    ModelAPIConfig,
    SessionLocal,
    now_str,
)
from sqlalchemy.orm import Session
from task_errors import TaskConfigError, TaskDataError

EMBEDDING_TEXT_LIMIT = 4000
REMOTE_EMBEDDING_REQUIRED_MESSAGE = (
    "文章推荐未启用或未配置可用的远程向量模型，请先在后台完成配置"
)


class ArticleEmbeddingService:
    def get_embedding_config(self, db: Session) -> dict | None:
        admin = db.query(AdminSettings).first()
        if not admin or not bool(admin.recommendations_enabled):
            return {"disabled": True}

        model_config_id = (admin.recommendation_model_config_id or "").strip()
        if not model_config_id:
            return None

        model_config = (
            db.query(ModelAPIConfig)
            .filter(ModelAPIConfig.id == model_config_id)
            .first()
        )
        if not model_config or not bool(model_config.is_enabled):
            return None
        if (model_config.model_type or "general") != "vector":
            return None

        return {
            "base_url": model_config.base_url,
            "api_key": model_config.api_key,
            "provider": model_config.provider or "openai",
            "model_name": model_config.model_name,
            "model_api_config_id": model_config.id,
            "price_input_per_1k": model_config.price_input_per_1k,
            "price_output_per_1k": model_config.price_output_per_1k,
            "currency": model_config.currency,
        }

    def has_available_remote_config(self, db: Session) -> bool:
        config = self.get_embedding_config(db)
        return bool(config and not config.get("disabled"))

    def get_embedding_source_text(self, article: Article) -> str:
        title = (article.title or "").strip()
        summary = (
            article.ai_analysis.summary.strip()
            if article.ai_analysis and article.ai_analysis.summary
            else ""
        )
        if not summary:
            return ""

        source = f"{title}\n\n{summary}" if title else summary

        source = (source or "").strip()
        if not source:
            return ""
        compact = re.sub(r"\s+", " ", source)
        return compact[:EMBEDDING_TEXT_LIMIT]

    def has_summary_source(self, article: Article) -> bool:
        return bool(self.get_embedding_source_text(article))

    def get_embedding_source_hash(self, article: Article) -> str | None:
        source_text = self.get_embedding_source_text(article)
        if not source_text:
            return None
        return hashlib.sha256(source_text.encode("utf-8")).hexdigest()

    def cosine_similarity(self, vector_a: list[float], vector_b: list[float]) -> float:
        if not vector_a or not vector_b or len(vector_a) != len(vector_b):
            return 0.0

        dot = 0.0
        norm_a = 0.0
        norm_b = 0.0
        for value_a, value_b in zip(vector_a, vector_b):
            dot += value_a * value_b
            norm_a += value_a * value_a
            norm_b += value_b * value_b

        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))

    async def ensure_article_embedding(
        self,
        db: Session,
        article: Article,
    ) -> ArticleEmbedding | None:
        config = self.get_embedding_config(db)
        if not config:
            raise TaskConfigError(REMOTE_EMBEDDING_REQUIRED_MESSAGE)
        if config.get("disabled"):
            return None

        source_text = self.get_embedding_source_text(article)
        if not source_text:
            raise TaskDataError("摘要未生成，暂无法生成向量")

        model_name = config["model_name"]
        model_label = model_name
        source_hash = hashlib.sha256(source_text.encode("utf-8")).hexdigest()

        existing = (
            db.query(ArticleEmbedding)
            .filter(ArticleEmbedding.article_id == article.id)
            .first()
        )
        if (
            existing
            and existing.model == model_label
            and existing.embedding
            and existing.source_hash == source_hash
        ):
            return existing

        provider = (config.get("provider") or "openai").lower()
        if provider == "jina":
            import httpx

            jina_base = config["base_url"].rstrip("/")
            if not jina_base.endswith("/v1"):
                jina_base = f"{jina_base}/v1"

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{jina_base}/embeddings",
                    headers={
                        "Authorization": f"Bearer {config['api_key']}",
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    json={"model": model_name, "input": [source_text]},
                    timeout=None,
                )
                response.raise_for_status()
                data = response.json()
                embedding_data = (data.get("data") or [{}])[0].get("embedding") or []
        else:
            client = ConfigurableAIClient(
                base_url=config["base_url"],
                api_key=config["api_key"],
                model_name=model_name,
            )
            result = await client.generate_embedding(source_text, model_name=model_name)
            embedding_data = result.get("embedding") or []

        embedding_json = json.dumps(embedding_data, ensure_ascii=False)
        now_iso = now_str()

        if existing:
            existing.embedding = embedding_json
            existing.model = model_label
            existing.source_hash = source_hash
            existing.updated_at = now_iso
            db.commit()
            return existing

        record = ArticleEmbedding(
            article_id=article.id,
            model=model_label,
            embedding=embedding_json,
            source_hash=source_hash,
            created_at=now_iso,
            updated_at=now_iso,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    async def process_article_embedding(self, article_id: str) -> None:
        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return
            await self.ensure_article_embedding(db, article)
        finally:
            db.close()
