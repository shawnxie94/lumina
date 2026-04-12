from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import auth
from app.api.routers import comment_router
from models import Article, ArticleComment, ReviewComment, ReviewIssue, ReviewTemplate, now_str


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


@pytest.mark.anyio
async def test_list_comments_includes_review_comments_with_resource_metadata(db_session):
    article = Article(
        title="Article with comments",
        slug="article-with-comments",
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
    template = ReviewTemplate(
        name="每周回顾",
        slug="weekly-review-template",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        review_input_mode="abstract",
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
        next_run_at="2026-04-07T09:00:00+08:00",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add_all([article, template])
    db_session.commit()

    issue = ReviewIssue(
        template_id=template.id,
        slug="review-with-comments",
        title="第 1 期回顾",
        status="published",
        window_start="2026-04-01T00:00:00+08:00",
        window_end="2026-04-08T00:00:00+08:00",
        top_image="",
        markdown_content="# 回顾",
        generated_at=now_str(),
        published_at="2026-04-06T09:00:00+08:00",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(issue)
    db_session.commit()

    article_comment = ArticleComment(
        article_id=article.id,
        user_id="article-user",
        user_name="Article User",
        user_avatar="",
        provider="github",
        content="article comment",
        reply_to_id=None,
        is_hidden=False,
        created_at="2026-04-09T08:00:00+08:00",
        updated_at="2026-04-09T08:00:00+08:00",
    )
    review_comment = ReviewComment(
        issue_id=issue.id,
        user_id="review-user",
        user_name="Review User",
        user_avatar="",
        provider="github",
        content="review comment",
        reply_to_id=None,
        is_hidden=False,
        created_at="2026-04-09T09:00:00+08:00",
        updated_at="2026-04-09T09:00:00+08:00",
    )
    db_session.add_all([article_comment, review_comment])
    db_session.commit()

    payload = await comment_router.list_comments(db=db_session, _=True)

    assert payload["pagination"]["total"] == 2
    assert [item["resource_type"] for item in payload["items"]] == ["review", "article"]
    assert payload["items"][0]["review_slug"] == issue.slug
    assert payload["items"][0]["resource_title"] == issue.title
    assert payload["items"][1]["article_slug"] == article.slug
    assert payload["items"][1]["resource_title"] == article.title


@pytest.mark.anyio
async def test_list_comments_article_title_filter_matches_review_title(db_session):
    template = ReviewTemplate(
        name="每周回顾",
        slug="weekly-review-filter-template",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        review_input_mode="abstract",
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
        next_run_at="2026-04-07T09:00:00+08:00",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(template)
    db_session.commit()

    issue = ReviewIssue(
        template_id=template.id,
        slug="review-filter-target",
        title="回顾标题筛选命中",
        status="published",
        window_start="2026-04-01T00:00:00+08:00",
        window_end="2026-04-08T00:00:00+08:00",
        top_image="",
        markdown_content="# 回顾",
        generated_at=now_str(),
        published_at="2026-04-06T09:00:00+08:00",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(issue)
    db_session.commit()

    review_comment = ReviewComment(
        issue_id=issue.id,
        user_id="review-user",
        user_name="Review User",
        user_avatar="",
        provider="github",
        content="review comment",
        reply_to_id=None,
        is_hidden=False,
        created_at="2026-04-09T09:00:00+08:00",
        updated_at="2026-04-09T09:00:00+08:00",
    )
    db_session.add(review_comment)
    db_session.commit()

    payload = await comment_router.list_comments(
        article_title="标题筛选命中",
        db=db_session,
        _=True,
    )

    assert payload["pagination"]["total"] == 1
    assert payload["items"][0]["resource_type"] == "review"
    assert payload["items"][0]["resource_title"] == issue.title


@pytest.mark.anyio
async def test_get_comment_notifications_includes_review_comments(db_session):
    article = Article(
        title="Notification article",
        slug="notification-article",
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
    template = ReviewTemplate(
        name="每周回顾",
        slug="notification-review-template",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        review_input_mode="abstract",
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
        next_run_at="2026-04-07T09:00:00+08:00",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add_all([article, template])
    db_session.commit()

    issue = ReviewIssue(
        template_id=template.id,
        slug="notification-review",
        title="通知回顾",
        status="published",
        window_start="2026-04-01T00:00:00+08:00",
        window_end="2026-04-08T00:00:00+08:00",
        top_image="",
        markdown_content="# 回顾",
        generated_at=now_str(),
        published_at="2026-04-06T09:00:00+08:00",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(issue)
    db_session.commit()

    db_session.add_all(
        [
            ArticleComment(
                article_id=article.id,
                user_id="article-user",
                user_name="Article User",
                user_avatar="",
                provider="github",
                content="article notification",
                reply_to_id=None,
                is_hidden=False,
                created_at="2026-04-09T08:00:00+08:00",
                updated_at="2026-04-09T08:00:00+08:00",
            ),
            ReviewComment(
                issue_id=issue.id,
                user_id="review-user",
                user_name="Review User",
                user_avatar="",
                provider="github",
                content="review notification",
                reply_to_id=None,
                is_hidden=False,
                created_at="2026-04-09T09:00:00+08:00",
                updated_at="2026-04-09T09:00:00+08:00",
            ),
        ]
    )
    db_session.commit()

    payload = await comment_router.get_comment_notifications(db=db_session, _=True)

    assert [item["resource_type"] for item in payload] == ["review", "article"]
    assert payload[0]["review_slug"] == issue.slug
    assert payload[0]["resource_title"] == issue.title
    assert payload[1]["article_slug"] == article.slug
    assert payload[1]["resource_title"] == article.title


@pytest.mark.anyio
async def test_delete_comment_removes_nested_descendants_for_reply_comment(db_session):
    article = Article(
        title="Delete nested replies article",
        slug="delete-nested-replies-article",
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

    root = ArticleComment(
        article_id=article.id,
        user_id="u1",
        user_name="Root User",
        user_avatar="",
        provider="github",
        content="root comment",
        reply_to_id=None,
        is_hidden=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(root)
    db_session.commit()

    reply = ArticleComment(
        article_id=article.id,
        user_id="u2",
        user_name="Reply User",
        user_avatar="",
        provider="github",
        content="reply comment",
        reply_to_id=root.id,
        is_hidden=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(reply)
    db_session.commit()

    nested_reply = ArticleComment(
        article_id=article.id,
        user_id="u3",
        user_name="Nested User",
        user_avatar="",
        provider="github",
        content="nested reply",
        reply_to_id=reply.id,
        is_hidden=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    sibling = ArticleComment(
        article_id=article.id,
        user_id="u4",
        user_name="Sibling User",
        user_avatar="",
        provider="github",
        content="sibling reply",
        reply_to_id=root.id,
        is_hidden=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add_all([nested_reply, sibling])
    db_session.commit()
    nested_reply_id = nested_reply.id
    sibling_id = sibling.id

    deleted = await comment_router.delete_comment(
        comment_id=reply.id,
        db=db_session,
        _=True,
    )

    assert deleted["success"] is True
    assert deleted["deleted"] == 2
    assert db_session.query(ArticleComment).filter(ArticleComment.id == reply.id).first() is None
    assert db_session.query(ArticleComment).filter(ArticleComment.id == nested_reply_id).first() is None
    assert db_session.query(ArticleComment).filter(ArticleComment.id == sibling_id).first() is not None


def test_admin_cookie_can_delete_article_comment_via_http_route(db_session):
    article = Article(
        title="Admin delete article comment",
        slug="admin-delete-article-comment",
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

    comment = ArticleComment(
        article_id=article.id,
        user_id="u1",
        user_name="Article User",
        user_avatar="",
        provider="github",
        content="delete me",
        reply_to_id=None,
        is_hidden=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(comment)
    db_session.commit()

    admin = auth.create_admin_settings(db_session, "secret123")
    token = auth.create_token(admin.jwt_secret)

    app = FastAPI()
    app.include_router(comment_router.router)
    app.dependency_overrides[comment_router.get_db] = lambda: db_session
    client = TestClient(app)

    response = client.delete(
        f"/api/comments/{comment.id}",
        cookies={"lumina_admin_token": token},
    )

    assert response.status_code == 200
    assert response.json()["success"] is True
