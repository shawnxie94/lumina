from __future__ import annotations

import json
import uuid

import pytest
from fastapi import FastAPI, HTTPException, Response
from fastapi.testclient import TestClient

from app.api.routers import review_router
from app.domain.review_service import REVIEW_ARTICLE_SECTIONS_PLACEHOLDER
from models import (
    AIAnalysis,
    AITask,
    Article,
    Category,
    ModelAPIConfig,
    ReviewComment,
    ReviewIssue,
    ReviewIssueArticle,
    ReviewTemplate,
    now_str,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


def make_template(
    db_session,
    *,
    name: str = "每周回顾",
    slug: str = "weekly-review",
    system_prompt: str | None = None,
) -> ReviewTemplate:
    template = ReviewTemplate(
        id=str(uuid.uuid4()),
        name=name,
        slug=slug,
        description="",
        is_enabled=True,
        schedule_type="weekly",
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        review_input_mode="abstract",
        system_prompt=system_prompt,
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
        next_run_at="2026-04-07T09:00:00+08:00",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(template)
    db_session.commit()
    db_session.refresh(template)
    return template


def make_model_config(
    db_session,
    *,
    name: str = "Review Writer",
    model_type: str = "general",
    is_enabled: bool = True,
) -> ModelAPIConfig:
    model = ModelAPIConfig(
        id=str(uuid.uuid4()),
        name=name,
        base_url="https://example.com/v1",
        api_key="test-key",
        provider="openai",
        model_name=name.lower().replace(" ", "-"),
        model_type=model_type,
        is_enabled=is_enabled,
        is_default=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(model)
    db_session.commit()
    db_session.refresh(model)
    return model


def make_category(
    db_session,
    *,
    name: str = "AI",
    sort_order: int = 0,
) -> Category:
    category = Category(
        id=str(uuid.uuid4()),
        name=name,
        description="",
        color="#2563eb",
        sort_order=sort_order,
        created_at=now_str(),
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category


def make_article(
    db_session,
    *,
    title: str,
    slug: str,
    category_id: str | None,
    created_at: str,
    summary: str = "",
    key_points: str = "",
    top_image: str = "",
    is_visible: bool = True,
) -> Article:
    article = Article(
        id=str(uuid.uuid4()),
        title=title,
        slug=slug,
        content_md="# 内容",
        content_trans="# 内容",
        top_image=top_image,
        author="Tester",
        published_at=created_at,
        source_domain="example.com",
        status="completed",
        is_visible=is_visible,
        category_id=category_id,
        created_at=created_at,
        updated_at=created_at,
    )
    db_session.add(article)
    db_session.flush()
    analysis = AIAnalysis(
        id=str(uuid.uuid4()),
        article_id=article.id,
        summary=summary,
        key_points=key_points,
    )
    db_session.add(analysis)
    db_session.commit()
    db_session.refresh(article)
    return article


def make_issue(
    db_session,
    template_id: str,
    *,
    slug: str,
    status: str,
    title: str | None = None,
    created_at: str | None = None,
    published_at: str | None = None,
    window_start: str = "2026-04-01T00:00:00+08:00",
    window_end: str = "2026-04-08T00:00:00+08:00",
    top_image: str | None = None,
    view_count: int = 0,
) -> ReviewIssue:
    issue_created_at = created_at or now_str()
    issue = ReviewIssue(
        id=str(uuid.uuid4()),
        template_id=template_id,
        slug=slug,
        title=title or slug,
        status=status,
        window_start=window_start,
        window_end=window_end,
        top_image=top_image,
        markdown_content=f"# 回顾\n\n{REVIEW_ARTICLE_SECTIONS_PLACEHOLDER}",
        generated_at=now_str(),
        published_at=published_at if status == "published" else None,
        view_count=view_count,
        created_at=issue_created_at,
        updated_at=issue_created_at,
    )
    db_session.add(issue)
    db_session.commit()
    db_session.refresh(issue)
    return issue


def make_review_comment(
    db_session,
    issue_id: str,
    *,
    user_id: str = "user-1",
    user_name: str = "Tester",
    content: str = "第一条评论",
    reply_to_id: str | None = None,
    is_hidden: bool = False,
    created_at: str | None = None,
) -> ReviewComment:
    timestamp = created_at or now_str()
    comment = ReviewComment(
        id=str(uuid.uuid4()),
        issue_id=issue_id,
        user_id=user_id,
        user_name=user_name,
        user_avatar="",
        provider="github",
        content=content,
        reply_to_id=reply_to_id,
        is_hidden=is_hidden,
        created_at=timestamp,
        updated_at=timestamp,
    )
    db_session.add(comment)
    db_session.commit()
    db_session.refresh(comment)
    return comment


def test_review_rss_route_takes_precedence_over_slug_route(db_session, monkeypatch):
    template = make_template(db_session, name="肖恩技术周刊", slug="shawn-weekly")
    make_issue(
        db_session,
        template.id,
        slug="weekly-review-1",
        status="published",
        title="第 1 期回顾",
        published_at="2026-04-06T09:00:00+08:00",
    )
    monkeypatch.setattr(review_router.article_rss_service, "assert_rss_enabled", lambda db: None)

    app = FastAPI()
    app.include_router(review_router.router)
    app.dependency_overrides[review_router.get_db] = lambda: db_session

    client = TestClient(app)

    response = client.get("/api/reviews/rss.xml")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/rss+xml")
    assert "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" in response.text


@pytest.mark.anyio
async def test_get_public_reviews_returns_only_published_items(db_session):
    template = make_template(db_session)
    make_issue(db_session, template.id, slug="draft-issue", status="draft")
    published = make_issue(db_session, template.id, slug="published-issue", status="published")

    payload = await review_router.get_public_reviews(
        response=Response(),
        page=1,
        size=20,
        db=db_session,
        is_admin=False,
    )

    assert [item["slug"] for item in payload["data"]] == [published.slug]
    assert payload["data"][0]["template"]["include_all_categories"] is True


@pytest.mark.anyio
async def test_get_public_reviews_includes_view_count_and_public_comment_count(db_session):
    template = make_template(db_session)
    published = make_issue(
        db_session,
        template.id,
        slug="published-issue",
        status="published",
        view_count=8,
    )
    make_review_comment(db_session, published.id, content="公开评论", is_hidden=False)
    make_review_comment(db_session, published.id, content="隐藏评论", is_hidden=True)

    payload = await review_router.get_public_reviews(
        response=Response(),
        page=1,
        size=20,
        db=db_session,
        is_admin=False,
    )

    assert payload["data"][0]["view_count"] == 8
    assert payload["data"][0]["comment_count"] == 1


@pytest.mark.anyio
async def test_get_public_reviews_allows_admin_to_see_draft_items(db_session):
    template = make_template(db_session)
    draft = make_issue(db_session, template.id, slug="draft-issue", status="draft")
    published = make_issue(db_session, template.id, slug="published-issue", status="published")

    payload = await review_router.get_public_reviews(
        response=Response(),
        page=1,
        size=20,
        db=db_session,
        is_admin=True,
    )

    assert [item["slug"] for item in payload["data"]] == [published.slug]
    assert payload["data"][0]["version_count"] == 2
    assert {item["slug"] for item in payload["data"][0]["versions"]} == {
        draft.slug,
        published.slug,
    }


@pytest.mark.anyio
async def test_get_public_reviews_sorts_by_published_at_desc(db_session):
    template = make_template(db_session)
    newer_created = make_issue(
        db_session,
        template.id,
        slug="newer-created-review",
        status="published",
        title="新建更晚",
        created_at="2026-04-05T12:00:00+08:00",
        published_at="2026-04-03T09:00:00+08:00",
        window_start="2026-03-24T00:00:00+08:00",
        window_end="2026-03-31T00:00:00+08:00",
    )
    older_created = make_issue(
        db_session,
        template.id,
        slug="older-created-review",
        status="published",
        title="新建更早",
        created_at="2026-04-04T12:00:00+08:00",
        published_at="2026-04-04T09:00:00+08:00",
        window_start="2026-03-31T00:00:00+08:00",
        window_end="2026-04-07T00:00:00+08:00",
    )

    payload = await review_router.get_public_reviews(
        response=Response(),
        page=1,
        size=20,
        db=db_session,
        is_admin=False,
    )

    assert [item["slug"] for item in payload["data"]] == [
        older_created.slug,
        newer_created.slug,
    ]


@pytest.mark.anyio
async def test_get_public_reviews_places_drafts_first_for_admin(db_session):
    template = make_template(db_session)
    older_draft = make_issue(
        db_session,
        template.id,
        slug="older-draft-review",
        status="draft",
        title="较早草稿",
        created_at="2026-04-05T09:00:00+08:00",
        window_start="2026-04-01T00:00:00+08:00",
        window_end="2026-04-08T00:00:00+08:00",
    )
    newer_draft = make_issue(
        db_session,
        template.id,
        slug="newer-draft-review",
        status="draft",
        title="较新草稿",
        created_at="2026-04-05T12:00:00+08:00",
        window_start="2026-04-08T00:00:00+08:00",
        window_end="2026-04-15T00:00:00+08:00",
    )
    published = make_issue(
        db_session,
        template.id,
        slug="published-review",
        status="published",
        title="已发布内容",
        created_at="2026-04-05T11:00:00+08:00",
        published_at="2026-04-06T09:00:00+08:00",
        window_start="2026-03-25T00:00:00+08:00",
        window_end="2026-04-01T00:00:00+08:00",
    )

    payload = await review_router.get_public_reviews(
        response=Response(),
        page=1,
        size=20,
        db=db_session,
        is_admin=True,
    )

    assert [item["slug"] for item in payload["data"]] == [
        newer_draft.slug,
        older_draft.slug,
        published.slug,
    ]


@pytest.mark.anyio
async def test_get_public_reviews_groups_same_issue_versions_into_one_card_for_admin(db_session):
    template = make_template(db_session)
    older = make_issue(
        db_session,
        template.id,
        slug="weekly-review-v1",
        status="draft",
        title="第 1 版",
        created_at="2026-04-04T10:00:00+08:00",
    )
    latest = make_issue(
        db_session,
        template.id,
        slug="weekly-review-v2",
        status="draft",
        title="第 2 版",
        created_at="2026-04-04T11:00:00+08:00",
    )
    other_window = make_issue(
        db_session,
        template.id,
        slug="weekly-review-next-window",
        status="draft",
        title="下一期",
        created_at="2026-04-05T10:00:00+08:00",
        window_start="2026-04-08T00:00:00+08:00",
        window_end="2026-04-15T00:00:00+08:00",
    )

    payload = await review_router.get_public_reviews(
        response=Response(),
        page=1,
        size=20,
        db=db_session,
        is_admin=True,
    )

    assert payload["pagination"]["total"] == 2
    assert [item["slug"] for item in payload["data"]] == [other_window.slug, latest.slug]
    assert payload["data"][1]["version_count"] == 2
    assert [item["slug"] for item in payload["data"][1]["versions"]] == [
        latest.slug,
        older.slug,
    ]
    assert payload["filters"]["templates"][1]["count"] == 2


@pytest.mark.anyio
async def test_get_public_reviews_supports_template_and_visibility_filters_for_admin(db_session):
    weekly = make_template(db_session, name="周回顾", slug="weekly-review")
    monthly = make_template(db_session, name="月回顾", slug="monthly-review")
    make_issue(db_session, weekly.id, slug="weekly-draft", status="draft")
    weekly_published = make_issue(db_session, weekly.id, slug="weekly-published", status="published")
    make_issue(db_session, monthly.id, slug="monthly-draft", status="draft")

    payload = await review_router.get_public_reviews(
        response=Response(),
        page=1,
        size=20,
        template_id=weekly.id,
        search=None,
        published_at_start=None,
        published_at_end=None,
        visibility="published",
        db=db_session,
        is_admin=True,
    )

    assert [item["slug"] for item in payload["data"]] == [weekly_published.slug]
    assert payload["filters"]["templates"][0]["id"] == ""


@pytest.mark.anyio
async def test_get_public_reviews_supports_search_and_published_at_range(db_session):
    template = make_template(db_session)
    matched = make_issue(
        db_session,
        template.id,
        slug="target-review",
        status="published",
        title="AI 周回顾精选",
        created_at="2026-04-03T10:00:00+08:00",
        published_at="2026-04-04T10:00:00+08:00",
    )
    make_issue(
        db_session,
        template.id,
        slug="outside-range-review",
        status="published",
        title="AI 周回顾过期",
        created_at="2026-03-20T10:00:00+08:00",
        published_at="2026-03-20T10:00:00+08:00",
    )
    make_issue(
        db_session,
        template.id,
        slug="title-miss-review",
        status="published",
        title="工具月报",
        created_at="2026-04-03T10:00:00+08:00",
        published_at="2026-04-04T10:00:00+08:00",
    )

    payload = await review_router.get_public_reviews(
        response=Response(),
        page=1,
        size=20,
        template_id=None,
        search="AI 周回顾",
        published_at_start="2026-04-01T00:00:00+08:00",
        published_at_end="2026-04-05T23:59:59+08:00",
        visibility=None,
        db=db_session,
        is_admin=False,
    )

    assert [item["slug"] for item in payload["data"]] == [matched.slug]


@pytest.mark.anyio
async def test_get_public_review_detail_rejects_draft_issue(db_session):
    template = make_template(db_session)
    make_issue(db_session, template.id, slug="draft-issue", status="draft")

    with pytest.raises(HTTPException) as exc_info:
        await review_router.get_public_review_detail(
            review_slug="draft-issue",
            db=db_session,
            is_admin=False,
    )
    assert exc_info.value.detail == "回顾不存在"


@pytest.mark.anyio
async def test_get_public_review_detail_includes_neighbors_and_public_comment_count(db_session):
    template = make_template(db_session)
    previous = make_issue(
        db_session,
        template.id,
        slug="review-prev",
        status="published",
        title="上一期",
        created_at="2026-03-29T10:00:00+08:00",
        published_at="2026-03-30T09:00:00+08:00",
        window_start="2026-03-17T00:00:00+08:00",
        window_end="2026-03-24T00:00:00+08:00",
    )
    target = make_issue(
        db_session,
        template.id,
        slug="review-current",
        status="published",
        title="当前期",
        created_at="2026-04-05T10:00:00+08:00",
        published_at="2026-04-06T09:00:00+08:00",
        window_start="2026-03-24T00:00:00+08:00",
        window_end="2026-03-31T00:00:00+08:00",
    )
    next_issue = make_issue(
        db_session,
        template.id,
        slug="review-next",
        status="published",
        title="下一期",
        created_at="2026-04-12T10:00:00+08:00",
        published_at="2026-04-13T09:00:00+08:00",
        window_start="2026-03-31T00:00:00+08:00",
        window_end="2026-04-07T00:00:00+08:00",
    )
    make_issue(
        db_session,
        template.id,
        slug="review-draft",
        status="draft",
        title="草稿不参与跳转",
        created_at="2026-04-13T10:00:00+08:00",
        window_start="2026-04-07T00:00:00+08:00",
        window_end="2026-04-14T00:00:00+08:00",
    )
    make_review_comment(db_session, target.id, content="公开评论")
    make_review_comment(db_session, target.id, content="隐藏评论", is_hidden=True)

    payload = await review_router.get_public_review_detail(
        review_slug=target.slug,
        db=db_session,
        is_admin=False,
    )

    assert payload["view_count"] == 0
    assert payload["comment_count"] == 1
    assert payload["prev_review"]["id"] == previous.id
    assert payload["prev_review"]["slug"] == previous.slug
    assert payload["next_review"]["id"] == next_issue.id
    assert payload["next_review"]["slug"] == next_issue.slug


@pytest.mark.anyio
async def test_record_review_view_increments_published_review_counter(db_session):
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        slug="published-issue",
        status="published",
        view_count=2,
    )

    payload = await review_router.record_review_view(
        review_slug=issue.slug,
        db=db_session,
        is_admin=False,
    )

    db_session.refresh(issue)
    assert payload == {
        "review_slug": issue.slug,
        "view_count": 3,
        "counted": True,
    }
    assert issue.view_count == 3


@pytest.mark.anyio
async def test_record_review_view_rejects_draft_review_for_public(db_session):
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        slug="draft-issue",
        status="draft",
        view_count=4,
    )

    with pytest.raises(HTTPException) as exc_info:
        await review_router.record_review_view(
            review_slug=issue.slug,
            db=db_session,
            is_admin=False,
        )

    db_session.refresh(issue)
    assert exc_info.value.status_code == 404
    assert issue.view_count == 4


@pytest.mark.anyio
async def test_get_review_rss_supports_template_filter_and_outputs_review_items(
    db_session,
    monkeypatch,
):
    template = make_template(db_session, name="肖恩技术周刊", slug="shawn-weekly")
    other_template = make_template(db_session, name="产品月报", slug="product-monthly")
    matched = make_issue(
        db_session,
        template.id,
        slug="weekly-review-1",
        status="published",
        title="第 1 期回顾",
        published_at="2026-04-06T09:00:00+08:00",
        top_image="/media/reviews/weekly-cover.png",
    )
    matched.markdown_content = "# 第 1 期回顾\n\n本期摘要"
    other = make_issue(
        db_session,
        other_template.id,
        slug="product-review-1",
        status="published",
        title="产品月报 1",
        published_at="2026-04-05T09:00:00+08:00",
    )
    other.markdown_content = "# 产品月报\n\n其他摘要"
    make_issue(
        db_session,
        template.id,
        slug="weekly-review-draft",
        status="draft",
        title="草稿不出现在 RSS",
    )
    db_session.commit()

    class DummyRequest:
        headers = {"origin": "https://lumina.example.com"}
        base_url = "https://lumina.example.com/"

    monkeypatch.setattr(review_router.article_rss_service, "assert_rss_enabled", lambda db: None)

    response = await review_router.get_reviews_rss(
        request=DummyRequest(),
        template_id=template.id,
        db=db_session,
    )

    body = response.body.decode("utf-8")
    assert response.media_type == "application/rss+xml"
    assert "<title>Lumina</title>" in body
    assert "https://lumina.example.com/reviews?template_id=" in body
    assert f"https://lumina.example.com/backend/api/reviews/rss.xml?template_id={template.id}" in body
    assert f"<link>https://lumina.example.com/reviews/{matched.slug}</link>" in body
    assert matched.title in body
    assert "本期摘要" in body
    assert "产品月报 1" not in body
    assert "草稿不出现在 RSS" not in body


@pytest.mark.anyio
async def test_get_public_review_detail_includes_sidebar_template_info_and_recent_reviews(db_session):
    template = make_template(db_session, name="肖恩技术周刊", slug="shawn-weekly")
    other_template = make_template(db_session, name="产品月报", slug="product-monthly")
    template.description = "聚焦 AI 工程化、智能体与基础设施。"
    template.schedule_type = "weekly"
    template.trigger_time = "08:00"
    db_session.commit()

    for index in range(1, 7):
        make_issue(
            db_session,
            template.id,
            slug=f"weekly-review-{index}",
            status="published",
            title=f"第 {index} 期",
            created_at=f"2026-04-0{index}T10:00:00+08:00",
            published_at=f"2026-04-0{index}T09:00:00+08:00",
            window_start=f"2026-03-{20 + index:02d}T00:00:00+08:00",
            window_end=f"2026-03-{21 + index:02d}T00:00:00+08:00",
        )
    make_issue(
        db_session,
        template.id,
        slug="weekly-review-draft",
        status="draft",
        title="草稿版",
        created_at="2026-04-07T10:00:00+08:00",
        published_at=None,
        window_start="2026-03-27T00:00:00+08:00",
        window_end="2026-03-28T00:00:00+08:00",
    )
    make_issue(
        db_session,
        other_template.id,
        slug="product-monthly-1",
        status="published",
        title="产品月报 1",
        created_at="2026-04-07T10:00:00+08:00",
        published_at="2026-04-07T09:00:00+08:00",
        window_start="2026-04-01T00:00:00+08:00",
        window_end="2026-05-01T00:00:00+08:00",
    )

    payload = await review_router.get_public_review_detail(
        review_slug="weekly-review-5",
        db=db_session,
        is_admin=False,
    )

    assert payload["template"]["description"] == "聚焦 AI 工程化、智能体与基础设施。"
    assert payload["template"]["schedule_type"] == "weekly"
    assert payload["template"]["trigger_time"] == "08:00"
    assert len(payload["recent_reviews"]) == 5
    assert [item["slug"] for item in payload["recent_reviews"]] == [
        "product-monthly-1",
        "weekly-review-6",
        "weekly-review-4",
        "weekly-review-3",
        "weekly-review-2",
    ]


@pytest.mark.anyio
async def test_get_public_review_comments_hides_hidden_items_for_public(db_session):
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, slug="published-issue", status="published")
    visible = make_review_comment(db_session, issue.id, content="可见评论")
    make_review_comment(db_session, issue.id, content="隐藏评论", is_hidden=True)

    payload = await review_router.get_review_comments(
        review_slug=issue.slug,
        include_hidden=False,
        request=None,
        db=db_session,
        credentials=None,
    )

    assert [item["id"] for item in payload] == [visible.id]
    assert payload[0]["review_slug"] == issue.slug


@pytest.mark.anyio
async def test_create_update_toggle_and_delete_review_comment(db_session):
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, slug="published-issue", status="published")

    created = await review_router.create_review_comment(
        review_slug=issue.slug,
        payload=review_router.CommentCreate(
            content="首条评论",
            user_id="user-1",
            user_name="Tester",
            user_avatar="",
            provider="github",
            reply_to_id=None,
        ),
        db=db_session,
        _=True,
    )

    assert created["content"] == "首条评论"

    updated = await review_router.update_review_comment(
        comment_id=created["id"],
        payload=review_router.CommentUpdate(content="改后的评论"),
        db=db_session,
        _=True,
    )
    assert updated["content"] == "改后的评论"

    toggled = await review_router.update_review_comment_visibility(
        comment_id=created["id"],
        payload=review_router.CommentVisibilityUpdate(is_hidden=True),
        db=db_session,
        _=True,
    )
    assert toggled["is_hidden"] is True

    deleted = await review_router.delete_review_comment(
        comment_id=created["id"],
        db=db_session,
        _=True,
    )
    assert deleted["success"] is True
    assert db_session.query(ReviewComment).filter(ReviewComment.id == created["id"]).first() is None


