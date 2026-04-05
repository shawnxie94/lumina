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
    key_points: str = "",
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
                key_points=key_points or None,
                key_points_status="completed" if key_points else None,
                updated_at=created_at,
            )
        )

    db_session.commit()
    db_session.refresh(article)
    return article


def make_template(
    db_session,
    *,
    schedule_type: str,
    name: str = "每周回顾",
    title_template: str = "第 {period_label} 回顾",
    anchor_date: str = "2026-04-01",
    trigger_time: str = "09:00",
    custom_interval_days: int | None = None,
    include_all_categories: bool = True,
    system_prompt: str | None = None,
    prompt_template: str = "请基于以下内容生成回顾。\n\n{content}",
    review_input_mode: str = "abstract",
    next_run_at: str = "2026-04-07T09:00:00+08:00",
) -> ReviewTemplate:
    template = ReviewTemplate(
        id=str(uuid.uuid4()),
        name=name,
        slug="weekly-review",
        description="",
        is_enabled=True,
        schedule_type=schedule_type,
        custom_interval_days=custom_interval_days,
        anchor_date=anchor_date,
        timezone="Asia/Shanghai",
        trigger_time=trigger_time,
        include_all_categories=include_all_categories,
        review_input_mode=review_input_mode,
        system_prompt=system_prompt,
        prompt_template=prompt_template,
        title_template=title_template,
        next_run_at=next_run_at,
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
        title=title,
        status=status,
        window_start="2026-04-07T00:00:00+08:00",
        window_end="2026-04-14T00:00:00+08:00",
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


def test_get_window_for_weekly_template_uses_natural_week_alignment(db_session):
    service = ReviewService()
    template = make_template(db_session, schedule_type="weekly")

    window = service.resolve_window(
        template,
        now_iso="2026-04-07T09:00:00+08:00",
    )

    assert window.start == "2026-03-30T00:00:00+08:00"
    assert window.end == "2026-04-06T00:00:00+08:00"
    assert window.period_label == "2026-03-30 ~ 2026-04-05"


def test_get_window_for_monthly_template_uses_natural_month_alignment(db_session):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="monthly",
        next_run_at="2026-05-01T09:00:00+08:00",
    )

    window = service.resolve_window(
        template,
        now_iso="2026-05-01T09:00:00+08:00",
    )

    assert window.start == "2026-04-01T00:00:00+08:00"
    assert window.end == "2026-05-01T00:00:00+08:00"
    assert window.period_label == "2026-04"


def test_get_window_for_custom_days_template_uses_anchor_date(db_session):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="custom_days",
        anchor_date="2026-04-01",
        custom_interval_days=10,
        next_run_at="2026-04-21T09:00:00+08:00",
    )

    window = service.resolve_window(
        template,
        now_iso="2026-04-21T09:00:00+08:00",
    )

    assert window.start == "2026-04-11T00:00:00+08:00"
    assert window.end == "2026-04-21T00:00:00+08:00"
    assert window.period_label == "2026-04-11 ~ 2026-04-20"


def test_collect_articles_filters_by_created_at_and_selected_categories(db_session):
    service = ReviewService()
    ai = make_category(db_session, "AI", 1)
    tools = make_category(db_session, "工具", 2)
    template = make_template(
        db_session,
        schedule_type="weekly",
        include_all_categories=False,
    )
    template.categories.append(ai)
    db_session.commit()

    matched = make_article(
        db_session,
        title="Matched",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=ai.id,
        summary="matched summary",
    )
    make_article(
        db_session,
        title="WrongCategory",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=tools.id,
        summary="wrong category",
    )
    make_article(
        db_session,
        title="OutsideWindow",
        created_at="2026-03-20T08:00:00+08:00",
        category_id=ai.id,
        summary="outside window",
    )

    articles = service.collect_articles(
        db_session,
        template,
        window_start="2026-04-01T00:00:00+08:00",
        window_end="2026-04-08T00:00:00+08:00",
    )

    assert [article.id for article in articles] == [matched.id]


