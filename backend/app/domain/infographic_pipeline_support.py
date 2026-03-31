from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Callable

from app.domain.infographic_render_service import (
    ALLOWED_STYLE_PROPERTIES,
    ALLOWED_TAGS,
    InfographicRenderService,
)
from models import AIUsageLog, Article, ModelAPIConfig, PromptConfig
from task_errors import TaskConfigError, TaskDataError

logger = logging.getLogger("article_ai_pipeline")

MAX_INFOGRAPHIC_REPAIR_ATTEMPTS = 2
LEGACY_INFOGRAPHIC_PROMPT_PREFIX = (
    "请将以下文章内容提炼为一张适合渲染为静态中文信息图的 HTML 片段。"
)
LEGACY_INFOGRAPHIC_SYSTEM_PROMPT = (
    "你是信息设计助手，只输出安全、可渲染的静态 HTML 片段。"
)
DEFAULT_INFOGRAPHIC_LAYOUT_BRIEF = (
    "采用「顶部结论区 + 2 个主体信息卡 + 1 个行动建议/启示区」布局。"
    "若文章信息较多，可扩展到 3 个主体信息块，但不要更多；"
    "突出读者最该记住的结论、方法、对比或清单。"
    "视觉上保持统一克制，优先浅暖或浅中性色背景、深墨标题与白色或浅色主体卡片，"
    "只保留一种低饱和强调色，避免多主色和高饱和撞色。"
)
INFOGRAPHIC_CUSTOM_GUIDANCE_FILTER_KEYWORDS = (
    "html",
    "markdown",
    "style",
    "script",
    "box-sizing",
    "url(",
    "javascript:",
    "@import",
    "class",
    "id",
    "1080",
    "1440",
    "1920",
    "3:4",
    "9:16",
    "width:",
    "height:",
    "svg",
    "iframe",
    "canvas",
    "img",
    "src",
    "srcset",
    "href",
    "标签",
    "属性",
    "事件",
    "脚本",
    "外链",
    "字体",
    "画布",
    "代码块",
    "仅输出",
    "只能使用",
    "禁止",
)


def _build_parameters(model) -> dict:
    if not model:
        return {}
    params = {}
    system_prompt = getattr(model, "system_prompt", None)
    temperature = getattr(model, "temperature", None)
    max_tokens = getattr(model, "max_tokens", None)
    top_p = getattr(model, "top_p", None)
    chunk_size_tokens = getattr(model, "chunk_size_tokens", None)
    chunk_overlap_tokens = getattr(model, "chunk_overlap_tokens", None)
    max_continue_rounds = getattr(model, "max_continue_rounds", None)
    if system_prompt:
        params["system_prompt"] = system_prompt
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