@pytest.mark.anyio
async def test_get_public_review_detail_allows_admin_to_open_draft_issue(db_session):
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, slug="draft-issue", status="draft")

    payload = await review_router.get_public_review_detail(
        review_slug="draft-issue",
        db=db_session,
        is_admin=True,
    )

    assert payload["id"] == issue.id
    assert payload["status"] == "draft"


@pytest.mark.anyio
async def test_get_review_issue_detail_includes_selected_article_ids_and_template_model(db_session):
    category = make_category(db_session, name="AI", sort_order=1)
    model = make_model_config(db_session, name="Review Default Model")
    template = make_template(db_session, name="周刊模板", slug="weekly-template")
    template.model_api_config_id = model.id
    db_session.commit()

    first_article = make_article(
        db_session,
        title="第一篇",
        slug="first-article",
        category_id=category.id,
        created_at="2026-04-01T08:00:00+08:00",
        summary="摘要 1",
    )
    second_article = make_article(
        db_session,
        title="第二篇",
        slug="second-article",
        category_id=category.id,
        created_at="2026-04-02T08:00:00+08:00",
        summary="摘要 2",
    )
    issue = make_issue(db_session, template.id, slug="draft-issue", status="draft")
    db_session.add_all(
        [
            ReviewIssueArticle(
                id=str(uuid.uuid4()),
                issue_id=issue.id,
                article_id=second_article.id,
                category_id=category.id,
                category_sort_order=1,
                article_sort_order=1,
                created_at=now_str(),
                updated_at=now_str(),
            ),
            ReviewIssueArticle(
                id=str(uuid.uuid4()),
                issue_id=issue.id,
                article_id=first_article.id,
                category_id=category.id,
                category_sort_order=1,
                article_sort_order=2,
                created_at=now_str(),
                updated_at=now_str(),
            ),
        ]
    )
    db_session.commit()

    payload = await review_router.get_review_issue_detail(
        issue_id=issue.id,
        db=db_session,
        _=True,
    )

    assert payload["selected_article_ids"] == [second_article.id, first_article.id]
    assert payload["template"]["model_api_config_id"] == model.id


