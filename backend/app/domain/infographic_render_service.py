from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

from task_errors import TaskDataError

FORBIDDEN_TAGS = {
    "a",
    "button",
    "canvas",
    "embed",
    "form",
    "iframe",
    "img",
    "input",
    "link",
    "meta",
    "object",
    "script",
    "select",
    "source",
    "style",
    "svg",
    "textarea",
    "video",
    "audio",
}
ALLOWED_TAGS = {
    "div",
    "section",
    "article",
    "header",
    "footer",
    "main",
    "h1",
    "h2",
    "h3",
    "h4",
    "p",
    "ul",
    "ol",
    "li",
    "span",
    "strong",
    "em",
    "b",
    "i",
    "small",
    "br",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
}
VOID_TAGS = {"br", "hr"}
ALLOWED_STYLE_PROPERTIES = {
    "align-items",
    "background",
    "background-color",
    "border",
    "border-collapse",
    "border-bottom",
    "border-left",
    "border-radius",
    "border-right",
    "border-spacing",
    "border-top",
    "box-sizing",
    "box-shadow",
    "color",
    "column-gap",
    "display",
    "flex",
    "flex-basis",
    "flex-direction",
    "flex-grow",
    "flex-shrink",
    "flex-wrap",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "gap",
    "height",
    "grid-template-columns",
    "grid-template-rows",
    "justify-content",
    "letter-spacing",
    "line-height",
    "list-style",
    "list-style-type",
    "margin",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
    "max-width",
    "min-height",
    "min-width",
    "opacity",
    "overflow-wrap",
    "padding",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
    "row-gap",
    "table-layout",
    "text-align",
    "text-transform",
    "vertical-align",
    "white-space",
    "width",
    "word-break",
}
DISALLOWED_STYLE_VALUE_PATTERN = re.compile(
    r"(url\s*\(|expression\s*\(|javascript:|@import|var\s*\(|data:)",
    re.IGNORECASE,
)
ALLOWED_STYLE_VALUE_PATTERN = re.compile(r"^[#(),'%.+\-/\"\sa-zA-Z0-9:]*$")
PIXEL_VALUE_PATTERN = re.compile(r"^(-?\d+(?:\.\d+)?)px$", re.IGNORECASE)
INFOGRAPHIC_CANVAS_WIDTH = 1080
INFOGRAPHIC_CANVAS_HEIGHT = 1440


