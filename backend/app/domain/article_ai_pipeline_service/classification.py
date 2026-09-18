import asyncio

from ai_client import is_english_content
from models import AIAnalysis, Article, Category, ModelAPIConfig, PromptConfig, now_str
from task_errors import TaskConfigError, TaskExternalError, TaskTimeoutError

from . import common
from .common import build_parameters


class _ClassificationMixin:
    async def process_article_classification(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
        post_process_options: dict | None = None,
    ):
        db = common.SessionLocal()
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

            classification_config = None
            prompt = None

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
                self._assert_general_model(model_config)
                classification_config = {
                    "base_url": model_config.base_url,
                    "api_key": model_config.api_key,
                    "model_name": model_config.model_name,
                    "model_api_config_id": model_config.id,
                    "price_input_per_1k": model_config.price_input_per_1k,
                    "price_output_per_1k": model_config.price_output_per_1k,
                    "currency": model_config.currency,
                    "context_window_tokens": model_config.context_window_tokens,
                    "reserve_output_tokens": model_config.reserve_output_tokens,
                }
                # 当指定模型但未指定提示词时，获取默认分类提示词
                if not prompt_config_id:
                    default_prompt_config = self._get_prompt_config(
                        db, category_id=category_id, prompt_type="classification"
                    )
                    if default_prompt_config:
                        prompt = default_prompt_config.prompt
                        parameters = build_parameters(default_prompt_config)
                        classification_config["parameters"] = parameters or None

            if prompt_config_id:
                prompt_config_obj = (
                    db.query(PromptConfig)
                    .filter(
                        PromptConfig.id == prompt_config_id,
                        PromptConfig.is_enabled == True,
                        PromptConfig.type == "classification",
                    )
                    .first()
                )
                if not prompt_config_obj:
                    raise TaskConfigError("指定分类提示词不存在、已禁用或类型不匹配")
                prompt = prompt_config_obj.prompt
                parameters = build_parameters(prompt_config_obj)
                if classification_config:
                    classification_config["parameters"] = parameters or None

            if not classification_config:
                classification_config = self.get_ai_config(
                    db, category_id, prompt_type="classification"
                )

            if not classification_config:
                analysis.classification_status = "failed"
                if not analysis.error_message:
                    analysis.error_message = "未配置AI服务，请先在配置页面设置AI参数"
                analysis.updated_at = now_str()
                db.commit()
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")

            # 如果 prompt 还没有设置，尝试从 classification_config 获取
            if not prompt and classification_config:
                prompt = classification_config.get("prompt_template")

            # 如果没有提示词配置，跳过 AI 调用但继续后续流程
            skip_ai_call = not prompt
            classification_task_error: Exception | None = None
            if skip_ai_call:
                analysis.classification_status = "failed"
                analysis.error_message = "未配置分类提示词，跳过分类"
                analysis.updated_at = now_str()
                db.commit()
            else:
                categories = db.query(Category).order_by(Category.sort_order).all()
                categories_payload = "\n".join(
                    [
                        f"- {category.id} | {category.name} | {category.description or ''}".strip()
                        for category in categories
                    ]
                )
                prompt = self._build_article_task_prompt(
                    prompt,
                    "classification",
                    article=article,
                    categories_payload=categories_payload,
                    content_placeholder=True,
                )
                parameters = self._merge_protocol_parameters(
                    "classification",
                    classification_config.get("parameters"),
                )
                pricing = {
                    "model_api_config_id": classification_config.get("model_api_config_id"),
                    "price_input_per_1k": classification_config.get("price_input_per_1k"),
                    "price_output_per_1k": classification_config.get("price_output_per_1k"),
                    "currency": classification_config.get("currency"),
                }

                try:
                    result = await self.create_ai_client(classification_config).generate_summary(
                        article.content_md,
                        prompt=prompt,
                        parameters=parameters,
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

                    parsed_result = self._parse_structured_task_result(
                        "classification",
                        result,
                    )
                    category_output = parsed_result.get("category_id", "").strip()
                    if category_output:
                        category = (
                            db.query(Category).filter(Category.id == category_output).first()
                        )
                        if category:
                            article.category_id = category.id
                            article.updated_at = now_str()
                            analysis.classification_status = "completed"
                            analysis.error_message = None
                            analysis.updated_at = now_str()
                            db.commit()
                        else:
                            analysis.classification_status = "failed"
                            analysis.error_message = "分类未命中：返回ID不存在"
                            analysis.updated_at = now_str()
                            db.commit()
                    else:
                        analysis.classification_status = "failed"
                        analysis.error_message = "分类未命中：未返回分类ID"
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
                    analysis.error_message = "AI生成超时，请稍后重试"
                    analysis.updated_at = now_str()
                    db.commit()
                    classification_task_error = TaskTimeoutError(
                        "AI生成超时，请稍后重试"
                    )
                except Exception as exc:
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_classification",
                        content_type="classification",
                        usage=None,
                        latency_ms=None,
                        status="failed",
                        error_message=str(exc),
                        price_input_per_1k=pricing.get("price_input_per_1k"),
                        price_output_per_1k=pricing.get("price_output_per_1k"),
                        currency=pricing.get("currency"),
                    )
                    analysis.classification_status = "failed"
                    analysis.error_message = str(exc)
                    analysis.updated_at = now_str()
                    db.commit()
                    classification_task_error = TaskExternalError(str(exc))

            effective_category_id = article.category_id or category_id
            options = self._normalize_post_process_options(post_process_options)

            if options.get("summary"):
                self._enqueue_task(
                    db,
                    task_type="process_ai_content",
                    article_id=article_id,
                    content_type="summary",
                    payload={"category_id": effective_category_id},
                )
            for content_type in ("outline", "quotes"):
                if options.get(content_type):
                    self._enqueue_task(
                        db,
                        task_type="process_ai_content",
                        article_id=article_id,
                        content_type=content_type,
                        payload={"category_id": effective_category_id},
                    )

            if (
                options.get("translation")
                and article.content_md
                and is_english_content(article.content_md)
            ):
                article.translation_status = "pending"
                article.translation_error = None
                article.updated_at = now_str()
                db.commit()
                self._enqueue_task(
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

            if not any(
                options.get(content_type)
                for content_type in ("summary", "outline", "quotes", "translation")
            ):
                article.status = "completed"
                article.updated_at = now_str()
                db.commit()

            if classification_task_error is not None:
                raise classification_task_error
        finally:
            db.close()