def test_collect_articles_orders_by_category_sort_order_then_created_at_desc(db_session):
    service = ReviewService()
    later_category = make_category(
        db_session,
        "后置分类",
        20,
        category_id="aaa-category",
    )
    earlier_category = make_category(
        db_session,
        "前置分类",
        10,
        category_id="zzz-category",
    )
    template = make_template(
        db_session,
        schedule_type="weekly",
        include_all_categories=True,
    )

    later_newer = make_article(
        db_session,
        title="Later Newer",
        created_at="2026-04-03T08:00:00+08:00",
        category_id=later_category.id,
        summary="later newer",
    )
    earlier_newer = make_article(
        db_session,
        title="Earlier Newer",
        created_at="2026-04-04T08:00:00+08:00",
        category_id=earlier_category.id,
        summary="earlier newer",
    )
    later_older = make_article(
        db_session,
        title="Later Older",
        created_at="2026-04-01T08:00:00+08:00",
        category_id=later_category.id,
        summary="later older",
    )
    earlier_older = make_article(
        db_session,
        title="Earlier Older",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=earlier_category.id,
        summary="earlier older",
    )

    articles = service.collect_articles(
        db_session,
        template,
        window_start="2026-04-01T00:00:00+08:00",
        window_end="2026-04-08T00:00:00+08:00",
    )

    assert [article.id for article in articles] == [
        earlier_newer.id,
        earlier_older.id,
        later_newer.id,
        later_older.id,
    ]


def test_render_issue_markdown_inserts_runtime_article_sections(db_session):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session, schedule_type="weekly")
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
    template = make_template(db_session, schedule_type="weekly")
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


def test_render_issue_markdown_hides_non_public_articles_for_public_view(db_session):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session, schedule_type="weekly")
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
    template = make_template(db_session, schedule_type="weekly")
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


def test_serialize_issue_card_falls_back_when_issue_top_image_file_is_missing(db_session):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session, schedule_type="weekly")
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
    template = make_template(db_session, schedule_type="weekly")
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
    previous.window_start = "2026-03-17T00:00:00+08:00"
    previous.window_end = "2026-03-24T00:00:00+08:00"
    current.window_start = "2026-03-24T00:00:00+08:00"
    current.window_end = "2026-03-31T00:00:00+08:00"
    next_issue.window_start = "2026-03-31T00:00:00+08:00"
    next_issue.window_end = "2026-04-07T00:00:00+08:00"
    draft.window_start = "2026-04-07T00:00:00+08:00"
    draft.window_end = "2026-04-14T00:00:00+08:00"
    db_session.commit()

    payload = service.serialize_issue_detail(db_session, current, is_admin=False)

    assert payload["prev_review"]["id"] == previous.id
    assert payload["next_review"]["id"] == next_issue.id
    assert payload["next_review"]["id"] != draft.id


def test_serialize_issue_detail_uses_public_comment_count_for_non_admin(db_session):
    service = ReviewService()
    template = make_template(db_session, schedule_type="weekly")
    issue = make_issue(db_session, template.id, status="published")
    make_review_comment(db_session, issue.id, content="公开评论", is_hidden=False)
    make_review_comment(db_session, issue.id, content="隐藏评论", is_hidden=True)

    payload = service.serialize_issue_detail(db_session, issue, is_admin=False)

    assert payload["comment_count"] == 1


def test_serialize_issue_detail_uses_all_comment_count_for_admin(db_session):
    service = ReviewService()
    template = make_template(db_session, schedule_type="weekly")
    issue = make_issue(db_session, template.id, status="published")
    make_review_comment(db_session, issue.id, content="公开评论", is_hidden=False)
    make_review_comment(db_session, issue.id, content="隐藏评论", is_hidden=True)

    payload = service.serialize_issue_detail(db_session, issue, is_admin=True)

    assert payload["comment_count"] == 2


def test_serialize_issue_card_includes_view_count_and_public_comment_count(db_session):
    service = ReviewService()
    template = make_template(db_session, schedule_type="weekly")
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


def test_serialize_issue_card_reuses_batch_resolution_maps(db_session, monkeypatch):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session, schedule_type="weekly")
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


