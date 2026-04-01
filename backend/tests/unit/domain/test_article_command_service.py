import asyncio

import pytest

import app.domain.article_command_service as article_command_service_module
from app.domain.article_command_service import ArticleCommandService
from models import AIAnalysis, AIAnalysisVersion, AITask, Article, now_str


class StubAITaskService:
    def enqueue_task(self, *args, **kwargs) -> str:
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
        key_points="key points",
        key_points_status="completed",
        outline="outline",
        outline_status="completed",
        quotes="quotes",
        quotes_status="completed",
        infographic_html="<section>infographic</section>",
        infographic_image_url="/media/infographic.png",
        infographic_status="completed",
        updated_at="2026-03-27 10:00:00",
    )
    db_session.add(analysis)
    db_session.commit()
    db_session.refresh(analysis)
    db_session.refresh(article)
    return article


def test_create_article_uses_first_html_image_when_top_image_missing(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())

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
    assert article.ai_analysis.key_points == "key points"
    assert article.ai_analysis.outline == "outline"


def test_delete_ai_content_clears_infographic_html_and_image(db_session):
    service = ArticleCommandService(ai_task_service=StubAITaskService())
    article = make_article_with_analysis(db_session)
    assert not hasattr(article_command_service_module, "delete_media_asset_by_url")

    service.delete_ai_content(db_session, article.id, "infographic")

    db_session.refresh(article)
    assert article.ai_analysis is not None
    assert article.ai_analysis.infographic_html is None
    assert article.ai_analysis.infographic_image_url is None
    assert article.ai_analysis.infographic_status is None


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