class _InfographicHtmlSanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized = tag.lower()
        if normalized in FORBIDDEN_TAGS:
            raise TaskDataError(f"信息图 HTML 不允许包含 <{normalized}> 标签")
        if normalized not in ALLOWED_TAGS:
            raise TaskDataError(f"信息图 HTML 包含不支持的 <{normalized}> 标签")

        serialized_attrs = self._serialize_attrs(normalized, attrs)
        self.parts.append(f"<{normalized}{serialized_attrs}>")
        if normalized not in VOID_TAGS:
            self.stack.append(normalized)

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.lower()
        if normalized in VOID_TAGS:
            return
        if normalized not in ALLOWED_TAGS:
            raise TaskDataError(f"信息图 HTML 包含不支持的 </{normalized}> 标签")
        if not self.stack or self.stack[-1] != normalized:
            raise TaskDataError("信息图 HTML 标签闭合结构异常")
        self.stack.pop()
        self.parts.append(f"</{normalized}>")

    def handle_data(self, data: str) -> None:
        if data:
            self.parts.append(escape(data))

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, _data: str) -> None:
        return

    def close(self) -> None:
        super().close()
        if self.stack:
            raise TaskDataError("信息图 HTML 标签未正确闭合")

    def sanitized_html(self) -> str:
        value = "".join(self.parts).strip()
        if not value:
            raise TaskDataError("信息图 HTML 为空")
        return value

    def _serialize_attrs(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> str:
        safe_attrs: list[str] = []
        for key, raw_value in attrs:
            normalized_key = (key or "").strip().lower()
            value = (raw_value or "").strip()
            if normalized_key.startswith("on"):
                raise TaskDataError("信息图 HTML 不允许事件属性")
            if normalized_key in {"id", "class", "src", "srcset", "href"}:
                raise TaskDataError(f"信息图 HTML 不允许属性 {normalized_key}")
            if normalized_key == "style":
                sanitized_style = self._sanitize_style(value)
                if sanitized_style:
                    safe_attrs.append(f' style="{escape(sanitized_style, quote=True)}"')
                continue
            if normalized_key in {"colspan", "rowspan"} and tag in {"td", "th"}:
                if not value.isdigit():
                    raise TaskDataError(f"{normalized_key} 必须为数字")
                safe_attrs.append(f' {normalized_key}="{value}"')
                continue
            if normalized_key:
                raise TaskDataError(f"信息图 HTML 不允许属性 {normalized_key}")
        return "".join(safe_attrs)

    def _sanitize_style(self, value: str) -> str:
        if not value:
            return ""
        declarations: list[str] = []
        for chunk in value.split(";"):
            item = chunk.strip()
            if not item:
                continue
            if ":" not in item:
                raise TaskDataError("信息图 HTML style 格式异常")
            property_name, raw_property_value = item.split(":", 1)
            property_name = property_name.strip().lower()
            property_value = raw_property_value.strip()
            if property_name not in ALLOWED_STYLE_PROPERTIES:
                raise TaskDataError(f"信息图 HTML 不允许样式属性 {property_name}")
            if not property_value:
                continue
            if DISALLOWED_STYLE_VALUE_PATTERN.search(property_value):
                raise TaskDataError("信息图 HTML style 包含不安全内容")
            if not ALLOWED_STYLE_VALUE_PATTERN.match(property_value):
                raise TaskDataError("信息图 HTML style 包含不支持的字符")
            declarations.append(f"{property_name}: {property_value}")
        return "; ".join(declarations)


class InfographicRenderService:
    MAX_HTML_LENGTH = 40000

    def sanitize_html_fragment(self, html_fragment: str) -> str:
        raw = (html_fragment or "").strip()
        if not raw:
            raise TaskDataError("信息图 HTML 为空")
        if len(raw) > self.MAX_HTML_LENGTH:
            raise TaskDataError("信息图 HTML 过长")

        parser = _InfographicHtmlSanitizer()
        try:
            parser.feed(raw)
            parser.close()
            sanitized = parser.sanitized_html()
        except TaskDataError:
            raise
        except Exception as exc:
            raise TaskDataError(f"信息图 HTML 解析失败：{str(exc)}") from exc

        if "<body" in raw.lower() or "<html" in raw.lower():
            raise TaskDataError("信息图仅允许 HTML 片段，不允许完整文档")
        self._validate_layout_constraints(sanitized)
        return sanitized

    def _validate_layout_constraints(self, sanitized_html: str) -> None:
        try:
            xml_safe_html = re.sub(r"<(br|hr)(\s*)>", r"<\1\2/>", sanitized_html)
            wrapper = ET.fromstring(f"<wrapper>{xml_safe_html}</wrapper>")
        except ET.ParseError as exc:
            raise TaskDataError(f"信息图 HTML 解析失败：{str(exc)}") from exc

        root_children = [child for child in list(wrapper) if isinstance(child.tag, str)]
        if len(root_children) != 1:
            raise TaskDataError("信息图 HTML 必须且只能包含一个根节点")

        root = root_children[0]
        root_style = self._parse_style_declarations(root.attrib.get("style", ""))
        self._validate_root_canvas(root_style)
        self._validate_vertical_layout(root)

    def _validate_root_canvas(self, style: dict[str, str]) -> None:
        width = self._parse_pixel_value(style.get("width"))
        height = self._parse_pixel_value(style.get("height"))
        box_sizing = (style.get("box-sizing") or "").strip().lower()

        if width != INFOGRAPHIC_CANVAS_WIDTH:
            raise TaskDataError("信息图根节点必须固定为 width: 1080px")
        if height != INFOGRAPHIC_CANVAS_HEIGHT:
            raise TaskDataError("信息图根节点必须固定为 height: 1440px")
        if box_sizing != "border-box":
            raise TaskDataError("信息图根节点必须包含 box-sizing: border-box")

    def _validate_vertical_layout(self, element: ET.Element) -> None:
        style = self._parse_style_declarations(element.attrib.get("style", ""))
        children = [child for child in list(element) if isinstance(child.tag, str)]
        if not children:
            return

        available_height = self._compute_available_content_height(style)
        if available_height is not None and self._is_vertical_stack_container(style):
            child_heights = [self._compute_outer_height(child) for child in children]
            if child_heights and all(height is not None for height in child_heights):
                required_height = int(round(sum(height or 0 for height in child_heights)))
                if required_height > available_height:
                    raise TaskDataError(
                        "信息图 HTML 固定高度布局超出画布："
                        f"<{element.tag}> 可用高度 {available_height}px，"
                        f"但子元素至少需要 {required_height}px"
                    )

        for child in children:
            self._validate_vertical_layout(child)

    def _compute_outer_height(self, element: ET.Element) -> int | None:
        style = self._parse_style_declarations(element.attrib.get("style", ""))
        height = self._parse_pixel_value(style.get("height"))
        if height is None:
            return None
        margins = self._extract_box_sides(style, "margin")
        return int(
            round(
                height
                + margins["top"]
                + margins["bottom"]
            )
        )

    def _compute_available_content_height(self, style: dict[str, str]) -> int | None:
        height = self._parse_pixel_value(style.get("height"))
        if height is None:
            return None
        paddings = self._extract_box_sides(style, "padding")
        if (style.get("box-sizing") or "").strip().lower() == "border-box":
            return max(int(round(height - paddings["top"] - paddings["bottom"])), 0)
        return int(round(height))

    def _is_vertical_stack_container(self, style: dict[str, str]) -> bool:
        display = (style.get("display") or "").strip().lower()
        if not display or display == "block":
            return True
        if "grid" in display:
            return False
        if "flex" in display:
            direction = (style.get("flex-direction") or "").strip().lower()
            return direction in {"column", "column-reverse"}
        return False

    def _extract_box_sides(
        self,
        style: dict[str, str],
        prefix: str,
    ) -> dict[str, float]:
        sides = {"top": 0.0, "right": 0.0, "bottom": 0.0, "left": 0.0}
        shorthand = self._parse_box_shorthand(style.get(prefix))
        if shorthand:
            sides.update(shorthand)

        for side in ("top", "right", "bottom", "left"):
            explicit = self._parse_pixel_value(style.get(f"{prefix}-{side}"))
            if explicit is not None:
                sides[side] = explicit
        return sides

    def _parse_box_shorthand(self, value: str | None) -> dict[str, float] | None:
        raw = (value or "").strip()
        if not raw:
            return None
        parts = raw.split()
        if not 1 <= len(parts) <= 4:
            return None
        parsed = [self._parse_pixel_value(part) for part in parts]
        if any(item is None for item in parsed):
            return None
        if len(parsed) == 1:
            top = right = bottom = left = parsed[0]
        elif len(parsed) == 2:
            top = bottom = parsed[0]
            right = left = parsed[1]
        elif len(parsed) == 3:
            top = parsed[0]
            right = left = parsed[1]
            bottom = parsed[2]
        else:
            top, right, bottom, left = parsed
        return {
            "top": float(top or 0),
            "right": float(right or 0),
            "bottom": float(bottom or 0),
            "left": float(left or 0),
        }

    def _parse_style_declarations(self, style_value: str) -> dict[str, str]:
        declarations: dict[str, str] = {}
        for chunk in (style_value or "").split(";"):
            item = chunk.strip()
            if not item or ":" not in item:
                continue
            property_name, property_value = item.split(":", 1)
            normalized_name = property_name.strip().lower()
            normalized_value = property_value.strip()
            if normalized_name and normalized_value:
                declarations[normalized_name] = normalized_value
        return declarations

    def _parse_pixel_value(self, value: str | None) -> float | None:
        raw = (value or "").strip()
        if not raw:
            return None
        match = PIXEL_VALUE_PATTERN.match(raw)
        if not match:
            return None
        return float(match.group(1))
