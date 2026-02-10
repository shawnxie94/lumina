import asyncio

from app.legacy.legacy_article_service import (
    ArticleService as LegacyArticleService,
    build_parameters,
)
from models import AIAnalysis, Article, ModelAPIConfig, PromptConfig, SessionLocal, now_str
from task_errors import TaskConfigError


class ArticleAIPipelineService:
    def __init__(
        self,
        current_task_id: str | None = None,
        enqueue_task_func=None,
    ):
        self.current_task_id = current_task_id
        self.legacy = LegacyArticleService(current_task_id=current_task_id)
        self.enqueue_task_func = enqueue_task_func

    async def process_article_ai(self, article_id: str, category_id: str | None):
        return await self.legacy.process_article_ai(article_id, category_id)

    async def process_article_cleaning(self, article_id: str, category_id: str | None):
        return await self.legacy.process_article_cleaning(article_id, category_id)

    async def process_article_validation(
        self,
        article_id: str,
        category_id: str | None,
        cleaned_md: str | None,
    ):
        return await self.legacy.process_article_validation(
            article_id, category_id, cleaned_md
        )

    async def process_article_classification(
        self, article_id: str, category_id: str | None
    ):
        return await self.legacy.process_article_classification(article_id, category_id)

    async def process_article_translation(self, article_id: str, category_id: str | None):
        return await self.legacy.process_article_translation(article_id, category_id)

    async def process_ai_content(
        self,
        article_id: str,
        category_id: str | None,
        content_type: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ):
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
                    .filter(
                        ModelAPIConfig.id == model_config_id,
                        ModelAPIConfig.is_enabled == True,
                    )
                    .first()
                )
                if not model_config:
                    raise TaskConfigError("指定模型配置不存在或已禁用")
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
                    .filter(
                        PromptConfig.id == prompt_config_id,
                        PromptConfig.is_enabled == True,
                    )
                    .first()
                )
                if not prompt_config:
                    raise TaskConfigError("指定提示词不存在或已禁用")
                prompt = prompt_config.prompt
                prompt_parameters = build_parameters(prompt_config)
                if not ai_config and prompt_config.model_api_config_id:
                    model_config = (
                        db.query(ModelAPIConfig)
                        .filter(
                            ModelAPIConfig.id == prompt_config.model_api_config_id,
                            ModelAPIConfig.is_enabled == True,
                        )
                        .first()
                    )
                    if not model_config:
                        raise TaskConfigError("提示词绑定的模型不存在或已禁用")
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
                default_config = self.legacy.get_ai_config(
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

            ai_client = self.legacy.create_ai_client(ai_config)
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
                    self.legacy._log_ai_usage(
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
                    enqueue_task = self.enqueue_task_func or self.legacy.enqueue_task
                    enqueue_task(
                        db,
                        task_type="process_article_embedding",
                        article_id=article_id,
                        content_type="embedding",
                    )
            except asyncio.TimeoutError:
                self.legacy._log_ai_usage(
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
            except Exception as exc:
                self.legacy._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_ai_content",
                    content_type=content_type,
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(exc),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = str(exc)
                article.ai_analysis.updated_at = now_str()
                print(f"{content_type} 生成失败: {article.title}, 错误: {exc}")

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
                        translation_status in ["completed", "failed", "skipped"]
                    ):
                        article.status = "completed"
                        article.updated_at = now_str()
                        db.commit()
        except Exception as exc:
            print(f"{content_type} 处理失败: {exc}")
            article = db.query(Article).filter(Article.id == article_id).first()
            if article and article.ai_analysis:
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = str(exc)
                article.ai_analysis.updated_at = now_str()
                db.commit()
        finally:
            db.close()
