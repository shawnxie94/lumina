import asyncio

import pytest

import app.domain.article_command_service as article_command_service_module
from app.domain.article_command_service import ArticleCommandService
from app.domain.article_extraction_service import (
    ArticleExtractionBadGatewayError,
    ArticleExtractionService,
    ExtractedArticle,
)
from models import (
    AIAnalysis,
    AIAnalysisVersion,
    AITask,
    AdminSettings,
    Article,
    now_str,
)


class StubAITaskService:
    def __init__(self):
        self.tasks = []

    def enqueue_task(self, *args, **kwargs) -> str:
        self.tasks.append(kwargs)
        return "task-id"


def make_article_with_analysis(db_session):
    article = Article(
        title="AI content article",
        slug="ai-content-article",
        content_html="<p>content</p>",
        content_md="content",
        content_trans="",
        source_url="https://example.com/ai-content-article",
        top_image="https://example.com/image.png",
        author="Tester",
        published_at=now_str(),
        source_domain="example.com",
        status="completed",
        is_visible=True,
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    analysis = AIAnalysis(
        article_id=article.id,
        summary="summary stays",
        summary_status="completed",
        outline="outline",
        outline_status="completed",
        quotes="quotes",
        quotes_status="completed",
        updated_at="2026-03-27 10:00:00",
    )
    db_session.add(analysis)
    db_session.commit()
    db_session.refresh(analysis)
    db_session.refresh(article)
    return article


def test_create_article_uses_first_html_image_when_top_image_missing(db_session):
    task_service = StubAITaskService()
    service = ArticleCommandService(ai_task_service=task_service)

    article_id = asyncio.run(
        service.create_article(
            {
                "title": "html image fallback",
                "content_html": """
                <article>
                    <p>正文文本</p>
                    <img src="/images/first.jpg" />
                    <img src="/images/second.jpg" />
                </article>
                """,
                "content_md": "正文 markdown",
                "source_url": "https://example.com/article/1",
                "top_image": "",
                "skip_ai_processing": True,
            },
            db_session,
        )
    )

    article = db_session.query(Article).filter(Article.id == article_id).first()
    assert article is not None
    assert article.top_image == "https://example.com/images/first.jpg"
    assert article.status == "completed"
    assert task_service.tasks == []


def test_create_article_queues_only_enabled_post_processing(db_session):
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            auto_ai_cleaning_enabled=False,
            auto_ai_classification_enabled=False,
            auto_ai_summary_enabled=True,
            auto_ai_outline_enabled=True,
            auto_ai_quotes_enabled=True,
            auto_translation_enabled=False,
        )
    )
    db_session.commit()
    task_service = StubAITaskService()
    service = ArticleCommandService(ai_task_service=task_service)

    article_id = asyncio.run(
        service.create_article(
            {
                "title": "summary only",
                "content_md": "这是一篇足够长的正文，用来验证默认只触发摘要任务。",
                "source_url": "https://example.com/article/summary-only",
            },
            db_session,
        )
    )

    article = db_session.query(Article).filter(Article.id == article_id).first()
    assert article is not None
    assert article.status == "completed"
    assert [
        (task["task_type"], task["content_type"]) for task in task_service.tasks
    ] == [
        ("process_article_interpretation", "interpretation"),
    ]
    assert "interpretation_bundle" not in task_service.tasks[0]["payload"][
        "post_process_options"
    ]


def test_create_article_uses_bundle_for_enabled_interpretation_fields(db_session):
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            auto_ai_cleaning_enabled=False,
            auto_ai_classification_enabled=False,
            auto_ai_summary_enabled=True,
            auto_ai_outline_enabled=True,
            auto_ai_quotes_enabled=True,
            auto_translation_enabled=False,
        )
    )
    db_session.commit()
    task_service = StubAITaskService()
    service = ArticleCommandService(ai_task_service=task_service)

    article_id = asyncio.run(
        service.create_article(
            {
                "title": "legacy summary tasks",
                "content_md": "这是一篇足够长的正文，用来验证历史整包设置不会关闭自动整包。",
                "source_url": "https://example.com/article/legacy-summary-tasks",
            },
            db_session,
        )
    )

    article = db_session.query(Article).filter(Article.id == article_id).first()
    assert article is not None
    assert article.status == "completed"
    assert [
        (task["task_type"], task["content_type"]) for task in task_service.tasks
    ] == [
        ("process_article_interpretation", "interpretation"),
    ]
    assert "interpretation_bundle" not in task_service.tasks[0]["payload"][
        "post_process_options"
    ]


def test_create_article_falls_back_to_markdown_image_when_html_has_no_image(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())

    article_id = asyncio.run(
        service.create_article(
            {
                "title": "markdown image fallback",
                "content_html": "<article><p>无图片正文</p></article>",
                "content_md": (
                    "这里有一段文字\n\n"
                    "![封面图](https://cdn.example.com/cover.png \"cover\")\n\n"
                    "后续内容"
                ),
                "source_url": "https://example.com/article/2",
                "top_image": None,
                "skip_ai_processing": True,
            },
            db_session,
        )
    )

    article = db_session.query(Article).filter(Article.id == article_id).first()
    assert article is not None
    assert article.top_image == "https://cdn.example.com/cover.png"


