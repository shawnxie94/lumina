import asyncio
from dataclasses import dataclass
from difflib import SequenceMatcher
import json
import logging
import re
from html import unescape
from typing import Any
from xml.etree import ElementTree as ET

from ai_client import ConfigurableAIClient, is_english_content
from media_service import maybe_ingest_article_images_with_stats
from sqlalchemy import or_
from app.core.public_cache import (
    CACHE_KEY_TAGS_PUBLIC,
    invalidate_public_cache,
    invalidate_public_rss_cache,
)
from app.domain.article_embedding_service import ArticleEmbeddingService
from app.domain.ai_call_session_service import AICallSessionService
from app.domain.ai_invocation_service import AIInvocationService
from app.domain.article_digest import (
    build_prefill_material,
    join_digest_lines,
    parse_digest_prefill_result,
)
from app.domain.article_tag_service import ArticleTagService
from app.domain.article_ai_version_service import ArticleAIVersionService
from models import (
    AIAnalysis,
    AITask,
    AIUsageLog,
    Article,
    Category,
    ModelAPIConfig,
    PromptConfig,
    SessionLocal,
    now_str,
)
from task_state import append_task_event
from task_errors import TaskConfigError, TaskDataError, TaskExternalError, TaskTimeoutError


logger = logging.getLogger("article_ai_pipeline")
VIDEO_URL_PATTERN = re.compile(
    r"(youtube\.com|youtu\.be|bilibili\.com|vimeo\.com|"
    r"\.(mp4|webm|mov|m4v|ogv|ogg)(\?.*)?$)",
    re.IGNORECASE,
)
AUDIO_URL_PATTERN = re.compile(
    r"\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?.*)?$",
    re.IGNORECASE,
)
BOOK_URL_PATTERN = re.compile(
    r"\.(pdf|epub|mobi)(\?.*)?$",
    re.IGNORECASE,
)
article_tag_service = ArticleTagService()


@dataclass(frozen=True)
class PromptOutputContract:
    mode: str
    response_format: dict[str, Any] | str | None
    system_instruction: str | None = None


def build_parameters(model) -> dict:
    if not model:
        return {}
    params = {}
    system_prompt = getattr(model, "system_prompt", None)
    response_format = getattr(model, "response_format", None)
    temperature = getattr(model, "temperature", None)
    max_tokens = getattr(model, "max_tokens", None)
    top_p = getattr(model, "top_p", None)
    chunk_size_tokens = getattr(model, "chunk_size_tokens", None)
    chunk_overlap_tokens = getattr(model, "chunk_overlap_tokens", None)
    max_continue_rounds = getattr(model, "max_continue_rounds", None)
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
    if chunk_size_tokens is not None:
        params["chunk_size_tokens"] = chunk_size_tokens
    if chunk_overlap_tokens is not None:
        params["chunk_overlap_tokens"] = chunk_overlap_tokens
    if max_continue_rounds is not None:
        params["max_continue_rounds"] = max_continue_rounds
    return params