@pytest.mark.anyio
async def test_update_review_rejects_missing_article_placeholder(db_session):
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, slug="draft-issue", status="draft")

    with pytest.raises(HTTPException) as exc_info:
        await review_router.update_review_issue(
            issue_id=issue.id,
            payload=review_router.ReviewIssueUpdateRequest(
                title="新标题",
                markdown_content="# 手工正文\n\n没有占位符",
            ),
            db=db_session,
            _=True,
    )
    assert "至少一个 {{article_slug}} 文章占位符" in exc_info.value.detail


@pytest.mark.anyio
async def test_update_review_accepts_top_image_and_published_at(db_session):
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, slug="draft-issue", status="draft")

    payload = await review_router.update_review_issue(
        issue_id=issue.id,
        payload=review_router.ReviewIssueUpdateRequest(
            title="新标题",
            published_at="2026-04-05",
            top_image="https://example.com/review-cover.png",
            markdown_content="# 手工正文\n\n{{review_article_sections}}",
        ),
        db=db_session,
        _=True,
    )

    assert payload["title"] == "新标题"
    assert payload["published_at"] == "2026-04-05"
    assert payload["top_image"] == "https://example.com/review-cover.png"


@pytest.mark.anyio
async def test_update_review_accepts_article_slug_placeholders(db_session):
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, slug="draft-issue", status="draft")

    payload = await review_router.update_review_issue(
        issue_id=issue.id,
        payload=review_router.ReviewIssueUpdateRequest(
            title="新标题",
            markdown_content="# 手工正文\n\n## AI\n\n### {{openai-news}}",
        ),
        db=db_session,
        _=True,
    )

    assert payload["title"] == "新标题"
    assert payload["markdown_content"] == "# 手工正文\n\n## AI\n\n### {{openai-news}}"


