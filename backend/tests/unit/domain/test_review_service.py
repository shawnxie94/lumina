from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.domain.review_service import (
    REVIEW_ARTICLE_SECTIONS_PLACEHOLDER,
    ReviewService,
)
from models import (
    AIUsageLog,
    Article,
    Category,
    ModelAPIConfig,
    ReviewComment,
    ReviewIssue,
    ReviewIssueArticle,
    ReviewTemplate,
    now_str,
)


def make_category(
    db_session,
    name: str,
    sort_order: int = 0,
    *,
    category_id: str | None = None,
) -> Category:
    category = Category(
        id=category_id or str(uuid.uuid4()),
        name=name,
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
    created_at: str,
    category_id: str | None = None,
    summary: str = "",
    content_md: str | None = None,
    content_trans: str = "",
    is_visible: bool = True,
) -> Article:
    article = Article(
        id=str(uuid.uuid4()),
        title=title,
        slug=f"{title.lower()}-{uuid.uuid4().hex[:8]}",
        content_md=content_md or f"{title} content",
        content_trans=content_trans,
        top_image=f"/media/{title.lower()}.png",
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

    if summary:
        from models import AIAnalysis

        db_session.add(
            AIAnalysis(
                id=str(uuid.uuid4()),
                article_id=article.id,
                summary=summary,
                summary_status="completed",
                updated_at=created_at,
            )
        )

    db_session.commit()
    db_session.refresh(article)
    return article


def make_template(
    db_session,
    *,
    name: str = "每周回顾",
    slug: str = "weekly-review",
    **_legacy_kwargs,
) -> ReviewTemplate:
    template = ReviewTemplate(
        id=str(uuid.uuid4()),
        name=name,
        slug=slug,
        description="",
        color="#3B82F6",
        sort_order=0,
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
    name: str,
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


def make_issue(
    db_session,
    template_id: str,
    *,
    status: str = "draft",
    title: str = "2026 第 14 周回顾",
    markdown_content: str | None = None,
    published_at: str | None = None,
    view_count: int = 0,
) -> ReviewIssue:
    issue = ReviewIssue(
        id=str(uuid.uuid4()),
        template_id=template_id,
        slug=f"issue-{uuid.uuid4().hex[:8]}",
        slug_locked=(status == "published"),
        title=title,
        status=status,
        markdown_content=markdown_content
        or f"# 回顾\n\n概览\n\n{REVIEW_ARTICLE_SECTIONS_PLACEHOLDER}",
        generated_at=now_str(),
        published_at=published_at if status == "published" else None,
        view_count=view_count,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(issue)
    db_session.commit()
    db_session.refresh(issue)
    return issue


def make_review_comment(
    db_session,
    issue_id: str,
    *,
    content: str,
    is_hidden: bool = False,
) -> ReviewComment:
    comment = ReviewComment(
        id=str(uuid.uuid4()),
        issue_id=issue_id,
        user_id="user-1",
        user_name="Tester",
        user_avatar="",
        provider="github",
        content=content,
        reply_to_id=None,
        is_hidden=is_hidden,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(comment)
    db_session.commit()
    db_session.refresh(comment)
    return comment
def test_render_issue_markdown_inserts_runtime_article_sections(db_session):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session)
    issue = make_issue(db_session, template.id)
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="最新摘要",
    )
    article.slug = "openai-news"
    db_session.add(
        ReviewIssueArticle(
            id=str(uuid.uuid4()),
            issue_id=issue.id,
            article_id=article.id,
            category_id=category.id,
            category_sort_order=1,
            article_sort_order=1,
            created_at=now_str(),
            updated_at=now_str(),
        )
    )
    db_session.commit()

    rendered = service.render_issue_markdown(db_session, issue, is_admin=False)

    assert REVIEW_ARTICLE_SECTIONS_PLACEHOLDER not in rendered
    assert "## AI" in rendered
    assert "### [OpenAI News](/article/openai-news)" in rendered
    assert "最新摘要" in rendered


def test_render_issue_markdown_replaces_article_slug_placeholders(db_session):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        markdown_content="# 回顾\n\n## AI\n\n### {{openai-news}}\n",
    )
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="最新摘要",
    )
    article.slug = "openai-news"
    db_session.add(
        ReviewIssueArticle(
            id=str(uuid.uuid4()),
            issue_id=issue.id,
            article_id=article.id,
            category_id=category.id,
            category_sort_order=1,
            article_sort_order=1,
            created_at=now_str(),
            updated_at=now_str(),
        )
    )
    db_session.commit()

    rendered = service.render_issue_markdown(db_session, issue, is_admin=False)

    assert "{{openai-news}}" not in rendered
    assert "### [OpenAI News](/article/openai-news)" in rendered
    assert "最新摘要" in rendered