def test_get_issue_template_filters_uses_aggregated_template_rows(db_session, monkeypatch):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="weekly",
        name="肖恩周刊",
    )

    class ExplodingPrimaryGroupQuery:
        def order_by(self, *args, **kwargs):
            return self

        def all(self):
            raise AssertionError("primary groups should not be fully materialized")

    monkeypatch.setattr(
        service,
        "_build_primary_issue_group_query",
        lambda base_query: (ExplodingPrimaryGroupQuery(), object()),
    )
    monkeypatch.setattr(service, "_primary_issue_group_order_by", lambda subquery: ())
    monkeypatch.setattr(
        service,
        "_load_issue_template_filter_rows",
        lambda db, base_query, primary_group_subquery: [
            SimpleNamespace(template_id=template.id, count=2)
        ],
        raising=False,
    )

    items = service.get_issue_template_filters(
        db_session,
        is_admin=True,
    )

    assert items == [
        {"id": "", "name": "全部", "slug": "", "count": 2},
        {
            "id": template.id,
            "name": template.name,
            "slug": template.slug,
            "count": 2,
        },
    ]


def test_publish_issue_promotes_canonical_slug_from_versioned_draft(db_session):
    service = ReviewService()
    template = make_template(db_session, schedule_type="weekly", name="肖恩技术周刊")
    published = make_issue(
        db_session,
        template.id,
        status="published",
        published_at="2026-04-05T09:00:00+08:00",
    )
    published.slug = "shawn-weekly-2026-04-05-2026-03-23-to-2026-03-29"
    published.window_start = "2026-03-23T00:00:00+08:00"
    published.window_end = "2026-03-30T00:00:00+08:00"

    target = make_issue(
        db_session,
        template.id,
        status="draft",
    )
    target.slug = "shawn-weekly-2026-04-05-2026-03-23-to-2026-03-29-v2"
    target.window_start = "2026-03-23T00:00:00+08:00"
    target.window_end = "2026-03-30T00:00:00+08:00"
    db_session.commit()

    updated = service.publish_issue(db_session, target)
    db_session.refresh(published)

    assert updated.slug == "shawn-weekly-2026-04-05-2026-03-23-to-2026-03-29"
    assert published.slug != updated.slug
    assert published.slug.startswith(
        "shawn-weekly-2026-04-05-2026-03-23-to-2026-03-29-v"
    )


def test_enqueue_due_review_tasks_renders_template_name_and_next_published_issue_number(db_session):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="weekly",
        name="肖恩技术周刊",
        title_template="第 {issue_number} 期｜{template_name}｜{period_label}",
    )
    first_issue = make_issue(
        db_session,
        template.id,
        status="published",
        title="第 1 期｜肖恩技术周刊｜2026-03-16 ~ 2026-03-22",
        published_at="2026-03-23T09:00:00+08:00",
    )
    first_issue.window_start = "2026-03-16T00:00:00+08:00"
    first_issue.window_end = "2026-03-23T00:00:00+08:00"
    second_issue = make_issue(
        db_session,
        template.id,
        status="published",
        title="第 2 期｜肖恩技术周刊｜2026-03-23 ~ 2026-03-29",
        published_at="2026-03-30T09:00:00+08:00",
    )
    second_issue.window_start = "2026-03-23T00:00:00+08:00"
    second_issue.window_end = "2026-03-30T00:00:00+08:00"
    make_issue(
        db_session,
        template.id,
        status="draft",
        title="草稿不计入期数",
    )
    db_session.commit()

    created = service.enqueue_due_review_tasks(
        db_session,
        now_iso="2026-04-07T09:00:00+08:00",
    )

    assert created == 1
    issue = (
        db_session.query(ReviewIssue)
        .filter(ReviewIssue.template_id == template.id)
        .filter(ReviewIssue.window_start == "2026-03-30T00:00:00+08:00")
        .filter(ReviewIssue.window_end == "2026-04-06T00:00:00+08:00")
        .one()
    )
    assert issue.title == "第 3 期｜肖恩技术周刊｜2026-03-30 ~ 2026-04-05"
    assert issue.markdown_content.startswith("# 第 3 期｜肖恩技术周刊｜2026-03-30 ~ 2026-04-05")


