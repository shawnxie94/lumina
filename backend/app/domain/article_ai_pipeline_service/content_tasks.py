import asyncio

from models import AIAnalysis, Article, ModelAPIConfig, PromptConfig, now_str
from task_errors import TaskConfigError, TaskDataError

from . import common
from .common import build_parameters


class _ContentTasksMixin:
    def _enqueue_summary_completed_hooks(self, db, article_id: str) -> None:
        if common.ArticleEmbeddingService().has_available_remote_config(db):
            self._enqueue_task(
                db,
                task_type="process_article_embedding",
                article_id=article_id,
                content_type="embedding",
            )

    def _update_article_completed_if_ready(
        self,
        db,
        article: Article,
        analysis: AIAnalysis | None,
    ) -> None:
        summary_status = analysis.summary_status if analysis else None
        translation_status = article.translation_status
        if summary_status in ["completed", "failed", "skipped"] and (
            translation_status in ["completed", "failed", "skipped"]
        ):
            article.status = "completed"
            article.updated_at = now_str()

    async def process_ai_content(
        self,
        article_id: str,
        category_id: str | None,
        content_type: str,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ):
        db = common.SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return
            if content_type not in self.SUPPORTED_AI_CONTENT_TYPES:
                raise TaskDataError("不支持的 AI 内容类型")

            if content_type == "digest_prefill":
                await self.process_digest_prefill(
                    article_id,
                    category_id,
                    model_config_id=model_config_id,
                    prompt_config_id=prompt_config_id,
                )
                return

            if not article.ai_analysis:
                return

            setattr(article.ai_analysis, f"{content_type}_status", "processing")
            article.ai_analysis.updated_at = now_str()
            db.commit()

            ai_config = None
            prompt = None
            prompt_parameters = {}
            default_config = self.get_ai_config(
                db, category_id, prompt_type=content_type
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
                ai_config = {
                    "base_url": model_config.base_url,
                    "api_key": model_config.api_key,
                    "model_name": model_config.model_name,
                    "model_api_config_id": model_config.id,
                    "api_type": model_config.api_type or "chat_completions",
                    "price_input_per_1k": model_config.price_input_per_1k,
                    "price_output_per_1k": model_config.price_output_per_1k,
                    "currency": model_config.currency,
                    "parameters": default_config.get("parameters") if default_config else None,
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
                        "api_type": model_config.api_type or "chat_completions",
                        "price_input_per_1k": model_config.price_input_per_1k,
                        "price_output_per_1k": model_config.price_output_per_1k,
                        "currency": model_config.currency,
                    }

            if not ai_config:
                if default_config:
                    ai_config = default_config
            if not prompt and default_config:
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
            elif not parameters and default_config:
                parameters = default_config.get("parameters") or {}
            if not prompt:
                setattr(article.ai_analysis, f"{content_type}_status", "failed")
                article.ai_analysis.error_message = (
                    f"未配置{content_type}提示词，请先在配置页面设置"
                )
                article.ai_analysis.updated_at = now_str()
                db.commit()
                return
            prompt = self._build_article_task_prompt(
                prompt,
                content_type,
                article=article,
            )
            parameters = self._merge_protocol_parameters(content_type, parameters)
            pricing = {
                "model_api_config_id": ai_config.get("model_api_config_id"),
                "price_input_per_1k": ai_config.get("price_input_per_1k"),
                "price_output_per_1k": ai_config.get("price_output_per_1k"),
                "currency": ai_config.get("currency"),
            }

            try:
                generation_error: Exception | None = None
                max_tokens = self._resolve_generation_max_tokens(
                    content_type, parameters
                )
                parameters = dict(parameters or {})
                parameters["max_tokens"] = max_tokens
                result = await self.ai_invocation_service.invoke_generation(
                    db=db,
                    api_type=ai_config.get("api_type") or "chat_completions",
                    model_name=ai_config["model_name"],
                    base_url=ai_config["base_url"],
                    api_key=ai_config["api_key"],
                    system_prompt=parameters.get("system_prompt"),
                    user_prompt=prompt,
                    article_id=article_id,
                    task_type="process_ai_content",
                    content_type=content_type,
                    task_id=self.current_task_id,
                    client=ai_client,
                    content=article.content_md,
                    prompt=prompt,
                    parameters=parameters,
                    max_tokens=max_tokens,
                    request_context={
                        "parameters": parameters,
                        "max_tokens": max_tokens,
                    },
                )
                if isinstance(result, dict):
                    usage_log = self._log_ai_usage(
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
                    self.ai_call_session_service.create_session(
                        db,
                        usage_log_id=usage_log.id,
                        task_id=self.current_task_id,
                        article_id=article_id,
                        task_type="process_ai_content",
                        content_type=content_type,
                        session_info=result.get("session_info") or {},
                    )
                    result = result.get("content")

                if content_type == "outline":
                    article.ai_analysis.outline = self._parse_outline_task_result(
                        result
                    )
                    article.ai_analysis.outline_status = "completed"
                elif content_type == "quotes":
                    article.ai_analysis.quotes = self._normalize_quotes_markdown(result)
                    article.ai_analysis.quotes_status = "completed"
                else:
                    setattr(article.ai_analysis, content_type, result)
                    setattr(article.ai_analysis, f"{content_type}_status", "completed")
                article.ai_analysis.error_message = None
                article.ai_analysis.updated_at = now_str()
                if content_type in self.SUPPORTED_AI_CONTENT_TYPES:
                    self.article_ai_version_service.record_version(
                        db,
                        article_id=article_id,
                        content_type=content_type,
                        source_task_id=self.current_task_id,
                        source_model_config_id=ai_config.get("model_api_config_id"),
                        source_prompt_config_id=prompt_config_id,
                    )
                print(f"{content_type} 生成完成: {article.title}")
                if content_type == "summary":
                    summary_text = (result or "").strip()
                    if summary_text:
                        self._enqueue_summary_completed_hooks(db, article_id)
            except asyncio.TimeoutError as exc:
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
                generation_error = exc
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
                generation_error = exc

            db.commit()

            if generation_error is not None:
                raise generation_error

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
            if content_type != "digest_prefill":
                article = db.query(Article).filter(Article.id == article_id).first()
                if article and article.ai_analysis:
                    setattr(article.ai_analysis, f"{content_type}_status", "failed")
                    article.ai_analysis.error_message = str(exc)
                    article.ai_analysis.updated_at = now_str()
                    db.commit()
            raise
        finally:
            db.close()