@pytest.mark.anyio
async def test_run_review_template_now_enqueues_generation_task(db_session, monkeypatch):
    template = make_template(db_session)
    monkeypatch.setattr(review_router, "now_str", lambda: "2026-04-04T12:00:00+08:00")

    payload = await review_router.run_review_template_now(
        template_id=template.id,
        db=db_session,
        _=True,
    )

    assert payload["success"] is True
    assert payload["task_id"]
    task = db_session.query(AITask).filter(AITask.task_type == "generate_review_issue").one()
    assert task.id == payload["task_id"]
    assert task.payload


@pytest.mark.anyio
async def test_run_review_template_now_only_enqueues_selected_template(db_session, monkeypatch):
    target = make_template(db_session, name="目标模板", slug="target-template")
    other = make_template(db_session, name="其他模板", slug="other-template")
    monkeypatch.setattr(review_router, "now_str", lambda: "2026-04-04T12:00:00+08:00")

    payload = await review_router.run_review_template_now(
        template_id=target.id,
        db=db_session,
        _=True,
    )

    assert payload["success"] is True
    assert payload["task_id"]
    tasks = db_session.query(AITask).filter(AITask.task_type == "generate_review_issue").all()
    assert len(tasks) == 1
    assert tasks[0].id == payload["task_id"]
    assert target.id in tasks[0].payload
    assert other.id not in tasks[0].payload
    target_issue = db_session.query(ReviewIssue).filter(ReviewIssue.template_id == target.id).one()
    assert target_issue.window_start == "2026-03-30T00:00:00+08:00"
    assert target_issue.window_end == "2026-04-06T00:00:00+08:00"


