import asyncio
import uuid

import app.domain.article_ai_pipeline_service as article_ai_pipeline_module
from app.domain.article_ai_pipeline_service import ArticleAIPipelineService
from models import AIAnalysis, Article, now_str


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


def test_process_ai_content_infographic_persists_html_and_status(
    db_session,
    monkeypatch,
):
    article_id = str(uuid.uuid4())
    article = Article(
        id=article_id,
        title="Infographic Article",
        slug="infographic-article",
        content_md="This is a test article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    analysis = AIAnalysis(
        article_id=article.id,
        infographic_status="completed",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    service = ArticleAIPipelineService()

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert content == "This is a test article."
            assert "固定实现约束" in (kwargs.get("prompt") or "")
            assert (
                ArticleAIPipelineService.DEFAULT_INFOGRAPHIC_LAYOUT_BRIEF
                in (kwargs.get("prompt") or "")
            )
            assert "你是信息图内容架构助手" in (
                (kwargs.get("parameters") or {}).get("system_prompt") or ""
            )
            return {
                "content": '<section style="display: flex"><div style="padding: 24px">信息图</div></section>',
                "usage": None,
                "latency_ms": 12,
                "request_payload": {},
                "response_payload": {},
            }

    class FakeRenderService:
        def sanitize_html_fragment(self, html_fragment: str) -> str:
            assert "信息图" in html_fragment
            return '<section style="display: flex"><div style="padding: 24px">已清洗信息图</div></section>'

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
    monkeypatch.setattr(
        service,
        "create_infographic_render_service",
        lambda: FakeRenderService(),
    )

    asyncio.run(
        service.process_ai_content(
            article_id=article_id,
            category_id=None,
            content_type="infographic",
        )
    )

    persisted = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert persisted.infographic_status == "completed"
    assert persisted.infographic_html == (
        '<section style="display: flex"><div style="padding: 24px">已清洗信息图</div></section>'
    )
    assert persisted.error_message is None


def test_process_ai_content_infographic_marks_failed_when_html_invalid(
    db_session,
    monkeypatch,
):
    article_id = str(uuid.uuid4())
    article = Article(
        id=article_id,
        title="Invalid Infographic",
        slug="invalid-infographic",
        content_md="This is a test article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    analysis = AIAnalysis(
        article_id=article.id,
        infographic_status="completed",
        infographic_html="<div>existing</div>",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    service = ArticleAIPipelineService()

    class FakeClient:
        def __init__(self):
            self.calls = 0

        async def generate_summary(self, content, **kwargs):
            self.calls += 1
            return {
                "content": "<script>alert(1)</script>",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    class FakeRenderService:
        def sanitize_html_fragment(self, html_fragment: str) -> str:
            raise article_ai_pipeline_module.TaskDataError("信息图 HTML 不允许包含 <script> 标签")

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
    fake_client = FakeClient()

    monkeypatch.setattr(service, "create_ai_client", lambda config: fake_client)
    monkeypatch.setattr(
        service,
        "create_infographic_render_service",
        lambda: FakeRenderService(),
    )

    asyncio.run(
        service.process_ai_content(
            article_id=article_id,
            category_id=None,
            content_type="infographic",
        )
    )

    persisted = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert fake_client.calls == 3
    assert persisted.infographic_status == "failed"
    assert persisted.error_message == (
        "信息图 HTML 校验失败，且自动修复未成功。\n"
        "原始错误：信息图 HTML 不允许包含 <script> 标签\n"
        "修复尝试：信息图 HTML 不允许包含 <script> 标签"
    )
    assert persisted.infographic_html == "<div>existing</div>"


def test_process_ai_content_infographic_repairs_invalid_html_once(
    db_session,
    monkeypatch,
):
    article_id = str(uuid.uuid4())
    article = Article(
        id=article_id,
        title="Repairable Infographic",
        slug="repairable-infographic",
        content_md="This is a test article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    analysis = AIAnalysis(
        article_id=article.id,
        infographic_status="processing",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    service = ArticleAIPipelineService()

    class FakeClient:
        def __init__(self):
            self.calls = []

        async def generate_summary(self, content, **kwargs):
            self.calls.append({"content": content, **kwargs})
            if len(self.calls) == 1:
                return {
                    "content": "<script>alert(1)</script>",
                    "usage": None,
                    "latency_ms": 5,
                    "request_payload": {},
                    "response_payload": {},
                }
            assert content == "<script>alert(1)</script>"
            assert "当前校验错误" in (kwargs.get("prompt") or "")
            assert "script" in (kwargs.get("prompt") or "")
            assert "允许删减次要文案" in (kwargs.get("prompt") or "")
            return {
                "content": '<section style="display: flex"><div style="padding: 24px">修复后信息图</div></section>',
                "usage": None,
                "latency_ms": 6,
                "request_payload": {},
                "response_payload": {},
            }

    class FakeRenderService:
        def sanitize_html_fragment(self, html_fragment: str) -> str:
            if "<script" in html_fragment:
                raise article_ai_pipeline_module.TaskDataError(
                    "信息图 HTML 不允许包含 <script> 标签"
                )
            return html_fragment

    fake_client = FakeClient()

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
    monkeypatch.setattr(service, "create_ai_client", lambda config: fake_client)
    monkeypatch.setattr(
        service,
        "create_infographic_render_service",
        lambda: FakeRenderService(),
    )

    asyncio.run(
        service.process_ai_content(
            article_id=article_id,
            category_id=None,
            content_type="infographic",
        )
    )

    persisted = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert len(fake_client.calls) == 2
    assert persisted.infographic_status == "completed"
    assert persisted.infographic_html == (
        '<section style="display: flex"><div style="padding: 24px">修复后信息图</div></section>'
    )
    assert persisted.error_message is None


def test_process_ai_content_infographic_repairs_layout_overflow_once(
    db_session,
    monkeypatch,
):
    article_id = str(uuid.uuid4())
    article = Article(
        id=article_id,
        title="Overflow Infographic",
        slug="overflow-infographic",
        content_md="This is a test article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    analysis = AIAnalysis(
        article_id=article.id,
        infographic_status="processing",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    service = ArticleAIPipelineService()

    overflowing_html = (
        '<div style="width: 1080px; height: 1440px; box-sizing: border-box; padding: 56px">'
        '<header style="height: 220px; margin-bottom: 28px">头部</header>'
        '<main style="height: 1060px; margin-bottom: 28px">主体</main>'
        '<footer style="height: 84px">底部</footer>'
        "</div>"
    )
    repaired_html = (
        '<div style="width: 1080px; height: 1440px; box-sizing: border-box; padding: 40px">'
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
                    "content": overflowing_html,
                    "usage": None,
                    "latency_ms": 5,
                    "request_payload": {},
                    "response_payload": {},
                }
            assert content == overflowing_html
            assert "固定高度布局超出画布" in (kwargs.get("prompt") or "")
            assert "不要只做轻微缩字号" in (kwargs.get("prompt") or "")
            return {
                "content": repaired_html,
                "usage": None,
                "latency_ms": 6,
                "request_payload": {},
                "response_payload": {},
            }

    fake_client = FakeClient()

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
    monkeypatch.setattr(service, "create_ai_client", lambda config: fake_client)

    asyncio.run(
        service.process_ai_content(
            article_id=article_id,
            category_id=None,
            content_type="infographic",
        )
    )

    persisted = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert len(fake_client.calls) == 2
    assert persisted.infographic_status == "completed"
    assert persisted.infographic_html == repaired_html
    assert persisted.error_message is None


def test_repair_infographic_html_uses_latest_logged_candidate_on_failed_status(
    db_session,
    monkeypatch,
):
    article_id = str(uuid.uuid4())
    article = Article(
        id=article_id,
        title="Manual Repair Infographic",
        slug="manual-repair-infographic",
        content_md="This is a test article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    analysis = AIAnalysis(
        article_id=article.id,
        infographic_status="failed",
        infographic_html="<div>old successful infographic</div>",
        error_message="旧错误",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    service = ArticleAIPipelineService()

    class FakeClient:
        def __init__(self):
            self.calls = []

        async def generate_summary(self, content, **kwargs):
            self.calls.append({"content": content, **kwargs})
            if len(self.calls) == 1:
                assert content == '<div style="outline: 1px solid red">latest candidate</div>'
                assert "请把非法样式去掉" in (kwargs.get("prompt") or "")
                return {
                    "content": '<div style="width: 1080px; height: 1440px; box-sizing: border-box">修复后信息图</div>',
                    "usage": None,
                    "latency_ms": 6,
                    "request_payload": {},
                    "response_payload": {},
                }
            raise AssertionError("unexpected extra repair round")

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service.infographic_support,
        "resolve_repair_source_html",
        lambda db, article: '<div style="outline: 1px solid red">latest candidate</div>',
    )
    monkeypatch.setattr(
        service.infographic_support,
        "resolve_repair_ai_config",
        lambda db, category_id, model_config_id: (
            {
                "base_url": "https://example.com",
                "api_key": "test-key",
                "model_name": "test-model",
                "model_api_config_id": None,
                "price_input_per_1k": None,
                "price_output_per_1k": None,
                "currency": None,
                "parameters": None,
            },
            {},
        ),
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())

    asyncio.run(
        service.repair_infographic_html(
            article_id=article_id,
            category_id=None,
            validation_error="请把非法样式去掉，并压缩整体高度",
            model_config_id=None,
        )
    )

    persisted = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert persisted.infographic_status == "completed"
    assert persisted.infographic_html == (
        '<div style="width: 1080px; height: 1440px; box-sizing: border-box">修复后信息图</div>'
    )
    assert persisted.error_message is None