def test_render_issue_markdown_replaces_visible_article_slug_placeholders_outside_issue_selection(
    db_session,
):
    service = ReviewService()
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        markdown_content="# 回顾\n\n## 额外引用\n\n### {{visible-external-article}}\n",
    )
    article = make_article(
        db_session,
        title="Visible External Article",
        created_at="2026-04-02T08:00:00+08:00",
        summary="外部可见文章摘要",
    )
    article.slug = "visible-external-article"
    db_session.commit()

    rendered = service.render_issue_markdown(db_session, issue, is_admin=False)

    assert "{{visible-external-article}}" not in rendered
    assert "### [Visible External Article](/article/visible-external-article)" in rendered
    assert "外部可见文章摘要" in rendered


def test_render_issue_markdown_hides_non_public_articles_for_public_view(db_session):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session)
    issue = make_issue(db_session, template.id)
    hidden_article = make_article(
        db_session,
        title="Hidden",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="不会公开渲染",
        is_visible=False,
    )
    db_session.add(
        ReviewIssueArticle(
            id=str(uuid.uuid4()),
            issue_id=issue.id,
            article_id=hidden_article.id,
            category_id=category.id,
            category_sort_order=1,
            article_sort_order=1,
            created_at=now_str(),
            updated_at=now_str(),
        )
    )
    db_session.commit()

    public_rendered = service.render_issue_markdown(db_session, issue, is_admin=False)
    admin_rendered = service.render_issue_markdown(db_session, issue, is_admin=True)

    assert "不会公开渲染" not in public_rendered
    assert "Hidden" in admin_rendered
    assert "已隐藏" in admin_rendered


def test_render_issue_markdown_removes_empty_category_blocks_for_public_view(db_session):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        markdown_content="# 回顾\n\n## AI\n\n### {{hidden-article}}\n",
    )
    hidden_article = make_article(
        db_session,
        title="Hidden",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="不会公开渲染",
        is_visible=False,
    )
    hidden_article.slug = "hidden-article"
    db_session.add(
        ReviewIssueArticle(
            id=str(uuid.uuid4()),
            issue_id=issue.id,
            article_id=hidden_article.id,
            category_id=category.id,
            category_sort_order=1,
            article_sort_order=1,
            created_at=now_str(),
            updated_at=now_str(),
        )
    )
    db_session.commit()

    public_rendered = service.render_issue_markdown(db_session, issue, is_admin=False)

    assert "## AI" not in public_rendered
    assert "{{hidden-article}}" not in public_rendered


def test_build_article_placeholder_render_blocks_includes_visible_external_article_placeholders(
    db_session,
):
    service = ReviewService()
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        markdown_content="# 回顾\n\n### {{visible-external-article}}\n",
    )
    article = make_article(
        db_session,
        title="Visible External Article",
        created_at="2026-04-02T08:00:00+08:00",
        summary="外部可见文章摘要",
    )
    article.slug = "visible-external-article"
    db_session.commit()

    blocks = service.build_article_placeholder_render_blocks(
        db_session,
        issue,
        is_admin=True,
    )

    assert "visible-external-article" in blocks
    assert "[Visible External Article](/article/visible-external-article)" in blocks[
        "visible-external-article"
    ]
    assert "外部可见文章摘要" in blocks["visible-external-article"]


def test_serialize_issue_card_falls_back_when_issue_top_image_file_is_missing(db_session):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        status="published",
        published_at="2026-04-06T09:00:00+08:00",
    )
    issue.top_image = "/backend/media/2026/04/missing-review-cover.png"
    article = make_article(
        db_session,
        title="Fallback Image Article",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="带兜底头图的文章",
    )
    article.top_image = "https://cdn.example.com/fallback-cover.png"
    db_session.add(
        ReviewIssueArticle(
            id=str(uuid.uuid4()),
            issue_id=issue.id,
            article_id=article.id,
            category_id=category.id,
            category_sort_order=1,
            article_sort_order=1,
            created_at=now_str(),
            updated_at=now_str(),
        )
    )
    db_session.commit()

    serialized = service.serialize_issue_card(db_session, issue)

    assert serialized["top_image"] == "https://cdn.example.com/fallback-cover.png"