@pytest.mark.anyio
async def test_get_review_template_generation_preview_returns_window_defaults_and_filtered_articles(
    db_session,
    monkeypatch,
):
    target_category = make_category(db_session, name="AI", sort_order=1)
    other_category = make_category(db_session, name="效率", sort_order=2)
    template = make_template(db_session, name="周刊模板", slug="weekly-template")
    template.include_all_categories = False
    template.categories = [target_category]
    db_session.commit()

    in_window_latest = make_article(
        db_session,
        title="AI Agent 实战",
        slug="ai-agent-practice",
        category_id=target_category.id,
        created_at="2026-04-03T08:00:00+08:00",
        summary="摘要 A",
    )
    in_window_older = make_article(
        db_session,
        title="模型工程综述",
        slug="model-engineering",
        category_id=target_category.id,
        created_at="2026-04-01T08:00:00+08:00",
        summary="摘要 B",
    )
    make_article(
        db_session,
        title="隐藏候选文章",
        slug="hidden-candidate-article",
        category_id=target_category.id,
        created_at="2026-04-02T08:00:00+08:00",
        summary="隐藏摘要",
        is_visible=False,
    )
    make_article(
        db_session,
        title="不在模板分类",
        slug="other-category-article",
        category_id=other_category.id,
        created_at="2026-04-03T08:00:00+08:00",
        summary="摘要 C",
    )
    make_article(
        db_session,
        title="超出时间窗口",
        slug="outside-window-article",
        category_id=target_category.id,
        created_at="2026-04-08T08:00:00+08:00",
        summary="摘要 D",
    )

    monkeypatch.setattr(review_router, "now_str", lambda: "2026-04-05T12:00:00+08:00")

    payload = await review_router.get_review_template_generation_preview(
        template_id=template.id,
        date_start=None,
        date_end=None,
        db=db_session,
        _=True,
    )

    assert payload["template"]["id"] == template.id
    assert payload["date_start"] == "2026-03-30"
    assert payload["date_end"] == "2026-04-05"
    assert [item["id"] for item in payload["articles"]] == [
        in_window_latest.id,
        in_window_older.id,
    ]
    assert payload["articles"][0]["summary"] == "摘要 A"
    assert payload["articles"][0]["category"]["id"] == target_category.id