class ArticleAIPipelineService:
    DEFAULT_SAFETY_MARGIN_TOKENS = 1000
    DEFAULT_CLEANING_MAX_TOKENS = 16000
    SUPPORTED_AI_CONTENT_TYPES = {"summary", "outline", "quotes", "digest_prefill"}
    DEFAULT_AI_CONTENT_MAX_TOKENS = {
        "summary": 500,
        "outline": 3000,
        "quotes": 800,
        "digest_prefill": 1000,
    }
    INTERPRETATION_FIELD_MAX_TOKENS = {
        "classification": 200,
        "tagging": 300,
        "summary": 500,
        "outline": 3000,
        "quotes": 800,
    }
    INTERPRETATION_BASE_MAX_TOKENS = 300
    INTERPRETATION_FIELD_LABELS = {
        "classification": "分类",
        "tagging": "标签",
        "summary": "摘要",
        "outline": "大纲",
        "quotes": "金句",
    }
    SINGLE_OUTPUT_PROTOCOLS = {
        "summary": (
            "输出协议：\n"
            "1) 只输出摘要正文，不要输出标题、解释、Markdown 代码块或额外前后缀。\n"
            "2) 摘要应为中文、客观、可直接展示给读者。"
        ),
        "outline": (
            "输出协议：\n"
            "1) 只输出一个 JSON 对象，禁止 Markdown 代码块、解释或额外文本。\n"
            "2) 每个节点只允许 title 和 children；title 必须是字符串，children 必须是数组。\n"
            "3) children 为空时返回空数组。"
        ),
        "quotes": (
            "输出协议：\n"
            "1) 使用 Markdown 无序列表（-），每行输出一条金句，数量 3-5 条。\n"
            "2) 禁止输出解释、标题、编号、Markdown 代码块或额外前后缀。"
        ),
        "digest_prefill": (
            "输出协议：\n"
            "1) 只输出单个 JSON 对象，键必须为 line1..line6。\n"
            "2) 六句都必须是完整批注句，不得只填空槽 ____。\n"
            "3) 禁止 Markdown 代码块、解释或额外字段。"
        ),
        "classification": (
            "输出协议：\n"
            "1) 只返回协议要求的分类结果，不要输出解释、Markdown 代码块或额外字段。\n"
            "2) category_id 只能来自分类列表；无合适分类时返回空字符串。"
        ),
        "tagging": (
            "输出协议：\n"
            "1) 只返回协议要求的标签结果，不要输出解释、Markdown 代码块或额外字段。\n"
            "2) tags 必须是 3-5 个具体、稳定、可检索的中文标签；无合适标签时返回空数组。"
        ),
    }
    STRUCTURED_OUTPUT_CONTRACTS = {
        "summary": PromptOutputContract(mode="text", response_format=None),
        "translation": PromptOutputContract(mode="text", response_format=None),
        "quotes": PromptOutputContract(mode="text", response_format=None),
        "digest_prefill": PromptOutputContract(
            mode="json_object",
            response_format={"type": "json_object"},
            system_instruction=(
                "固定输出协议：必须返回单个 JSON 对象，键为 line1,line2,line3,line4,line5,line6。"
                "六句都必须填写完整、非空内容；禁止只输出空槽 ____。"
                "禁止输出解释、Markdown 代码块或额外字段。"
            ),
        ),
        "content_cleaning": PromptOutputContract(
            mode="markdown_text",
            response_format=None,
        ),
        "outline": PromptOutputContract(
            mode="json_object",
            response_format={"type": "json_object"},
            system_instruction=(
                "固定输出协议：必须返回单个 JSON 对象；每个节点仅允许包含 title 和 children。"
                "title 必须是字符串；children 必须是数组；禁止输出解释、Markdown 代码块或额外字段。"
                "禁止输出思考过程、推理步骤或 <think> 标签；第一个字符必须是 { 或 [。"
            ),
        ),
        "classification": PromptOutputContract(
            mode="structured_json",
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "article_classification_result",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "category_id": {
                                "type": "string",
                                "description": "分类ID，无匹配时为空字符串",
                            }
                        },
                        "required": ["category_id"],
                        "additionalProperties": False,
                    },
                },
            },
            system_instruction=(
                "固定输出协议：必须返回单个 JSON 对象，且只包含 category_id 字段。\n"
                "示例：{\"category_id\": \"abc123\"} 或 {\"category_id\": \"\"}\n"
                "category_id 必须是字符串；无匹配时返回空字符串；禁止输出解释、Markdown 代码块或额外字段。"
            ),
        ),
        "tagging": PromptOutputContract(
            mode="structured_json",
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "article_tagging_result",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "tags": {
                                "type": "array",
                                "items": {"type": "string"},
                            }
                        },
                        "required": ["tags"],
                        "additionalProperties": False,
                    },
                },
            },
            system_instruction=(
                "固定输出协议：必须返回单个 JSON 对象，且只包含 tags 字段。\n"
                "示例：{\"tags\": [\"标签1\", \"标签2\", \"标签3\"]}\n"
                "tags 必须是字符串数组；禁止输出解释、Markdown 代码块或额外字段。"
            ),
        ),
    }

    def __init__(
        self,
        current_task_id: str | None = None,
        enqueue_task_func=None,
    ):
        self.current_task_id = current_task_id
        self.enqueue_task_func = enqueue_task_func
        self.article_ai_version_service = ArticleAIVersionService()
        self.ai_invocation_service = AIInvocationService()
        self.ai_call_session_service = AICallSessionService()

    def _enqueue_task(self, db, **kwargs):
        if self.enqueue_task_func:
            return self.enqueue_task_func(db, **kwargs)
        from app.domain.ai_task_service import AITaskService

        return AITaskService().enqueue_task(db, **kwargs)

    def _normalize_post_process_options(self, options: dict | None) -> dict:
        if not isinstance(options, dict):
            return {
                "classification": True,
                "summary": True,
                "outline": True,
                "quotes": False,
                "tagging": True,
                "translation": True,
            }
        return {
            "classification": bool(options.get("classification")),
            "summary": bool(options.get("summary")),
            "outline": bool(options.get("outline")),
            "quotes": bool(options.get("quotes")),
            "tagging": bool(options.get("tagging")),
            "translation": bool(options.get("translation")),
        }

    def _enqueue_post_validation_tasks(
        self,
        db,
        article: Article,
        category_id: str | None,
        post_process_options: dict | None,
    ) -> None:
        options = self._normalize_post_process_options(post_process_options)
        article.status = "completed"
        article.updated_at = now_str()
        db.commit()

        interpretation_fields = (
            "classification",
            "tagging",
            "summary",
            "outline",
            "quotes",
        )
        if any(options.get(field) for field in interpretation_fields):
            analysis = article_tag_service.ensure_analysis(db, article)
            analysis.interpretation_status = "pending"
            analysis.interpretation_error = None
            analysis.updated_at = now_str()
            db.commit()
            self._enqueue_task(
                db,
                task_type="process_article_interpretation",
                article_id=article.id,
                content_type="interpretation",
                payload={
                    "category_id": category_id,
                    "post_process_options": options,
                },
            )
            return

        if options.get("classification"):
            self._enqueue_task(
                db,
                task_type="process_article_classification",
                article_id=article.id,
                content_type="classification",
                payload={
                    "category_id": category_id,
                    "post_process_options": options,
                },
            )
            return

        if options.get("tagging"):
            self._enqueue_task(
                db,
                task_type="process_article_tagging",
                article_id=article.id,
                content_type="tagging",
                payload={"category_id": category_id},
            )
        if options.get("summary"):
            self._enqueue_task(
                db,
                task_type="process_ai_content",
                article_id=article.id,
                content_type="summary",
                payload={"category_id": category_id},
            )
        for content_type in ("outline", "quotes"):
            if options.get(content_type):
                self._enqueue_task(
                    db,
                    task_type="process_ai_content",
                    article_id=article.id,
                    content_type=content_type,
                    payload={"category_id": category_id},
                )
        if options.get("translation") and article.content_md and is_english_content(
            article.content_md
        ):
            article.translation_status = "pending"
            article.translation_error = None
            article.updated_at = now_str()
            db.commit()
            self._enqueue_task(
                db,
                task_type="process_article_translation",
                article_id=article.id,
                content_type="translation",
                payload={"category_id": category_id},
            )
        else:
            article.translation_status = "skipped"
            article.translation_error = None
            article.updated_at = now_str()
            db.commit()

    async def _accept_cleaned_article_content(
        self,
        db,
        article: Article,
        ai_analysis: AIAnalysis,
        cleaned_md: str,
        category_id: str | None,
        post_process_options: dict | None,
    ) -> None:
        article.content_md = cleaned_md
        article.updated_at = now_str()
        ai_analysis.error_message = None
        ai_analysis.cleaned_md_draft = None
        ai_analysis.updated_at = now_str()
        db.commit()
        try:
            ingest_stats = await maybe_ingest_article_images_with_stats(db, article)
            self._append_media_ingest_event(
                db, ingest_stats, stage="cleaning_completed"
            )
        except Exception as exc:
            logger.warning("article_images_ingest_failed: %s", str(exc))
            self._append_media_ingest_event(
                db,
                {"total": 0, "success": 0, "failed": 0, "updated": False},
                stage="cleaning_completed_error",
            )

        self._enqueue_post_validation_tasks(
            db,
            article,
            category_id,
            post_process_options,
        )

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
            or_(
                ModelAPIConfig.model_type.is_(None),
                ModelAPIConfig.model_type != "vector",
            ),
        )
        prompt_config = self._get_prompt_config(
            db, category_id=category_id, prompt_type=prompt_type
        )

        model_config = None
        if prompt_config and prompt_config.model_api_config_id:
            bound_model = (
                db.query(ModelAPIConfig)
                .filter(ModelAPIConfig.id == prompt_config.model_api_config_id)
                .first()
            )
            if not bound_model:
                raise TaskConfigError("提示词绑定的模型不存在，请检查模型配置")
            if not bound_model.is_enabled:
                raise TaskConfigError("提示词绑定的模型已禁用，请启用后再试")
            self._assert_general_model(bound_model)
            model_config = bound_model

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
            "api_type": model_config.api_type or "chat_completions",
            "price_input_per_1k": model_config.price_input_per_1k,
            "price_output_per_1k": model_config.price_output_per_1k,
            "currency": model_config.currency,
            "context_window_tokens": model_config.context_window_tokens,
            "reserve_output_tokens": model_config.reserve_output_tokens,
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
            api_type=config.get("api_type") or "chat_completions",
        )

    def _get_prompt_output_contract(self, prompt_type: str) -> PromptOutputContract:
        return self.STRUCTURED_OUTPUT_CONTRACTS.get(
            prompt_type,
            PromptOutputContract(mode="text", response_format=None),
        )

    def _merge_protocol_parameters(
        self,
        prompt_type: str,
        parameters: dict | None,
    ) -> dict:
        contract = self._get_prompt_output_contract(prompt_type)
        return self._merge_parameters_with_contract(parameters, contract)

    def _merge_parameters_with_contract(
        self,
        parameters: dict | None,
        contract: PromptOutputContract,
    ) -> dict:
        merged = dict(parameters or {})
        if contract.response_format is not None:
            merged["response_format"] = contract.response_format
        if contract.system_instruction:
            existing_system_prompt = str(merged.get("system_prompt") or "").strip()
            protocol_block = (
                "固定输出协议（系统注入，不可配置）：\n"
                f"{contract.system_instruction}"
            )
            if existing_system_prompt:
                merged["system_prompt"] = (
                    f"{existing_system_prompt}\n\n{protocol_block}"
                )
            else:
                merged["system_prompt"] = protocol_block
        # Structured JSON outputs need tokens for the payload itself. MiniMax-M3
        # defaults to adaptive thinking which can exhaust max_tokens on <think>
        # only. Prefer disabling thinking unless the prompt config overrides.
        if (
            contract.mode in {"json_object", "structured_json"}
            and "thinking" not in merged
            and "disable_thinking" not in merged
        ):
            merged["disable_thinking"] = True
        return merged

    def _enabled_interpretation_fields(self, options: dict) -> list[str]:
        return [
            field
            for field in ("classification", "tagging", "summary", "outline", "quotes")
            if options.get(field)
        ]

    def _build_interpretation_output_contract(
        self,
        enabled_fields: list[str],
    ) -> PromptOutputContract:
        properties: dict[str, Any] = {}
        required: list[str] = []
        if "classification" in enabled_fields:
            properties["category_id"] = {"type": "string"}
            required.append("category_id")
        if "tagging" in enabled_fields:
            properties["tags"] = {"type": "array", "items": {"type": "string"}}
            required.append("tags")
        if "summary" in enabled_fields:
            properties["summary"] = {"type": "string"}
            required.append("summary")
        if "outline" in enabled_fields:
            properties["outline"] = {
                "anyOf": [
                    {"type": "null"},
                    {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "children": {"type": "array"},
                        },
                        "required": ["title", "children"],
                        "additionalProperties": False,
                    },
                ]
            }
            required.append("outline")
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

        field_names = ", ".join(properties) if properties else "无"
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
            system_instruction=(
                "固定输出协议：必须返回单个 JSON 对象，且只包含本次启用字段对应的字段："
                f"{field_names}。\n"
                "未启用字段禁止出现在 JSON 中。禁止解释、Markdown 代码块或额外字段。"
                "outline 启用时节点只允许 title 和 children。"
                "quotes 启用时必须返回 3-5 个字符串数组元素；每个元素是一条完整金句，"
                "禁止在字符串内添加列表符号或编号。"
            ),
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
        if content_type == "tagging" and category_name:
            blocks.append(f"参考分类：{category_name}")
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
            elif field == "tagging" and category_name:
                blocks.append(f"参考分类：{category_name}")

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
        text = str(raw_text or "").strip()
        if not text:
            return ""
        # Common thinking wrappers from reasoning-capable models.
        text = re.sub(
            r"<think>.*?</(?:think|thinking)>",
            "",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        text = re.sub(
            r"<thinking>.*?</thinking>",
            "",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        # Unclosed think block (model hit max_tokens mid-reasoning).
        text = re.sub(
            r"<think(?:ing)?>.*$",
            "",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        text = text.strip()
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

        if prompt_type == "tagging":
            tags = parsed.get("tags")
            if not isinstance(tags, list):
                raise TaskDataError("tagging.tags 必须是字符串数组")
            if any(not isinstance(item, str) for item in tags):
                raise TaskDataError("tagging.tags 必须是字符串数组")
            return {"tags": tags}

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
            or ("classification", "tagging", "summary", "outline", "quotes")
        )

        category_id = parsed.get("category_id", "")
        if category_id is None:
            category_id = ""
        if "classification" in enabled and not isinstance(category_id, str):
            field_errors["classification"] = "interpretation.category_id 必须是字符串"
            category_id = ""

        tags = parsed.get("tags", [])
        if "tagging" in enabled and (
            not isinstance(tags, list) or any(not isinstance(item, str) for item in tags)
        ):
            field_errors["tagging"] = "interpretation.tags 必须是字符串数组"
            tags = []

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
            "tags": "tagging",
            "summary": "summary",
            "outline": "outline",
            "quotes": "quotes",
        }
        for field_name, status_key in field_to_status.items():
            if status_key in enabled and field_name not in parsed:
                field_errors.setdefault(status_key, f"interpretation 缺少 {field_name}")

        return {
            "category_id": category_id,
            "tags": tags,
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
        *,
        force_tagging: bool = False,
    ) -> None:
        status_fields = {
            "classification": "classification_status",
            "tagging": "tagging_status",
            "summary": "summary_status",
            "outline": "outline_status",
            "quotes": "quotes_status",
        }
        for option_name, status_field in status_fields.items():
            if (
                option_name == "tagging"
                and bool(analysis.tagging_manual_override)
                and not force_tagging
            ):
                continue
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
        *,
        force_tagging: bool = False,
    ) -> None:
        for option_name, status_field in {
            "classification": "classification_status",
            "tagging": "tagging_status",
            "summary": "summary_status",
            "outline": "outline_status",
            "quotes": "quotes_status",
        }.items():
            if (
                option_name == "tagging"
                and bool(analysis.tagging_manual_override)
                and not force_tagging
            ):
                continue
            setattr(
                analysis,
                status_field,
                "failed" if options.get(option_name) else "skipped",
            )
        analysis.interpretation_status = "failed"
        analysis.interpretation_error = error_message
        analysis.error_message = error_message
        analysis.updated_at = now_str()

    def _enqueue_summary_completed_hooks(self, db, article_id: str) -> None:
        if ArticleEmbeddingService().has_available_remote_config(db):
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
        force_tagging: bool = False,
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

        if options.get("tagging"):
            if bool(analysis.tagging_manual_override) and not force_tagging:
                field_statuses["tagging"] = (
                    "completed"
                    if analysis.tagging_status == "completed"
                    else (analysis.tagging_status or "skipped")
                )
            elif field_errors.get("tagging"):
                analysis.tagging_status = "failed"
                field_statuses["tagging"] = "failed"
            else:
                tag_names = article_tag_service.parse_tag_names(parsed_result.get("tags"))
                if tag_names:
                    article_tag_service.set_article_tags(
                        db,
                        article,
                        tag_names,
                        manual_override=False,
                        tagging_status="completed",
                        source_hash=article_tag_service.get_tagging_source_hash(article),
                    )
                    invalidate_public_cache(CACHE_KEY_TAGS_PUBLIC)
                    invalidate_public_rss_cache()
                    field_statuses["tagging"] = "completed"
                else:
                    analysis.tagging_status = "failed"
                    field_statuses["tagging"] = "failed"
        else:
            analysis.tagging_status = "skipped"
            field_statuses["tagging"] = "skipped"

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
        finish_reason: str | None = None,
        truncated: bool | None = None,
        chunk_index: int | None = None,
        continue_round: int | None = None,
        estimated_input_tokens: int | None = None,
    ) -> AIUsageLog:
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

        usage_log = AIUsageLog(
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
            finish_reason=finish_reason,
            truncated=truncated,
            chunk_index=chunk_index,
            continue_round=continue_round,
            estimated_input_tokens=estimated_input_tokens,
            error_message=error_message,
            request_payload=normalize_payload(request_payload),
            response_payload=normalize_payload(response_payload),
            created_at=now_str(),
        )
        db.add(usage_log)
        db.flush()
        return usage_log

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

    def _normalize_line_breaks(self, text: str) -> str:
        return (text or "").replace("\r\n", "\n").replace("\r", "\n")

    def _strip_html_tags(self, html_text: str) -> str:
        text = re.sub(r"<[^>]+>", " ", html_text or "")
        text = unescape(text)
        text = re.sub(r"[ \t\f\v]+", " ", text)
        text = re.sub(r"\n[ \t]+", "\n", text)
        return text.strip()

    def _extract_attr(self, raw_attrs: str, attr_name: str) -> str:
        if not raw_attrs:
            return ""
        match = re.search(
            rf"""{attr_name}\s*=\s*(['"])(.*?)\1""",
            raw_attrs,
            re.IGNORECASE | re.DOTALL,
        )
        if match:
            return unescape(match.group(2).strip())
        match = re.search(
            rf"""{attr_name}\s*=\s*([^\s>]+)""",
            raw_attrs,
            re.IGNORECASE,
        )
        if match:
            return unescape(match.group(1).strip())
        return ""

    def _normalize_media_url(self, url: str) -> str:
        normalized = (url or "").strip()
        if not normalized:
            return ""
        normalized = re.sub(r"^<|>$", "", normalized)
        normalized = re.sub(r"[),.;:!?]+$", "", normalized)
        return normalized

    def _detect_media_kind(self, url: str) -> str | None:
        normalized = self._normalize_media_url(url)
        if not normalized:
            return None
        if AUDIO_URL_PATTERN.search(normalized):
            return "audio"
        if VIDEO_URL_PATTERN.search(normalized):
            return "video"
        if BOOK_URL_PATTERN.search(normalized):
            return "book"
        return None

    def _build_media_markdown_link(
        self,
        kind: str,
        url: str,
        title: str | None = None,
    ) -> str:
        normalized_url = self._normalize_media_url(url)
        if not normalized_url:
            return ""
        normalized_title = self._strip_html_tags(title or "").strip()
        if not normalized_title:
            if kind == "video":
                normalized_title = "视频"
            elif kind == "audio":
                normalized_title = "音频"
            else:
                normalized_title = "书籍"
        if kind == "video":
            marker = "▶"
        elif kind == "audio":
            marker = "🎧"
        else:
            marker = "📚"
        return f"[{marker} {normalized_title}]({normalized_url})"

    def _extract_source_from_media_inner(self, inner_html: str) -> str:
        if not inner_html:
            return ""
        source_match = re.search(r"<source\b([^>]*)>", inner_html, re.IGNORECASE)
        if not source_match:
            return ""
        return self._extract_attr(source_match.group(1), "src")

    def _mathml_local_name(self, tag: str) -> str:
        if not tag:
            return ""
        name = tag
        if "}" in name:
            name = name.split("}", 1)[1]
        if ":" in name:
            name = name.split(":", 1)[1]
        return name.lower()

    def _normalize_math_operator(self, text: str) -> str:
        mapping = {
            "−": "-",
            "–": "-",
            "—": "-",
            "∗": r"\cdot ",
            "·": r"\cdot ",
            "×": r"\times ",
            "÷": r"\div ",
            "≤": r"\le ",
            "≥": r"\ge ",
            "≠": r"\neq ",
            "≈": r"\approx ",
            "∞": r"\infty ",
        }
        return mapping.get(text, text)

    def _wrap_latex_group(self, value: str) -> str:
        text = (value or "").strip()
        if not text:
            return ""
        if text.startswith("{") and text.endswith("}"):
            return text
        return "{" + text + "}"

    def _mathml_element_to_latex(self, element: ET.Element) -> str:
        tag = self._mathml_local_name(element.tag)
        text = (element.text or "").strip()
        children = list(element)

        if tag in {"math", "mrow", "semantics"}:
            parts = []
            for child in children:
                child_tag = self._mathml_local_name(child.tag)
                if child_tag == "annotation":
                    continue
                part = self._mathml_element_to_latex(child)
                if part:
                    parts.append(part)
            return "".join(parts) or text

        if tag in {"mi", "mn"}:
            return text

        if tag == "mo":
            return self._normalize_math_operator(text)

        if tag == "mtext":
            if not text:
                return ""
            return r"\text{" + text.replace("{", r"\{").replace("}", r"\}") + "}"

        if tag == "msup" and len(children) >= 2:
            base = self._mathml_element_to_latex(children[0])
            sup = self._mathml_element_to_latex(children[1])
            return f"{base}^{self._wrap_latex_group(sup)}"

        if tag == "msub" and len(children) >= 2:
            base = self._mathml_element_to_latex(children[0])
            sub = self._mathml_element_to_latex(children[1])
            return f"{base}_{self._wrap_latex_group(sub)}"

        if tag == "msubsup" and len(children) >= 3:
            base = self._mathml_element_to_latex(children[0])
            sub = self._mathml_element_to_latex(children[1])
            sup = self._mathml_element_to_latex(children[2])
            return f"{base}_{self._wrap_latex_group(sub)}^{self._wrap_latex_group(sup)}"

        if tag == "mfrac" and len(children) >= 2:
            numerator = self._mathml_element_to_latex(children[0])
            denominator = self._mathml_element_to_latex(children[1])
            return r"\frac" + self._wrap_latex_group(numerator) + self._wrap_latex_group(
                denominator
            )

        if tag == "msqrt" and len(children) >= 1:
            body = "".join(self._mathml_element_to_latex(child) for child in children)
            return r"\sqrt" + self._wrap_latex_group(body)

        if tag == "mroot" and len(children) >= 2:
            body = self._mathml_element_to_latex(children[0])
            root = self._mathml_element_to_latex(children[1])
            return (
                r"\sqrt[" + root + "]" + self._wrap_latex_group(body)
            )

        if tag == "mfenced":
            body = "".join(self._mathml_element_to_latex(child) for child in children)
            open_symbol = element.attrib.get("open", "(")
            close_symbol = element.attrib.get("close", ")")
            return f"{open_symbol}{body}{close_symbol}"

        parts = []
        if text:
            parts.append(text)
        for child in children:
            child_text = self._mathml_element_to_latex(child)
            if child_text:
                parts.append(child_text)
            tail = (child.tail or "").strip()
            if tail:
                parts.append(tail)
        return "".join(parts)

    def _mathml_to_latex(self, mathml_fragment: str) -> str:
        fragment = (mathml_fragment or "").strip()
        if not fragment:
            return ""

        annotation_match = re.search(
            r"<annotation\b[^>]*encoding\s*=\s*['\"]application/x-tex['\"][^>]*>([\s\S]*?)</annotation>",
            fragment,
            flags=re.IGNORECASE,
        )
        if annotation_match:
            return self._strip_html_tags(annotation_match.group(1))

        try:
            root = ET.fromstring(unescape(fragment))
        except Exception:
            return self._strip_html_tags(fragment)

        for node in root.iter():
            if self._mathml_local_name(node.tag) != "annotation":
                continue
            encoding = (node.attrib.get("encoding") or "").strip().lower()
            if encoding == "application/x-tex":
                value = (node.text or "").strip()
                if value:
                    return value

        return self._mathml_element_to_latex(root).strip()

    def _wrap_formula_markdown(self, latex_text: str, is_block: bool) -> str:
        formula = (latex_text or "").strip()
        if not formula:
            return ""
        if is_block:
            return "\n\n$$\n" + formula + "\n$$\n\n"
        return "$" + formula + "$"

    def _convert_html_math_expressions(self, html_text: str) -> str:
        content = html_text or ""

        def replace_script_math(match: re.Match) -> str:
            attrs = match.group(1) or ""
            script_type = self._extract_attr(attrs, "type").lower()
            if not script_type.startswith("math/tex"):
                return match.group(0)
            tex = (match.group(2) or "").strip()
            mode_attr = self._extract_attr(attrs, "mode").lower()
            is_block = "mode=display" in script_type or mode_attr == "display"
            return self._wrap_formula_markdown(tex, is_block)

        def replace_mjx_container(match: re.Match) -> str:
            attrs = (match.group(1) or "").lower()
            inner = match.group(2) or ""
            tex = ""
            annotation_match = re.search(
                r"<annotation\b[^>]*encoding\s*=\s*['\"]application/x-tex['\"][^>]*>([\s\S]*?)</annotation>",
                inner,
                flags=re.IGNORECASE,
            )
            if annotation_match:
                tex = self._strip_html_tags(annotation_match.group(1))
            else:
                math_match = re.search(
                    r"<math\b[^>]*>[\s\S]*?</math>", inner, flags=re.IGNORECASE
                )
                if math_match:
                    tex = self._mathml_to_latex(math_match.group(0))
            is_block = "display" in attrs and "inline" not in attrs
            return self._wrap_formula_markdown(tex, is_block)

        def replace_mathml(match: re.Match) -> str:
            attrs = (match.group(1) or "").lower()
            full_math = match.group(0)
            tex = self._mathml_to_latex(full_math)
            is_block = "display=\"block\"" in attrs or "display='block'" in attrs
            return self._wrap_formula_markdown(tex, is_block)

        content = re.sub(
            r"<script\b([^>]*)>([\s\S]*?)</script>",
            replace_script_math,
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r"<mjx-container\b([^>]*)>([\s\S]*?)</mjx-container>",
            replace_mjx_container,
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r"<math\b([^>]*)>[\s\S]*?</math>",
            replace_mathml,
            content,
            flags=re.IGNORECASE,
        )
        return content

    def _convert_html_media_embeds(self, html_text: str) -> str:
        content = html_text or ""

        def replace_iframe(match: re.Match) -> str:
            attrs = match.group(1) or match.group(3) or ""
            inner = match.group(2) or ""
            src = self._extract_attr(attrs, "src")
            kind = self._detect_media_kind(src)
            if kind != "video":
                return "\n\n"
            title = (
                self._extract_attr(attrs, "title")
                or self._extract_attr(attrs, "aria-label")
                or self._strip_html_tags(inner)
            )
            media_md = self._build_media_markdown_link(kind, src, title)
            return f"\n\n{media_md}\n\n" if media_md else "\n\n"

        def replace_video(match: re.Match) -> str:
            attrs = match.group(1) or match.group(3) or ""
            inner = match.group(2) or ""
            src = self._extract_attr(attrs, "src") or self._extract_source_from_media_inner(
                inner
            )
            if not src:
                return "\n\n"
            title = (
                self._extract_attr(attrs, "title")
                or self._extract_attr(attrs, "aria-label")
                or self._strip_html_tags(inner)
            )
            media_md = self._build_media_markdown_link("video", src, title)
            return f"\n\n{media_md}\n\n" if media_md else "\n\n"

        def replace_audio(match: re.Match) -> str:
            attrs = match.group(1) or match.group(3) or ""
            inner = match.group(2) or ""
            src = self._extract_attr(attrs, "src") or self._extract_source_from_media_inner(
                inner
            )
            if not src:
                return "\n\n"
            title = (
                self._extract_attr(attrs, "title")
                or self._extract_attr(attrs, "aria-label")
                or self._strip_html_tags(inner)
            )
            media_md = self._build_media_markdown_link("audio", src, title)
            return f"\n\n{media_md}\n\n" if media_md else "\n\n"

        content = re.sub(
            r"<iframe\b([^>]*)>([\s\S]*?)</iframe>|<iframe\b([^>]*)/?>",
            replace_iframe,
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r"<video\b([^>]*)>([\s\S]*?)</video>|<video\b([^>]*)/?>",
            replace_video,
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r"<audio\b([^>]*)>([\s\S]*?)</audio>|<audio\b([^>]*)/?>",
            replace_audio,
            content,
            flags=re.IGNORECASE,
        )
        return content

    def _convert_html_tables(self, html_text: str) -> str:
        table_re = re.compile(r"<table\b[^>]*>([\s\S]*?)</table>", re.IGNORECASE)
        row_re = re.compile(r"<tr\b[^>]*>([\s\S]*?)</tr>", re.IGNORECASE)
        cell_re = re.compile(r"<t[hd]\b[^>]*>([\s\S]*?)</t[hd]>", re.IGNORECASE)

        def repl(match: re.Match) -> str:
            table_html = match.group(1) or ""
            rows = []
            for row_html in row_re.findall(table_html):
                cells = [self._strip_html_tags(cell) for cell in cell_re.findall(row_html)]
                if cells:
                    rows.append(cells)
            if not rows:
                return "\n\n"
            width = max(len(row) for row in rows)
            normalized = [row + [""] * (width - len(row)) for row in rows]
            header = normalized[0]
            separator = ["---"] * width
            lines = [
                "| " + " | ".join(header) + " |",
                "| " + " | ".join(separator) + " |",
            ]
            for row in normalized[1:]:
                lines.append("| " + " | ".join(row) + " |")
            return "\n\n" + "\n".join(lines) + "\n\n"

        return table_re.sub(repl, html_text or "")

    def _html_to_markdown_intermediate(self, html_text: str) -> str:
        content = self._normalize_line_breaks(html_text)
        if not content.strip():
            return ""

        content = self._convert_html_math_expressions(content)
        content = self._convert_html_media_embeds(content)
        content = re.sub(r"<!--[\s\S]*?-->", "", content)
        content = re.sub(
            r"<(script|style|noscript|iframe|canvas|svg)\b[\s\S]*?</\1>",
            "",
            content,
            flags=re.IGNORECASE,
        )

        noise_keywords = (
            "nav",
            "footer",
            "comment",
            "related",
            "recommend",
            "share",
            "breadcrumb",
            "advert",
            "promo",
            "pagination",
            "social",
            "sidebar",
            "copyright",
        )
        for _ in range(3):
            previous = content
            content = re.sub(
                r"<([a-z0-9]+)\b(?=[^>]*(?:id|class)\s*=\s*['\"][^'\"]*(?:"
                + "|".join(noise_keywords)
                + r")[^'\"]*['\"])[^>]*>[\s\S]*?</\1>",
                "",
                content,
                flags=re.IGNORECASE,
            )
            if content == previous:
                break

        content = self._convert_html_tables(content)

        content = re.sub(
            r"<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)</code>\s*</pre>",
            lambda m: "\n\n```\n" + self._strip_html_tags(m.group(1)) + "\n```\n\n",
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r"<pre\b[^>]*>([\s\S]*?)</pre>",
            lambda m: "\n\n```\n" + self._strip_html_tags(m.group(1)) + "\n```\n\n",
            content,
            flags=re.IGNORECASE,
        )

        for level in range(6, 0, -1):
            content = re.sub(
                rf"<h{level}\b[^>]*>([\s\S]*?)</h{level}>",
                lambda m, n=level: "\n\n" + ("#" * n) + " " + self._strip_html_tags(m.group(1)) + "\n\n",
                content,
                flags=re.IGNORECASE,
            )

        content = re.sub(
            r"<blockquote\b[^>]*>([\s\S]*?)</blockquote>",
            lambda m: "\n\n"
            + "\n".join(
                f"> {line}".rstrip()
                for line in self._strip_html_tags(m.group(1)).splitlines()
                if line.strip()
            )
            + "\n\n",
            content,
            flags=re.IGNORECASE,
        )

        content = re.sub(
            r"<a\b([^>]*)>([\s\S]*?)</a>",
            lambda m: (
                self._build_media_markdown_link(
                    self._detect_media_kind(self._extract_attr(m.group(1), "href")) or "",
                    self._extract_attr(m.group(1), "href"),
                    self._strip_html_tags(m.group(2)),
                )
                if self._detect_media_kind(self._extract_attr(m.group(1), "href"))
                else "["
                + (self._strip_html_tags(m.group(2)) or self._extract_attr(m.group(1), "href"))
                + "]("
                + self._extract_attr(m.group(1), "href")
                + ")"
            )
            if self._extract_attr(m.group(1), "href")
            else self._strip_html_tags(m.group(2)),
            content,
            flags=re.IGNORECASE,
        )

        content = re.sub(
            r"<img\b([^>]*)>",
            lambda m: (
                "!["
                + (self._extract_attr(m.group(1), "alt") or "image")
                + "]("
                + self._extract_attr(m.group(1), "src")
                + ")"
            )
            if self._extract_attr(m.group(1), "src")
            else "",
            content,
            flags=re.IGNORECASE,
        )

        content = re.sub(
            r"<li\b[^>]*>([\s\S]*?)</li>",
            lambda m: "\n- " + self._strip_html_tags(m.group(1)),
            content,
            flags=re.IGNORECASE,
        )

        content = re.sub(r"<br\s*/?>", "\n", content, flags=re.IGNORECASE)
        content = re.sub(
            r"</?(p|div|section|article|main|header|ul|ol|table|thead|tbody|tfoot|tr)\b[^>]*>",
            "\n",
            content,
            flags=re.IGNORECASE,
        )

        content = re.sub(
            r"<(strong|b)\b[^>]*>([\s\S]*?)</\1>",
            lambda m: "**" + self._strip_html_tags(m.group(2)) + "**",
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r"<(em|i)\b[^>]*>([\s\S]*?)</\1>",
            lambda m: "*" + self._strip_html_tags(m.group(2)) + "*",
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(
            r"<code\b[^>]*>([\s\S]*?)</code>",
            lambda m: "`" + self._strip_html_tags(m.group(1)) + "`",
            content,
            flags=re.IGNORECASE,
        )

        fenced_blocks: dict[str, str] = {}

        def stash_fenced(match: re.Match) -> str:
            key = f"__CODE_BLOCK_{len(fenced_blocks)}__"
            fenced_blocks[key] = match.group(0)
            return key

        content = re.sub(r"```[\s\S]*?```", stash_fenced, content)
        content = re.sub(r"<[^>]+>", " ", content)
        content = unescape(content)
        for key, block in fenced_blocks.items():
            content = content.replace(key, block)
        content = re.sub(r"[ \t\f\v]+", " ", content)
        content = re.sub(r"\n[ \t]+", "\n", content)
        return self._normalize_markdown_whitespace(content)

    def _normalize_markdown_whitespace(self, text: str) -> str:
        content = self._normalize_line_breaks(text)
        content = re.sub(r"[ \t]+\n", "\n", content)
        content = re.sub(r"\n{3,}", "\n\n", content)
        return content.strip()

    def normalize_source_content(
        self, article: Article, source_format: str | None = None
    ) -> tuple[str, str]:
        resolved_format = (source_format or "").strip().lower()
        if resolved_format not in {"html", "markdown"}:
            resolved_format = "html" if article.content_html else "markdown"

        if resolved_format == "html":
            markdown = self._html_to_markdown_intermediate(article.content_html or "")
            if not markdown:
                markdown = self._normalize_markdown_whitespace(article.content_md or "")
            return resolved_format, markdown

        markdown = self._normalize_markdown_whitespace(article.content_md or "")
        if not markdown and article.content_html:
            markdown = self._html_to_markdown_intermediate(article.content_html)
            resolved_format = "html"
        return resolved_format, markdown

    def _estimate_tokens(self, text: str) -> int:
        content = text or ""
        if not content:
            return 0
        cjk_chars = len(re.findall(r"[\u4e00-\u9fff]", content))
        word_count = len(re.findall(r"[A-Za-z0-9_]+", content))
        symbol_chars = max(0, len(content) - cjk_chars)
        estimate = int(cjk_chars + (word_count * 1.3) + (symbol_chars * 0.2))
        return max(1, estimate)

    def _build_markdown_blocks(self, content: str) -> list[str]:
        blocks: list[str] = []
        current: list[str] = []
        in_fence = False
        fence_marker = ""
        for line in self._normalize_line_breaks(content).split("\n"):
            stripped = line.strip()
            if stripped.startswith("```") or stripped.startswith("~~~"):
                marker = stripped[:3]
                if not in_fence:
                    in_fence = True
                    fence_marker = marker
                elif marker == fence_marker:
                    in_fence = False
                    fence_marker = ""
            current.append(line)
            if (not in_fence) and stripped == "":
                block = "\n".join(current).strip()
                if block:
                    blocks.append(block)
                current = []
        tail = "\n".join(current).strip()
        if tail:
            blocks.append(tail)
        return blocks

    def _split_large_block(self, block: str, chunk_size_tokens: int) -> list[str]:
        stripped = block.strip()
        if not stripped:
            return []

        lines = stripped.split("\n")
        if (
            len(lines) >= 3
            and lines[0].strip().startswith("```")
            and lines[-1].strip().startswith("```")
        ):
            open_fence = lines[0]
            close_fence = lines[-1]
            body = lines[1:-1]
            chunks: list[str] = []
            current: list[str] = []
            current_tokens = 0
            for line in body:
                line_tokens = self._estimate_tokens(line)
                if current and current_tokens + line_tokens > chunk_size_tokens:
                    chunks.append(
                        open_fence + "\n" + "\n".join(current) + "\n" + close_fence
                    )
                    current = []
                    current_tokens = 0
                current.append(line)
                current_tokens += line_tokens
            if current:
                chunks.append(open_fence + "\n" + "\n".join(current) + "\n" + close_fence)
            return chunks

        if len(lines) >= 3 and lines[0].strip().startswith("|") and "---" in lines[1]:
            header = lines[0]
            separator = lines[1]
            rows = lines[2:]
            chunks = []
            current = [header, separator]
            current_tokens = self._estimate_tokens(header + "\n" + separator)
            for row in rows:
                row_tokens = self._estimate_tokens(row)
                if len(current) > 2 and current_tokens + row_tokens > chunk_size_tokens:
                    chunks.append("\n".join(current))
                    current = [header, separator, row]
                    current_tokens = self._estimate_tokens(
                        header + "\n" + separator + "\n" + row
                    )
                else:
                    current.append(row)
                    current_tokens += row_tokens
            if len(current) > 2:
                chunks.append("\n".join(current))
            return chunks

        chunks = []
        current_lines: list[str] = []
        current_tokens = 0
        for line in lines:
            line_tokens = self._estimate_tokens(line)
            if current_lines and current_tokens + line_tokens > chunk_size_tokens:
                chunks.append("\n".join(current_lines).strip())
                current_lines = []
                current_tokens = 0
            current_lines.append(line)
            current_tokens += line_tokens
        if current_lines:
            chunks.append("\n".join(current_lines).strip())
        return chunks

    def _chunk_markdown_content(
        self, content: str, chunk_size_tokens: int, overlap_tokens: int
    ) -> list[str]:
        blocks: list[str] = []
        for block in self._build_markdown_blocks(content):
            if self._estimate_tokens(block) > chunk_size_tokens:
                blocks.extend(self._split_large_block(block, chunk_size_tokens))
            else:
                blocks.append(block)

        chunks: list[str] = []
        current: list[str] = []
        current_tokens = 0
        for block in blocks:
            block_tokens = self._estimate_tokens(block)
            if current and current_tokens + block_tokens > chunk_size_tokens:
                chunks.append("\n\n".join(current).strip())
                overlap_blocks: list[str] = []
                overlap_count = 0
                for existing in reversed(current):
                    existing_tokens = self._estimate_tokens(existing)
                    if overlap_blocks and overlap_count + existing_tokens > overlap_tokens:
                        break
                    overlap_blocks.insert(0, existing)
                    overlap_count += existing_tokens
                    if overlap_count >= overlap_tokens:
                        break
                current = overlap_blocks + [block]
                current_tokens = sum(self._estimate_tokens(item) for item in current)
            else:
                current.append(block)
                current_tokens += block_tokens
        if current:
            chunks.append("\n\n".join(current).strip())
        return [item for item in chunks if item]

    def _normalize_overlap_text(self, text: str) -> str:
        content = self._normalize_line_breaks(text or "").strip()
        if not content:
            return ""
        content = re.sub(r"\s+([，。！？；：、,.!?;:])", r"\1", content)
        content = re.sub(r"([，。！？；：、,.!?;:])\s+", r"\1", content)
        content = re.sub(r"\s+", " ", content)
        return content.strip()

    def _has_unclosed_fence(self, text: str) -> bool:
        content = self._normalize_line_breaks(text or "")
        fence_count = len(re.findall(r"^\s*```", content, flags=re.MULTILINE))
        return fence_count % 2 == 1

    def _split_sentence_spans(self, text: str) -> list[tuple[str, int, int]]:
        content = self._normalize_line_breaks(text or "")
        if not content.strip():
            return []

        spans: list[tuple[str, int, int]] = []
        start = 0
        for idx, char in enumerate(content):
            if char in "。！？!?；;.\n":
                segment = content[start : idx + 1]
                if segment.strip():
                    spans.append((segment, start, idx + 1))
                start = idx + 1
        if start < len(content):
            segment = content[start:]
            if segment.strip():
                spans.append((segment, start, len(content)))
        return spans

    def _try_trim_block_overlap(self, left: str, right: str) -> str:
        left_blocks = self._build_markdown_blocks(left)
        right_blocks = self._build_markdown_blocks(right)
        max_size = min(6, len(left_blocks), len(right_blocks))
        if max_size <= 0:
            return right

        for size in range(max_size, 0, -1):
            left_slice = left_blocks[-size:]
            right_slice = right_blocks[:size]
            if all(
                self._normalize_overlap_text(l) == self._normalize_overlap_text(r)
                for l, r in zip(left_slice, right_slice)
            ):
                return "\n\n".join(right_blocks[size:]).strip()
        return right

    def _try_trim_line_overlap(self, left: str, right: str) -> str:
        left_lines = self._normalize_line_breaks(left).splitlines()
        right_lines = self._normalize_line_breaks(right).splitlines()
        max_size = min(12, len(left_lines), len(right_lines))
        if max_size < 2:
            return right

        for size in range(max_size, 1, -1):
            left_slice = "\n".join(left_lines[-size:])
            right_slice = "\n".join(right_lines[:size])
            if self._normalize_overlap_text(left_slice) == self._normalize_overlap_text(
                right_slice
            ):
                return "\n".join(right_lines[size:]).strip()
        return right

    def _try_trim_exact_text_overlap(self, left: str, right: str) -> str:
        max_overlap = min(len(left), len(right), 600)
        for size in range(max_overlap, 40, -1):
            if left[-size:] == right[:size]:
                return right[size:].strip()
        return right

    def _try_trim_sentence_overlap(self, left: str, right: str) -> str:
        if self._has_unclosed_fence(left) or self._has_unclosed_fence(right):
            return right

        left_spans = self._split_sentence_spans(left)
        right_spans = self._split_sentence_spans(right)
        max_size = min(2, len(left_spans), len(right_spans))
        if max_size <= 0:
            return right

        for size in range(max_size, 0, -1):
            left_start = left_spans[-size][1]
            right_end = right_spans[size - 1][2]
            left_candidate = left[left_start:].strip()
            right_candidate = right[:right_end].strip()
            left_normalized = self._normalize_overlap_text(left_candidate)
            right_normalized = self._normalize_overlap_text(right_candidate)
            if min(len(left_normalized), len(right_normalized)) < 24:
                continue
            score = SequenceMatcher(None, left_normalized, right_normalized).ratio()
            if score >= 0.9:
                return right[right_end:].lstrip()
        return right

    def _merge_with_overlap(
        self, existing: str, new_text: str, mode: str = "markdown"
    ) -> str:
        left = (existing or "").strip()
        right = (new_text or "").strip()
        if not left:
            return right
        if not right:
            return left

        if mode == "markdown":
            for trim_func in (
                self._try_trim_block_overlap,
                self._try_trim_line_overlap,
                self._try_trim_exact_text_overlap,
                self._try_trim_sentence_overlap,
            ):
                trimmed_right = trim_func(left, right)
                if trimmed_right != right:
                    if not trimmed_right:
                        return left
                    return (left + "\n\n" + trimmed_right).strip()

        return (left + "\n\n" + right).strip()

    def _finalize_markdown(self, content: str) -> str:
        text = self._normalize_markdown_whitespace(content)
        fence_count = len(re.findall(r"^\s*```", text, flags=re.MULTILINE))
        if fence_count % 2 == 1:
            text = text.rstrip() + "\n```"
        lines = text.split("\n")
        fixed_lines: list[str] = []
        in_table = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("|") and stripped.endswith("|"):
                in_table = True
                fixed_lines.append(line)
                continue
            if in_table and stripped and not stripped.startswith("|"):
                fixed_lines.append("")
                in_table = False
            fixed_lines.append(line)
        return self._normalize_markdown_whitespace("\n".join(fixed_lines))

    def _extract_title_text(self, content: str) -> str:
        text = self._normalize_markdown_whitespace(self._strip_html_tags(content or ""))
        if not text:
            return ""

        lines = [line.strip() for line in self._normalize_line_breaks(text).split("\n")]
        lines = [line for line in lines if line]
        if not lines:
            return ""

        title_line = lines[0]
        if len(lines) >= 2 and re.fullmatch(r"[=-]{3,}", lines[1]):
            title_line = lines[0]

        title_line = re.sub(r"^#{1,6}\s+", "", title_line)
        title_line = re.sub(r"\s+#+$", "", title_line).strip()
        title_line = re.sub(r"^\*\*(.+)\*\*$", r"\1", title_line)
        title_line = re.sub(r'^["“”\'‘’]+|["“”\'‘’]+$', "", title_line).strip()
        return title_line

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

    def _update_current_task_payload(self, db, **updates) -> None:
        if not self.current_task_id or not updates:
            return
        task = db.query(AITask).filter(AITask.id == self.current_task_id).first()
        if not task:
            return
        try:
            payload = json.loads(task.payload or "{}")
        except Exception:
            payload = {}
        changed = False
        for key, value in updates.items():
            if payload.get(key) != value:
                payload[key] = value
                changed = True
        if changed:
            task.payload = json.dumps(
                payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            task.updated_at = now_str()
            db.commit()

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

    async def process_article_interpretation(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
        post_process_options: dict | None = None,
        force_tagging: bool = False,
    ):
        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            analysis = article_tag_service.ensure_analysis(db, article)
            options = self._normalize_post_process_options(post_process_options)
            self._mark_interpretation_fields_processing(
                analysis,
                options,
                force_tagging=force_tagging,
            )
            db.commit()

            source_content = self._normalize_markdown_whitespace(article.content_md or "")
            if not source_content:
                self._mark_interpretation_fields_failed(
                    analysis,
                    options,
                    "文章内容为空，无法生成 AI 解读",
                    force_tagging=force_tagging,
                )
                db.commit()
                raise TaskDataError("文章内容为空，无法生成 AI 解读")

            interpretation_config = None
            enabled_fields = self._enabled_interpretation_fields(options)
            prompt_type_priority = [
                field
                for field in ("summary", "outline", "quotes", "tagging", "classification")
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
                    force_tagging=force_tagging,
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
                    force_tagging=force_tagging,
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
                    force_tagging=force_tagging,
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
                    force_tagging=force_tagging,
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
                    force_tagging=force_tagging,
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

    async def process_article_classification(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
        post_process_options: dict | None = None,
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

            if options.get("tagging") and not analysis.tagging_manual_override:
                analysis.tagging_status = "pending"
                analysis.updated_at = now_str()
                db.commit()
                self._enqueue_task(
                    db,
                    task_type="process_article_tagging",
                    article_id=article_id,
                    content_type="tagging",
                    payload={"category_id": effective_category_id},
                )

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

    async def process_article_tagging(
        self,
        article_id: str,
        category_id: str | None,
        force: bool = False,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ):
        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                return

            analysis = article_tag_service.ensure_analysis(db, article)
            if bool(analysis.tagging_manual_override) and not force:
                analysis.updated_at = now_str()
                db.commit()
                return

            source_content = self._normalize_markdown_whitespace(article.content_md or "")
            if not source_content:
                analysis.tagging_status = "failed"
                analysis.updated_at = now_str()
                db.commit()
                raise TaskDataError("文章内容为空，无法生成标签")

            source_hash = article_tag_service.get_tagging_source_hash(article)
            if (
                not force
                and analysis.tagging_status == "completed"
                and analysis.tagging_source_hash == source_hash
                and len(article.tags) > 0
            ):
                return

            analysis.tagging_status = "processing"
            analysis.updated_at = now_str()
            db.commit()

            tagging_config = None
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
                tagging_config = {
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
                # 当指定模型但未指定提示词时，获取默认标签提示词
                if not prompt_config_id:
                    default_prompt_config = self._get_prompt_config(
                        db, category_id=category_id, prompt_type="tagging"
                    )
                    if default_prompt_config:
                        prompt = default_prompt_config.prompt

            if prompt_config_id:
                prompt_config_obj = (
                    db.query(PromptConfig)
                    .filter(
                        PromptConfig.id == prompt_config_id,
                        PromptConfig.is_enabled == True,
                        PromptConfig.type == "tagging",
                    )
                    .first()
                )
                if not prompt_config_obj:
                    raise TaskConfigError("指定标签提示词不存在、已禁用或类型不匹配")
                prompt = prompt_config_obj.prompt

            if not tagging_config:
                tagging_config = self.get_ai_config(db, category_id, prompt_type="tagging")

            if not tagging_config:
                analysis.tagging_status = "failed"
                analysis.updated_at = now_str()
                db.commit()
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")

            # 如果 prompt 还没有设置，尝试从 tagging_config 获取
            if not prompt and tagging_config:
                prompt = tagging_config.get("prompt_template")

            # 如果没有提示词配置，跳过 AI 调用
            if not prompt:
                analysis.tagging_status = "failed"
                analysis.error_message = "未配置标签提示词，请先在配置页面设置"
                analysis.updated_at = now_str()
                db.commit()
                return

            category_name = article.category.name if article.category else ""
            prompt = self._build_article_task_prompt(
                prompt,
                "tagging",
                article=article,
                category_name=category_name,
                content_placeholder=True,
            )
            parameters = self._merge_protocol_parameters(
                "tagging",
                tagging_config.get("parameters"),
            )
            pricing = {
                "model_api_config_id": tagging_config.get("model_api_config_id"),
                "price_input_per_1k": tagging_config.get("price_input_per_1k"),
                "price_output_per_1k": tagging_config.get("price_output_per_1k"),
                "currency": tagging_config.get("currency"),
            }

            try:
                result = await self.create_ai_client(tagging_config).generate_summary(
                    source_content,
                    prompt=prompt,
                    parameters=parameters,
                    max_tokens=300,
                )
                if isinstance(result, dict):
                    self._log_ai_usage(
                        db,
                        model_config_id=pricing.get("model_api_config_id"),
                        article_id=article_id,
                        task_type="process_article_tagging",
                        content_type="tagging",
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

                parsed_result = self._parse_structured_task_result("tagging", result)
                tag_names = article_tag_service.parse_tag_names(parsed_result["tags"])
                article_tag_service.set_article_tags(
                    db,
                    article,
                    tag_names,
                    manual_override=False,
                    tagging_status="completed",
                    source_hash=source_hash,
                )
                invalidate_public_cache(CACHE_KEY_TAGS_PUBLIC)
                invalidate_public_rss_cache()
                db.commit()
            except asyncio.TimeoutError:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_tagging",
                    content_type="tagging",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message="AI生成超时，请稍后重试",
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                analysis = article_tag_service.ensure_analysis(db, article)
                analysis.tagging_status = "failed"
                analysis.error_message = "AI生成超时，请稍后重试"
                analysis.updated_at = now_str()
                db.commit()
                raise TaskTimeoutError("AI生成超时，请稍后重试")
            except Exception as exc:
                self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_article_tagging",
                    content_type="tagging",
                    usage=None,
                    latency_ms=None,
                    status="failed",
                    error_message=str(exc),
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                )
                analysis = article_tag_service.ensure_analysis(db, article)
                analysis.tagging_status = "failed"
                analysis.error_message = str(exc)
                analysis.updated_at = now_str()
                db.commit()
                raise TaskExternalError(str(exc))
        finally:
            db.close()

    async def process_article_translation(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
        strategy: str | None = None,
        chunk_cursor: int | None = None,
    ):
        db = SessionLocal()
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


    async def process_digest_prefill(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ):
        """Generate six-line note draft; result goes to task payload only."""
        db = SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                raise TaskDataError("文章不存在")

            analysis = (
                db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
            )
            summary = analysis.summary if analysis else None
            outline = analysis.outline if analysis else None
            material, flags = build_prefill_material(
                summary=summary,
                outline=outline,
                content_md=article.content_md,
            )
            if not material:
                raise TaskDataError("缺少摘要、大纲或正文，无法生成批注")

            ai_config = None
            prompt = None
            prompt_parameters: dict = {}
            default_config = self.get_ai_config(
                db, category_id, prompt_type="digest_prefill"
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
                        PromptConfig.type == "digest_prefill",
                    )
                    .first()
                )
                if not prompt_config:
                    raise TaskConfigError(
                        "指定批注提示词不存在、已禁用或类型不匹配"
                    )
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

            if not ai_config and default_config:
                ai_config = default_config
            if not prompt and default_config:
                prompt = default_config.get("prompt_template")
            if not ai_config:
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")
            if not prompt:
                raise TaskConfigError("未配置批注提示词，请先在配置页面设置")

            parameters = ai_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}
            elif not parameters and default_config:
                parameters = default_config.get("parameters") or {}

            protocol = self.SINGLE_OUTPUT_PROTOCOLS.get("digest_prefill")
            instruction = str(prompt).strip()
            # Prefer explicit material block over raw article body.
            if "{content}" in instruction:
                instruction = instruction.replace("{content}", material)
                user_prompt = instruction
                if protocol:
                    user_prompt = f"{instruction}\n\n{protocol}"
            else:
                blocks = [instruction]
                if protocol:
                    blocks.append(protocol)
                blocks.append(f"客观材料：\n{material}")
                user_prompt = "\n\n".join(block for block in blocks if block)

            parameters = self._merge_protocol_parameters("digest_prefill", parameters)
            pricing = {
                "model_api_config_id": ai_config.get("model_api_config_id"),
                "price_input_per_1k": ai_config.get("price_input_per_1k"),
                "price_output_per_1k": ai_config.get("price_output_per_1k"),
                "currency": ai_config.get("currency"),
            }
            ai_client = self.create_ai_client(ai_config)
            max_tokens = self._resolve_generation_max_tokens(
                "digest_prefill", parameters
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
                user_prompt=user_prompt,
                article_id=article_id,
                task_type="process_ai_content",
                content_type="digest_prefill",
                task_id=self.current_task_id,
                client=ai_client,
                content=material,
                prompt=user_prompt,
                parameters=parameters,
                max_tokens=max_tokens,
                request_context={
                    "parameters": parameters,
                    "max_tokens": max_tokens,
                    "material_flags": flags,
                },
            )

            raw_content = result.get("content") if isinstance(result, dict) else result
            try:
                lines = parse_digest_prefill_result(raw_content)
            except ValueError as exc:
                raise TaskDataError(str(exc)) from exc

            note_markdown = join_digest_lines(lines)
            self._update_current_task_payload(
                db,
                digest_prefill_result={
                    "lines": lines,
                    "note_markdown": note_markdown,
                    "material_flags": flags,
                },
            )

            if isinstance(result, dict):
                usage_log = self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_ai_content",
                    content_type="digest_prefill",
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
                if usage_log is not None:
                    self.ai_call_session_service.create_session(
                        db,
                        usage_log_id=usage_log.id,
                        task_id=self.current_task_id,
                        article_id=article_id,
                        task_type="process_ai_content",
                        content_type="digest_prefill",
                        session_info=result.get("session_info") or {},
                    )
            db.commit()
        except Exception as exc:
            print(f"digest_prefill 处理失败: {exc}")
            raise
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