def test_enqueue_template_run_now_uses_current_active_window_instead_of_next_scheduled_window(
    db_session,
):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="weekly",
        next_run_at="2026-04-20T09:00:00+08:00",
    )

    task_id = service.enqueue_template_run_now(
        db_session,
        template,
        now_iso="2026-04-04T12:00:00+08:00",
    )

    assert task_id
    issue = (
        db_session.query(ReviewIssue)
        .filter(ReviewIssue.template_id == template.id)
        .order_by(ReviewIssue.created_at.desc())
        .first()
    )
    assert issue is not None
    assert issue.window_start == "2026-03-30T00:00:00+08:00"
    assert issue.window_end == "2026-04-06T00:00:00+08:00"


def test_enqueue_template_run_now_creates_new_draft_version_for_same_window(db_session):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="weekly",
        next_run_at="2026-04-20T09:00:00+08:00",
    )

    first_task_id = service.enqueue_template_run_now(
        db_session,
        template,
        now_iso="2026-04-04T12:00:00+08:00",
    )
    second_task_id = service.enqueue_template_run_now(
        db_session,
        template,
        now_iso="2026-04-04T12:05:00+08:00",
    )

    issues = (
        db_session.query(ReviewIssue)
        .filter(ReviewIssue.template_id == template.id)
        .filter(ReviewIssue.window_start == "2026-03-30T00:00:00+08:00")
        .filter(ReviewIssue.window_end == "2026-04-06T00:00:00+08:00")
        .order_by(ReviewIssue.created_at.asc(), ReviewIssue.id.asc())
        .all()
    )

    assert first_task_id != second_task_id
    assert len(issues) == 2
    assert issues[0].id != issues[1].id
    assert issues[0].slug != issues[1].slug


def test_enqueue_manual_issue_task_reuses_same_issue_number_for_same_window_versions(db_session):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="weekly",
        name="肖恩技术周刊",
        title_template="第 {issue_number} 期｜{template_name}｜{period_label}",
    )
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        summary="最新摘要",
    )
    first_issue = make_issue(
        db_session,
        template.id,
        status="published",
        title="第 1 期｜肖恩技术周刊｜2026-03-23 ~ 2026-03-29",
        published_at="2026-03-30T09:00:00+08:00",
    )
    first_issue.window_start = "2026-03-23T00:00:00+08:00"
    first_issue.window_end = "2026-03-30T00:00:00+08:00"

    current_issue = make_issue(
        db_session,
        template.id,
        status="published",
        title="第 2 期｜肖恩技术周刊｜2026-03-30 ~ 2026-04-05",
        published_at="2026-04-06T09:00:00+08:00",
    )
    current_issue.window_start = "2026-03-30T00:00:00+08:00"
    current_issue.window_end = "2026-04-06T00:00:00+08:00"
    db_session.commit()

    issue, _task_id = service.enqueue_manual_issue_task(
        db_session,
        template,
        date_start="2026-03-30",
        date_end="2026-04-05",
        article_ids=[article.id],
        now_iso="2026-04-07T10:00:00+08:00",
    )

    assert issue.title == "第 2 期｜肖恩技术周刊｜2026-03-30 ~ 2026-04-05"


def test_generate_issue_markdown_without_ai_config_uses_issue_title_for_default_markdown(db_session):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="weekly",
        name="肖恩技术周刊",
        title_template="第 {issue_number} 期｜{template_name}｜{period_label}",
    )
    issue = make_issue(
        db_session,
        template.id,
        title="第 3 期｜肖恩技术周刊｜2026-03-30 ~ 2026-04-05",
    )

    service.pipeline_service.get_ai_config = lambda db, prompt_type="summary": None

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[],
        )
    )

    assert markdown.startswith("# 第 3 期｜肖恩技术周刊｜2026-03-30 ~ 2026-04-05")
    assert REVIEW_ARTICLE_SECTIONS_PLACEHOLDER in markdown


