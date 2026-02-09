from ai_client import ConfigurableAIClient, is_english_content
import json
import logging
import math
import re

from models import (
    Article,
    AIAnalysis,
    AITask,
    AIUsageLog,
    ArticleEmbedding,
    AdminSettings,
    Category,
    SessionLocal,
    ModelAPIConfig,
    PromptConfig,
    now_str,
)
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from slug_utils import generate_article_slug
from media_service import maybe_ingest_top_image, maybe_ingest_article_images

logger = logging.getLogger("article_service")

EMBEDDING_TEXT_LIMIT = 4000
LOCAL_EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
_local_embedding_model = None


def get_local_embedding_model():
    global _local_embedding_model
    if _local_embedding_model is None:
        from sentence_transformers import SentenceTransformer

        _local_embedding_model = SentenceTransformer(LOCAL_EMBEDDING_MODEL_NAME)
    return _local_embedding_model


def build_parameters(model) -> dict:
    if not model:
        return {}
    params = {}
    system_prompt = getattr(model, "system_prompt", None)
    response_format = getattr(model, "response_format", None)
    temperature = getattr(model, "temperature", None)
    max_tokens = getattr(model, "max_tokens", None)
    top_p = getattr(model, "top_p", None)
    if system_prompt:
        params["system_prompt"] = system_prompt
    if response_format:
        params["response_format"] = response_format
    if temperature is not None:
        params["temperature"] = temperature
    if max_tokens is not None:
        params["max_tokens"] = max_tokens
    if top_p is not None:
        params["top_p"] = top_p
    return params