def test_serialize_issue_detail_includes_published_neighbors_within_same_template(db_session):
    service = ReviewService()
    template = make_template(db_session)
    previous = make_issue(
        db_session,
        template.id,
        title="上一期",
        status="published",
        published_at="2026-03-30T09:00:00+08:00",
    )
    current = make_issue(
        db_session,
        template.id,
        title="当前期",
        status="published",
        published_at="2026-04-06T09:00:00+08:00",
    )
    next_issue = make_issue(
        db_session,
        template.id,
        title="下一期",
        status="published",
        published_at="2026-04-13T09:00:00+08:00",
    )
    draft = make_issue(
        db_session,
        template.id,
        title="草稿",
        status="draft",
        published_at=None,
    )
    db_session.commit()

    payload = service.serialize_issue_detail(db_session, current, is_admin=False)

    assert payload["prev_review"]["id"] == previous.id
    assert payload["next_review"]["id"] == next_issue.id
    assert payload["next_review"]["id"] != draft.id


def test_serialize_issue_detail_uses_public_comment_count_for_non_admin(db_session):
    service = ReviewService()
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, status="published")
    make_review_comment(db_session, issue.id, content="公开评论", is_hidden=False)
    make_review_comment(db_session, issue.id, content="隐藏评论", is_hidden=True)

    payload = service.serialize_issue_detail(db_session, issue, is_admin=False)

    assert payload["comment_count"] == 1


def test_serialize_issue_detail_uses_all_comment_count_for_admin(db_session):
    service = ReviewService()
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, status="published")
    make_review_comment(db_session, issue.id, content="公开评论", is_hidden=False)
    make_review_comment(db_session, issue.id, content="隐藏评论", is_hidden=True)

    payload = service.serialize_issue_detail(db_session, issue, is_admin=True)

    assert payload["comment_count"] == 2


def test_serialize_issue_card_includes_view_count_and_public_comment_count(db_session):
    service = ReviewService()
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        status="published",
        view_count=12,
    )
    make_review_comment(db_session, issue.id, content="公开评论", is_hidden=False)
    make_review_comment(db_session, issue.id, content="隐藏评论", is_hidden=True)

    payload = service.serialize_issue_card(db_session, issue)

    assert payload["view_count"] == 12
    assert payload["comment_count"] == 1


def test_serialize_issue_card_summary_skips_heading_and_reference_blocks(db_session):
    service = ReviewService()
    template = make_template(db_session)
    issue = make_issue(
        db_session,
        template.id,
        status="published",
        markdown_content=(
            "# 第 14 周回顾\n\n"
            "> 这是一段文章引用，不应该成为回顾卡片摘要。\n\n"
            "—— [被引用文章](/article/referenced-article)\n\n"
            "本期回顾真正的开场摘要，应该展示在回顾卡片上。\n\n"
            "## 文章列表\n\n"
            "{{review_article_sections}}"
        ),
    )

    payload = service.serialize_issue_card(db_session, issue)

    assert payload["summary"] == "本期回顾真正的开场摘要，应该展示在回顾卡片上。"


def test_serialize_issue_card_reuses_batch_resolution_maps(db_session, monkeypatch):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session)
    issue = make_issue(db_session, template.id, status="published")

    def fail_legacy_helper(*args, **kwargs):
        raise AssertionError("legacy single-item resolver should not be used")

    monkeypatch.setattr(
        service,
        "_resolve_issue_category_names",
        fail_legacy_helper,
        raising=False,
    )
    monkeypatch.setattr(
        service,
        "_resolve_issue_top_image_for_output",
        fail_legacy_helper,
        raising=False,
    )
    monkeypatch.setattr(
        service,
        "_load_issue_category_names_map",
        lambda db, issue_ids: {issue.id: [category.name]},
    )
    monkeypatch.setattr(
        service,
        "_load_issue_comment_count_map",
        lambda db, issue_ids, include_hidden=False: {issue.id: 3},
    )
    monkeypatch.setattr(
        service,
        "_load_issue_top_images_for_output",
        lambda db, issues: {issue.id: "/backend/media/issue.png"},
    )

    payload = service.serialize_issue_card(db_session, issue)

    assert payload["category_names"] == ["AI"]
    assert payload["comment_count"] == 3
    assert payload["top_image"] == "/backend/media/issue.png"