@pytest.mark.anyio
async def test_run_review_template_manual_enqueues_selected_articles_and_model_override(
    db_session,
    monkeypatch,
):
    category = make_category(db_session, name="AI", sort_order=1)
    template = make_template(db_session, name="周刊模板", slug="weekly-template")
    template.include_all_categories = False
    template.categories = [category]
    db_session.commit()
    model = make_model_config(db_session, name="Manual Review Model")
    first_article = make_article(
        db_session,
        title="第一篇",
        slug="first-article",
        category_id=category.id,
        created_at="2026-04-01T08:00:00+08:00",
        summary="摘要 1",
    )
    second_article = make_article(
        db_session,
        title="第二篇",
        slug="second-article",
        category_id=category.id,
        created_at="2026-04-02T08:00:00+08:00",
        summary="摘要 2",
    )

    monkeypatch.setattr(review_router, "now_str", lambda: "2026-04-05T12:00:00+08:00")

    payload = await review_router.run_review_template_manual(
        template_id=template.id,
        payload=review_router.ReviewTemplateManualRunRequest(
            date_start="2026-04-01",
            date_end="2026-04-03",
            article_ids=[second_article.id, first_article.id],
            model_api_config_id=model.id,
        ),
        db=db_session,
        _=True,
    )

    assert payload["success"] is True
    assert payload["task_id"]
    assert payload["issue_id"]

    issue = db_session.query(ReviewIssue).filter(ReviewIssue.id == payload["issue_id"]).one()
    assert issue.template_id == template.id
    assert issue.status == "draft"
    assert issue.window_start == "2026-04-01T00:00:00+08:00"
    assert issue.window_end == "2026-04-04T00:00:00+08:00"

    task = db_session.query(AITask).filter(AITask.id == payload["task_id"]).one()
    task_payload = json.loads(task.payload)
    assert task_payload["template_id"] == template.id
    assert task_payload["issue_id"] == issue.id
    assert task_payload["article_ids"] == [second_article.id, first_article.id]
    assert task_payload["model_api_config_id"] == model.id


