import asyncio

from app.domain.article_command_service import ArticleCommandService
from models import Article


class StubAITaskService:
    def enqueue_task(self, *args, **kwargs) -> str:
        return "task-id"


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