def test_create_article_ingests_body_images_after_create(db_session, monkeypatch):
    captured = {}

    async def fake_ingest_body_images(_db, article):
        captured["article_id"] = article.id
        captured["content_md"] = article.content_md
        article.content_md = article.content_md.replace(
            "https://cdn.example.com/body.png",
            "/media/2026/06/body.webp",
        )
        _db.commit()
        return {"total": 1, "success": 1, "failed": 0, "updated": True}

    monkeypatch.setattr(
        article_command_service_module,
        "maybe_ingest_article_images_with_stats",
        fake_ingest_body_images,
    )
    service = ArticleCommandService(ai_task_service=StubAITaskService())

    article_id = asyncio.run(
        service.create_article(
            {
                "title": "body image ingest",
                "content_md": "正文\n\n![图](https://cdn.example.com/body.png)",
                "skip_ai_processing": True,
            },
            db_session,
        )
    )

    article = db_session.query(Article).filter(Article.id == article_id).first()
    assert captured["article_id"] == article_id
    assert "https://cdn.example.com/body.png" in captured["content_md"]
    assert article is not None
    assert article.content_md == "正文\n\n![图](/media/2026/06/body.webp)"


def test_create_article_keeps_explicit_top_image(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())

    article_id = asyncio.run(
        service.create_article(
            {
                "title": "explicit top image",
                "content_html": """
                <article>
                    <p>正文文本</p>
                    <img src="https://cdn.example.com/from-content.png" />
                </article>
                """,
                "content_md": "![封面图](https://cdn.example.com/from-markdown.png)",
                "top_image": "https://cdn.example.com/from-input.png",
                "skip_ai_processing": True,
            },
            db_session,
        )
    )

    article = db_session.query(Article).filter(Article.id == article_id).first()
    assert article is not None
    assert article.top_image == "https://cdn.example.com/from-input.png"


def test_create_article_keeps_client_html_even_when_jina_enabled(
    db_session,
    monkeypatch,
):
    """Client-provided bodies are final; Jina only applies on URL extract_url."""
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            jina_reader_enabled=True,
            jina_reader_prefer_mode="jina_first",
        )
    )
    db_session.commit()
    extraction_service = ArticleExtractionService()
    called = {"extract_html": 0}

    async def fake_extract_html(_db, **_kwargs):
        called["extract_html"] += 1
        return ExtractedArticle(
            title="Cleaned Title",
            content_html="<p>Cleaned content from Jina Reader.</p>",
            content_md="Cleaned content from Jina Reader.",
            source_url="https://example.com/cleaned",
            top_image="https://example.com/cleaned.png",
            author="Clean Author",
            published_at="2026-04-13",
            source_domain="example.com",
            provider="jina_html",
            metadata={"content_length": 33},
        )

    monkeypatch.setattr(extraction_service, "extract_html", fake_extract_html)
    service = ArticleCommandService(
        ai_task_service=StubAITaskService(),
        article_extraction_service=extraction_service,
    )

    article_id = asyncio.run(
        service.create_article(
            {
                "title": "Original Title",
                "content_html": "<article><p>Original selected HTML content.</p></article>",
                "content_md": "Original selected HTML content.",
                "content_structured": {"blocks": []},
                "source_url": "https://example.com/original",
                "skip_ai_processing": True,
                "extraction_provider": "browser_extension",
                "extraction_status": "completed",
            },
            db_session,
        )
    )

    article = db_session.query(Article).filter(Article.id == article_id).first()
    assert called["extract_html"] == 0
    assert article is not None
    assert article.title == "Original Title"
    assert article.content_html == "<article><p>Original selected HTML content.</p></article>"
    assert article.content_md == "Original selected HTML content."
    assert article.content_structured is not None
    assert article.extraction_provider == "browser_extension"
    assert article.extraction_status == "completed"


def test_create_article_defaults_provider_direct_without_re_clean(
    db_session,
    monkeypatch,
):
    db_session.add(
        AdminSettings(
            password_hash="hash",
            jwt_secret="secret",
            jina_reader_enabled=True,
            jina_reader_prefer_mode="jina_first",
        )
    )
    db_session.commit()
    extraction_service = ArticleExtractionService()
    called = {"extract_html": 0}

    async def fake_extract_html(_db, **_kwargs):
        called["extract_html"] += 1
        raise ArticleExtractionBadGatewayError("Jina HTML unavailable")

    monkeypatch.setattr(extraction_service, "extract_html", fake_extract_html)
    service = ArticleCommandService(
        ai_task_service=StubAITaskService(),
        article_extraction_service=extraction_service,
    )

    article_id = asyncio.run(
        service.create_article(
            {
                "title": "Original Title",
                "content_html": "<article><p>Original selected HTML content.</p></article>",
                "content_md": "Original selected HTML content.",
                "source_url": "https://example.com/original",
                "skip_ai_processing": True,
            },
            db_session,
        )
    )

    article = db_session.query(Article).filter(Article.id == article_id).first()
    assert called["extract_html"] == 0
    assert article is not None
    assert article.content_html == "<article><p>Original selected HTML content.</p></article>"
    assert article.content_md == "Original selected HTML content."
    assert article.extraction_provider == "direct"
    assert article.extraction_status == "completed"