@pytest.mark.anyio
async def test_create_review_template_generates_slug_when_payload_omits_it(db_session):
    payload = review_router.ReviewTemplateBase(
        name="技术周回顾",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        custom_interval_days=None,
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        category_ids=[],
        system_prompt="你是回顾主编。",
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
    )

    result = await review_router.create_review_template(
        payload=payload,
        db=db_session,
        _=True,
    )

    created = db_session.query(ReviewTemplate).filter(ReviewTemplate.id == result["id"]).one()
    assert created.slug == "ji-zhu-zhou-hui-gu"
    assert created.system_prompt == "你是回顾主编。"


@pytest.mark.anyio
async def test_create_review_template_generates_unique_slug_for_duplicate_names(db_session):
    first_payload = review_router.ReviewTemplateBase(
        name="技术周回顾",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        custom_interval_days=None,
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        category_ids=[],
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
    )
    second_payload = review_router.ReviewTemplateBase(
        name="技术周回顾",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        custom_interval_days=None,
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        category_ids=[],
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
    )

    first = await review_router.create_review_template(
        payload=first_payload,
        db=db_session,
        _=True,
    )
    second = await review_router.create_review_template(
        payload=second_payload,
        db=db_session,
        _=True,
    )

    first_template = db_session.query(ReviewTemplate).filter(ReviewTemplate.id == first["id"]).one()
    second_template = db_session.query(ReviewTemplate).filter(ReviewTemplate.id == second["id"]).one()
    assert first_template.slug == "ji-zhu-zhou-hui-gu"
    assert second_template.slug == "ji-zhu-zhou-hui-gu-2"


