import logging
import re
from dataclasses import dataclass
from typing import Any

from app.domain.article_embedding_service import ArticleEmbeddingService
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


def _ensure_analysis(db, article):
    analysis = getattr(article, "ai_analysis", None)
    if analysis is None:
        analysis = AIAnalysis(article_id=article.id)
        db.add(analysis)
        db.flush()
        article.ai_analysis = analysis
    return analysis


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


class _ConstantsMixin:
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
        "summary": 500,
        "outline": 3000,
        "quotes": 800,
    }
    INTERPRETATION_BASE_MAX_TOKENS = 300
    INTERPRETATION_FIELD_LABELS = {
        "classification": "分类",
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
    }