def test_retry_article_ai_refetches_html_when_article_has_only_markdown(
    db_session,
    monkeypatch,
):
    task_service = StubAITaskService()
    extraction_service = ArticleExtractionService()

    async def fake_extract_url(_db, source_url, *, ensure_public_url):
        ensure_public_url(source_url)
        return ExtractedArticle(
            title="Refetched Title",
            content_html="<article><p>Refetched HTML content.</p></article>",
            content_md="Refetched HTML content.",
            source_url=source_url,
            top_image="https://example.com/image.png",
            author="Refetched Author",
            published_at="2026-04-13",
            source_domain="example.com",
            provider="local_html",
            metadata={"content_length": 23},
        )

    monkeypatch.setattr(extraction_service, "extract_url", fake_extract_url)
    service = ArticleCommandService(
        ai_task_service=task_service,
        article_extraction_service=extraction_service,
    )
    article = Article(
        title="Markdown only",
        slug="markdown-only",
        content_html=None,
        content_md="Only markdown content.",
        source_url="https://93.184.216.34/article",
        status="completed",
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    article_id = asyncio.run(service.retry_article_ai(db_session, article.id))

    db_session.refresh(article)
    assert article_id == article.id
    assert article.content_html == "<article><p>Refetched HTML content.</p></article>"
    assert article.content_md == "Refetched HTML content."
    assert article.extraction_provider == "local_html"
    assert article.status == "pending"
    assert len(task_service.tasks) == 1
    assert task_service.tasks[0]["task_type"] == "process_article_cleaning"
    assert task_service.tasks[0]["payload"]["source_format"] == "html"


def test_retry_article_ai_rejects_markdown_only_article_without_source_url(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())
    article = Article(
        title="Markdown only",
        slug="markdown-only-no-url",
        content_html=None,
        content_md="Only markdown content.",
        source_url=None,
        status="completed",
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    with pytest.raises(ValueError, match="缺少HTML正文和来源URL"):
        asyncio.run(service.retry_article_ai(db_session, article.id))


def test_delete_ai_content_clears_only_requested_content_type(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())
    article = make_article_with_analysis(db_session)

    service.delete_ai_content(db_session, article.id, "quotes")

    db_session.refresh(article)
    assert article.ai_analysis is not None
    assert article.ai_analysis.summary == "summary stays"
    assert article.ai_analysis.summary_status == "completed"
    assert article.ai_analysis.quotes is None
    assert article.ai_analysis.quotes_status is None
    assert article.ai_analysis.outline == "outline"


def test_delete_ai_content_rejects_removed_content_type(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())
    article = make_article_with_analysis(db_session)

    with pytest.raises(ValueError, match="不支持删除该类型的 AI 解读"):
        service.delete_ai_content(db_session, article.id, "infographic")


def test_delete_ai_content_rejects_summary(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())
    article = make_article_with_analysis(db_session)

    version = AIAnalysisVersion(
        article_id=article.id,
        content_type="summary",
        version_number=1,
        status="completed",
        content_text="summary stays",
        created_by_mode="generation",
        created_at=now_str(),
    )
    db_session.add(version)
    db_session.commit()
    article.ai_analysis.current_summary_version_id = version.id
    db_session.commit()

    with pytest.raises(ValueError, match="不支持删除该类型的 AI 解读"):
        service.delete_ai_content(db_session, article.id, "summary")

    db_session.refresh(article)
    assert article.ai_analysis.summary == "summary stays"
    assert article.ai_analysis.summary_status == "completed"
    assert article.ai_analysis.current_summary_version_id == version.id
    assert (
        db_session.query(AIAnalysisVersion)
        .filter(AIAnalysisVersion.article_id == article.id)
        .filter(AIAnalysisVersion.content_type == "summary")
        .count()
        == 1
    )


def test_delete_ai_content_rejects_inflight_ai_task(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())
    article = make_article_with_analysis(db_session)
    task = AITask(
        article_id=article.id,
        task_type="process_ai_content",
        content_type="quotes",
        status="processing",
        payload="{}",
        run_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(task)
    db_session.commit()

    try:
        service.delete_ai_content(db_session, article.id, "quotes")
    except ValueError as exc:
        assert str(exc) == "当前类型的 AI 解读正在生成中，请稍后再试"
    else:
        raise AssertionError("expected delete_ai_content to reject inflight task")