@pytest.mark.anyio
async def test_create_review_template_persists_selected_model_config(db_session):
    model = make_model_config(db_session)
    payload = review_router.ReviewTemplateBase(
        name="技术周回顾",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        custom_interval_days=None,
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        category_ids=[],
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
        model_api_config_id=model.id,
    )

    created = await review_router.create_review_template(
        payload=payload,
        db=db_session,
        _=True,
    )
    rows = await review_router.get_review_templates(db=db_session, _=True)

    created_template = db_session.query(ReviewTemplate).filter(ReviewTemplate.id == created["id"]).one()
    serialized = next(item for item in rows if item["id"] == created["id"])

    assert getattr(created_template, "model_api_config_id", None) == model.id
    assert serialized["model_api_config_id"] == model.id


@pytest.mark.anyio
async def test_create_review_template_persists_input_mode_and_advanced_generation_params(
    db_session,
):
    payload = review_router.ReviewTemplateBase(
        name="技术周回顾",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        custom_interval_days=None,
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        category_ids=[],
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
        review_input_mode="full_text",
        temperature=0.85,
        max_tokens=2400,
        top_p=0.7,
    )

    created = await review_router.create_review_template(
        payload=payload,
        db=db_session,
        _=True,
    )
    rows = await review_router.get_review_templates(db=db_session, _=True)

    created_template = db_session.query(ReviewTemplate).filter(ReviewTemplate.id == created["id"]).one()
    serialized = next(item for item in rows if item["id"] == created["id"])

    assert getattr(created_template, "review_input_mode", None) == "full_text"
    assert getattr(created_template, "temperature", None) == pytest.approx(0.85)
    assert getattr(created_template, "max_tokens", None) == 2400
    assert getattr(created_template, "top_p", None) == pytest.approx(0.7)
    assert serialized["review_input_mode"] == "full_text"
    assert serialized["temperature"] == pytest.approx(0.85)
    assert serialized["max_tokens"] == 2400
    assert serialized["top_p"] == pytest.approx(0.7)


@pytest.mark.anyio
async def test_delete_review_template_removes_template_and_related_issues(db_session):
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, slug="issue-to-delete", status="draft")

    payload = await review_router.delete_review_template(
        template_id=template.id,
        db=db_session,
        _=True,
    )

    assert payload == {"success": True}
    assert db_session.query(ReviewTemplate).filter(ReviewTemplate.id == template.id).first() is None
    assert db_session.query(ReviewIssue).filter(ReviewIssue.id == issue.id).first() is None


@pytest.mark.anyio
async def test_delete_review_issue_removes_issue(db_session):
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, slug="issue-to-delete", status="draft")

    payload = await review_router.delete_review_issue(
        issue_id=issue.id,
        db=db_session,
        _=True,
    )

    assert payload == {"success": True}
    assert db_session.query(ReviewIssue).filter(ReviewIssue.id == issue.id).first() is None


@pytest.mark.anyio
async def test_publish_review_issue_deletes_other_drafts_in_same_group(db_session):
    template = make_template(db_session)
    target = make_issue(
        db_session,
        template.id,
        slug="issue-to-publish",
        status="draft",
        created_at="2026-04-04T11:00:00+08:00",
    )
    sibling_draft = make_issue(
        db_session,
        template.id,
        slug="issue-to-delete-after-publish",
        status="draft",
        created_at="2026-04-04T10:00:00+08:00",
    )
    other_group = make_issue(
        db_session,
        template.id,
        slug="issue-other-group",
        status="draft",
        created_at="2026-04-05T10:00:00+08:00",
        window_start="2026-04-08T00:00:00+08:00",
        window_end="2026-04-15T00:00:00+08:00",
    )

    payload = await review_router.publish_review_issue(
        issue_id=target.id,
        db=db_session,
        _=True,
    )

    db_session.refresh(target)
    assert payload == {"success": True, "status": "published"}
    assert target.status == "published"
    assert db_session.query(ReviewIssue).filter(ReviewIssue.id == sibling_draft.id).first() is None
    assert db_session.query(ReviewIssue).filter(ReviewIssue.id == other_group.id).first() is not None