class InfographicPipelineSupport:
    def __init__(
        self,
        *,
        get_prompt_config: Callable[..., PromptConfig | None],
        get_ai_config: Callable[..., dict | None],
        assert_general_model: Callable[[ModelAPIConfig], None],
        create_render_service: Callable[[], InfographicRenderService],
        log_ai_usage: Callable[..., None],
        merge_protocol_parameters: Callable[[str, dict | None], dict],
        max_tokens: int,
    ) -> None:
        self._get_prompt_config = get_prompt_config
        self._get_ai_config = get_ai_config
        self._assert_general_model = assert_general_model
        self._create_render_service = create_render_service
        self._log_ai_usage = log_ai_usage
        self._merge_protocol_parameters = merge_protocol_parameters
        self._max_tokens = max_tokens

    @staticmethod
    def _normalize_line_breaks(value: str) -> str:
        return value.replace("\r\n", "\n").replace("\r", "\n")

    def looks_like_legacy_prompt(self, value: str | None) -> bool:
        normalized = self._normalize_line_breaks(value or "").strip()
        if not normalized:
            return False
        return normalized.startswith(LEGACY_INFOGRAPHIC_PROMPT_PREFIX)

    def looks_like_legacy_system_prompt(self, value: str | None) -> bool:
        normalized = self._normalize_line_breaks(value or "").strip()
        return normalized == LEGACY_INFOGRAPHIC_SYSTEM_PROMPT

    def normalize_custom_guidance(self, raw_text: str | None) -> str:
        normalized = self._normalize_line_breaks(raw_text or "").strip()
        if not normalized:
            return ""
        if self.looks_like_legacy_prompt(
            normalized
        ) or self.looks_like_legacy_system_prompt(normalized):
            return ""

        filtered_lines: list[str] = []
        for raw_line in normalized.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if "{content}" in line:
                line = line.replace("{content}", "").strip()
            compact = re.sub(r"\s+", "", line).lower()
            if compact in {"文章内容：", "文章内容:", "待处理内容：", "待处理内容:"}:
                continue
            if any(
                keyword in compact
                for keyword in INFOGRAPHIC_CUSTOM_GUIDANCE_FILTER_KEYWORDS
            ):
                continue
            filtered_lines.append(line)
        return "\n".join(filtered_lines).strip()

    def resolve_layout_brief(
        self,
        prompt_text: str | None,
        system_prompt_text: str | None = None,
    ) -> str:
        parts: list[str] = []
        prompt_guidance = self.normalize_custom_guidance(prompt_text)
        system_guidance = self.normalize_custom_guidance(system_prompt_text)
        if system_guidance:
            parts.append(system_guidance)
        if prompt_guidance:
            parts.append(prompt_guidance)
        if parts:
            return "\n".join(parts)
        return DEFAULT_INFOGRAPHIC_LAYOUT_BRIEF

    def build_system_prompt(self, custom_system_prompt: str | None) -> str:
        guidance = self.normalize_custom_guidance(custom_system_prompt)
        base_prompt = (
            "你是信息图内容架构助手。安全、尺寸、样式、标签、密度和可渲染约束"
            "由系统固定注入，必须严格遵守；当内容过多时，优先删减次要信息，"
            "也不要输出会溢出画布的布局。"
        )
        if not guidance:
            return base_prompt
        return (
            f"{base_prompt}\n\n"
            "补充的内容组织偏好（仅影响信息结构与重点，不得覆盖系统硬约束）：\n"
            f"{guidance}"
        )

    def build_generation_prompt(
        self,
        custom_prompt: str | None,
        custom_system_prompt: str | None = None,
    ) -> str:
        allowed_tags = ", ".join(sorted(ALLOWED_TAGS))
        allowed_styles = ", ".join(sorted(ALLOWED_STYLE_PROPERTIES))
        layout_brief = self.resolve_layout_brief(custom_prompt, custom_system_prompt)
        return (
            "请将下面的文章内容提炼为一张适合静态渲染的中文信息图 HTML 片段。\n\n"
            "固定实现约束（由系统定义，不属于可配置项）：\n"
            "1. 只输出 HTML fragment，不要输出 Markdown、代码块、解释、前后缀或完整 HTML 文档。\n"
            f"2. 仅允许使用这些标签：{allowed_tags}。\n"
            "3. 只能使用内联 style，不允许事件属性、class、id、src、srcset、href，也不允许任何外链资源。\n"
            f"4. style 中仅允许这些属性：{allowed_styles}。\n"
            "5. 根节点必须是单张 1080x1440 的 3:4 竖版画布，并明确包含 width: 1080px、height: 1440px、box-sizing: border-box。\n"
            "6. 所有内容都必须完整容纳在这张单页画布内，不能依赖自然高度继续向下撑开。\n"
            "7. 默认控制在 2-3 个主体信息块；除非文章信息明显不足，否则不要堆出超过 3 个主体卡片。\n"
            "8. 每组列表最多 2-3 条；每条尽量写成短句或短语，避免长段落、长标题和解释性从句。\n"
            "9. 除非确实必要，不要使用表格；若必须使用，最多 2 列、3 行正文，并保证内容非常紧凑。\n"
            "10. 当信息放不下时，优先合并同类观点、删除次要案例和补充说明，不要靠极小字号硬塞。\n"
            "11. 所有文字优先中文输出；若原文信息不足，不要编造，可以用简洁措辞说明信息不足。\n\n"
            "本次个性化内容结构 / 布局偏好（来自提示词配置，仅影响信息组织方式）：\n"
            f"{layout_brief}\n\n"
            "文章内容：\n{content}"
        )

    def build_generation_parameters(self, parameters: dict | None) -> dict:
        generated_parameters = dict(parameters or {})
        generated_parameters["system_prompt"] = self.build_system_prompt(
            generated_parameters.get("system_prompt")
        )
        temperature = generated_parameters.get("temperature")
        if temperature is None or temperature > 0.3:
            generated_parameters["temperature"] = 0.2
        return self._merge_protocol_parameters("infographic", generated_parameters)

    def build_overflow_repair_hint(self) -> str:
        return (
            "当前问题属于画布高度超限。修复时不要只做轻微缩字号，必须优先通过以下方式主动压缩：\n"
            "1. 合并相近信息卡，主体信息块最多保留 3 个。\n"
            "2. 删除次要案例、脚注、补充说明和解释性从句。\n"
            "3. 每组列表最多保留 2-3 条，每条改成更短的短句或短语。\n"
            "4. 长标题必须缩短，优先保留结论词，不要让标题换成多行。\n"
            "5. 如果有表格，优先改成更紧凑的列表或最多 2 列的短表。\n"
            "6. 允许牺牲部分次要信息，目标是让单张海报完整、可读、不溢出。"
        )

    def build_repair_prompt(self, validation_error: str) -> str:
        allowed_tags = ", ".join(sorted(ALLOWED_TAGS))
        allowed_styles = ", ".join(sorted(ALLOWED_STYLE_PROPERTIES))
        normalized_error = (validation_error or "未知错误").strip()
        overflow_hint = ""
        if "固定高度布局超出画布" in normalized_error:
            overflow_hint = (
                f"\n额外修复策略：\n{self.build_overflow_repair_hint()}\n"
            )
        return (
            "你是一个严格的信息图 HTML 修复器。下面提供的是一个未通过校验的 "
            "HTML fragment，请在尽量保留原有文案、层级和语义的前提下修复它。\n\n"
            f"当前校验错误：{normalized_error}\n\n"
            "输出要求：\n"
            "1. 只输出修复后的 HTML fragment，不要输出 Markdown、代码块、解释或额外文字。\n"
            f"2. 仅允许使用以下标签：{allowed_tags}。\n"
            "3. 根节点必须是单张竖版海报画布，按 1080x1440 固定尺寸设计；根节点必须明确包含 "
            "width: 1080px、height: 1440px、box-sizing: border-box，且所有内容必须完整放在这张画布内。\n"
            "4. 仅允许纯文本与盒模型布局，不允许完整 HTML 文档，不允许 <html>、"
            "<body>、<script>、<style>、<iframe>、<img>、<svg>、<canvas>、"
            "<video>、<audio>、<form> 等标签。\n"
            "5. 不允许事件属性、id、class、src、srcset、href；如需样式，只能使用 "
            f"style，并且 style 中仅允许这些属性：{allowed_styles}。\n"
            "6. style 中禁止 url(...), data:, javascript:, expression(), @import, var(...)。\n"
            "7. 若当前内容密度过高，允许删减次要文案、压缩列表数量、合并卡片；完整渲染优先于保留所有细节。\n"
            "8. 必须保证标签闭合正确，输出为空视为失败。"
            f"{overflow_hint}\n"
            "待修复 HTML：\n{content}"
        )

    def build_repair_parameters(self, parameters: dict | None) -> dict:
        repair_parameters = dict(parameters or {})
        repair_parameters["system_prompt"] = self.build_system_prompt(
            repair_parameters.get("system_prompt")
        )
        temperature = repair_parameters.get("temperature")
        if temperature is None or temperature > 0.3:
            repair_parameters["temperature"] = 0.2
        return self._merge_protocol_parameters("infographic", repair_parameters)

    @staticmethod
    def format_repair_error(initial_error: str, repair_error: str) -> str:
        normalized_initial = (initial_error or "未知错误").strip()
        normalized_repair = (repair_error or "未知错误").strip()
        return (
            "信息图 HTML 校验失败，且自动修复未成功。\n"
            f"原始错误：{normalized_initial}\n"
            f"修复尝试：{normalized_repair}"
        )

    @staticmethod
    def extract_response_content(response_payload: str | None) -> str:
        raw = (response_payload or "").strip()
        if not raw:
            return ""
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return raw
        if isinstance(parsed, dict):
            content = parsed.get("content")
            return content.strip() if isinstance(content, str) else ""
        if isinstance(parsed, str):
            return parsed.strip()
        return ""

    def get_latest_candidate_html(self, db, article_id: str) -> str:
        usage_log = (
            db.query(AIUsageLog)
            .filter(
                AIUsageLog.article_id == article_id,
                AIUsageLog.content_type == "infographic",
                AIUsageLog.status == "completed",
                AIUsageLog.response_payload.isnot(None),
            )
            .order_by(AIUsageLog.created_at.desc(), AIUsageLog.id.desc())
            .first()
        )
        if not usage_log:
            return ""
        return self.extract_response_content(usage_log.response_payload)

    def resolve_repair_source_html(self, db, article: Article) -> str:
        analysis = article.ai_analysis
        if analysis and analysis.infographic_status != "failed":
            current_html = (analysis.infographic_html or "").strip()
            if current_html:
                return current_html

        latest_candidate = self.get_latest_candidate_html(db, article.id)
        if latest_candidate:
            return latest_candidate

        current_html = (analysis.infographic_html or "").strip() if analysis else ""
        if current_html:
            return current_html
        raise TaskDataError("暂无可修复的信息图 HTML")

    @staticmethod
    def _build_runtime_ai_config_from_model(model_config: ModelAPIConfig) -> dict:
        return {
            "base_url": model_config.base_url,
            "api_key": model_config.api_key,
            "model_name": model_config.model_name,
            "model_api_config_id": model_config.id,
            "price_input_per_1k": model_config.price_input_per_1k,
            "price_output_per_1k": model_config.price_output_per_1k,
            "currency": model_config.currency,
        }

    def resolve_repair_ai_config(
        self,
        db,
        category_id: str | None,
        model_config_id: str | None,
    ) -> tuple[dict, dict]:
        prompt_config = self._get_prompt_config(
            db, category_id=category_id, prompt_type="infographic"
        )
        prompt_parameters = _build_parameters(prompt_config) if prompt_config else {}

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
            ai_config = self._build_runtime_ai_config_from_model(model_config)
            ai_config["parameters"] = prompt_parameters or None
            return ai_config, prompt_parameters

        ai_config = self._get_ai_config(db, category_id, prompt_type="infographic")
        if ai_config:
            return ai_config, ai_config.get("parameters") or {}
        raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")

    async def repair_html(
        self,
        *,
        db,
        ai_client,
        article_id: str,
        raw_html: str,
        validation_error: str,
        parameters: dict | None,
        pricing: dict,
    ) -> str:
        repair_prompt = self.build_repair_prompt(validation_error)
        repair_parameters = self.build_repair_parameters(parameters)
        try:
            result = await ai_client.generate_summary(
                raw_html,
                prompt=repair_prompt,
                parameters=repair_parameters,
                max_tokens=self._max_tokens,
            )
        except asyncio.TimeoutError:
            repair_error = "AI生成超时，请稍后重试"
            self._log_ai_usage(
                db,
                model_config_id=pricing.get("model_api_config_id"),
                article_id=article_id,
                task_type="process_ai_content",
                content_type="infographic",
                usage=None,
                latency_ms=None,
                status="failed",
                error_message=repair_error,
                price_input_per_1k=pricing.get("price_input_per_1k"),
                price_output_per_1k=pricing.get("price_output_per_1k"),
                currency=pricing.get("currency"),
            )
            raise TaskDataError(
                self.format_repair_error(validation_error, repair_error)
            ) from None
        except Exception as exc:
            repair_error = str(exc)
            self._log_ai_usage(
                db,
                model_config_id=pricing.get("model_api_config_id"),
                article_id=article_id,
                task_type="process_ai_content",
                content_type="infographic",
                usage=None,
                latency_ms=None,
                status="failed",
                error_message=repair_error,
                price_input_per_1k=pricing.get("price_input_per_1k"),
                price_output_per_1k=pricing.get("price_output_per_1k"),
                currency=pricing.get("currency"),
            )
            raise TaskDataError(
                self.format_repair_error(validation_error, repair_error)
            ) from exc
        if isinstance(result, dict):
            self._log_ai_usage(
                db,
                model_config_id=pricing.get("model_api_config_id"),
                article_id=article_id,
                task_type="process_ai_content",
                content_type="infographic",
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
            return result.get("content") or ""
        return result or ""

    async def sanitize_html_with_repair(
        self,
        *,
        db,
        ai_client,
        article_id: str,
        raw_html: str,
        parameters: dict | None,
        pricing: dict,
    ) -> str:
        render_service = self._create_render_service()
        candidate_html = raw_html or ""
        initial_error_message: str | None = None
        latest_error_message: str | None = None

        for repair_round in range(MAX_INFOGRAPHIC_REPAIR_ATTEMPTS + 1):
            try:
                return render_service.sanitize_html_fragment(candidate_html)
            except TaskDataError as exc:
                latest_error_message = str(exc)
                if initial_error_message is None:
                    initial_error_message = latest_error_message

                if repair_round >= MAX_INFOGRAPHIC_REPAIR_ATTEMPTS:
                    raise TaskDataError(
                        self.format_repair_error(
                            initial_error_message,
                            latest_error_message,
                        )
                    ) from exc

                logger.warning(
                    "infographic_html_invalid_repairing: article_id=%s round=%s error=%s",
                    article_id,
                    repair_round + 1,
                    latest_error_message,
                )
                candidate_html = await self.repair_html(
                    db=db,
                    ai_client=ai_client,
                    article_id=article_id,
                    raw_html=candidate_html,
                    validation_error=latest_error_message,
                    parameters=parameters,
                    pricing=pricing,
                )

        raise TaskDataError(
            self.format_repair_error(
                initial_error_message or "未知错误",
                latest_error_message or "未知错误",
            )
        )