def test_generate_issue_markdown_prefers_enabled_template_model_config(db_session, monkeypatch):
    service = ReviewService()
    template_model = make_model_config(db_session, name="Review Writer")
    template = make_template(
        db_session,
        schedule_type="weekly",
        name="肖恩技术周刊",
        title_template="第 {issue_number} 期｜{template_name}｜{period_label}",
    )
    template.model_api_config_id = template_model.id
    db_session.commit()
    issue = make_issue(
        db_session,
        template.id,
        title="第 3 期｜肖恩技术周刊｜2026-03-30 ~ 2026-04-05",
    )

    used_model_ids: list[str | None] = []

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "default-summary-model",
            "parameters": {"max_tokens": 1600, "temperature": 0.3},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            return {
                "content": "# 回顾\n\n模板模型输出。\n\n{{review_article_sections}}",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    def fake_create_ai_client(config):
        used_model_ids.append(config.get("model_api_config_id"))
        return FakeClient()

    monkeypatch.setattr(service.pipeline_service, "create_ai_client", fake_create_ai_client)

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[],
        )
    )

    assert markdown.startswith("# 回顾")
    assert used_model_ids == [template_model.id]


def test_generate_issue_markdown_falls_back_when_template_model_is_not_available(
    db_session,
    monkeypatch,
):
    service = ReviewService()
    disabled_model = make_model_config(
        db_session,
        name="Disabled Review Writer",
        is_enabled=False,
    )
    template = make_template(db_session, schedule_type="weekly")
    template.model_api_config_id = disabled_model.id
    db_session.commit()
    issue = make_issue(db_session, template.id)

    used_model_ids: list[str | None] = []

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "default-summary-model",
            "parameters": {"max_tokens": 1600, "temperature": 0.3},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            return {
                "content": "# 回顾\n\n默认模型输出。\n\n{{review_article_sections}}",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    def fake_create_ai_client(config):
        used_model_ids.append(config.get("model_api_config_id"))
        return FakeClient()

    monkeypatch.setattr(service.pipeline_service, "create_ai_client", fake_create_ai_client)

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[],
        )
    )

    assert markdown.startswith("# 回顾")
    assert used_model_ids == ["default-summary-model"]


def test_generate_issue_markdown_default_prompt_keeps_article_outline_programmatic(
    db_session,
    monkeypatch,
):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(
        db_session,
        schedule_type="weekly",
        prompt_template="",
    )
    issue = make_issue(db_session, template.id)
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="最新摘要",
    )
    article.slug = "openai-news"
    db_session.add(article)
    db_session.commit()

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "default-summary-model",
            "parameters": {"max_tokens": 1600, "temperature": 0.3},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            prompt = kwargs.get("prompt") or ""
            assert "## AI" not in prompt
            assert "### {{openai-news}}" not in prompt
            assert "{{review_article_sections}}" not in prompt
            assert "不要输出文章列表、分类标题或任何文章占位标记" in prompt
            assert "这部分会由系统按分类自动插入" in prompt
            return {
                "content": "# 回顾\n\n默认模型输出。\n\n## 本期综述\n\n这里是 AI 生成的总结。",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(
        service.pipeline_service,
        "create_ai_client",
        lambda config: FakeClient(),
    )

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[article],
        )
    )

    assert "## 本期综述" in markdown
    assert "这里是 AI 生成的总结。" in markdown
    assert "## AI" in markdown
    assert "### {{openai-news}}" in markdown


def test_generate_issue_markdown_supports_literal_braces_in_prompt_template(
    db_session,
    monkeypatch,
):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(
        db_session,
        schedule_type="weekly",
        prompt_template=(
            "请输出 JSON 示例：{\"section\": true}\n"
            "模板：{template_name}\n"
            "周期：{period_label}\n"
            "{content}"
        ),
    )
    issue = make_issue(db_session, template.id)
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="最新摘要",
    )

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "model-review-1",
            "parameters": {"max_tokens": 1200, "temperature": 0.4},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            prompt = kwargs.get("prompt") or ""
            assert '{"section": true}' in prompt
            assert "{template_name}" not in prompt
            assert "{period_label}" not in prompt
            return {
                "content": "# 回顾\n\n本期亮点梳理。\n\n{{review_article_sections}}",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(
        service.pipeline_service,
        "create_ai_client",
        lambda config: FakeClient(),
    )

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[article],
        )
    )

    assert markdown.startswith("# 回顾")


