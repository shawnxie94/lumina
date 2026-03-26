from __future__ import annotations

import asyncio

from app.domain.infographic_pipeline_support import (
    DEFAULT_INFOGRAPHIC_LAYOUT_BRIEF,
    LEGACY_INFOGRAPHIC_PROMPT_PREFIX,
    LEGACY_INFOGRAPHIC_SYSTEM_PROMPT,
    InfographicPipelineSupport,
)


def create_support() -> InfographicPipelineSupport:
    return InfographicPipelineSupport(
        get_prompt_config=lambda *args, **kwargs: None,
        get_ai_config=lambda *args, **kwargs: None,
        assert_general_model=lambda *args, **kwargs: None,
        create_render_service=lambda: None,
        log_ai_usage=lambda *args, **kwargs: None,
        max_tokens=2200,
    )


def test_resolve_layout_brief_filters_style_constraints():
    support = create_support()

    prompt_text = """
    请做成双列对比卡片布局，左列写常见误区，右列写推荐做法。
    根节点必须包含 width: 1080px; height: 1440px; box-sizing: border-box。
    禁止 script、img、iframe，且不要输出 Markdown。
    """
    system_prompt_text = """
    顶部先给一句结论，再给 3 个主体卡片。
    只能使用内联 style。
    """

    brief = support.resolve_layout_brief(prompt_text, system_prompt_text)

    assert "双列对比卡片布局" in brief
    assert "顶部先给一句结论" in brief
    assert "1080px" not in brief
    assert "script" not in brief.lower()
    assert "Markdown" not in brief


def test_build_generation_prompt_ignores_legacy_default_prompt():
    support = create_support()

    prompt = support.build_generation_prompt(
        LEGACY_INFOGRAPHIC_PROMPT_PREFIX,
        LEGACY_INFOGRAPHIC_SYSTEM_PROMPT,
    )

    assert DEFAULT_INFOGRAPHIC_LAYOUT_BRIEF in prompt
    assert "请将以下文章内容提炼为一张适合渲染为静态中文信息图的 HTML 片段。" not in prompt


def test_build_repair_prompt_adds_overflow_compression_hint():
    support = create_support()

    prompt = support.build_repair_prompt(
        "信息图 HTML 固定高度布局超出画布：<article> 可用高度 1328px，但子元素至少需要 1440px"
    )

    assert "不要只做轻微缩字号" in prompt
    assert "主体信息块最多保留 3 个" in prompt


def test_sanitize_html_with_repair_supports_multi_round_repair(db_session):
    first_html = (
        '<div style="width: 1080px; height: 1440px; box-sizing: border-box; outline: 1px solid red">'
        '<main style="height: 1440px">主体</main>'
        "</div>"
    )
    second_html = (
        '<div style="width: 1080px; height: 1440px; box-sizing: border-box; padding: 56px">'
        '<header style="height: 220px; margin-bottom: 28px">头部</header>'
        '<main style="height: 1060px; margin-bottom: 28px">主体</main>'
        '<footer style="height: 84px">底部</footer>'
        "</div>"
    )
    final_html = (
        '<div style="width: 1080px; height: 1440px; box-sizing: border-box; padding: 40px; font-family: Inter, Arial, sans-serif">'
        '<header style="height: 180px; margin-bottom: 16px">头部</header>'
        '<main style="height: 1080px; margin-bottom: 16px">主体</main>'
        '<footer style="height: 60px">底部</footer>'
        "</div>"
    )

    class FakeClient:
        def __init__(self):
            self.calls = []

        async def generate_summary(self, content, **kwargs):
            self.calls.append({"content": content, **kwargs})
            if len(self.calls) == 1:
                return {
                    "content": second_html,
                    "usage": None,
                    "latency_ms": 5,
                    "request_payload": {},
                    "response_payload": {},
                }
            if len(self.calls) == 2:
                assert content == second_html
                assert "固定高度布局超出画布" in (kwargs.get("prompt") or "")
                return {
                    "content": final_html,
                    "usage": None,
                    "latency_ms": 6,
                    "request_payload": {},
                    "response_payload": {},
                }
            raise AssertionError("unexpected extra repair round")

    fake_client = FakeClient()
    usage_log_calls: list[dict] = []
    support = InfographicPipelineSupport(
        get_prompt_config=lambda *args, **kwargs: None,
        get_ai_config=lambda *args, **kwargs: None,
        assert_general_model=lambda *args, **kwargs: None,
        create_render_service=lambda: article_ai_pipeline_render_service(),
        log_ai_usage=lambda *args, **kwargs: usage_log_calls.append(kwargs),
        max_tokens=2200,
    )

    sanitized = asyncio.run(
        support.sanitize_html_with_repair(
            db=db_session,
            ai_client=fake_client,
            article_id="article-1",
            raw_html=first_html,
            parameters=None,
            pricing={},
        )
    )

    assert len(fake_client.calls) == 2
    assert "outline" in fake_client.calls[0]["content"]
    assert sanitized == final_html
    assert len(usage_log_calls) == 2


def article_ai_pipeline_render_service():
    from app.domain.infographic_render_service import InfographicRenderService

    return InfographicRenderService()
