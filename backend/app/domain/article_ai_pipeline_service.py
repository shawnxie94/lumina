import asyncio
import json
import logging
import re
from html import unescape

from ai_client import ConfigurableAIClient, is_english_content
from media_service import maybe_ingest_article_images_with_stats
from sqlalchemy import or_
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
    DEFAULT_AI_CONTENT_MAX_TOKENS = {
        "key_points": 1000,
        "outline": 1000,
    }

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
        finish_reason: str | None = None,
        truncated: bool | None = None,
        chunk_index: int | None = None,
        continue_round: int | None = None,
        estimated_input_tokens: int | None = None,
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
                "["
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

    def _merge_with_overlap(self, existing: str, new_text: str) -> str:
        left = (existing or "").strip()
        right = (new_text or "").strip()
        if not left:
            return right
        if not right:
            return left
        max_overlap = min(len(left), len(right), 600)
        overlap = 0
        for size in range(max_overlap, 40, -1):
            if left[-size:] == right[:size]:
                overlap = size
                break
        if overlap:
            return (left + right[overlap:]).strip()
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

    def _build_cleaning_prompt(self, base_prompt: str | None, source_format: str) -> str | None:
        if not base_prompt:
            return None
        if source_format == "html":
            return base_prompt
        adjusted = (
            base_prompt.replace("以下 HTML 内容", "以下 Markdown 内容")
            .replace("以下html内容", "以下markdown内容")
            .replace("HTML：", "Markdown：")
        )
        return adjusted

    def _build_continue_prompt(self, base_prompt: str | None, partial_output: str) -> str:
        instruction = (
            "继续上一次输出：仅补充尚未输出的剩余内容，不要重复任何已输出句子。"
            "从最后一个完整句后继续，保持 GFM Markdown 格式。"
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
        return estimated_tokens > input_budget, input_budget

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

            cleaning_client = self.create_ai_client(cleaning_config)
            parameters = cleaning_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}
            elif not parameters and default_config and not has_custom_prompt:
                parameters = default_config.get("parameters") or {}
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

            ai_analysis.cleaned_md_draft = cleaned_md
            ai_analysis.error_message = None
            ai_analysis.updated_at = now_str()
            db.commit()
            if advanced_options:
                self._update_current_task_payload(db, chunk_cursor=0)

            self._enqueue_task(
                db,
                task_type="process_article_validation",
                article_id=article_id,
                content_type="content_validation",
                payload={
                    "category_id": category_id,
                    "source_format": resolved_source_format,
                    "strategy": strategy_value if advanced_options else "single",
                    "chunk_cursor": 0,
                },
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

            trans_client = self.create_ai_client(ai_config)
            parameters = ai_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}
            elif not parameters and default_translation_config and not has_custom_prompt:
                parameters = default_translation_config.get("parameters") or {}
            pricing = {
                "model_api_config_id": ai_config.get("model_api_config_id"),
                "price_input_per_1k": ai_config.get("price_input_per_1k"),
                "price_output_per_1k": ai_config.get("price_output_per_1k"),
                "currency": ai_config.get("currency"),
            }

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
                default_max_tokens = self.DEFAULT_AI_CONTENT_MAX_TOKENS.get(
                    content_type, 500
                )
                result = await ai_client.generate_summary(
                    article.content_md,
                    prompt=prompt,
                    parameters=parameters,
                    max_tokens=default_max_tokens,
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
