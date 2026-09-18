import re
from difflib import SequenceMatcher
from html import unescape
from xml.etree import ElementTree as ET

from models import Article

from . import common


class _ContentMixin:
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
        if common.AUDIO_URL_PATTERN.search(normalized):
            return "audio"
        if common.VIDEO_URL_PATTERN.search(normalized):
            return "video"
        if common.BOOK_URL_PATTERN.search(normalized):
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