def test_enqueue_due_review_tasks_preserves_literal_braces_in_title_template(db_session):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="weekly",
        name="肖恩技术周刊",
        title_template="{template_name} 第 {issue_number} 期 {literal_braces}",
    )

    created = service.enqueue_due_review_tasks(
        db_session,
        now_iso="2026-04-07T09:00:00+08:00",
    )

    issue = (
        db_session.query(ReviewIssue)
        .filter(ReviewIssue.template_id == template.id)
        .order_by(ReviewIssue.created_at.desc())
        .first()
    )

    assert created == 1
    assert issue is not None
    assert issue.title == "肖恩技术周刊 第 1 期 {literal_braces}"


def test_generate_issue_markdown_passes_article_payload_only_once_to_ai_client(
    db_session,
    monkeypatch,
):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(
        db_session,
        schedule_type="weekly",
        prompt_template=(
            "请基于以下文章生成回顾。\n\n"
            "周期：{period_label}\n"
            "模板：{template_name}\n"
            "{content}\n\n"
            "{article_sections_placeholder}"
        ),
    )
    issue = make_issue(db_session, template.id)
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="最新摘要",
    )

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "model-review-1",
            "parameters": {"max_tokens": 1200, "temperature": 0.4},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert "OpenAI News" in content
            assert "{content}" in (kwargs.get("prompt") or "")
            assert "OpenAI News" not in (kwargs.get("prompt") or "")
            return {
                "content": "# 回顾\n\n本期亮点梳理。\n\n{{review_article_sections}}",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(
        service.pipeline_service,
        "create_ai_client",
        lambda config: FakeClient(),
    )

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[article],
        )
    )

    assert markdown.startswith("# 回顾")


def test_generate_issue_markdown_materializes_article_slug_outline_from_ai_output(
    db_session,
    monkeypatch,
):
    service = ReviewService()
    template = make_template(db_session, schedule_type="weekly")
    issue = make_issue(db_session, template.id)
    category = make_category(db_session, "AI", 1)
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="最新摘要",
    )
    article.slug = "openai-news"
    db_session.commit()

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "model-review-1",
            "parameters": {"max_tokens": 1200, "temperature": 0.4},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            return {
                "content": (
                    "# 回顾\n\n"
                    "本期亮点梳理。\n\n"
                    "{review_article_sections}\n\n"
                    "{{review_article_sections}}"
                ),
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(
        service.pipeline_service,
        "create_ai_client",
        lambda config: FakeClient(),
    )

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[article],
        )
    )

    assert "## AI" in markdown
    assert "### {{openai-news}}" in markdown
    assert REVIEW_ARTICLE_SECTIONS_PLACEHOLDER not in markdown
    assert "\n{review_article_sections}\n" not in f"\n{markdown}\n"


def test_generate_issue_markdown_uses_template_system_prompt(
    db_session,
    monkeypatch,
):
    service = ReviewService()
    template = make_template(
        db_session,
        schedule_type="weekly",
        system_prompt="你是回顾主编，请保持审稿视角。",
    )
    issue = make_issue(db_session, template.id)

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "default-summary-model",
            "parameters": {
                "max_tokens": 1600,
                "temperature": 0.3,
                "system_prompt": "你是一名资深内容分析师。",
            },
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            parameters = kwargs.get("parameters") or {}
            assert parameters.get("system_prompt") == "你是回顾主编，请保持审稿视角。"
            return {
                "content": "# 回顾\n\n模板系统提示词输出。\n\n{{review_article_sections}}",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(
        service.pipeline_service,
        "create_ai_client",
        lambda config: FakeClient(),
    )

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[],
        )
    )

    assert markdown.startswith("# 回顾")