class ArticleService:
    def __init__(self):
        pass

    def get_ai_config(
        self, db: Session, category_id: str = None, prompt_type: str = "summary"
    ):
        query = db.query(ModelAPIConfig).filter(ModelAPIConfig.is_enabled == True)
        prompt_query = db.query(PromptConfig).filter(
            PromptConfig.is_enabled == True, PromptConfig.type == prompt_type
        )

        prompt_config = None
        if category_id:
            prompt_config = prompt_query.filter(
                PromptConfig.category_id == category_id
            ).first()

        if not prompt_config:
            prompt_config = prompt_query.filter(
                PromptConfig.category_id.is_(None)
            ).first()

        model_config = None
        if prompt_config and prompt_config.model_api_config_id:
            model_config = query.filter(
                ModelAPIConfig.id == prompt_config.model_api_config_id
            ).first()

        if not model_config:
            model_config = query.filter(ModelAPIConfig.is_default == True).first()

        if not model_config:
            return None

        result = {
            "base_url": model_config.base_url,
            "api_key": model_config.api_key,
            "model_name": model_config.model_name,
            "model_api_config_id": model_config.id,
            "price_input_per_1k": model_config.price_input_per_1k,
            "price_output_per_1k": model_config.price_output_per_1k,
            "currency": model_config.currency,
            "prompt_template": prompt_config.prompt if prompt_config else None,
        }

        parameters = build_parameters(prompt_config) if prompt_config else {}
        result["parameters"] = parameters or None
        return result

    def create_ai_client(self, config: dict) -> ConfigurableAIClient:
        return ConfigurableAIClient(
            base_url=config["base_url"],
            api_key=config["api_key"],
            model_name=config["model_name"],
        )

    def get_embedding_config(self, db: Session) -> dict | None:
        admin = db.query(AdminSettings).first()
        if admin and not bool(admin.recommendations_enabled):
            return {"disabled": True}

        if admin and admin.recommendation_model_config_id:
            model_config = (
                db.query(ModelAPIConfig)
                .filter(ModelAPIConfig.id == admin.recommendation_model_config_id)
                .first()
            )
        else:
            model_config = None

        if not model_config:
            return {"use_local": True}

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

    def get_embedding_source_text(self, article: Article) -> str:
        title = (article.title or "").strip()
        summary = (
            article.ai_analysis.summary.strip()
            if article.ai_analysis and article.ai_analysis.summary
            else ""
        )
        if summary:
            source = f"{title}\n\n{summary}" if title else summary
        elif article.content_md:
            source = f"{title}\n\n{article.content_md}" if title else article.content_md
        else:
            html = article.content_html or ""
            cleaned = re.sub(r"<[^>]+>", " ", html) if html else ""
            source = f"{title}\n\n{cleaned}" if title else cleaned

        source = (source or "").strip()
        if not source:
            return ""
        compact = re.sub(r"\s+", " ", source)
        return compact[:EMBEDDING_TEXT_LIMIT]

    def cosine_similarity(self, vector_a: list[float], vector_b: list[float]) -> float:
        if not vector_a or not vector_b or len(vector_a) != len(vector_b):
            return 0.0
        dot = 0.0
        norm_a = 0.0
        norm_b = 0.0
        for a, b in zip(vector_a, vector_b):
            dot += a * b
            norm_a += a * a
            norm_b += b * b
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
            raise Exception("未配置AI服务，请先在配置页面设置AI参数")
        if config.get("disabled"):
            return None
        source_text = self.get_embedding_source_text(article)
        if not source_text:
            raise Exception("文章内容为空，无法生成向量")
        use_local = bool(config.get("use_local"))
        model_name = LOCAL_EMBEDDING_MODEL_NAME if use_local else config["model_name"]
        model_label = f"local:{model_name}" if use_local else model_name

        existing = (
            db.query(ArticleEmbedding)
            .filter(ArticleEmbedding.article_id == article.id)
            .first()
        )
        if existing and existing.model == model_label and existing.embedding:
            return existing

        if use_local:
            local_model = get_local_embedding_model()
            embedding_data = local_model.encode(
                source_text, normalize_embeddings=True
            ).tolist()
        else:
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
                        timeout=20.0,
                    )
                    response.raise_for_status()
                    data = response.json()
                    embedding_data = (data.get("data") or [{}])[0].get(
                        "embedding"
                    ) or []
            else:
                client = ConfigurableAIClient(
                    base_url=config["base_url"],
                    api_key=config["api_key"],
                    model_name=model_name,
                )
                result = await client.generate_embedding(
                    source_text, model_name=model_name
                )
                embedding_data = result.get("embedding") or []
        embedding_json = json.dumps(embedding_data, ensure_ascii=False)
        now_iso = now_str()

        if existing:
            existing.embedding = embedding_json
            existing.model = model_label
            existing.updated_at = now_iso
            db.commit()
            return existing

        record = ArticleEmbedding(
            article_id=article.id,
            model=model_label,
            embedding=embedding_json,
            created_at=now_iso,
            updated_at=now_iso,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    def _extract_usage_value(self, usage, key: str):
        if usage is None:
            return None
        if isinstance(usage, dict):
            return usage.get(key)
        return getattr(usage, key, None)

    def _log_ai_usage(
        self,
        db: Session,
        model_config_id: str | None,
        article_id: str | None,
        task_type: str | None,
        content_type: str | None,
        usage,
        latency_ms: int | None,
        status: str,
        error_message: str | None,
        price_input_per_1k: float | None,
        price_output_per_1k: float | None,
        currency: str | None,
        request_payload: dict | str | None = None,
        response_payload: dict | str | None = None,
    ) -> None:
        def normalize_payload(payload: dict | str | None) -> str | None:
            if payload is None:
                return None
            if isinstance(payload, str):
                return payload
            return json.dumps(payload, ensure_ascii=False)

        prompt_tokens = self._extract_usage_value(usage, "prompt_tokens")
        completion_tokens = self._extract_usage_value(usage, "completion_tokens")
        total_tokens = self._extract_usage_value(usage, "total_tokens")

        if prompt_tokens is None and completion_tokens is None:
            cost_input = None
            cost_output = None
            cost_total = None
        else:
            input_price = price_input_per_1k or 0
            output_price = price_output_per_1k or 0
            cost_input = ((prompt_tokens or 0) / 1000) * input_price
            cost_output = ((completion_tokens or 0) / 1000) * output_price
            cost_total = cost_input + cost_output

        db.add(
            AIUsageLog(
                model_api_config_id=model_config_id,
                task_id=None,
                article_id=article_id,
                task_type=task_type,
                content_type=content_type,
                status=status,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                cost_input=cost_input,
                cost_output=cost_output,
                cost_total=cost_total,
                currency=currency,
                latency_ms=latency_ms,
                error_message=error_message,
                request_payload=normalize_payload(request_payload),
                response_payload=normalize_payload(response_payload),
                created_at=now_str(),
            )
        )

    def enqueue_task(
        self,
        db: Session,
        task_type: str,
        article_id: str | None = None,
        content_type: str | None = None,
        payload: dict | None = None,
    ) -> str:
        task = AITask(
            article_id=article_id,
            task_type=task_type,
            content_type=content_type,
            payload=json.dumps(payload or {}, ensure_ascii=False),
            status="pending",
            attempts=0,
            run_at=now_str(),
            updated_at=now_str(),
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        return task.id

    def get_article_neighbors(
        self,
        db: Session,
        article: Article,
        is_admin: bool = False,
    ):
        query = db.query(Article)
        if not is_admin:
            query = query.filter(Article.is_visible == True)

        prev_article = (
            query.filter(Article.created_at > article.created_at)
            .order_by(Article.created_at.asc())
            .first()
        )
        next_article = (
            query.filter(Article.created_at < article.created_at)
            .order_by(Article.created_at.desc())
            .first()
        )
        return prev_article, next_article

    def get_article_by_slug(self, db: Session, slug: str) -> Article | None:
        """通过slug查询文章"""
        return db.query(Article).filter(Article.slug == slug).first()

    async def create_article(self, article_data: dict, db: Session) -> str:
        if not article_data.get("content_html") and not article_data.get("content_md"):
            raise ValueError("文章内容不能为空")
        category = (
            db.query(Category)
            .filter(Category.id == article_data.get("category_id"))
            .first()
        )

        content_structured = article_data.get("content_structured")
        if isinstance(content_structured, (dict, list)):
            content_structured = json.dumps(content_structured, ensure_ascii=False)

        # 检测原文语言
        content_for_lang = (
            article_data.get("content_html") or article_data.get("content_md") or ""
        )
        original_language = "en" if is_english_content(content_for_lang) else "zh"

        # 处理 source_url：空字符串转为 None，避免唯一性约束冲突
        source_url = article_data.get("source_url")
        if source_url == "":
            source_url = None

        # 先创建文章对象以获取ID
        article = Article(
            title=article_data.get("title"),
            content_html=article_data.get("content_html"),
            content_structured=content_structured,
            content_md=article_data.get("content_md"),
            source_url=source_url,
            top_image=article_data.get("top_image"),
            author=article_data.get("author"),
            published_at=article_data.get("published_at"),
            source_domain=article_data.get("source_domain"),
            category_id=article_data.get("category_id"),
            status="pending",
            original_language=original_language,
        )

        try:
            db.add(article)
            db.commit()
            db.refresh(article)

            # 生成并保存slug
            article.slug = generate_article_slug(article.title, article.id)
            db.commit()

        except IntegrityError as e:
            db.rollback()
            error_str = str(e).lower()
            if "source_url" in error_str or "unique constraint" in error_str:
                existing = (
                    db.query(Article)
                    .filter(Article.source_url == article_data.get("source_url"))
                    .first()
                )
                if existing:
                    raise ValueError("该文章已存在，请勿重复提交")
            raise ValueError(f"数据完整性错误: {str(e)}")

        try:
            await maybe_ingest_top_image(db, article)
        except Exception as exc:
            logger.warning("top_image_ingest_error: %s", str(exc))

        self.enqueue_task(
            db,
            task_type="process_article_cleaning",
            article_id=article.id,
            content_type="content_cleaning",
            payload={"category_id": article_data.get("category_id")},
        )

        return article.id

    async def process_article_ai(self, article_id: str, category_id: str):
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            article.status = "processing"
            db.commit()

            ai_analysis = (
                db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
            )
            if not ai_analysis:
                ai_analysis = AIAnalysis(
                    article_id=article.id,
                    error_message=None,
                    updated_at=now_str(),
                )
                db.add(ai_analysis)
                db.commit()

            source_content = article.content_html or article.content_md
            if not source_content:
                article.status = "failed"
                ai_analysis.error_message = "文章内容为空，无法处理"
                ai_analysis.updated_at = now_str()
                db.commit()
                raise ValueError("文章内容为空，无法处理")

            async def run_cleaning(content: str) -> str:
                cleaning_config = self.get_ai_config(
                    db, category_id, prompt_type="content_cleaning"
                )
                if not cleaning_config:
                    raise Exception("未配置AI服务，请先在配置页面设置AI参数")
                cleaning_client = self.create_ai_client(cleaning_config)
                parameters = cleaning_config.get("parameters") or {}
                prompt = cleaning_config.get("prompt_template")
                pricing = {
                    "model_api_config_id": cleaning_config.get("model_api_config_id"),
                    "price_input_per_1k": cleaning_config.get("price_input_per_1k"),
                    "price_output_per_1k": cleaning_config.get("price_output_per_1k"),
                    "currency": cleaning_config.get("currency"),
                }
                try:
                    result = await asyncio.wait_for(
                        cleaning_client.generate_summary(
                            content, prompt=prompt, parameters=parameters
                        ),
                        timeout=300.0,
                    )
                    if isinstance(result, dict):
                        self._log_ai_usage(
                            db,
                            model_config_id=pricing.get("model_api_config_id"),
                            article_id=article_id,
                            task_type="process_article_ai",
                            content_type="content_cleaning",
                            usage=result.get("usage"),
                            latency_ms=result.get("latency_ms"),
                            status="completed",
                            error_message=None,
                            price_input_per_1k=pricing.get("price_input_per_1k"),
                            price_output_per_1k=pricing.get("price_output_per_1k"),
                            currency=pricing.get("currency"),
                            request_payload=result.get("request_payload"),
                            response_payload=result.get("response_payload"),
                        )
                        result = result.get("content")
                    return result or ""
                except asyncio.TimeoutError:
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_ai",
                        content_type="content_cleaning",
                        usage=None,
                        latency_ms=None,
                        status="failed",
                        error_message="AI生成超时，请稍后重试",
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                    )
                    raise Exception("内容清洗超时，请稍后重试")
                except Exception as e:
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_ai",
                        content_type="content_cleaning",
                        usage=None,
                        latency_ms=None,
                        status="failed",
                        error_message=str(e),
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                    )
                    raise

            async def run_validation(content: str) -> dict:
                validation_config = self.get_ai_config(
                    db, category_id, prompt_type="content_validation"
                )
                if not validation_config:
                    raise Exception("未配置AI服务，请先在配置页面设置AI参数")
                validation_client = self.create_ai_client(validation_config)
                parameters = validation_config.get("parameters") or {}
                prompt = validation_config.get("prompt_template")
                pricing = {
                    "model_api_config_id": validation_config.get("model_api_config_id"),
                    "price_input_per_1k": validation_config.get("price_input_per_1k"),
                    "price_output_per_1k": validation_config.get("price_output_per_1k"),
                    "currency": validation_config.get("currency"),
                }
                try:
                    result = await asyncio.wait_for(
                        validation_client.generate_summary(
                            content, prompt=prompt, parameters=parameters
                        ),
                        timeout=300.0,
                    )
                    if isinstance(result, dict):
                        self._log_ai_usage(
                            db,
                            model_config_id=pricing.get("model_api_config_id"),
                            article_id=article_id,
                            task_type="process_article_ai",
                            content_type="content_validation",
                            usage=result.get("usage"),
                            latency_ms=result.get("latency_ms"),
                            status="completed",
                            error_message=None,
                            price_input_per_1k=pricing.get("price_input_per_1k"),
                            price_output_per_1k=pricing.get("price_output_per_1k"),
                            currency=pricing.get("currency"),
                            request_payload=result.get("request_payload"),
                            response_payload=result.get("response_payload"),
                        )
                        result = result.get("content")
                    raw = (result or "").strip()
                    if not raw:
                        return {"is_valid": False, "error": "内容校验输出为空"}
                    try:
                        parsed = json.loads(raw)
                    except json.JSONDecodeError:
                        return {"is_valid": False, "error": "内容校验输出解析失败"}
                    if not isinstance(parsed, dict):
                        return {"is_valid": False, "error": "内容校验输出格式错误"}
                    return parsed
                except asyncio.TimeoutError:
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_ai",
                        content_type="content_validation",
                        usage=None,
                        latency_ms=None,
                        status="failed",
                        error_message="AI生成超时，请稍后重试",
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                    )
                    raise Exception("内容校验超时，请稍后重试")
                except Exception as e:
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_ai",
                        content_type="content_validation",
                        usage=None,
                        latency_ms=None,
                        status="failed",
                        error_message=str(e),
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                    )
                    raise

            cleaned_md = await run_cleaning(source_content)
            validation_result = await run_validation(cleaned_md)
            is_valid = bool(validation_result.get("is_valid"))
            if not is_valid:
                article.status = "failed"
                ai_analysis.error_message = (
                    validation_result.get("error") or "内容校验未通过"
                )
                ai_analysis.updated_at = now_str()
                db.commit()
                return

            final_md = cleaned_md
            if not final_md:
                article.status = "failed"
                ai_analysis.error_message = "内容校验未通过：内容为空"
                ai_analysis.updated_at = now_str()
                db.commit()
                return

            article.content_md = final_md
            article.updated_at = now_str()
            ai_analysis.error_message = None
            ai_analysis.updated_at = now_str()
            db.commit()

            self.enqueue_task(
                db,
                task_type="process_article_embedding",
                article_id=article.id,
                content_type="embedding",
            )

            try:
                await maybe_ingest_article_images(db, article)
            except Exception as exc:
                logger.warning("content_image_ingest_error: %s", str(exc))

            async def run_summary_task(content: str, cat_id: str | None) -> None:
                task_db = SessionLocal()
                try:
                    task_article = (
                        task_db.query(Article).filter(Article.id == article_id).first()
                    )
                    if not task_article:
                        return
                    analysis = (
                        task_db.query(AIAnalysis)
                        .filter(AIAnalysis.article_id == article_id)
                        .first()
                    )
                    if not analysis:
                        analysis = AIAnalysis(
                            article_id=article_id,
                            updated_at=now_str(),
                        )
                        task_db.add(analysis)
                        task_db.commit()

                    analysis.summary_status = "processing"
                    analysis.updated_at = now_str()
                    task_db.commit()

                    summary_config = self.get_ai_config(
                        task_db, cat_id, prompt_type="summary"
                    )
                    if not summary_config:
                        analysis.summary_status = "failed"
                        if not analysis.error_message:
                            analysis.error_message = (
                                "未配置AI服务，请先在配置页面设置AI参数"
                            )
                        analysis.updated_at = now_str()
                        task_db.commit()
                        return

                    summary_client = self.create_ai_client(summary_config)
                    parameters = summary_config.get("parameters") or {}
                    prompt = summary_config.get("prompt_template")
                    pricing = {
                        "model_api_config_id": summary_config.get(
                            "model_api_config_id"
                        ),
                        "price_input_per_1k": summary_config.get("price_input_per_1k"),
                        "price_output_per_1k": summary_config.get(
                            "price_output_per_1k"
                        ),
                        "currency": summary_config.get("currency"),
                    }

                    try:
                        summary_result = await asyncio.wait_for(
                            summary_client.generate_summary(
                                content, prompt=prompt, parameters=parameters
                            ),
                            timeout=300.0,
                        )
                        if isinstance(summary_result, dict):
                            self._log_ai_usage(
                                task_db,
                                model_config_id=pricing.get("model_api_config_id"),
                                article_id=article_id,
                                task_type="process_article_ai",
                                content_type="summary",
                                usage=summary_result.get("usage"),
                                latency_ms=summary_result.get("latency_ms"),
                                status="completed",
                                error_message=None,
                                price_input_per_1k=pricing.get("price_input_per_1k"),
                                price_output_per_1k=pricing.get("price_output_per_1k"),
                                currency=pricing.get("currency"),
                                request_payload=summary_result.get("request_payload"),
                                response_payload=summary_result.get("response_payload"),
                            )
                            summary_result = summary_result.get("content")
                        analysis.summary = summary_result
                        analysis.summary_status = "completed"
                        analysis.error_message = None
                        analysis.updated_at = now_str()
                    except asyncio.TimeoutError:
                        self._log_ai_usage(
                            task_db,
                            model_config_id=pricing.get("model_api_config_id"),
                            article_id=article_id,
                            task_type="process_article_ai",
                            content_type="summary",
                            usage=None,
                            latency_ms=None,
                            status="failed",
                            error_message="AI生成超时，请稍后重试",
                            price_input_per_1k=pricing.get("price_input_per_1k"),
                            price_output_per_1k=pricing.get("price_output_per_1k"),
                            currency=pricing.get("currency"),
                        )
                        analysis.summary_status = "failed"
                        if not analysis.error_message:
                            analysis.error_message = "AI生成超时，请稍后重试"
                        analysis.updated_at = now_str()
                    except Exception as e:
                        self._log_ai_usage(
                            task_db,
                            model_config_id=pricing.get("model_api_config_id"),
                            article_id=article_id,
                            task_type="process_article_ai",
                            content_type="summary",
                            usage=None,
                            latency_ms=None,
                            status="failed",
                            error_message=str(e),
                            price_input_per_1k=pricing.get("price_input_per_1k"),
                            price_output_per_1k=pricing.get("price_output_per_1k"),
                            currency=pricing.get("currency"),
                        )
                        analysis.summary_status = "failed"
                        if not analysis.error_message:
                            analysis.error_message = str(e)
                        analysis.updated_at = now_str()
                    task_db.commit()
                finally:
                    task_db.close()

            async def run_translation_task(content: str, cat_id: str | None) -> None:
                if not is_english_content(content):
                    return
                task_db = SessionLocal()
                try:
                    task_article = (
                        task_db.query(Article).filter(Article.id == article_id).first()
                    )
                    if not task_article:
                        return

                    task_article.translation_status = "processing"
                    task_article.translation_error = None
                    task_db.commit()

                    ai_config = self.get_ai_config(
                        task_db, cat_id, prompt_type="translation"
                    )
                    if not ai_config:
                        task_article.translation_status = "failed"
                        task_article.translation_error = (
                            "未配置AI服务，请先在配置页面设置AI参数"
                        )
                        task_db.commit()
                        return

                    trans_client = self.create_ai_client(ai_config)
                    trans_prompt = ai_config.get("prompt_template")
                    trans_parameters = ai_config.get("parameters") or {}
                    pricing = {
                        "model_api_config_id": ai_config.get("model_api_config_id"),
                        "price_input_per_1k": ai_config.get("price_input_per_1k"),
                        "price_output_per_1k": ai_config.get("price_output_per_1k"),
                        "currency": ai_config.get("currency"),
                    }

                    try:
                        content_trans = await asyncio.wait_for(
                            trans_client.translate_to_chinese(
                                content,
                                prompt=trans_prompt,
                                parameters=trans_parameters,
                            ),
                            timeout=300.0,
                        )
                        if isinstance(content_trans, dict):
                            self._log_ai_usage(
                                task_db,
                                model_config_id=pricing.get("model_api_config_id"),
                                article_id=article_id,
                                task_type="process_article_ai",
                                content_type="translation",
                                usage=content_trans.get("usage"),
                                latency_ms=content_trans.get("latency_ms"),
                                status="completed",
                                error_message=None,
                                price_input_per_1k=pricing.get("price_input_per_1k"),
                                price_output_per_1k=pricing.get("price_output_per_1k"),
                                currency=pricing.get("currency"),
                                request_payload=content_trans.get("request_payload"),
                                response_payload=content_trans.get("response_payload"),
                            )
                            content_trans = content_trans.get("content")
                        task_article.content_trans = content_trans
                        task_article.translation_status = "completed"
                        task_article.translation_error = None
                    except asyncio.TimeoutError:
                        self._log_ai_usage(
                            task_db,
                            model_config_id=pricing.get("model_api_config_id"),
                            article_id=article_id,
                            task_type="process_article_ai",
                            content_type="translation",
                            usage=None,
                            latency_ms=None,
                            status="failed",
                            error_message="翻译超时，请稍后重试",
                            price_input_per_1k=pricing.get("price_input_per_1k"),
                            price_output_per_1k=pricing.get("price_output_per_1k"),
                            currency=pricing.get("currency"),
                        )
                        task_article.translation_status = "failed"
                        task_article.translation_error = "翻译超时，请稍后重试"
                    except Exception as e:
                        self._log_ai_usage(
                            task_db,
                            model_config_id=pricing.get("model_api_config_id"),
                            article_id=article_id,
                            task_type="process_article_ai",
                            content_type="translation",
                            usage=None,
                            latency_ms=None,
                            status="failed",
                            error_message=str(e),
                            price_input_per_1k=pricing.get("price_input_per_1k"),
                            price_output_per_1k=pricing.get("price_output_per_1k"),
                            currency=pricing.get("currency"),
                        )
                        task_article.translation_status = "failed"
                        task_article.translation_error = str(e)
                    task_db.commit()
                finally:
                    task_db.close()

            async def run_classification_task(content: str) -> None:
                task_db = SessionLocal()
                try:
                    task_article = (
                        task_db.query(Article).filter(Article.id == article_id).first()
                    )
                    if not task_article:
                        return
                    analysis = (
                        task_db.query(AIAnalysis)
                        .filter(AIAnalysis.article_id == article_id)
                        .first()
                    )
                    if not analysis:
                        analysis = AIAnalysis(
                            article_id=article_id,
                            updated_at=now_str(),
                        )
                        task_db.add(analysis)
                        task_db.commit()

                    analysis.classification_status = "processing"
                    analysis.updated_at = now_str()
                    task_db.commit()

                    classification_config = self.get_ai_config(
                        task_db, category_id, prompt_type="classification"
                    )
                    if not classification_config:
                        analysis.classification_status = "failed"
                        if not analysis.error_message:
                            analysis.error_message = (
                                "未配置AI服务，请先在配置页面设置AI参数"
                            )
                        analysis.updated_at = now_str()
                        task_db.commit()
                        return

                    categories = (
                        task_db.query(Category).order_by(Category.sort_order).all()
                    )
                    categories_payload = "\n".join(
                        [
                            f"- {c.id} | {c.name} | {c.description or ''}".strip()
                            for c in categories
                        ]
                    )
                    prompt = classification_config.get("prompt_template")
                    if prompt:
                        if "{categories}" in prompt:
                            prompt = prompt.replace("{categories}", categories_payload)
                        else:
                            prompt = f"{prompt}\n\n分类列表：\n{categories_payload}"
                    parameters = classification_config.get("parameters") or {}
                    pricing = {
                        "model_api_config_id": classification_config.get(
                            "model_api_config_id"
                        ),
                        "price_input_per_1k": classification_config.get(
                            "price_input_per_1k"
                        ),
                        "price_output_per_1k": classification_config.get(
                            "price_output_per_1k"
                        ),
                        "currency": classification_config.get("currency"),
                    }

                    try:
                        result = await asyncio.wait_for(
                            self.create_ai_client(
                                classification_config
                            ).generate_summary(
                                content, prompt=prompt, parameters=parameters
                            ),
                            timeout=300.0,
                        )
                        if isinstance(result, dict):
                            self._log_ai_usage(
                                task_db,
                                model_config_id=pricing.get("model_api_config_id"),
                                article_id=article_id,
                                task_type="process_article_ai",
                                content_type="classification",
                                usage=result.get("usage"),
                                latency_ms=result.get("latency_ms"),
                                status="completed",
                                error_message=None,
                                price_input_per_1k=pricing.get("price_input_per_1k"),
                                price_output_per_1k=pricing.get("price_output_per_1k"),
                                currency=pricing.get("currency"),
                                request_payload=result.get("request_payload"),
                                response_payload=result.get("response_payload"),
                            )
                            result = result.get("content")
                        category_output = (result or "").strip().strip('"').strip("'")
                        if not category_output:
                            analysis.classification_status = "failed"
                            analysis.updated_at = now_str()
                            task_db.commit()
                            return
                        category = (
                            task_db.query(Category)
                            .filter(Category.id == category_output)
                            .first()
                        )
                        if not category:
                            analysis.classification_status = "failed"
                            analysis.updated_at = now_str()
                            task_db.commit()
                            return
                        task_article.category_id = category.id
                        task_article.updated_at = now_str()
                        analysis.classification_status = "completed"
                        analysis.error_message = None
                        analysis.updated_at = now_str()
                        task_db.commit()
                    except asyncio.TimeoutError:
                        self._log_ai_usage(
                            task_db,
                            model_config_id=pricing.get("model_api_config_id"),
                            article_id=article_id,
                            task_type="process_article_ai",
                            content_type="classification",
                            usage=None,
                            latency_ms=None,
                            status="failed",
                            error_message="AI生成超时，请稍后重试",
                            price_input_per_1k=pricing.get("price_input_per_1k"),
                            price_output_per_1k=pricing.get("price_output_per_1k"),
                            currency=pricing.get("currency"),
                        )
                        analysis.classification_status = "failed"
                        if not analysis.error_message:
                            analysis.error_message = "AI生成超时，请稍后重试"
                        analysis.updated_at = now_str()
                        task_db.commit()
                    except Exception as e:
                        self._log_ai_usage(
                            task_db,
                            model_config_id=pricing.get("model_api_config_id"),
                            article_id=article_id,
                            task_type="process_article_ai",
                            content_type="classification",
                            usage=None,
                            latency_ms=None,
                            status="failed",
                            error_message=str(e),
                            price_input_per_1k=pricing.get("price_input_per_1k"),
                            price_output_per_1k=pricing.get("price_output_per_1k"),
                            currency=pricing.get("currency"),
                        )
                        analysis.classification_status = "failed"
                        if not analysis.error_message:
                            analysis.error_message = str(e)
                        analysis.updated_at = now_str()
                        task_db.commit()
                finally:
                    task_db.close()

            await run_classification_task(final_md)

            updated_article = db.query(Article).filter(Article.id == article_id).first()
            effective_category_id = (
                updated_article.category_id if updated_article else category_id
            )

            await asyncio.gather(
                run_summary_task(final_md, effective_category_id),
                run_translation_task(final_md, effective_category_id),
                return_exceptions=True,
            )

            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.status = "completed"
                article.updated_at = now_str()
                db.commit()
        except Exception as e:
            print(f"AI生成失败: {e}")
            error_message = str(e)
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.status = "failed"
                existing_analysis = (
                    db.query(AIAnalysis)
                    .filter(AIAnalysis.article_id == article_id)
                    .first()
                )
                if existing_analysis:
                    existing_analysis.error_message = error_message
                    existing_analysis.updated_at = now_str()
                else:
                    ai_analysis = AIAnalysis(
                        article_id=article.id,
                        error_message=error_message,
                        updated_at=now_str(),
                    )
                    db.add(ai_analysis)
                db.commit()
        finally:
            db.close()

    async def process_article_embedding(self, article_id: str) -> None:
        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return
            await self.ensure_article_embedding(db, article)
        finally:
            db.close()

    async def process_article_cleaning(self, article_id: str, category_id: str):
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            article.status = "processing"
            db.commit()

            ai_analysis = (
                db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
            )
            if not ai_analysis:
                ai_analysis = AIAnalysis(
                    article_id=article.id,
                    error_message=None,
                    updated_at=now_str(),
                )
                db.add(ai_analysis)
                db.commit()

            source_content = article.content_html or article.content_md
            if not source_content:
                article.status = "failed"
                ai_analysis.error_message = "文章内容为空，无法处理"
                ai_analysis.updated_at = now_str()
                db.commit()
                return

            cleaning_config = self.get_ai_config(
                db, category_id, prompt_type="content_cleaning"
            )
            if not cleaning_config:
                article.status = "failed"
                ai_analysis.error_message = "未配置AI服务，请先在配置页面设置AI参数"
                ai_analysis.updated_at = now_str()
                db.commit()
                raise ValueError("未配置AI服务，请先在配置页面设置AI参数")

            cleaning_client = self.create_ai_client(cleaning_config)
            parameters = cleaning_config.get("parameters") or {}
            prompt = cleaning_config.get("prompt_template")
            pricing = {
                "model_api_config_id": cleaning_config.get("model_api_config_id"),
                "price_input_per_1k": cleaning_config.get("price_input_per_1k"),
                "price_output_per_1k": cleaning_config.get("price_output_per_1k"),
                "currency": cleaning_config.get("currency"),
            }

            try:
                result = await asyncio.wait_for(
                    cleaning_client.generate_summary(
                        source_content, prompt=prompt, parameters=parameters
                    ),
                    timeout=300.0,
                )
                if isinstance(result, dict):
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_cleaning",
                        content_type="content_cleaning",
                        usage=result.get("usage"),
                        latency_ms=result.get("latency_ms"),
                        status="completed",
                        error_message=None,
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                        request_payload=result.get("request_payload"),
                        response_payload=result.get("response_payload"),
                    )
                    result = result.get("content")
                cleaned_md = (result or "").strip()
                if not cleaned_md:
                    raise Exception("内容清洗失败：输出为空")
            except asyncio.TimeoutError:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_cleaning",
                    content_type="content_cleaning",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message="AI生成超时，请稍后重试",
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                raise Exception("内容清洗超时，请稍后重试")
            except Exception as e:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_cleaning",
                    content_type="content_cleaning",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(e),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                raise

            self.enqueue_task(
                db,
                task_type="process_article_validation",
                article_id=article_id,
                content_type="content_validation",
                payload={
                    "category_id": category_id,
                    "cleaned_md": cleaned_md,
                },
            )
        except Exception as e:
            error_message = str(e)
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.status = "failed"
                ai_analysis = (
                    db.query(AIAnalysis)
                    .filter(AIAnalysis.article_id == article_id)
                    .first()
                )
                if ai_analysis:
                    ai_analysis.error_message = error_message
                    ai_analysis.updated_at = now_str()
                else:
                    ai_analysis = AIAnalysis(
                        article_id=article_id,
                        error_message=error_message,
                        updated_at=now_str(),
                    )
                    db.add(ai_analysis)
                db.commit()
            raise
        finally:
            db.close()

    async def process_article_validation(
        self,
        article_id: str,
        category_id: str,
        cleaned_md: str,
    ):
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            ai_analysis = (
                db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
            )
            if not ai_analysis:
                ai_analysis = AIAnalysis(
                    article_id=article.id,
                    error_message=None,
                    updated_at=now_str(),
                )
                db.add(ai_analysis)
                db.commit()

            validation_config = self.get_ai_config(
                db, category_id, prompt_type="content_validation"
            )
            if not validation_config:
                article.status = "failed"
                ai_analysis.error_message = "未配置AI服务，请先在配置页面设置AI参数"
                ai_analysis.updated_at = now_str()
                db.commit()
                raise ValueError("未配置AI服务，请先在配置页面设置AI参数")

            validation_client = self.create_ai_client(validation_config)
            parameters = validation_config.get("parameters") or {}
            prompt = validation_config.get("prompt_template")
            pricing = {
                "model_api_config_id": validation_config.get("model_api_config_id"),
                "price_input_per_1k": validation_config.get("price_input_per_1k"),
                "price_output_per_1k": validation_config.get("price_output_per_1k"),
                "currency": validation_config.get("currency"),
            }

            try:
                result = await asyncio.wait_for(
                    validation_client.generate_summary(
                        cleaned_md, prompt=prompt, parameters=parameters
                    ),
                    timeout=300.0,
                )
                if isinstance(result, dict):
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_validation",
                        content_type="content_validation",
                        usage=result.get("usage"),
                        latency_ms=result.get("latency_ms"),
                        status="completed",
                        error_message=None,
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                        request_payload=result.get("request_payload"),
                        response_payload=result.get("response_payload"),
                    )
                    result = result.get("content")
                raw = (result or "").strip()
                if not raw:
                    validation_result = {
                        "is_valid": False,
                        "error": "格式异常：校验输出为空",
                    }
                else:
                    try:
                        validation_result = json.loads(raw)
                    except json.JSONDecodeError:
                        validation_result = {
                            "is_valid": False,
                            "error": "格式异常：校验输出解析失败",
                        }
                if not isinstance(validation_result, dict):
                    validation_result = {
                        "is_valid": False,
                        "error": "格式异常：校验输出格式错误",
                    }
            except asyncio.TimeoutError:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_validation",
                    content_type="content_validation",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message="AI生成超时，请稍后重试",
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                raise Exception("内容校验超时，请稍后重试")
            except Exception as e:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_validation",
                    content_type="content_validation",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(e),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                raise

            is_valid = bool(validation_result.get("is_valid"))
            if not is_valid:
                article.status = "failed"
                ai_analysis.error_message = (
                    validation_result.get("error") or "内容校验未通过"
                )
                ai_analysis.updated_at = now_str()
                db.commit()
                raise ValueError(ai_analysis.error_message or "内容校验未通过")

            final_md = cleaned_md.strip()
            if not final_md:
                article.status = "failed"
                ai_analysis.error_message = "内容校验未通过：内容为空"
                ai_analysis.updated_at = now_str()
                db.commit()
                raise ValueError("内容校验未通过：内容为空")

            article.content_md = final_md
            article.updated_at = now_str()
            ai_analysis.error_message = None
            ai_analysis.updated_at = now_str()
            db.commit()

            self.enqueue_task(
                db,
                task_type="process_article_classification",
                article_id=article_id,
                content_type="classification",
                payload={"category_id": category_id},
            )
        except Exception as e:
            error_message = str(e)
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.status = "failed"
                ai_analysis = (
                    db.query(AIAnalysis)
                    .filter(AIAnalysis.article_id == article_id)
                    .first()
                )
                if ai_analysis:
                    ai_analysis.error_message = error_message
                    ai_analysis.updated_at = now_str()
                else:
                    ai_analysis = AIAnalysis(
                        article_id=article_id,
                        error_message=error_message,
                        updated_at=now_str(),
                    )
                    db.add(ai_analysis)
                db.commit()
            raise
        finally:
            db.close()

    async def process_article_classification(self, article_id: str, category_id: str):
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            analysis = (
                db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
            )
            if not analysis:
                analysis = AIAnalysis(
                    article_id=article_id,
                    updated_at=now_str(),
                )
                db.add(analysis)
                db.commit()

            analysis.classification_status = "processing"
            analysis.updated_at = now_str()
            db.commit()

            classification_config = self.get_ai_config(
                db, category_id, prompt_type="classification"
            )
            if not classification_config:
                analysis.classification_status = "failed"
                if not analysis.error_message:
                    analysis.error_message = "未配置AI服务，请先在配置页面设置AI参数"
                analysis.updated_at = now_str()
                db.commit()
                raise ValueError("未配置AI服务，请先在配置页面设置AI参数")

            categories = db.query(Category).order_by(Category.sort_order).all()
            categories_payload = "\n".join(
                [
                    f"- {c.id} | {c.name} | {c.description or ''}".strip()
                    for c in categories
                ]
            )
            prompt = classification_config.get("prompt_template")
            if prompt:
                if "{categories}" in prompt:
                    prompt = prompt.replace("{categories}", categories_payload)
                else:
                    prompt = f"{prompt}\n\n分类列表：\n{categories_payload}"
            parameters = classification_config.get("parameters") or {}
            pricing = {
                "model_api_config_id": classification_config.get("model_api_config_id"),
                "price_input_per_1k": classification_config.get("price_input_per_1k"),
                "price_output_per_1k": classification_config.get("price_output_per_1k"),
                "currency": classification_config.get("currency"),
            }

            try:
                result = await asyncio.wait_for(
                    self.create_ai_client(classification_config).generate_summary(
                        article.content_md, prompt=prompt, parameters=parameters
                    ),
                    timeout=300.0,
                )
                if isinstance(result, dict):
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_classification",
                        content_type="classification",
                        usage=result.get("usage"),
                        latency_ms=result.get("latency_ms"),
                        status="completed",
                        error_message=None,
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                        request_payload=result.get("request_payload"),
                        response_payload=result.get("response_payload"),
                    )
                    result = result.get("content")
                category_output = (result or "").strip().strip('"').strip("'")
                if category_output:
                    category = (
                        db.query(Category)
                        .filter(Category.id == category_output)
                        .first()
                    )
                    if category:
                        article.category_id = category.id
                        article.updated_at = now_str()
                        db.commit()
                    else:
                        raise ValueError("分类未命中：返回ID不存在")
                else:
                    raise ValueError("分类未命中：未返回分类ID")
                analysis.classification_status = "completed"
                analysis.error_message = None
                analysis.updated_at = now_str()
                db.commit()
            except asyncio.TimeoutError:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_classification",
                    content_type="classification",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message="AI生成超时，请稍后重试",
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                analysis.classification_status = "failed"
                if not analysis.error_message:
                    analysis.error_message = "AI生成超时，请稍后重试"
                analysis.updated_at = now_str()
                db.commit()
                raise Exception("分类任务超时")
            except Exception as e:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_classification",
                    content_type="classification",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(e),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                analysis.classification_status = "failed"
                if not analysis.error_message:
                    analysis.error_message = str(e)
                analysis.updated_at = now_str()
                db.commit()
                raise

            effective_category_id = article.category_id or category_id
            self.enqueue_task(
                db,
                task_type="process_ai_content",
                article_id=article_id,
                content_type="summary",
                payload={
                    "category_id": effective_category_id,
                },
            )

            if article.content_md and is_english_content(article.content_md):
                self.enqueue_task(
                    db,
                    task_type="process_article_translation",
                    article_id=article_id,
                    content_type="translation",
                    payload={"category_id": effective_category_id},
                )
            else:
                article.translation_status = "skipped"
                article.translation_error = None
                db.commit()
        finally:
            db.close()

    def get_articles(
        self,
        db: Session,
        page: int = 1,
        size: int = 20,
        category_id: str | None = None,
        search: str | None = None,
        source_domain: str | None = None,
        author: str | None = None,
        is_visible: bool | None = None,
        published_at_start: str | None = None,
        published_at_end: str | None = None,
        created_at_start: str | None = None,
        created_at_end: str | None = None,
        sort_by: str | None = "created_at_desc",
        is_admin: bool = False,
    ):
        from sqlalchemy import func

        query = db.query(Article)

        if not is_admin:
            query = query.filter(Article.is_visible == True)
        elif is_visible is not None:
            query = query.filter(Article.is_visible == is_visible)

        if category_id:
            query = query.filter(Article.category_id == category_id)
        if search:
            query = query.filter(Article.title.contains(search))
        if source_domain:
            query = query.filter(Article.source_domain == source_domain)
        if author:
            query = query.filter(Article.author == author)
        if published_at_start:
            query = query.filter(
                func.substr(Article.published_at, 1, 10) >= published_at_start
            )
        if published_at_end:
            query = query.filter(
                func.substr(Article.published_at, 1, 10) <= published_at_end
            )
        if created_at_start:
            query = query.filter(
                func.substr(Article.created_at, 1, 10) >= created_at_start
            )
        if created_at_end:
            query = query.filter(
                func.substr(Article.created_at, 1, 10) <= created_at_end
            )

        total = query.count()

        # Apply sorting based on sort_by parameter
        if sort_by == "created_at_desc":
            query = query.order_by(Article.created_at.desc())
        else:  # Default: published_at_desc
            query = query.order_by(
                Article.published_at.desc().nullslast(), Article.created_at.desc()
            )

        query = query.offset((page - 1) * size).limit(size)

        articles = query.all()
        return articles, total

    def export_articles(self, db: Session, article_slugs: list):
        articles = db.query(Article).filter(Article.slug.in_(article_slugs)).all()

        categories_dict = {}
        uncategorized = []

        for article in articles:
            if article.category:
                cat_name = article.category.name
                if cat_name not in categories_dict:
                    categories_dict[cat_name] = []
                categories_dict[cat_name].append(article)
            else:
                uncategorized.append(article)

        markdown_content = ""

        for cat_name, cat_articles in categories_dict.items():
            markdown_content += f"## {cat_name}\n\n"
            for article in cat_articles:
                markdown_content += (
                    f"### [{article.title}]({article.source_url or ''})\n\n"
                )
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis:
                    # 优先使用关键内容，没有则使用摘要
                    if article.ai_analysis.key_points:
                        markdown_content += f"{article.ai_analysis.key_points}\n\n"
                    elif article.ai_analysis.summary:
                        markdown_content += f"{article.ai_analysis.summary}\n\n"

        if uncategorized:
            markdown_content += "## 未分类\n\n"
            for article in uncategorized:
                markdown_content += (
                    f"### [{article.title}]({article.source_url or ''})\n\n"
                )
                if article.top_image:
                    markdown_content += f"![]({article.top_image})\n\n"
                if article.ai_analysis:
                    # 优先使用关键内容，没有则使用摘要
                    if article.ai_analysis.key_points:
                        markdown_content += f"{article.ai_analysis.key_points}\n\n"
                    elif article.ai_analysis.summary:
                        markdown_content += f"{article.ai_analysis.summary}\n\n"

        return markdown_content

    async def retry_article_ai(self, db: Session, article_id: str) -> str:
        article = db.query(Article).filter(Article.id == article_id).first()

        if not article:
            raise ValueError("Article not found")

        article.status = "pending"
        if article.ai_analysis:
            article.ai_analysis.error_message = None
        db.commit()

        self.enqueue_task(
            db,
            task_type="process_article_cleaning",
            article_id=article_id,
            content_type="content_cleaning",
            payload={"category_id": article.category_id},
        )

        return article_id

    async def retry_article_translation(self, db: Session, article_id: str) -> str:
        """重新生成文章翻译"""
        article = db.query(Article).filter(Article.id == article_id).first()

        if not article:
            raise ValueError("文章不存在")

        if not article.content_md:
            raise ValueError("文章内容为空，无法翻译")

        if not is_english_content(article.content_md):
            raise ValueError("文章不是英文内容，无需翻译")

        article.translation_status = "pending"
        article.translation_error = None
        db.commit()

        self.enqueue_task(
            db,
            task_type="process_article_translation",
            article_id=article_id,
            payload={"category_id": article.category_id},
        )

        return article_id

    async def process_article_translation(self, article_id: str, category_id: str):
        """单独处理文章翻译"""
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            article.translation_status = "processing"
            article.translation_error = None
            db.commit()

            # 获取AI配置
            ai_config = self.get_ai_config(db, category_id)
            if not ai_config:
                article.translation_status = "failed"
                article.translation_error = "未配置AI服务，请先在配置页面设置AI参数"
                db.commit()
                return

            ai_client = self.create_ai_client(ai_config)
            pricing = {
                "model_api_config_id": ai_config.get("model_api_config_id"),
                "price_input_per_1k": ai_config.get("price_input_per_1k"),
                "price_output_per_1k": ai_config.get("price_output_per_1k"),
                "currency": ai_config.get("currency"),
            }

            # 获取翻译类型的提示词配置
            trans_config = self.get_ai_config(
                db, category_id, prompt_type="translation"
            )
            trans_prompt = None
            trans_parameters = {}

            if trans_config:
                trans_prompt = trans_config.get("prompt_template")
                trans_parameters = trans_config.get("parameters") or {}
                pricing = {
                    "model_api_config_id": trans_config.get("model_api_config_id"),
                    "price_input_per_1k": trans_config.get("price_input_per_1k"),
                    "price_output_per_1k": trans_config.get("price_output_per_1k"),
                    "currency": trans_config.get("currency"),
                }
                if trans_config.get("base_url") and trans_config.get("api_key"):
                    trans_client = self.create_ai_client(trans_config)
                else:
                    trans_client = ai_client
            else:
                trans_client = ai_client

            try:
                content_trans = await asyncio.wait_for(
                    trans_client.translate_to_chinese(
                        article.content_md,
                        prompt=trans_prompt,
                        parameters=trans_parameters,
                    ),
                    timeout=300.0,
                )
                if isinstance(content_trans, dict):
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_translation",
                        content_type="translation",
                        usage=content_trans.get("usage"),
                        latency_ms=content_trans.get("latency_ms"),
                        status="completed",
                        error_message=None,
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                        request_payload=content_trans.get("request_payload"),
                        response_payload=content_trans.get("response_payload"),
                    )
                    content_trans = content_trans.get("content")
                article.content_trans = content_trans
                article.translation_status = "completed"
                article.translation_error = None
                print(f"翻译完成: {article.title}")
            except asyncio.TimeoutError:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_translation",
                    content_type="translation",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message="翻译超时，请稍后重试",
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                article.translation_status = "failed"
                article.translation_error = "翻译超时，请稍后重试"
                print(f"翻译超时: {article.title}")
            except Exception as e:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_translation",
                    content_type="translation",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(e),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                article.translation_status = "failed"
                article.translation_error = str(e)
                print(f"翻译失败: {article.title}, 错误: {e}")

            db.commit()
        except Exception as e:
            print(f"翻译处理失败: {e}")
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.translation_status = "failed"
                article.translation_error = str(e)
                db.commit()
        finally:
            try:
                article = db.query(Article).filter(Article.id == article_id).first()
                if article:
                    analysis = (
                        db.query(AIAnalysis)
                        .filter(AIAnalysis.article_id == article_id)
                        .first()
                    )
                    summary_status = analysis.summary_status if analysis else None
                    translation_status = article.translation_status
                    if summary_status in ["completed", "failed"] and (
                        translation_status in ["completed", "failed", "skipped", None]
                    ):
                        article.status = "completed"
                        article.updated_at = now_str()
                        db.commit()
            finally:
                db.close()

    async def generate_ai_content(
        self,
        db: Session,
        article_id: str,
        content_type: str,
        model_config_id: str = None,
        prompt_config_id: str = None,
    ):
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise ValueError("文章不存在")

        if not article.content_md:
            raise ValueError("文章内容为空")

        if not article.ai_analysis:
            ai_analysis = AIAnalysis(article_id=article.id)
            db.add(ai_analysis)
            db.commit()
            db.refresh(article)

        setattr(article.ai_analysis, f"{content_type}_status", "pending")
        article.ai_analysis.updated_at = now_str()
        db.commit()

        self.enqueue_task(
            db,
            task_type="process_ai_content",
            article_id=article_id,
            content_type=content_type,
            payload={
                "category_id": article.category_id,
                "model_config_id": model_config_id,
                "prompt_config_id": prompt_config_id,
            },
        )

    async def process_ai_content(
        self,
        article_id: str,
        category_id: str,
        content_type: str,
        model_config_id: str = None,
        prompt_config_id: str = None,
    ):
        from models import SessionLocal
        import asyncio

        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article or not article.ai_analysis:
                return

            setattr(article.ai_analysis, f"{content_type}_status", "processing")
            article.ai_analysis.updated_at = now_str()
            db.commit()

            ai_config = None
            prompt = None
            prompt_parameters = {}

            if model_config_id:
                model_config = (
                    db.query(ModelAPIConfig)
                    .filter(ModelAPIConfig.id == model_config_id)
                    .first()
                )
                if model_config:
                    ai_config = {
                        "base_url": model_config.base_url,
                        "api_key": model_config.api_key,
                        "model_name": model_config.model_name,
                        "model_api_config_id": model_config.id,
                        "price_input_per_1k": model_config.price_input_per_1k,
                        "price_output_per_1k": model_config.price_output_per_1k,
                        "currency": model_config.currency,
                    }

            if prompt_config_id:
                prompt_config = (
                    db.query(PromptConfig)
                    .filter(PromptConfig.id == prompt_config_id)
                    .first()
                )
                if prompt_config:
                    prompt = prompt_config.prompt
                    prompt_parameters = build_parameters(prompt_config)
                    if not ai_config and prompt_config.model_api_config_id:
                        model_config = (
                            db.query(ModelAPIConfig)
                            .filter(
                                ModelAPIConfig.id == prompt_config.model_api_config_id
                            )
                            .first()
                        )
                        if model_config:
                            ai_config = {
                                "base_url": model_config.base_url,
                                "api_key": model_config.api_key,
                                "model_name": model_config.model_name,
                                "model_api_config_id": model_config.id,
                                "price_input_per_1k": model_config.price_input_per_1k,
                                "price_output_per_1k": model_config.price_output_per_1k,
                                "currency": model_config.currency,
                            }

            if not ai_config:
                default_config = self.get_ai_config(
                    db, category_id, prompt_type=content_type
                )
                if default_config:
                    ai_config = default_config
                    if not prompt:
                        prompt = default_config.get("prompt_template")

            if not ai_config:
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = (
                    "未配置AI服务，请先在配置页面设置AI参数"
                )
                article.ai_analysis.updated_at = now_str()
                db.commit()
                return

            ai_client = self.create_ai_client(ai_config)
            parameters = ai_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}
            pricing = {
                "model_api_config_id": ai_config.get("model_api_config_id"),
                "price_input_per_1k": ai_config.get("price_input_per_1k"),
                "price_output_per_1k": ai_config.get("price_output_per_1k"),
                "currency": ai_config.get("currency"),
            }

            try:
                result = await asyncio.wait_for(
                    ai_client.generate_summary(
                        article.content_md, prompt=prompt, parameters=parameters
                    ),
                    timeout=300.0,
                )
                if isinstance(result, dict):
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_ai_content",
                        content_type=content_type,
                        usage=result.get("usage"),
                        latency_ms=result.get("latency_ms"),
                        status="completed",
                        error_message=None,
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                        request_payload=result.get("request_payload"),
                        response_payload=result.get("response_payload"),
                    )
                    result = result.get("content")
                setattr(article.ai_analysis, content_type, result)
                setattr(article.ai_analysis, f"{content_type}_status", "completed")
                article.ai_analysis.error_message = None
                article.ai_analysis.updated_at = now_str()
                print(f"{content_type} 生成完成: {article.title}")
                if content_type == "summary":
                    self.enqueue_task(
                        db,
                        task_type="process_article_embedding",
                        article_id=article_id,
                        content_type="embedding",
                    )
                if content_type == "summary":
                    self.enqueue_task(
                        db,
                        task_type="process_article_embedding",
                        article_id=article_id,
                        content_type="embedding",
                    )
            except asyncio.TimeoutError:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_ai_content",
                    content_type=content_type,
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message="AI生成超时，请稍后重试",
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = "AI生成超时，请稍后重试"
                article.ai_analysis.updated_at = now_str()
                print(f"{content_type} 生成超时: {article.title}")
            except Exception as e:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_ai_content",
                    content_type=content_type,
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(e),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = str(e)
                article.ai_analysis.updated_at = now_str()
                print(f"{content_type} 生成失败: {article.title}, 错误: {e}")

            db.commit()

            if content_type == "summary":
                article = db.query(Article).filter(Article.id == article_id).first()
                if article:
                    analysis = (
                        db.query(AIAnalysis)
                        .filter(AIAnalysis.article_id == article_id)
                        .first()
                    )
                    summary_status = analysis.summary_status if analysis else None
                    translation_status = article.translation_status
                    if summary_status in ["completed", "failed"] and (
                        translation_status in ["completed", "failed", "skipped", None]
                    ):
                        article.status = "completed"
                        article.updated_at = now_str()
                        db.commit()
        except Exception as e:
            print(f"{content_type} 处理失败: {e}")
            article = db.query(Article).filter(Article.id == article_id).first()
            if article and article.ai_analysis:
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = str(e)
                article.ai_analysis.updated_at = now_str()
                db.commit()
        finally:
            db.close()
