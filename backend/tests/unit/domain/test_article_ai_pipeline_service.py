import asyncio

import app.domain.article_ai_pipeline_service as article_ai_pipeline_module
from app.domain.article_ai_pipeline_service import ArticleAIPipelineService
from models import Article, now_str


def test_detect_media_kind_supports_book_links():
    service = ArticleAIPipelineService()

    assert service._detect_media_kind("https://example.com/library/demo.pdf") == "book"
    assert service._detect_media_kind("https://example.com/library/demo.epub") == "book"
    assert service._detect_media_kind("https://example.com/library/demo.mobi") == "book"


def test_build_media_markdown_link_renders_book_marker():
    service = ArticleAIPipelineService()

    assert (
        service._build_media_markdown_link(
            "book",
            "https://example.com/library/demo.pdf",
            "深度学习导论",
        )
        == "[📚 深度学习导论](https://example.com/library/demo.pdf)"
    )


def test_build_media_markdown_link_uses_book_default_title():
    service = ArticleAIPipelineService()

    assert (
        service._build_media_markdown_link(
            "book",
            "https://example.com/library/demo.epub",
        )
        == "[📚 书籍](https://example.com/library/demo.epub)"
    )


def test_merge_with_overlap_deduplicates_markdown_blocks():
    service = ArticleAIPipelineService()
    existing = "# 标题\n\n第一段内容。\n\n## 第二节\n\n重复边界段落。"
    new_text = "## 第二节\n\n重复边界段落。\n\n第三段新内容。"

    merged = service._merge_with_overlap(existing, new_text)

    assert merged.count("## 第二节") == 1
    assert merged.count("重复边界段落。") == 1
    assert merged.endswith("第三段新内容。")


def test_merge_with_overlap_deduplicates_lines_when_blocks_do_not_match():
    service = ArticleAIPipelineService()
    existing = "A\nB\nC\nD"
    new_text = "C\nD\nE\nF"

    merged = service._merge_with_overlap(existing, new_text)

    assert merged == "A\nB\nC\nD\n\nE\nF"


def test_merge_with_overlap_deduplicates_similar_sentence_boundaries():
    service = ArticleAIPipelineService()
    existing = (
        "前文介绍背景。我们认为这个方案可以显著降低重复率，并且能够保持 Markdown 结构完整。"
    )
    new_text = (
        "我们认为这个方案可以显著降低重复率, 并且能够保持Markdown结构完整。"
        "然后进入验证阶段。"
    )

    merged = service._merge_with_overlap(existing, new_text)

    assert merged.count("我们认为这个方案可以显著降低重复率") == 1
    assert merged.endswith("然后进入验证阶段。")


def test_merge_with_overlap_keeps_non_overlapping_content():
    service = ArticleAIPipelineService()
    existing = "第一部分。"
    new_text = "完全不同的第二部分。"

    merged = service._merge_with_overlap(existing, new_text)

    assert merged == "第一部分。\n\n完全不同的第二部分。"


def test_merge_with_overlap_skips_sentence_trim_when_fence_unclosed():
    service = ArticleAIPipelineService()
    existing = "```python\n# 该函数用于加载配置并初始化上下文对象以便后续处理"
    new_text = "# 该函数用于加载配置并初始化上下文对象以便后续处理。然后执行下一步。"

    merged = service._merge_with_overlap(existing, new_text)

    assert merged == f"{existing}\n\n{new_text}"
    assert merged.count("该函数用于加载配置并初始化上下文对象以便后续处理") == 2


def test_merge_with_overlap_supports_continue_round_deduplication():
    service = ArticleAIPipelineService()
    round_1 = "这是一段较长的第一段内容，用于模拟续写拼接时的重复边界。"
    round_2 = f"{round_1}随后输出第二段。"

    merged = service._merge_with_overlap("", round_1)
    merged = service._merge_with_overlap(merged, round_2)

    assert merged.count(round_1) == 1
    assert merged.endswith("随后输出第二段。")


def test_merge_with_overlap_handles_mixed_punctuation_sentence_boundaries():
    service = ArticleAIPipelineService()
    existing = (
        "这是第一句用于说明背景信息并引出上下文？"
        "这是第二句用于描述跨语言标点兼容能力并验证边界拼接稳定性。"
    )
    new_text = (
        "这是第二句用于描述跨语言标点兼容能力并验证边界拼接稳定性. "
        "接下来是第三句继续展开说明！"
    )

    merged = service._merge_with_overlap(existing, new_text)

    assert merged.count("这是第二句用于描述跨语言标点兼容能力并验证边界拼接稳定性") == 1
    assert merged.endswith("接下来是第三句继续展开说明！")


def test_build_continue_prompt_adds_boundary_dedup_instruction():
    service = ArticleAIPipelineService()

    prompt = service._build_continue_prompt("请翻译：{content}", "这是已输出内容")

    assert "如果下一段与已输出末尾有重复，必须删除重复后再继续" in prompt
    assert "禁止复述上一段最后一句" in prompt


def test_extract_title_text_handles_markdown_heading_and_quotes():
    service = ArticleAIPipelineService()

    assert service._extract_title_text('# "Hello World"') == "Hello World"
    assert service._extract_title_text("**你好，世界**") == "你好，世界"


def test_process_article_translation_also_updates_translated_title(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Hello World",
        slug="hello-world",
        content_md="This is a test article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    service = ArticleAIPipelineService()

    class FakeClient:
        def __init__(self):
            self.calls = 0

        async def translate_to_chinese(self, content, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return {"content": "# 你好，世界"}
            return {"content": "这是一篇测试文章。"}

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "parameters": None,
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())

    asyncio.run(
        service.process_article_translation(
            article_id=article.id,
            category_id=None,
        )
    )

    persisted_article = db_session.get(Article, article.id)
    assert persisted_article is not None
    assert persisted_article.title_trans == "你好，世界"
    assert persisted_article.content_trans == "这是一篇测试文章。"
    assert persisted_article.translation_status == "completed"