def test_generate_issue_markdown_uses_requested_review_input_mode_and_advanced_params(
    db_session,
    monkeypatch,
):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session, schedule_type="weekly")
    template.review_input_mode = "full_text"
    template.temperature = 0.92
    template.max_tokens = 2400
    template.top_p = 0.66
    db_session.commit()
    issue = make_issue(db_session, template.id)
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="这是一段 AI 摘要",
        key_points="这是一段 AI 总结",
        content_md="第一段全文内容。\n\n第二段全文内容。",
    )

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "model-review-1",
            "parameters": {"max_tokens": 1200, "temperature": 0.4, "top_p": 0.95},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert "第一段全文内容" in content
            assert "这是一段 AI 摘要" not in content
            assert "这是一段 AI 总结" not in content
            parameters = kwargs.get("parameters") or {}
            assert parameters.get("temperature") == pytest.approx(0.92)
            assert parameters.get("max_tokens") == 2400
            assert parameters.get("top_p") == pytest.approx(0.66)
            return {
                "content": "# 回顾\n\n本期亮点梳理。\n\n{{review_article_sections}}",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(
        service.pipeline_service,
        "create_ai_client",
        lambda config: FakeClient(),
    )

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[article],
        )
    )

    assert markdown.startswith("# 回顾")


def test_generate_issue_markdown_uses_ai_summary_for_abstract_mode(
    db_session,
    monkeypatch,
):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(
        db_session,
        schedule_type="weekly",
        review_input_mode="abstract",
    )
    issue = make_issue(db_session, template.id)
    article = make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="这是 AI 摘要内容",
        key_points="这是 AI 总结内容",
        content_md="这是全文内容",
    )

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "model-review-1",
            "parameters": {"max_tokens": 1200, "temperature": 0.4},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert "这是 AI 摘要内容" in content
            assert "这是 AI 总结内容" not in content
            assert "这是全文内容" not in content
            return {
                "content": "# 回顾\n\n摘要模式输出。\n\n{{review_article_sections}}",
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(
        service.pipeline_service,
        "create_ai_client",
        lambda config: FakeClient(),
    )

    markdown = asyncio.run(
        service.generate_issue_markdown(
            db_session,
            template=template,
            issue=issue,
            articles=[article],
        )
    )

    assert markdown.startswith("# 回顾")


def test_generate_issue_logs_ai_usage_with_task_context(db_session, monkeypatch):
    service = ReviewService()
    category = make_category(db_session, "AI", 1)
    template = make_template(db_session, schedule_type="weekly")
    issue = make_issue(db_session, template.id)
    make_article(
        db_session,
        title="OpenAI News",
        created_at="2026-04-02T08:00:00+08:00",
        category_id=category.id,
        summary="最新摘要",
    )

    monkeypatch.setattr(
        service.pipeline_service,
        "get_ai_config",
        lambda db, prompt_type="summary": {
            "model_api_config_id": "model-review-1",
            "price_input_per_1k": 0.01,
            "price_output_per_1k": 0.02,
            "currency": "USD",
            "parameters": {"max_tokens": 1200, "temperature": 0.4},
        },
    )

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            return {
                "content": "# 回顾\n\n本期亮点梳理。\n\n{{review_article_sections}}",
                "usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 60,
                    "total_tokens": 180,
                },
                "latency_ms": 321,
                "finish_reason": "stop",
                "request_payload": {"prompt": kwargs.get("prompt")},
                "response_payload": {"content": "本期亮点梳理。"},
            }

    monkeypatch.setattr(
        service.pipeline_service,
        "create_ai_client",
        lambda config: FakeClient(),
    )

    asyncio.run(service.generate_issue(db_session, template.id, issue.id, task_id="task-review-1"))

    usage_log = db_session.query(AIUsageLog).one()
    assert usage_log.task_id == "task-review-1"
    assert usage_log.task_type == "generate_review_issue"
    assert usage_log.content_type == "review"
    assert usage_log.status == "completed"
    assert usage_log.prompt_tokens == 120
    assert usage_log.completion_tokens == 60
    assert usage_log.total_tokens == 180
