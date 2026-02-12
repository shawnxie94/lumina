import asyncio
import json
import logging

from ai_client import ConfigurableAIClient, is_english_content
from media_service import maybe_ingest_article_images_with_stats
from models import (
    AIAnalysis,
    AIUsageLog,
    Article,
    Category,
    ModelAPIConfig,
    PromptConfig,
    SessionLocal,
    now_str,
)
from task_state import append_task_event
from task_errors import TaskConfigError, TaskDataError, TaskTimeoutError


logger = logging.getLogger("article_ai_pipeline")


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


class ArticleAIPipelineService:
    def __init__(
        self,
        current_task_id: str | None = None,
        enqueue_task_func=None,
    ):
        self.current_task_id = current_task_id
        self.enqueue_task_func = enqueue_task_func

    def _enqueue_task(self, db, **kwargs):
        if self.enqueue_task_func:
            return self.enqueue_task_func(db, **kwargs)
        from app.domain.ai_task_service import AITaskService

        return AITaskService().enqueue_task(db, **kwargs)

    def _prompt_ordering(self, query):
        return query.order_by(
            PromptConfig.is_default.desc(),
            PromptConfig.updated_at.desc(),
            PromptConfig.created_at.desc(),
            PromptConfig.id.asc(),
        )

    def _model_ordering(self, query):
        return query.order_by(
            ModelAPIConfig.updated_at.desc(),
            ModelAPIConfig.created_at.desc(),
            ModelAPIConfig.id.asc(),
        )

    def _get_prompt_config(
        self,
        db,
        category_id: str | None = None,
        prompt_type: str = "summary",
    ):
        prompt_query = db.query(PromptConfig).filter(
            PromptConfig.is_enabled == True,
            PromptConfig.type == prompt_type,
        )

        prompt_config = None
        if category_id:
            prompt_config = self._prompt_ordering(
                prompt_query.filter(PromptConfig.category_id == category_id)
            ).first()

        if not prompt_config:
            prompt_config = self._prompt_ordering(
                prompt_query.filter(PromptConfig.category_id.is_(None))
            ).first()

        return prompt_config

    def get_ai_config(
        self, db, category_id: str | None = None, prompt_type: str = "summary"
    ):
        model_query = db.query(ModelAPIConfig).filter(
            ModelAPIConfig.is_enabled == True,
            ModelAPIConfig.model_type != "vector",
        )
        prompt_config = self._get_prompt_config(
            db, category_id=category_id, prompt_type=prompt_type
        )

        model_config = None
        if prompt_config and prompt_config.model_api_config_id:
            model_config = model_query.filter(
                ModelAPIConfig.id == prompt_config.model_api_config_id
            ).first()

        if not model_config:
            model_config = self._model_ordering(
                model_query.filter(ModelAPIConfig.is_default == True)
            ).first()

        if not model_config:
            model_config = self._model_ordering(model_query).first()

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

    def _assert_general_model(self, model_config: ModelAPIConfig) -> None:
        if (model_config.model_type or "general") == "vector":
            raise TaskConfigError("当前任务仅支持通用模型，不能使用向量模型")

    def _extract_usage_value(self, usage, key: str):
        if usage is None:
            return None
        if isinstance(usage, dict):
            return usage.get(key)
        return getattr(usage, key, None)

    def _log_ai_usage(
        self,
        db,
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
        task_id: str | None = None,
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
                task_id=task_id or self.current_task_id,
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

    def _append_media_ingest_event(self, db, stats: dict, stage: str) -> None:
        if not self.current_task_id:
            return
        total = int(stats.get("total", 0))
        success = int(stats.get("success", 0))
        failed = int(stats.get("failed", 0))
        updated = bool(stats.get("updated", False))
        append_task_event(
            db,
            task_id=self.current_task_id,
            event_type="media_ingest",
            from_status=None,
            to_status=None,
            message=f"图片转储统计（{stage}）：成功 {success}，失败 {failed}",
            details={
                "stage": stage,
                "total": total,
                "success": success,
                "failed": failed,
                "updated": updated,
            },
        )

    async def process_article_cleaning(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ):
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

            ai_analysis.cleaned_md_draft = None
            ai_analysis.updated_at = now_str()
            db.commit()

            cleaning_config = None
            prompt = None
            prompt_parameters = {}
            has_custom_prompt = False
            default_config = self.get_ai_config(
                db,
                category_id,
                prompt_type="content_cleaning",
            )

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
                cleaning_config = {
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
                        PromptConfig.type == "content_cleaning",
                    )
                    .first()
                )
                if not prompt_config:
                    raise TaskConfigError("指定清洗提示词不存在、已禁用或类型不匹配")
                prompt = prompt_config.prompt
                prompt_parameters = build_parameters(prompt_config)
                has_custom_prompt = True
                if not cleaning_config and prompt_config.model_api_config_id:
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
                    self._assert_general_model(model_config)
                    cleaning_config = {
                        "base_url": model_config.base_url,
                        "api_key": model_config.api_key,
                        "model_name": model_config.model_name,
                        "model_api_config_id": model_config.id,
                        "price_input_per_1k": model_config.price_input_per_1k,
                        "price_output_per_1k": model_config.price_output_per_1k,
                        "currency": model_config.currency,
                    }

            if not cleaning_config:
                if default_config:
                    cleaning_config = default_config

            if not prompt and default_config:
                prompt = default_config.get("prompt_template")

            if not cleaning_config:
                article.status = "failed"
                ai_analysis.error_message = "未配置AI服务，请先在配置页面设置AI参数"
                ai_analysis.updated_at = now_str()
                db.commit()
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")

            cleaning_client = self.create_ai_client(cleaning_config)
            parameters = cleaning_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}
            elif not parameters and default_config and not has_custom_prompt:
                parameters = default_config.get("parameters") or {}
            pricing = {
                "model_api_config_id": cleaning_config.get("model_api_config_id"),
                "price_input_per_1k": cleaning_config.get("price_input_per_1k"),
                "price_output_per_1k": cleaning_config.get("price_output_per_1k"),
                "currency": cleaning_config.get("currency"),
            }

            try:
                result = await cleaning_client.generate_summary(
                    source_content, prompt=prompt, parameters=parameters
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
                    raise TaskDataError("内容清洗失败：输出为空")
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
                raise TaskTimeoutError("内容清洗超时，请稍后重试")
            except Exception as exc:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_cleaning",
                    content_type="content_cleaning",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(exc),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                raise

            ai_analysis.cleaned_md_draft = cleaned_md
            ai_analysis.updated_at = now_str()
            db.commit()

            self._enqueue_task(
                db,
                task_type="process_article_validation",
                article_id=article_id,
                content_type="content_validation",
                payload={"category_id": category_id},
            )
        except Exception as exc:
            error_message = str(exc)
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
        category_id: str | None,
        cleaned_md: str | None = None,
    ):
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

            cleaned_md_candidate = (cleaned_md or "").strip()
            if not cleaned_md_candidate and ai_analysis.cleaned_md_draft:
                cleaned_md_candidate = (ai_analysis.cleaned_md_draft or "").strip()
            if not cleaned_md_candidate:
                raise TaskDataError("缺少待校验内容，请先执行内容清洗")

            prompt_config = self._get_prompt_config(
                db,
                category_id=category_id,
                prompt_type="content_validation",
            )
            if not prompt_config:
                article.content_md = cleaned_md_candidate
                article.updated_at = now_str()
                ai_analysis.error_message = None
                ai_analysis.cleaned_md_draft = None
                ai_analysis.updated_at = now_str()
                db.commit()
                try:
                    ingest_stats = await maybe_ingest_article_images_with_stats(
                        db, article
                    )
                    self._append_media_ingest_event(
                        db, ingest_stats, stage="validation_fallback"
                    )
                except Exception as exc:
                    logger.warning("article_images_ingest_failed: %s", str(exc))
                    self._append_media_ingest_event(
                        db,
                        {"total": 0, "success": 0, "failed": 0, "updated": False},
                        stage="validation_fallback_error",
                    )

                self._enqueue_task(
                    db,
                    task_type="process_article_classification",
                    article_id=article_id,
                    content_type="classification",
                    payload={"category_id": category_id},
                )
                return

            validation_config = self.get_ai_config(
                db, category_id, prompt_type="content_validation"
            )
            if not validation_config:
                article.status = "failed"
                ai_analysis.error_message = "未配置AI服务，请先在配置页面设置AI参数"
                ai_analysis.updated_at = now_str()
                db.commit()
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")

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
                result = await validation_client.generate_summary(
                    cleaned_md_candidate, prompt=prompt, parameters=parameters
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
                raise TaskTimeoutError("内容校验超时，请稍后重试")
            except Exception as exc:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_validation",
                    content_type="content_validation",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(exc),
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
                raise TaskDataError(ai_analysis.error_message or "内容校验未通过")

            final_md = cleaned_md_candidate
            if not final_md:
                article.status = "failed"
                ai_analysis.error_message = "内容校验未通过：内容为空"
                ai_analysis.updated_at = now_str()
                db.commit()
                raise TaskDataError("内容校验未通过：内容为空")

            article.content_md = final_md
            article.updated_at = now_str()
            ai_analysis.error_message = None
            ai_analysis.cleaned_md_draft = None
            ai_analysis.updated_at = now_str()
            db.commit()
            try:
                ingest_stats = await maybe_ingest_article_images_with_stats(db, article)
                self._append_media_ingest_event(
                    db, ingest_stats, stage="validation_passed"
                )
            except Exception as exc:
                logger.warning("article_images_ingest_failed: %s", str(exc))
                self._append_media_ingest_event(
                    db,
                    {"total": 0, "success": 0, "failed": 0, "updated": False},
                    stage="validation_passed_error",
                )

            self._enqueue_task(
                db,
                task_type="process_article_classification",
                article_id=article_id,
                content_type="classification",
                payload={"category_id": category_id},
            )
        except Exception as exc:
            error_message = str(exc)
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

    async def process_article_classification(
        self, article_id: str, category_id: str | None
    ):
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
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")

            categories = db.query(Category).order_by(Category.sort_order).all()
            categories_payload = "\n".join(
                [
                    f"- {category.id} | {category.name} | {category.description or ''}".strip()
                    for category in categories
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

                category_output = (result or "").strip().strip('"').strip("'")
                if category_output:
                    category = (
                        db.query(Category).filter(Category.id == category_output).first()
                    )
                    if category:
                        article.category_id = category.id
                        article.updated_at = now_str()
                        db.commit()
                    else:
                        raise TaskDataError("分类未命中：返回ID不存在")
                else:
                    raise TaskDataError("分类未命中：未返回分类ID")

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
                raise TaskTimeoutError("分类任务超时")
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
                if not analysis.error_message:
                    analysis.error_message = str(exc)
                analysis.updated_at = now_str()
                db.commit()
                raise

            effective_category_id = article.category_id or category_id
            self._enqueue_task(
                db,
                task_type="process_ai_content",
                article_id=article_id,
                content_type="summary",
                payload={"category_id": effective_category_id},
            )

            if article.content_md and is_english_content(article.content_md):
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
        finally:
            db.close()

    async def process_article_translation(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ):
        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            article.translation_status = "processing"
            article.translation_error = None
            db.commit()

            trans_prompt = None
            trans_parameters = {}
            prompt_bound_model_id = None
            if prompt_config_id:
                prompt_config = (
                    db.query(PromptConfig)
                    .filter(
                        PromptConfig.id == prompt_config_id,
                        PromptConfig.is_enabled == True,
                        PromptConfig.type == "translation",
                    )
                    .first()
                )
                if not prompt_config:
                    raise TaskConfigError("指定翻译提示词不存在、已禁用或类型不匹配")
                trans_prompt = prompt_config.prompt
                trans_parameters = build_parameters(prompt_config)
                prompt_bound_model_id = prompt_config.model_api_config_id

            ai_config = None
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
                ai_config = {
                    "base_url": model_config.base_url,
                    "api_key": model_config.api_key,
                    "model_name": model_config.model_name,
                    "model_api_config_id": model_config.id,
                    "price_input_per_1k": model_config.price_input_per_1k,
                    "price_output_per_1k": model_config.price_output_per_1k,
                    "currency": model_config.currency,
                }

            if prompt_bound_model_id and not ai_config:
                model_config = (
                    db.query(ModelAPIConfig)
                    .filter(
                        ModelAPIConfig.id == prompt_bound_model_id,
                        ModelAPIConfig.is_enabled == True,
                    )
                    .first()
                )
                if not model_config:
                    raise TaskConfigError("提示词绑定的模型不存在或已禁用")
                self._assert_general_model(model_config)
                ai_config = {
                    "base_url": model_config.base_url,
                    "api_key": model_config.api_key,
                    "model_name": model_config.model_name,
                    "model_api_config_id": model_config.id,
                    "price_input_per_1k": model_config.price_input_per_1k,
                    "price_output_per_1k": model_config.price_output_per_1k,
                    "currency": model_config.currency,
                }

            default_translation_config = self.get_ai_config(
                db,
                category_id,
                prompt_type="translation",
            )
            if not trans_prompt and default_translation_config:
                trans_prompt = default_translation_config.get("prompt_template")
                trans_parameters = default_translation_config.get("parameters") or {}

            if not ai_config:
                ai_config = default_translation_config or self.get_ai_config(
                    db,
                    category_id,
                    prompt_type="summary",
                )

            if not ai_config:
                article.translation_status = "failed"
                article.translation_error = "未配置AI服务，请先在配置页面设置AI参数"
                db.commit()
                return

            trans_client = self.create_ai_client(ai_config)
            pricing = {
                "model_api_config_id": ai_config.get("model_api_config_id"),
                "price_input_per_1k": ai_config.get("price_input_per_1k"),
                "price_output_per_1k": ai_config.get("price_output_per_1k"),
                "currency": ai_config.get("currency"),
            }

            try:
                content_trans = await trans_client.translate_to_chinese(
                    article.content_md,
                    prompt=trans_prompt,
                    parameters=trans_parameters,
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
            except Exception as exc:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_translation",
                    content_type="translation",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(exc),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                article.translation_status = "failed"
                article.translation_error = str(exc)
                print(f"翻译失败: {article.title}, 错误: {exc}")

            db.commit()
        except Exception as exc:
            print(f"翻译处理失败: {exc}")
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.translation_status = "failed"
                article.translation_error = str(exc)
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
                        translation_status in ["completed", "failed", "skipped"]
                    ):
                        article.status = "completed"
                        article.updated_at = now_str()
                        db.commit()
            finally:
                db.close()

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
                self._assert_general_model(model_config)
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
                    self._assert_general_model(model_config)
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
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")

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
                result = await ai_client.generate_summary(
                    article.content_md, prompt=prompt, parameters=parameters
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
                    summary_text = (result or "").strip()
                    if summary_text:
                        from app.domain.article_embedding_service import (
                            ArticleEmbeddingService,
                        )

                        if ArticleEmbeddingService().has_available_remote_config(db):
                            self._enqueue_task(
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
            except Exception as exc:
                self._log_ai_usage(
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
            if isinstance(exc, TaskConfigError):
                raise
        finally:
            db.close()
