import asyncio

from models import AIAnalysis, AITask, Article, ModelAPIConfig, PromptConfig, now_str
from task_errors import TaskConfigError, TaskDataError, TaskExternalError, TaskTimeoutError
from task_state import append_task_event

from . import common
from .common import build_parameters


class _CleaningTranslationMixin:
    async def _translate_article_title(
        self,
        db,
        ai_client,
        title: str,
        prompt: str | None,
        parameters: dict,
        pricing: dict,
        article_id: str,
    ) -> str:
        source_title = self._extract_title_text(title)
        if not source_title:
            raise TaskDataError("文章标题为空，无法翻译")

        title_payload = f"# {source_title}"
        estimated_tokens = self._estimate_tokens(title_payload)

        try:
            translated_title = await ai_client.translate_to_chinese(
                title_payload,
                prompt=prompt,
                parameters=parameters,
                max_tokens=min(512, self.DEFAULT_CLEANING_MAX_TOKENS),
            )
            finish_reason = (
                translated_title.get("finish_reason")
                if isinstance(translated_title, dict)
                else None
            )
            truncated = finish_reason == "length"
            usage = None
            latency_ms = None
            request_payload = None
            response_payload = None

            if isinstance(translated_title, dict):
                usage = translated_title.get("usage")
                latency_ms = translated_title.get("latency_ms")
                request_payload = translated_title.get("request_payload")
                response_payload = translated_title.get("response_payload")
                translated_title = translated_title.get("content") or ""

            normalized_title = self._extract_title_text(translated_title)
            if not normalized_title:
                raise TaskDataError("标题翻译失败：输出为空")
            self._log_ai_usage(
                db,
                model_config_id=pricing.get("model_api_config_id"),
                article_id=article_id,
                task_type="process_article_translation",
                content_type="translation_title",
                usage=usage,
                latency_ms=latency_ms,
                status="completed",
                error_message=None,
                price_input_per_1k=pricing.get("price_input_per_1k"),
                price_output_per_1k=pricing.get("price_output_per_1k"),
                currency=pricing.get("currency"),
                request_payload=request_payload,
                response_payload=response_payload,
                finish_reason=finish_reason,
                truncated=truncated,
                chunk_index=None,
                continue_round=None,
                estimated_input_tokens=estimated_tokens,
            )
            return normalized_title
        except asyncio.TimeoutError:
            self._log_ai_usage(
                db,
                model_config_id=pricing.get("model_api_config_id"),
                article_id=article_id,
                task_type="process_article_translation",
                content_type="translation_title",
                usage=None,
                latency_ms=None,
                status="failed",
                error_message="标题翻译超时，请稍后重试",
                price_input_per_1k=pricing.get("price_input_per_1k"),
                price_output_per_1k=pricing.get("price_output_per_1k"),
                currency=pricing.get("currency"),
                finish_reason=None,
                truncated=None,
                chunk_index=None,
                continue_round=None,
                estimated_input_tokens=estimated_tokens,
            )
            return None
        except Exception as exc:
            self._log_ai_usage(
                db,
                model_config_id=pricing.get("model_api_config_id"),
                article_id=article_id,
                task_type="process_article_translation",
                content_type="translation_title",
                usage=None,
                latency_ms=None,
                status="failed",
                error_message=str(exc),
                price_input_per_1k=pricing.get("price_input_per_1k"),
                price_output_per_1k=pricing.get("price_output_per_1k"),
                currency=pricing.get("currency"),
                finish_reason=None,
                truncated=None,
                chunk_index=None,
                continue_round=None,
                estimated_input_tokens=estimated_tokens,
            )
            return None

    def _build_cleaning_prompt(self, base_prompt: str | None, source_format: str) -> str | None:
        if not base_prompt:
            return None

        content_label = "待清洗 HTML 内容" if source_format == "html" else "待清洗 Markdown 内容"
        if source_format == "html":
            return self._build_runtime_content_prompt(base_prompt, content_label)
        adjusted = (
            base_prompt.replace("以下 HTML 内容", "以下 Markdown 内容")
            .replace("以下html内容", "以下markdown内容")
            .replace("HTML：", "Markdown：")
        )
        return self._build_runtime_content_prompt(adjusted, content_label)

    def _build_translation_prompt(self, base_prompt: str | None) -> str | None:
        return self._build_runtime_content_prompt(base_prompt, "待翻译内容")

    def _build_continue_prompt(self, base_prompt: str | None, partial_output: str) -> str:
        instruction = (
            "继续上一次输出：仅补充尚未输出的剩余内容，不要重复任何已输出句子。"
            "从最后一个完整句后继续，保持 GFM Markdown 格式。"
            "如果下一段与已输出末尾有重复，必须删除重复后再继续；禁止复述上一段最后一句。"
            f"\n\n已输出末尾（仅供衔接，不要原样重复）：\n{partial_output[-1200:]}\n"
        )
        if not base_prompt:
            return instruction + "\n\n待处理内容：\n{content}"
        if "{content}" in base_prompt:
            return base_prompt + "\n\n" + instruction
        return base_prompt + "\n\n" + instruction

    def _resolve_cleaning_advanced_options(
        self,
        cleaning_config: dict,
        parameters: dict,
    ) -> dict | None:
        context_window_tokens = cleaning_config.get("context_window_tokens")
        reserve_output_tokens = cleaning_config.get("reserve_output_tokens")
        chunk_size_tokens = parameters.get("chunk_size_tokens")
        chunk_overlap_tokens = parameters.get("chunk_overlap_tokens")
        max_continue_rounds = parameters.get("max_continue_rounds")

        values = (
            context_window_tokens,
            reserve_output_tokens,
            chunk_size_tokens,
            chunk_overlap_tokens,
            max_continue_rounds,
        )
        if any(value is None for value in values):
            return None

        try:
            context_window_tokens = int(context_window_tokens)
            reserve_output_tokens = int(reserve_output_tokens)
            chunk_size_tokens = int(chunk_size_tokens)
            chunk_overlap_tokens = int(chunk_overlap_tokens)
            max_continue_rounds = int(max_continue_rounds)
        except Exception:
            return None

        if context_window_tokens <= 0 or reserve_output_tokens < 0:
            return None
        if chunk_size_tokens <= 0 or chunk_overlap_tokens < 0 or max_continue_rounds < 0:
            return None

        return {
            "context_window_tokens": context_window_tokens,
            "reserve_output_tokens": reserve_output_tokens,
            "chunk_size_tokens": chunk_size_tokens,
            "chunk_overlap_tokens": chunk_overlap_tokens,
            "max_continue_rounds": max_continue_rounds,
        }

    def _determine_cleaning_strategy(
        self,
        estimated_tokens: int,
        strategy: str | None,
        advanced_options: dict,
    ) -> tuple[bool, int]:
        strategy_value = (strategy or "auto").strip().lower()
        input_budget = max(
            200,
            int(advanced_options["context_window_tokens"])
            - int(advanced_options["reserve_output_tokens"])
            - self.DEFAULT_SAFETY_MARGIN_TOKENS,
        )
        if strategy_value == "chunked":
            return True, input_budget
        if strategy_value == "single":
            return False, input_budget
        chunk_threshold = min(input_budget, int(advanced_options["chunk_size_tokens"]))
        return estimated_tokens > chunk_threshold, input_budget

    def _enqueue_translation_chunk_continuation(
        self,
        db,
        *,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None,
        prompt_config_id: str | None,
        strategy: str,
        chunk_cursor: int,
    ) -> str | None:
        if not self.current_task_id:
            return None

        current_task = db.query(AITask).filter(AITask.id == self.current_task_id).first()
        if current_task:
            root_task_id = current_task.root_task_id or current_task.id
            content_type = current_task.content_type
        else:
            root_task_id = self.current_task_id
            content_type = "translation"

        payload = {
            "category_id": category_id,
            "chunk_cursor": chunk_cursor,
            "strategy": strategy,
        }
        if model_config_id:
            payload["model_config_id"] = model_config_id
        if prompt_config_id:
            payload["prompt_config_id"] = prompt_config_id

        next_task_id = self._enqueue_task(
            db,
            task_type="process_article_translation",
            article_id=article_id,
            content_type=content_type,
            payload=payload,
            parent_task_id=self.current_task_id,
            root_task_id=root_task_id,
        )
        append_task_event(
            db,
            task_id=self.current_task_id,
            event_type="chunk_continuation_enqueued",
            from_status=None,
            to_status=None,
            message=f"已排队继续翻译第 {chunk_cursor + 1} 块",
            details={
                "next_task_id": next_task_id,
                "chunk_cursor": chunk_cursor,
            },
        )
        db.commit()
        return next_task_id

    async def _clean_markdown_chunk(
        self,
        db,
        ai_client,
        chunk_content: str,
        prompt: str | None,
        parameters: dict,
        pricing: dict,
        article_id: str,
        chunk_index: int,
        max_continue_rounds: int,
    ) -> str:
        estimated_tokens = self._estimate_tokens(chunk_content)
        merged_result = ""
        current_prompt = prompt

        for continue_round in range(max_continue_rounds + 1):
            try:
                result = await ai_client.generate_summary(
                    chunk_content,
                    prompt=current_prompt,
                    parameters=parameters,
                    max_tokens=self.DEFAULT_CLEANING_MAX_TOKENS,
                )
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
                    finish_reason=None,
                    truncated=None,
                    chunk_index=chunk_index,
                    continue_round=continue_round,
                    estimated_input_tokens=estimated_tokens,
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
                    finish_reason=None,
                    truncated=None,
                    chunk_index=chunk_index,
                    continue_round=continue_round,
                    estimated_input_tokens=estimated_tokens,
                )
                raise

            finish_reason = result.get("finish_reason") if isinstance(result, dict) else None
            partial = (
                (result.get("content") if isinstance(result, dict) else result) or ""
            ).strip()
            truncated = finish_reason == "length"

            self._log_ai_usage(
                db,
                model_config_id=pricing.get("model_api_config_id"),
                article_id=article_id,
                task_type="process_article_cleaning",
                content_type="content_cleaning",
                usage=result.get("usage") if isinstance(result, dict) else None,
                latency_ms=result.get("latency_ms") if isinstance(result, dict) else None,
                status="completed",
                error_message=None,
                price_input_per_1k=pricing.get("price_input_per_1k"),
                price_output_per_1k=pricing.get("price_output_per_1k"),
                currency=pricing.get("currency"),
                request_payload=result.get("request_payload")
                if isinstance(result, dict)
                else None,
                response_payload=result.get("response_payload")
                if isinstance(result, dict)
                else None,
                finish_reason=finish_reason,
                truncated=truncated,
                chunk_index=chunk_index,
                continue_round=continue_round,
                estimated_input_tokens=estimated_tokens,
            )

            if not partial and continue_round == 0:
                raise TaskDataError("内容清洗失败：输出为空")

            merged_result = self._merge_with_overlap(merged_result, partial)
            if finish_reason != "length":
                return merged_result.strip()

            if continue_round >= max_continue_rounds:
                raise TaskExternalError("内容清洗输出被截断，请稍后重试")

            current_prompt = self._build_continue_prompt(prompt, merged_result)

        return merged_result.strip()

    async def _translate_markdown_chunk(
        self,
        db,
        ai_client,
        chunk_content: str,
        prompt: str | None,
        parameters: dict,
        pricing: dict,
        article_id: str,
        chunk_index: int,
        max_continue_rounds: int,
    ) -> str:
        estimated_tokens = self._estimate_tokens(chunk_content)
        merged_result = ""
        current_prompt = prompt

        for continue_round in range(max_continue_rounds + 1):
            try:
                result = await ai_client.translate_to_chinese(
                    chunk_content,
                    prompt=current_prompt,
                    parameters=parameters,
                    max_tokens=self.DEFAULT_CLEANING_MAX_TOKENS,
                )
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
                    finish_reason=None,
                    truncated=None,
                    chunk_index=chunk_index,
                    continue_round=continue_round,
                    estimated_input_tokens=estimated_tokens,
                )
                raise TaskTimeoutError("翻译超时，请稍后重试")
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
                    finish_reason=None,
                    truncated=None,
                    chunk_index=chunk_index,
                    continue_round=continue_round,
                    estimated_input_tokens=estimated_tokens,
                )
                raise

            finish_reason = result.get("finish_reason") if isinstance(result, dict) else None
            partial = (
                (result.get("content") if isinstance(result, dict) else result) or ""
            ).strip()
            truncated = finish_reason == "length"

            self._log_ai_usage(
                db,
                model_config_id=pricing.get("model_api_config_id"),
                article_id=article_id,
                task_type="process_article_translation",
                content_type="translation",
                usage=result.get("usage") if isinstance(result, dict) else None,
                latency_ms=result.get("latency_ms") if isinstance(result, dict) else None,
                status="completed",
                error_message=None,
                price_input_per_1k=pricing.get("price_input_per_1k"),
                price_output_per_1k=pricing.get("price_output_per_1k"),
                currency=pricing.get("currency"),
                request_payload=result.get("request_payload")
                if isinstance(result, dict)
                else None,
                response_payload=result.get("response_payload")
                if isinstance(result, dict)
                else None,
                finish_reason=finish_reason,
                truncated=truncated,
                chunk_index=chunk_index,
                continue_round=continue_round,
                estimated_input_tokens=estimated_tokens,
            )

            if not partial and continue_round == 0:
                raise TaskDataError("翻译失败：输出为空")

            merged_result = self._merge_with_overlap(merged_result, partial)
            if finish_reason != "length":
                return merged_result.strip()

            if continue_round >= max_continue_rounds:
                raise TaskExternalError("翻译输出被截断，请稍后重试")

            current_prompt = self._build_continue_prompt(prompt, merged_result)

        return merged_result.strip()

    async def process_article_cleaning(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
        source_format: str | None = None,
        strategy: str | None = None,
        chunk_cursor: int | None = None,
        post_process_options: dict | None = None,
    ):
        db = common.SessionLocal()
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

            resolved_source_format, source_content = self.normalize_source_content(
                article, source_format=source_format
            )
            if not source_content:
                article.status = "failed"
                ai_analysis.error_message = "文章内容为空，无法处理"
                ai_analysis.updated_at = now_str()
                db.commit()
                return

            try:
                start_cursor = max(0, int(chunk_cursor or 0))
            except Exception:
                start_cursor = 0

            if start_cursor <= 0:
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
                    "context_window_tokens": model_config.context_window_tokens,
                    "reserve_output_tokens": model_config.reserve_output_tokens,
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
                        "context_window_tokens": model_config.context_window_tokens,
                        "reserve_output_tokens": model_config.reserve_output_tokens,
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

            # 如果没有提示词配置，跳过 AI 调用
            if not prompt:
                article.status = "failed"
                ai_analysis.error_message = "未配置清洗提示词，请先在配置页面设置"
                ai_analysis.updated_at = now_str()
                db.commit()
                return

            cleaning_client = self.create_ai_client(cleaning_config)
            parameters = cleaning_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}
            elif not parameters and default_config and not has_custom_prompt:
                parameters = default_config.get("parameters") or {}
            parameters = self._merge_protocol_parameters(
                "content_cleaning",
                parameters,
            )
            prompt = self._build_cleaning_prompt(prompt, resolved_source_format)
            pricing = {
                "model_api_config_id": cleaning_config.get("model_api_config_id"),
                "price_input_per_1k": cleaning_config.get("price_input_per_1k"),
                "price_output_per_1k": cleaning_config.get("price_output_per_1k"),
                "currency": cleaning_config.get("currency"),
            }

            strategy_value = (strategy or "auto").strip().lower() or "auto"
            estimated_tokens = self._estimate_tokens(source_content)
            advanced_options = self._resolve_cleaning_advanced_options(
                cleaning_config,
                parameters,
            )

            if not advanced_options:
                try:
                    result = await cleaning_client.generate_summary(
                        source_content,
                        prompt=prompt,
                        parameters=parameters,
                        max_tokens=self.DEFAULT_CLEANING_MAX_TOKENS,
                    )
                    finish_reason = (
                        result.get("finish_reason") if isinstance(result, dict) else None
                    )
                    truncated = finish_reason == "length"
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
                            finish_reason=finish_reason,
                            truncated=truncated,
                            chunk_index=None,
                            continue_round=None,
                            estimated_input_tokens=estimated_tokens,
                        )
                        cleaned_md = (result.get("content") or "").strip()
                    else:
                        cleaned_md = (result or "").strip()
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
                        finish_reason=None,
                        truncated=None,
                        chunk_index=None,
                        continue_round=None,
                        estimated_input_tokens=estimated_tokens,
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
                        finish_reason=None,
                        truncated=None,
                        chunk_index=None,
                        continue_round=None,
                        estimated_input_tokens=estimated_tokens,
                    )
                    raise
                if not cleaned_md:
                    raise TaskDataError("内容清洗失败：输出为空")
            else:
                should_chunk, input_budget = self._determine_cleaning_strategy(
                    estimated_tokens,
                    strategy,
                    advanced_options=advanced_options,
                )
                chunk_size_tokens = int(advanced_options["chunk_size_tokens"])
                # Recommended overlap window for cleaning: 80-120 tokens.
                chunk_overlap_tokens = int(advanced_options["chunk_overlap_tokens"])
                max_continue_rounds = int(advanced_options["max_continue_rounds"])
                chunks = (
                    self._chunk_markdown_content(
                        source_content,
                        chunk_size_tokens=chunk_size_tokens,
                        overlap_tokens=chunk_overlap_tokens,
                    )
                    if should_chunk
                    else [source_content]
                )
                if not chunks:
                    raise TaskDataError("内容清洗失败：输入内容为空")

                self._update_current_task_payload(
                    db,
                    source_format=resolved_source_format,
                    strategy=strategy_value,
                    chunk_cursor=start_cursor,
                )

                if self.current_task_id:
                    append_task_event(
                        db,
                        task_id=self.current_task_id,
                        event_type="chunking_plan",
                        from_status=None,
                        to_status=None,
                        message=f"清洗分块计划：{len(chunks)}块",
                        details={
                            "source_format": resolved_source_format,
                            "strategy": strategy_value,
                            "chunked": should_chunk,
                            "chunk_count": len(chunks),
                            "chunk_size_tokens": chunk_size_tokens,
                            "chunk_overlap_tokens": chunk_overlap_tokens,
                            "estimated_tokens": estimated_tokens,
                            "input_budget": input_budget,
                            "context_window_tokens": advanced_options.get(
                                "context_window_tokens"
                            ),
                            "reserve_output_tokens": advanced_options.get(
                                "reserve_output_tokens"
                            ),
                        },
                    )
                    db.commit()

                if start_cursor > len(chunks):
                    start_cursor = len(chunks)

                assembled = ""
                if start_cursor > 0 and ai_analysis.cleaned_md_draft:
                    assembled = ai_analysis.cleaned_md_draft.strip()
                else:
                    start_cursor = 0
                    ai_analysis.cleaned_md_draft = None
                    ai_analysis.updated_at = now_str()
                    db.commit()
                    self._update_current_task_payload(db, chunk_cursor=0)

                for index in range(start_cursor, len(chunks)):
                    cleaned_chunk = await self._clean_markdown_chunk(
                        db=db,
                        ai_client=cleaning_client,
                        chunk_content=chunks[index],
                        prompt=prompt,
                        parameters=parameters,
                        pricing=pricing,
                        article_id=article_id,
                        chunk_index=index,
                        max_continue_rounds=max_continue_rounds,
                    )
                    if not cleaned_chunk:
                        raise TaskDataError("内容清洗失败：输出为空")
                    assembled = self._merge_with_overlap(assembled, cleaned_chunk)
                    ai_analysis.cleaned_md_draft = assembled
                    ai_analysis.updated_at = now_str()
                    db.commit()
                    self._update_current_task_payload(db, chunk_cursor=index + 1)

                cleaned_md = self._finalize_markdown(assembled)
                if not cleaned_md:
                    raise TaskDataError("内容清洗失败：输出为空")

            await self._accept_cleaned_article_content(
                db,
                article,
                ai_analysis,
                cleaned_md,
                category_id,
                post_process_options,
            )
            if advanced_options:
                self._update_current_task_payload(db, chunk_cursor=0)
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

    async def process_article_tagging(self, article_id, task_id=None, **kwargs):
        # Tagging feature removed; no-op for legacy queued tasks.
        return {"status": "skipped", "reason": "tagging_removed"}

    async def process_article_translation(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
        strategy: str | None = None,
        chunk_cursor: int | None = None,
    ):
        db = common.SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            source_content = self._normalize_markdown_whitespace(article.content_md or "")
            if not source_content:
                article.translation_status = "failed"
                article.translation_error = "文章内容为空，无法翻译"
                article.updated_at = now_str()
                db.commit()
                return

            article.translation_status = "processing"
            article.translation_error = None
            article.updated_at = now_str()
            db.commit()

            try:
                start_cursor = max(0, int(chunk_cursor or 0))
            except Exception:
                start_cursor = 0

            trans_prompt = None
            prompt_parameters = {}
            has_custom_prompt = False
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
                prompt_parameters = build_parameters(prompt_config)
                has_custom_prompt = True
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
                    "api_type": model_config.api_type or "chat_completions",
                    "price_input_per_1k": model_config.price_input_per_1k,
                    "price_output_per_1k": model_config.price_output_per_1k,
                    "currency": model_config.currency,
                    "context_window_tokens": model_config.context_window_tokens,
                    "reserve_output_tokens": model_config.reserve_output_tokens,
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
                    "context_window_tokens": model_config.context_window_tokens,
                    "reserve_output_tokens": model_config.reserve_output_tokens,
                }

            default_translation_config = self.get_ai_config(
                db,
                category_id,
                prompt_type="translation",
            )
            if not trans_prompt and default_translation_config:
                trans_prompt = default_translation_config.get("prompt_template")

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

            # 如果没有提示词配置，跳过 AI 调用
            if not trans_prompt:
                article.translation_status = "failed"
                article.translation_error = "未配置翻译提示词，请先在配置页面设置"
                db.commit()
                return
            trans_prompt = self._build_translation_prompt(trans_prompt)

            trans_client = self.create_ai_client(ai_config)
            parameters = ai_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}
            elif not parameters and default_translation_config and not has_custom_prompt:
                parameters = default_translation_config.get("parameters") or {}
            parameters = self._merge_protocol_parameters(
                "translation",
                parameters,
            )
            pricing = {
                "model_api_config_id": ai_config.get("model_api_config_id"),
                "price_input_per_1k": ai_config.get("price_input_per_1k"),
                "price_output_per_1k": ai_config.get("price_output_per_1k"),
                "currency": ai_config.get("currency"),
            }
            article.title_trans = await self._translate_article_title(
                db=db,
                ai_client=trans_client,
                title=article.title or "",
                prompt=trans_prompt,
                parameters=parameters,
                pricing=pricing,
                article_id=article_id,
            )
            article.updated_at = now_str()
            db.commit()

            strategy_value = (strategy or "auto").strip().lower() or "auto"
            estimated_tokens = self._estimate_tokens(source_content)
            advanced_options = self._resolve_cleaning_advanced_options(
                ai_config,
                parameters,
            )

            if not advanced_options:
                try:
                    content_trans = await trans_client.translate_to_chinese(
                        source_content,
                        prompt=trans_prompt,
                        parameters=parameters,
                        max_tokens=self.DEFAULT_CLEANING_MAX_TOKENS,
                    )
                    finish_reason = (
                        content_trans.get("finish_reason")
                        if isinstance(content_trans, dict)
                        else None
                    )
                    truncated = finish_reason == "length"
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
                            finish_reason=finish_reason,
                            truncated=truncated,
                            chunk_index=None,
                            continue_round=None,
                            estimated_input_tokens=estimated_tokens,
                        )
                        content_trans = (content_trans.get("content") or "").strip()
                    else:
                        content_trans = (content_trans or "").strip()
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
                        finish_reason=None,
                        truncated=None,
                        chunk_index=None,
                        continue_round=None,
                        estimated_input_tokens=estimated_tokens,
                    )
                    raise TaskTimeoutError("翻译超时，请稍后重试")
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
                        finish_reason=None,
                        truncated=None,
                        chunk_index=None,
                        continue_round=None,
                        estimated_input_tokens=estimated_tokens,
                    )
                    raise
                if not content_trans:
                    raise TaskDataError("翻译失败：输出为空")
            else:
                should_chunk, input_budget = self._determine_cleaning_strategy(
                    estimated_tokens,
                    strategy,
                    advanced_options=advanced_options,
                )
                chunk_size_tokens = int(advanced_options["chunk_size_tokens"])
                # Recommended overlap window for translation: 120-180 tokens.
                chunk_overlap_tokens = int(advanced_options["chunk_overlap_tokens"])
                max_continue_rounds = int(advanced_options["max_continue_rounds"])
                chunks = (
                    self._chunk_markdown_content(
                        source_content,
                        chunk_size_tokens=chunk_size_tokens,
                        overlap_tokens=chunk_overlap_tokens,
                    )
                    if should_chunk
                    else [source_content]
                )
                if not chunks:
                    raise TaskDataError("翻译失败：输入内容为空")

                self._update_current_task_payload(
                    db,
                    strategy=strategy_value,
                    chunk_cursor=start_cursor,
                )

                if self.current_task_id:
                    append_task_event(
                        db,
                        task_id=self.current_task_id,
                        event_type="chunking_plan",
                        from_status=None,
                        to_status=None,
                        message=f"翻译分块计划：{len(chunks)}块",
                        details={
                            "stage": "translation",
                            "strategy": strategy_value,
                            "chunked": should_chunk,
                            "chunk_count": len(chunks),
                            "chunk_size_tokens": chunk_size_tokens,
                            "chunk_overlap_tokens": chunk_overlap_tokens,
                            "estimated_tokens": estimated_tokens,
                            "input_budget": input_budget,
                            "context_window_tokens": advanced_options.get(
                                "context_window_tokens"
                            ),
                            "reserve_output_tokens": advanced_options.get(
                                "reserve_output_tokens"
                            ),
                        },
                    )
                    db.commit()

                if start_cursor > len(chunks):
                    start_cursor = len(chunks)

                assembled = ""
                if start_cursor > 0 and article.content_trans:
                    assembled = (article.content_trans or "").strip()
                else:
                    start_cursor = 0
                    article.content_trans = None
                    article.updated_at = now_str()
                    db.commit()
                    self._update_current_task_payload(db, chunk_cursor=0)

                for index in range(start_cursor, len(chunks)):
                    translated_chunk = await self._translate_markdown_chunk(
                        db=db,
                        ai_client=trans_client,
                        chunk_content=chunks[index],
                        prompt=trans_prompt,
                        parameters=parameters,
                        pricing=pricing,
                        article_id=article_id,
                        chunk_index=index,
                        max_continue_rounds=max_continue_rounds,
                    )
                    if not translated_chunk:
                        raise TaskDataError("翻译失败：输出为空")
                    assembled = self._merge_with_overlap(assembled, translated_chunk)
                    article.content_trans = assembled
                    article.updated_at = now_str()
                    db.commit()
                    self._update_current_task_payload(db, chunk_cursor=index + 1)
                    if self.current_task_id and index + 1 < len(chunks):
                        self._enqueue_translation_chunk_continuation(
                            db,
                            article_id=article_id,
                            category_id=category_id,
                            model_config_id=model_config_id
                            or ai_config.get("model_api_config_id"),
                            prompt_config_id=prompt_config_id,
                            strategy=strategy_value,
                            chunk_cursor=index + 1,
                        )
                        return

                content_trans = self._finalize_markdown(assembled)
                if not content_trans:
                    raise TaskDataError("翻译失败：输出为空")

            article.content_trans = content_trans
            article.translation_status = "completed"
            article.translation_error = None
            article.updated_at = now_str()
            db.commit()
            if advanced_options:
                self._update_current_task_payload(db, chunk_cursor=0)
            print(f"翻译完成: {article.title}")
        except Exception as exc:
            print(f"翻译处理失败: {exc}")
            article = db.query(Article).filter(Article.id == article_id).first()
            if article:
                article.translation_status = "failed"
                article.translation_error = str(exc)
                article.updated_at = now_str()
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
