from __future__ import annotations

from types import SimpleNamespace

import pytest

import auth
from app.api.routers import comment_router
from models import Article, ArticleComment, now_str


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_get_article_comments_includes_hidden_for_cookie_admin(db_session):
    article = Article(
        title="Hidden comments article",
        slug="hidden-comments-article",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at=now_str(),
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()

    db_session.add_all(
        [
            ArticleComment(
                article_id=article.id,
                user_id="u1",
                user_name="Visible User",
                user_avatar="",
                provider="github",
                content="visible comment",
                reply_to_id=None,
                is_hidden=False,
                created_at=now_str(),
                updated_at=now_str(),
            ),
            ArticleComment(
                article_id=article.id,
                user_id="u2",
                user_name="Hidden User",
                user_avatar="",
                provider="github",
                content="hidden comment",
                reply_to_id=None,
                is_hidden=True,
                created_at=now_str(),
                updated_at=now_str(),
            ),
        ]
    )
    db_session.commit()

    admin = auth.create_admin_settings(db_session, "secret123")
    token = auth.create_token(admin.jwt_secret)

    comments = await comment_router.get_article_comments(
        article_slug=article.slug,
        include_hidden=True,
        request=SimpleNamespace(cookies={"lumina_admin_token": token}),
        db=db_session,
        credentials=None,
    )

    assert [item["content"] for item in comments] == [
        "visible comment",
        "hidden comment",
    ]
