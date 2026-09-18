import asyncio
import json
import re
from typing import Any

from ai_client import is_english_content, strip_model_reasoning_noise
from models import AIAnalysis, Article, Category, ModelAPIConfig, PromptConfig, now_str
from task_errors import TaskConfigError, TaskDataError, TaskExternalError, TaskTimeoutError

from . import common
from .common import PromptOutputContract, build_parameters


class _InterpretationMixin:
    def _enabled_interpretation_fields(self, options: dict) -> list[str]:
        return [
            field
            for field in ("classification", "summary", "outline", "quotes")
            if options.get(field)
        ]

    def _build_interpretation_output_contract(
        self,
        enabled_fields: list[str],
    ) -> PromptOutputContract:
        field_names = ", ".join(
            {
                "classification": "category_id",
                "summary": "summary",
                "outline": "outline",
                "quotes": "quotes",
            }[field]
            for field in enabled_fields
        )
        system_instruction = (
            "固定输出协议：必须返回单个 JSON 对象，且只包含本次启用字段对应的字段："
            f"{field_names or '无'}。\n"
            "未启用字段禁止出现在 JSON 中。禁止解释、Markdown 代码块或额外字段。"
            "outline 启用时节点只允许 title 和 children。"
            "quotes 启用时必须返回 3-5 个字符串数组元素；每个元素是一条完整金句，"
            "禁止在字符串内添加列表符号或编号。"
        )

        # The outline is a recursive tree. Different OpenAI-compatible
        # providers support recursive response schemas inconsistently, while
        # the application already performs recursive validation and
        # normalization in _normalize_outline_node. Keep bundles containing
        # outline on the broadly supported JSON-object contract and validate
        # the payload after parsing instead of sending a fragile recursive
        # schema.
        if "outline" in enabled_fields:
            return PromptOutputContract(
                mode="json_object",
                response_format={"type": "json_object"},
                system_instruction=system_instruction,
            )

        properties: dict[str, Any] = {}
        required: list[str] = []
        if "classification" in enabled_fields:
            properties["category_id"] = {"type": "string"}
            required.append("category_id")
        if "summary" in enabled_fields:
            properties["summary"] = {"type": "string"}
            required.append("summary")
        if "quotes" in enabled_fields:
            properties["quotes"] = {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "3-5 条中文金句；每个数组元素是一条完整金句，"
                    "不要在字符串内添加列表符号、编号或解释"
                ),
            }
            required.append("quotes")
        return PromptOutputContract(
            mode="structured_json",
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "article_interpretation_bundle",
                    "schema": {
                        "type": "object",
                        "properties": properties,
                        "required": required,
                        "additionalProperties": False,
                    },
                },
            },
            system_instruction=system_instruction,
        )

    def _build_article_task_prompt(
        self,
        instruction: str,
        content_type: str,
        *,
        article: Article,
        categories_payload: str | None = None,
        category_name: str | None = None,
        content_placeholder: bool = False,
    ) -> str:
        blocks = [str(instruction or "").strip()]
        if content_type == "classification" and categories_payload:
            blocks.append(f"分类列表：\n{categories_payload}")
        output_protocol = self.SINGLE_OUTPUT_PROTOCOLS.get(content_type)
        if output_protocol:
            blocks.append(output_protocol)
        content_block = "{content}" if content_placeholder else (article.content_md or "")
        blocks.append(f"文章正文：\n{content_block}")
        return "\n\n".join(block for block in blocks if block)

    def _build_runtime_content_prompt(
        self,
        instruction: str | None,
        content_label: str,
    ) -> str | None:
        instruction_text = str(instruction or "").strip()
        if not instruction_text:
            return None
        if "{content}" in instruction_text:
            return instruction_text
        return f"{instruction_text}\n\n{content_label}：\n{{content}}"

    def _build_interpretation_prompt(
        self,
        *,
        article: Article,
        categories_payload: str,
        category_name: str | None,
        options: dict,
        instructions: dict[str, str],
    ) -> str:
        enabled_fields = self._enabled_interpretation_fields(options)
        blocks = [
            "请阅读文章正文，并一次性完成本次启用的文章 AI 解读字段。",
            "只处理启用字段；不要生成、提及或返回未启用字段。",
            "启用字段："
            + (
                "、".join(
                    self.INTERPRETATION_FIELD_LABELS.get(field, field)
                    for field in enabled_fields
                )
                if enabled_fields
                else "无"
            ),
        ]
        for field in enabled_fields:
            instruction = (instructions.get(field) or "").strip()
            if not instruction:
                continue
            label = self.INTERPRETATION_FIELD_LABELS.get(field, field)
            blocks.append(f"{label}任务要求：\n{instruction}")
            if field == "classification":
                blocks.append(f"分类列表：\n{categories_payload}")

        blocks.append("文章正文：\n{content}")
        return "\n\n".join(block for block in blocks if block)

    def _calculate_interpretation_max_tokens(
        self,
        options: dict,
        parameters: dict | None,
    ) -> int:
        enabled_fields = self._enabled_interpretation_fields(options)
        return self.INTERPRETATION_BASE_MAX_TOKENS + sum(
            self.INTERPRETATION_FIELD_MAX_TOKENS.get(field, 300)
            for field in enabled_fields
        )

    def _resolve_generation_max_tokens(
        self,
        content_type: str,
        parameters: dict | None,
    ) -> int:
        """Pick generation budget, never below type default.

        Prompt-config max_tokens is a soft preference. Reasoning models may
        spend a large share of the budget on <think> wrappers; under-budgeted
        configs (e.g. outline=1200) can produce empty JSON payloads.
        """
        default = int(self.DEFAULT_AI_CONTENT_MAX_TOKENS.get(content_type, 500))
        configured = None
        if parameters is not None and parameters.get("max_tokens") is not None:
            try:
                configured = int(parameters.get("max_tokens"))
            except (TypeError, ValueError):
                configured = None
        if configured is None or configured <= 0:
            return default
        return max(configured, default)

    def _strip_model_reasoning_noise(self, raw_text: str) -> str:
        """Remove chain-of-thought wrappers and markdown fences from model output."""
        text = strip_model_reasoning_noise(raw_text)
        if not text:
            return ""
        # Structured callers may still receive a markdown JSON fence.
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*```$", "", text)
        return text.strip()

    def _loads_json_payload(self, raw_output: Any, *, label: str) -> Any:
        if isinstance(raw_output, (dict, list)):
            return raw_output
        original_text = str(raw_output or "").strip()
        raw_text = self._strip_model_reasoning_noise(original_text)
        if not raw_text:
            if original_text and (
                "<think" in original_text.lower()
                or "<thinking" in original_text.lower()
            ):
                raise TaskDataError(
                    f"{label} 输出为空：模型只返回了思考过程未产出 JSON，"
                    "请提高 max_tokens 或更换模型后重试"
                )
            raise TaskDataError(f"{label} 输出为空")
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError:
            pass

        # Extract first top-level JSON object or array from mixed text.
        decoder = json.JSONDecoder()
        for index, char in enumerate(raw_text):
            if char not in "{[":
                continue
            try:
                parsed, _end = decoder.raw_decode(raw_text[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, (dict, list)):
                return parsed
        raise TaskDataError(f"{label} 输出不是合法 JSON")

    def _parse_structured_task_result(
        self,
        prompt_type: str,
        raw_output: Any,
    ) -> dict[str, Any]:
        parsed = self._loads_json_payload(raw_output, label=prompt_type)
        if not isinstance(parsed, dict):
            raise TaskDataError(f"{prompt_type} 输出必须是 JSON 对象")

        if prompt_type == "classification":
            category_id = parsed.get("category_id")
            if category_id is None:
                raise TaskDataError("classification 输出缺少 category_id")
            if not isinstance(category_id, str):
                raise TaskDataError("classification.category_id 必须是字符串")
            return {"category_id": category_id}


        return parsed

    def _normalize_outline_node(self, raw_node: Any) -> dict[str, Any]:
        if isinstance(raw_node, str):
            title = raw_node.strip()
            if not title:
                raise TaskDataError("outline 节点标题不能为空")
            return {"title": title, "children": []}

        if not isinstance(raw_node, dict):
            raise TaskDataError("outline 节点必须是对象或字符串")

        title_value = raw_node.get("title", "")
        if title_value is None:
            title_value = ""
        if not isinstance(title_value, str):
            raise TaskDataError("outline.title 必须是字符串")
        title = title_value.strip()

        children_value = raw_node.get("children", [])
        if children_value is None:
            children_value = []
        if not isinstance(children_value, list):
            raise TaskDataError("outline.children 必须是数组")

        children = [
            self._normalize_outline_node(child)
            for child in children_value
        ]
        if not title and not children:
            raise TaskDataError("outline 节点不能为空")
        return {"title": title, "children": children}

    def _parse_outline_task_result(self, raw_output: Any) -> str:
        parsed = self._loads_json_payload(raw_output, label="outline")

        if isinstance(parsed, list):
            normalized = {
                "title": "",
                "children": [
                    self._normalize_outline_node(child)
                    for child in parsed
                ],
            }
        elif isinstance(parsed, dict):
            normalized = self._normalize_outline_node(parsed)
        else:
            raise TaskDataError("outline 输出必须是 JSON 对象或数组")

        if not normalized["title"] and not normalized["children"]:
            raise TaskDataError("outline 输出不能为空")
        return json.dumps(normalized, ensure_ascii=False)

    def _parse_interpretation_result(
        self,
        raw_output: Any,
        enabled_fields: list[str] | None = None,
    ) -> dict[str, Any]:
        parsed = self._parse_structured_task_result("interpretation", raw_output)
        field_errors: dict[str, str] = {}
        enabled = set(
            enabled_fields
            or ("classification", "summary", "outline", "quotes")
        )

        category_id = parsed.get("category_id", "")
        if category_id is None:
            category_id = ""
        if "classification" in enabled and not isinstance(category_id, str):
            field_errors["classification"] = "interpretation.category_id 必须是字符串"
            category_id = ""

        summary = parsed.get("summary", "")
        if summary is None:
            summary = ""
        if "summary" in enabled and not isinstance(summary, str):
            field_errors["summary"] = "interpretation.summary 必须是字符串"
            summary = ""

        outline = parsed.get("outline")
        if (
            "outline" in enabled
            and outline is not None
            and not isinstance(outline, (dict, list, str))
        ):
            field_errors["outline"] = (
                "interpretation.outline 必须是对象、数组、字符串或 null"
            )
            outline = None

        quotes = parsed.get("quotes", [])
        if "quotes" in enabled and (
            not isinstance(quotes, list)
            or any(not isinstance(item, str) for item in quotes)
        ):
            field_errors["quotes"] = "interpretation.quotes 必须是字符串数组"
            quotes = []

        field_to_status = {
            "category_id": "classification",
            "summary": "summary",
            "outline": "outline",
            "quotes": "quotes",
        }
        for field_name, status_key in field_to_status.items():
            if status_key in enabled and field_name not in parsed:
                field_errors.setdefault(status_key, f"interpretation 缺少 {field_name}")

        return {
            "category_id": category_id,
            "summary": summary,
            "outline": outline,
            "quotes": quotes,
            "_field_errors": field_errors,
        }

    def _format_quotes_markdown(self, quotes: list[str]) -> str:
        lines = []
        for quote in quotes:
            text = str(quote or "").strip()
            if not text:
                continue
            text = re.sub(r"^\s*(?:[-*+]\s+|\d+[.)]\s*)", "", text).strip()
            if text:
                lines.append(f"- {text}")
        return "\n".join(lines)

    def _normalize_quotes_markdown(self, content: str | None) -> str:
        lines = [
            line.strip()
            for line in self._normalize_line_breaks(content or "").split("\n")
            if line.strip()
        ]
        return self._format_quotes_markdown(lines)

    def _mark_interpretation_fields_processing(
        self,
        analysis: AIAnalysis,
        options: dict,
    ) -> None:
        status_fields = {
            "classification": "classification_status",
            "summary": "summary_status",
            "outline": "outline_status",
            "quotes": "quotes_status",
        }
        for option_name, status_field in status_fields.items():
            setattr(
                analysis,
                status_field,
                "processing" if options.get(option_name) else "skipped",
            )
        analysis.interpretation_status = "processing"
        analysis.interpretation_error = None
        analysis.error_message = None
        analysis.updated_at = now_str()

    def _mark_interpretation_fields_failed(
        self,
        analysis: AIAnalysis,
        options: dict,
        error_message: str,
    ) -> None:
        for option_name, status_field in {
            "classification": "classification_status",
            "summary": "summary_status",
            "outline": "outline_status",
            "quotes": "quotes_status",
        }.items():
            setattr(
                analysis,
                status_field,
                "failed" if options.get(option_name) else "skipped",
            )
        analysis.interpretation_status = "failed"
        analysis.interpretation_error = error_message
        analysis.error_message = error_message
        analysis.updated_at = now_str()

    def _apply_interpretation_result(
        self,
        db,
        article: Article,
        analysis: AIAnalysis,
        parsed_result: dict[str, Any],
        options: dict,
        *,
        source_task_id: str | None,
        source_model_config_id: str | None,
        source_prompt_config_id: str | dict[str, str] | None,
    ) -> dict[str, str]:
        field_statuses: dict[str, str] = {}
        field_errors = parsed_result.get("_field_errors") or {}

        if options.get("classification"):
            category_output = (parsed_result.get("category_id") or "").strip()
            if field_errors.get("classification"):
                analysis.classification_status = "failed"
                field_statuses["classification"] = "failed"
            elif category_output:
                category = db.query(Category).filter(Category.id == category_output).first()
                if category:
                    article.category_id = category.id
                    analysis.classification_status = "completed"
                    field_statuses["classification"] = "completed"
                else:
                    analysis.classification_status = "failed"
                    field_statuses["classification"] = "failed"
            else:
                analysis.classification_status = "failed"
                field_statuses["classification"] = "failed"
        else:
            analysis.classification_status = "skipped"
            field_statuses["classification"] = "skipped"

        if options.get("summary"):
            summary = (parsed_result.get("summary") or "").strip()
            if field_errors.get("summary"):
                analysis.summary_status = "failed"
                field_statuses["summary"] = "failed"
            elif summary:
                analysis.summary = summary
                analysis.summary_status = "completed"
                self.article_ai_version_service.record_version(
                    db,
                    article_id=article.id,
                    content_type="summary",
                    source_task_id=source_task_id,
                    source_model_config_id=source_model_config_id,
                    source_prompt_config_id=(
                        source_prompt_config_id.get("summary")
                        if isinstance(source_prompt_config_id, dict)
                        else source_prompt_config_id
                    ),
                )
                field_statuses["summary"] = "completed"
            else:
                analysis.summary_status = "failed"
                field_statuses["summary"] = "failed"
        else:
            analysis.summary_status = "skipped"
            field_statuses["summary"] = "skipped"

        if options.get("outline"):
            outline = parsed_result.get("outline")
            if field_errors.get("outline"):
                analysis.outline_status = "failed"
                field_statuses["outline"] = "failed"
            elif outline is not None:
                try:
                    analysis.outline = self._parse_outline_task_result(outline)
                    analysis.outline_status = "completed"
                    self.article_ai_version_service.record_version(
                        db,
                        article_id=article.id,
                        content_type="outline",
                        source_task_id=source_task_id,
                        source_model_config_id=source_model_config_id,
                        source_prompt_config_id=(
                            source_prompt_config_id.get("outline")
                            if isinstance(source_prompt_config_id, dict)
                            else source_prompt_config_id
                        ),
                    )
                    field_statuses["outline"] = "completed"
                except Exception:
                    analysis.outline_status = "failed"
                    field_statuses["outline"] = "failed"
            else:
                analysis.outline_status = "failed"
                field_statuses["outline"] = "failed"
        else:
            analysis.outline_status = "skipped"
            field_statuses["outline"] = "skipped"

        if options.get("quotes"):
            quotes = [
                quote.strip()
                for quote in (parsed_result.get("quotes") or [])
                if isinstance(quote, str) and quote.strip()
            ]
            if field_errors.get("quotes"):
                analysis.quotes_status = "failed"
                field_statuses["quotes"] = "failed"
            elif quotes:
                analysis.quotes = self._format_quotes_markdown(quotes)
                analysis.quotes_status = "completed"
                self.article_ai_version_service.record_version(
                    db,
                    article_id=article.id,
                    content_type="quotes",
                    source_task_id=source_task_id,
                    source_model_config_id=source_model_config_id,
                    source_prompt_config_id=(
                        source_prompt_config_id.get("quotes")
                        if isinstance(source_prompt_config_id, dict)
                        else source_prompt_config_id
                    ),
                )
                field_statuses["quotes"] = "completed"
            else:
                analysis.quotes_status = "failed"
                field_statuses["quotes"] = "failed"
        else:
            analysis.quotes_status = "skipped"
            field_statuses["quotes"] = "skipped"

        enabled_statuses = [
            status
            for field, status in field_statuses.items()
            if options.get(field)
        ]
        if not enabled_statuses:
            analysis.interpretation_status = "skipped"
        elif all(status == "skipped" for status in enabled_statuses):
            analysis.interpretation_status = "skipped"
        elif all(status in {"completed", "skipped"} for status in enabled_statuses):
            analysis.interpretation_status = "completed"
        elif any(status == "completed" for status in enabled_statuses):
            analysis.interpretation_status = "partial_completed"
        else:
            analysis.interpretation_status = "failed"
        failed_messages = [
            field_errors.get(field)
            for field, status in field_statuses.items()
            if status == "failed" and field_errors.get(field)
        ]
        if failed_messages:
            analysis.interpretation_error = "; ".join(failed_messages)
            analysis.error_message = analysis.interpretation_error
        else:
            analysis.interpretation_error = None
            analysis.error_message = None
        analysis.updated_at = now_str()
        article.updated_at = now_str()
        return field_statuses

    async def process_article_interpretation(
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

            analysis = common._ensure_analysis(db, article)
            options = self._normalize_post_process_options(post_process_options)
            self._mark_interpretation_fields_processing(
                analysis,
                options,
            )
            db.commit()

            _, source_content = self.normalize_source_content(article)
            if not source_content:
                self._mark_interpretation_fields_failed(
                    analysis,
                    options,
                    "文章内容为空，无法生成 AI 解读",
                )
                db.commit()
                raise TaskDataError("文章内容为空，无法生成 AI 解读")

            interpretation_config = None
            enabled_fields = self._enabled_interpretation_fields(options)
            prompt_type_priority = [
                field
                for field in ("summary", "outline", "quotes", "classification")
                if field in enabled_fields
            ]
            prompt_configs: dict[str, PromptConfig] = {}
            missing_prompt_fields: list[str] = []
            for field in enabled_fields:
                prompt_config = self._get_prompt_config(
                    db,
                    category_id=category_id,
                    prompt_type=field,
                )
                if not prompt_config or not (prompt_config.prompt or "").strip():
                    missing_prompt_fields.append(
                        self.INTERPRETATION_FIELD_LABELS.get(field, field)
                    )
                    continue
                prompt_configs[field] = prompt_config

            if missing_prompt_fields:
                self._mark_interpretation_fields_failed(
                    analysis,
                    options,
                    "未配置文章解读任务要求：" + "、".join(missing_prompt_fields),
                )
                db.commit()
                raise TaskConfigError(
                    "未配置文章解读任务要求：" + "、".join(missing_prompt_fields)
                )

            primary_prompt_type = prompt_type_priority[0] if prompt_type_priority else None
            primary_prompt_config = (
                prompt_configs.get(primary_prompt_type) if primary_prompt_type else None
            )
            default_config = (
                self.get_ai_config(db, category_id, prompt_type=primary_prompt_type)
                if primary_prompt_type
                else None
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
                interpretation_config = {
                    "base_url": model_config.base_url,
                    "api_key": model_config.api_key,
                    "model_name": model_config.model_name,
                    "model_api_config_id": model_config.id,
                    "api_type": model_config.api_type or "chat_completions",
                    "price_input_per_1k": model_config.price_input_per_1k,
                    "price_output_per_1k": model_config.price_output_per_1k,
                    "currency": model_config.currency,
                    "parameters": build_parameters(primary_prompt_config)
                    if primary_prompt_config
                    else None,
                }

            if not interpretation_config:
                interpretation_config = default_config

            if not interpretation_config:
                self._mark_interpretation_fields_failed(
                    analysis,
                    options,
                    "未配置AI服务，请先在配置页面设置AI参数",
                )
                db.commit()
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")

            categories = db.query(Category).order_by(Category.sort_order).all()
            categories_payload = "\n".join(
                [
                    f"- {category.id} | {category.name} | {category.description or ''}".strip()
                    for category in categories
                ]
            )
            category_name = article.category.name if article.category else ""
            prompt = self._build_interpretation_prompt(
                article=article,
                categories_payload=categories_payload,
                category_name=category_name,
                options=options,
                instructions={
                    field: prompt_config.prompt
                    for field, prompt_config in prompt_configs.items()
                },
            )
            parameters = interpretation_config.get("parameters") or {}
            if not parameters and primary_prompt_config:
                parameters = build_parameters(primary_prompt_config)
            max_tokens = self._calculate_interpretation_max_tokens(options, parameters)
            parameters.pop("max_tokens", None)
            parameters.pop("system_prompt", None)
            parameters = self._merge_parameters_with_contract(
                parameters,
                self._build_interpretation_output_contract(enabled_fields),
            )
            ai_client = self.create_ai_client(interpretation_config)
            pricing = {
                "model_api_config_id": interpretation_config.get("model_api_config_id"),
                "price_input_per_1k": interpretation_config.get("price_input_per_1k"),
                "price_output_per_1k": interpretation_config.get("price_output_per_1k"),
                "currency": interpretation_config.get("currency"),
            }

            try:
                result = await self.ai_invocation_service.invoke_generation(
                    db=db,
                    api_type=interpretation_config.get("api_type") or "chat_completions",
                    model_name=interpretation_config["model_name"],
                    base_url=interpretation_config["base_url"],
                    api_key=interpretation_config["api_key"],
                    system_prompt=parameters.get("system_prompt"),
                    user_prompt=prompt.replace("{content}", source_content)
                    if "{content}" in prompt
                    else f"{prompt}\n\n{source_content}",
                    article_id=article_id,
                    task_type="process_article_interpretation",
                    content_type="interpretation",
                    task_id=self.current_task_id,
                    client=ai_client,
                    content=source_content,
                    prompt=prompt,
                    parameters=parameters,
                    max_tokens=max_tokens,
                    request_context={
                        "parameters": parameters,
                        "post_process_options": options,
                        "max_tokens": max_tokens,
                    },
                )
                raw_content = result.get("content") if isinstance(result, dict) else result
                parsed_result = self._parse_interpretation_result(
                    raw_content,
                    enabled_fields=enabled_fields,
                )
                field_statuses = self._apply_interpretation_result(
                    db,
                    article,
                    analysis,
                    parsed_result,
                    options,
                    source_task_id=self.current_task_id,
                    source_model_config_id=interpretation_config.get(
                        "model_api_config_id"
                    ),
                    source_prompt_config_id={
                        field: prompt_config.id
                        for field, prompt_config in prompt_configs.items()
                    },
                )
                response_payload = (
                    result.get("response_payload") if isinstance(result, dict) else None
                )
                if isinstance(response_payload, dict):
                    response_payload = {
                        **response_payload,
                        "field_statuses": field_statuses,
                        "interpretation_status": analysis.interpretation_status,
                    }
                else:
                    response_payload = {
                        "raw_response_payload": response_payload,
                        "field_statuses": field_statuses,
                        "interpretation_status": analysis.interpretation_status,
                    }
                usage_log = self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_interpretation",
                    content_type="interpretation",
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
                    response_payload=response_payload,
                )
                self.ai_call_session_service.create_session(
                    db,
                    usage_log_id=usage_log.id,
                    task_id=self.current_task_id,
                    article_id=article_id,
                    task_type="process_article_interpretation",
                    content_type="interpretation",
                    session_info=result.get("session_info") if isinstance(result, dict) else {},
                )
                if field_statuses.get("summary") == "completed":
                    self._enqueue_summary_completed_hooks(db, article_id)
            except asyncio.TimeoutError as exc:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_interpretation",
                    content_type="interpretation",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message="AI生成超时，请稍后重试",
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                self._mark_interpretation_fields_failed(
                    analysis,
                    options,
                    "AI生成超时，请稍后重试",
                )
                db.commit()
                raise TaskTimeoutError("AI生成超时，请稍后重试") from exc
            except Exception as exc:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_interpretation",
                    content_type="interpretation",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(exc),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                self._mark_interpretation_fields_failed(
                    analysis,
                    options,
                    str(exc),
                )
                db.commit()
                if isinstance(exc, (TaskConfigError, TaskDataError, TaskExternalError)):
                    raise
                raise TaskExternalError(str(exc)) from exc

            effective_category_id = article.category_id or category_id
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
                self._update_article_completed_if_ready(db, article, analysis)
                db.commit()
        finally:
            db.close()
