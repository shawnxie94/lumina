from __future__ import annotations

import uuid

from app.domain.article_tag_service import ArticleTagService
from models import AIAnalysis, Article, Tag, now_str


def make_article(
    db_session,
    *,
    title: str,
    content_md: str = "article content",
    created_at: str | None = None,
) -> Article:
    article = Article(
        id=str(uuid.uuid4()),
        title=title,
        slug=f"{title.lower()}-{uuid.uuid4().hex[:8]}",
        content_md=content_md,
        created_at=created_at or now_str(),
        updated_at=now_str(),
        status="completed",
        is_visible=True,
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    return article


def make_analysis(
    db_session,
    article: Article,
    *,
    tagging_status: str | None = None,
    tagging_source_hash: str | None = None,
    tagging_manual_override: bool = False,
) -> AIAnalysis:
    analysis = AIAnalysis(
        article_id=article.id,
        tagging_status=tagging_status,
        tagging_source_hash=tagging_source_hash,
        tagging_manual_override=tagging_manual_override,
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()
    db_session.refresh(analysis)
    return analysis


def test_normalize_tag_names_deduplicates_hashes_and_limits_count():
    service = ArticleTagService()

    result = service.normalize_tag_names(
        [
            " #AI ",
            "ai",
            "Data   Science",
            "",
            "产品策略",
            "知识管理",
            "工作流",
            "额外标签",
        ]
    )

    assert result == ["AI", "Data Science", "产品策略", "知识管理", "工作流"]


def test_set_article_tags_upserts_and_cleans_orphans(db_session):
    service = ArticleTagService()
    article = make_article(db_session, title="demo")

    service.set_article_tags(
        db_session,
        article,
        ["AI", "Agent Workflow"],
        manual_override=True,
        tagging_status="completed",
        source_hash="hash-1",
    )
    db_session.commit()
    db_session.refresh(article)

    assert sorted(tag.name for tag in article.tags) == ["AI", "Agent Workflow"]
    assert db_session.query(Tag).count() == 2
    assert article.ai_analysis is not None
    assert article.ai_analysis.tagging_manual_override is True

    service.set_article_tags(
        db_session,
        article,
        ["AI"],
        manual_override=True,
        tagging_status="completed",
        source_hash="hash-2",
    )
    db_session.commit()
    db_session.refresh(article)

    assert [tag.name for tag in article.tags] == ["AI"]
    assert db_session.query(Tag).count() == 1


def test_parse_tag_names_supports_json_and_line_fallback():
    service = ArticleTagService()

    assert service.parse_tag_names('["AI 产品", "浏览器插件", "知识管理"]') == [
        "AI 产品",
        "浏览器插件",
        "知识管理",
    ]
    assert service.parse_tag_names("- AI 产品\n- 浏览器插件\n- 知识管理") == [
        "AI 产品",
        "浏览器插件",
        "知识管理",
    ]


def test_has_same_tag_names_ignores_order_case_and_hash_prefix(db_session):
    service = ArticleTagService()
    article = make_article(db_session, title="same-tags")
    service.set_article_tags(
        db_session,
        article,
        ["AI", "Agent Workflow"],
        manual_override=False,
        tagging_status="completed",
        source_hash="hash-1",
    )
    db_session.commit()
    db_session.refresh(article)

    assert service.has_same_tag_names(article, [" #agent workflow ", "ai"]) is True
    assert service.has_same_tag_names(article, ["AI", "知识管理"]) is False


def test_list_tags_with_count_hides_hidden_only_tags_for_public(db_session):
    service = ArticleTagService()
    visible_article = make_article(db_session, title="visible")
    hidden_article = make_article(db_session, title="hidden")
    hidden_article.is_visible = False
    db_session.commit()

    service.set_article_tags(
        db_session,
        visible_article,
        ["AI"],
        manual_override=False,
        tagging_status="completed",
        source_hash="hash-visible",
    )
    service.set_article_tags(
        db_session,
        hidden_article,
        ["内部标签"],
        manual_override=False,
        tagging_status="completed",
        source_hash="hash-hidden",
    )
    db_session.commit()

    public_tags = service.list_tags_with_count(db_session, include_hidden=False)
    admin_tags = service.list_tags_with_count(db_session, include_hidden=True)

    assert public_tags == [{"id": visible_article.tags[0].id, "name": "AI", "article_count": 1}]
    assert {item["name"] for item in admin_tags} == {"AI", "内部标签"}


def test_cleanup_orphan_tags_can_target_specific_tag_ids(db_session):
    service = ArticleTagService()
    article = make_article(db_session, title="cleanup-targeted")

    service.set_article_tags(
        db_session,
        article,
        ["AI", "工作流"],
        manual_override=False,
        tagging_status="completed",
        source_hash="hash-targeted",
    )
    db_session.commit()
    db_session.refresh(article)

    removed_tag = next(tag for tag in article.tags if tag.name == "工作流")
    kept_tag = next(tag for tag in article.tags if tag.name == "AI")
    removed_tag_id = removed_tag.id
    kept_tag_id = kept_tag.id
    article.tags = [kept_tag]
    db_session.flush()

    deleted = service.cleanup_orphan_tags(db_session, tag_ids=[removed_tag_id])
    db_session.commit()

    assert deleted == 1
    assert db_session.get(Tag, removed_tag_id) is None
    assert db_session.get(Tag, kept_tag_id) is not None
