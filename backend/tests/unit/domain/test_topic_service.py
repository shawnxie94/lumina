from __future__ import annotations

import uuid

from models import AdminSettings, Article, now_str
from app.domain.topic_service import TopicService


def make_admin(db_session) -> AdminSettings:
    admin = AdminSettings(
        id=str(uuid.uuid4()),
        password_hash="x",
        jwt_secret="y",
        topics_enabled=True,
        topics_bridge_base_url="http://127.0.0.1:8787",
        topics_auto_sync_on_enable=True,
        topics_last_sync_status="idle",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(admin)
    db_session.commit()
    return admin


def make_article(db_session, *, title: str = "Hello", visible: bool = True) -> Article:
    article = Article(
        id=str(uuid.uuid4()),
        title=title,
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        content_md="body",
        is_visible=visible,
        status="completed",
        compile_status="none",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    return article


def test_normalize_topic_key_allows_chinese():
    service = TopicService()
    assert service.normalize_topic_key(" 代码仓库即模板 ") == "代码仓库即模板"
    assert service.normalize_topic_key("Redis Core") == "redis-core"


def test_apply_compile_results_upsert_and_article_topic_replace(db_session):
    make_admin(db_session)
    a1 = make_article(db_session, title="A1")
    a2 = make_article(db_session, title="A2")
    service = TopicService()

    first = service.apply_compile_results(
        db_session,
        {
            "compiler": "llm_wiki",
            "compiled_at": "2026-07-27T10:00:00+08:00",
            "topics": [
                {
                    "key": "redis",
                    "title": "Redis",
                    "content_md": "内存数据库是一种将数据主要保存在内存中的存储系统。",
                    "article_ids": [a1.id, a2.id],
                    "claims": [{"text": "很快", "article_ids": [a1.id]}],
                    "related_topic_keys": ["kv-store"],
                    "compiler_ref": "wiki/entities/redis.md",
                }
            ],
            "articles": [
                {
                    "article_id": a1.id,
                    "compile_status": "compiled",
                    "topic_keys": ["redis"],
                    "replace_topics": True,
                }
            ],
        },
    )
    assert first["ok"] is True
    assert first["upserted_topics"] == 1

    detail = service.get_topic_detail(db_session, "redis", is_admin=True)
    assert detail is not None
    assert detail["title"] == "Redis"
    assert detail["article_count"] >= 1
    assert detail["claims"][0]["text"] == "很快"
    assert detail["summary"] and "内存" in detail["summary"]
    assert "content_md" in detail and "内存数据库" in (detail["content_md"] or "")
    # ensure DB no longer persists summary column usage via ORM attribute
    from models import Topic
    row = db_session.query(Topic).filter(Topic.key == "redis").first()
    assert not hasattr(row, "summary") or "summary" not in row.__table__.columns

    # older writeback should not override
    second = service.apply_compile_results(
        db_session,
        {
            "compiler": "llm_wiki",
            "compiled_at": "2026-07-27T09:00:00+08:00",
            "topics": [
                {
                    "key": "redis",
                    "title": "Old Redis",
                    "content_md": "旧摘要",
                    "article_ids": [a1.id],
                }
            ],
            "articles": [],
        },
    )
    assert any(w.startswith("skip_stale_topic:") for w in second["warnings"])
    detail2 = service.get_topic_detail(db_session, "redis", is_admin=True)
    assert detail2["title"] == "Redis"

    # replace article topics
    service.apply_compile_results(
        db_session,
        {
            "compiler": "llm_wiki",
            "compiled_at": "2026-07-27T11:00:00+08:00",
            "topics": [
                {
                    "key": "kv-store",
                    "title": "KV Store",
                    "content_md": "键值存储用 key 直接定位 value。",
                    "article_ids": [a1.id],
                }
            ],
            "articles": [
                {
                    "article_id": a1.id,
                    "compile_status": "compiled",
                    "topic_keys": ["kv-store"],
                    "replace_topics": True,
                }
            ],
        },
    )
    a1_topics = service.serialize_article_topics(
        db_session.query(Article).filter(Article.id == a1.id).first()
    )
    assert [t["key"] for t in a1_topics] == ["kv-store"]


def test_mark_article_stale_only_for_export_changes(db_session):
    article = make_article(db_session)
    article.compile_status = "compiled"
    db_session.commit()
    service = TopicService()
    service.mark_article_stale_if_needed(db_session, article, title_changed=False, body_changed=False)
    assert article.compile_status == "compiled"
    service.mark_article_stale_if_needed(db_session, article, title_changed=True, body_changed=False)
    assert article.compile_status == "stale"


def test_topic_settings_knowledge_fields_roundtrip(db_session):
    make_admin(db_session)
    service = TopicService()
    updated = service.update_topic_settings(
        db_session,
        {
            "knowledge_type": "llm_wiki",
            "project_path": "/Users/shawn/.lumina/knowledge/Lumina-Knowledge",
            "enabled": True,
        },
    )
    assert updated["knowledge_type"] == "llm_wiki"
    assert updated["project_path"] == "/Users/shawn/.lumina/knowledge/Lumina-Knowledge"
    assert updated["enabled"] is True


def test_cleanup_orphan_topics_dry_run_and_delete(db_session):
    make_admin(db_session)
    service = TopicService()
    a1 = make_article(db_session, title="A1")
    service.apply_compile_results(
        db_session,
        {
            "compiler": "llm_wiki",
            "compiled_at": "2026-07-29T10:00:00+08:00",
            "topics": [
                {
                    "key": "keep-me",
                    "title": "Keep Me",
                    "content_md": "保留主题",
                    "article_ids": [a1.id],
                },
                {
                    "key": "orphan-me",
                    "title": "Orphan Me",
                    "content_md": "孤儿主题",
                    "article_ids": [a1.id],
                },
            ],
            "articles": [
                {
                    "article_id": a1.id,
                    "compile_status": "compiled",
                    "topic_keys": ["keep-me", "orphan-me"],
                    "replace_topics": True,
                }
            ],
        },
    )
    preview = service.cleanup_orphan_topics(db_session, ["keep-me"], dry_run=True)
    assert preview["dry_run"] is True
    assert preview["orphan_count"] == 1
    assert preview["orphans"][0]["key"] == "orphan-me"

    result = service.cleanup_orphan_topics(db_session, ["keep-me"], dry_run=False)
    assert result["deleted_count"] == 1
    assert service.get_topic_by_key(db_session, "orphan-me") is None
    assert service.get_topic_by_key(db_session, "keep-me") is not None
    remaining = service.serialize_article_topics(
        db_session.query(Article).filter(Article.id == a1.id).first()
    )
    assert [item["key"] for item in remaining] == ["keep-me"]


def test_cleanup_orphan_topics_with_explicit_keys_still_works(db_session):
    make_admin(db_session)
    service = TopicService()
    a1 = make_article(db_session, title="A2")
    service.apply_compile_results(
        db_session,
        {
            "compiler": "llm_wiki",
            "compiled_at": "2026-07-29T12:00:00+08:00",
            "topics": [
                {"key": "keep-a", "title": "Keep A", "content_md": "a", "article_ids": [a1.id]},
                {"key": "drop-a", "title": "Drop A", "content_md": "b", "article_ids": [a1.id]},
            ],
            "articles": [],
        },
    )
    preview = service.cleanup_orphan_topics(
        db_session,
        ["keep-a"],
        dry_run=True,
        fetch_from_bridge=False,
    )
    assert preview["orphan_count"] == 1
    assert preview["orphans"][0]["key"] == "drop-a"


def test_topic_settings_persist_last_sync_result(db_session):
    service = TopicService()
    # ensure admin settings row
    from models import AdminSettings

    admin = db_session.query(AdminSettings).first()
    if admin is None:
        admin = AdminSettings(password_hash="x", jwt_secret="y")
        db_session.add(admin)
        db_session.commit()

    payload = {
        "last_sync_at": "2026-07-29T10:00:00+00:00",
        "last_sync_status": "completed",
        "last_sync_error": None,
        "last_sync_result": {
            "status": "completed",
            "at": "2026-07-29T10:00:00+00:00",
            "summary": "同步完成：主题无变化",
            "detailLines": ["扫描主题: 12 · 实际变更: 0 · 未变化: 12"],
            "hint": None,
            "error": None,
            "exported": 0,
            "skipped": 1,
            "writebackTopics": 0,
            "writebackArticles": 0,
        },
    }
    updated = service.update_topic_settings(db_session, payload)
    assert updated["last_sync_status"] == "completed"
    assert updated["last_sync_result"]["summary"] == "同步完成：主题无变化"
    assert updated["last_sync_result"]["detailLines"][0].startswith("扫描主题")

    again = service.get_topic_settings(db_session)
    assert again["last_sync_result"]["writebackTopics"] == 0


def test_serialize_article_topics_defaults_to_lite_refs(db_session):
    service = TopicService()
    from models import Article, Topic, ArticleTopic, now_str
    import uuid

    article = Article(
        id=str(uuid.uuid4()),
        slug="demo-article",
        title="Demo",
        status="published",
        is_visible=True,
        created_at=now_str(),
        updated_at=now_str(),
    )
    topic = Topic(
        id=str(uuid.uuid4()),
        key="long-topic-name",
        title="Long Topic Name",
        content_md="# Heading\n\nThis body should not be summarized in lite mode.",
        status="active",
        topic_type="concept",
        created_at=now_str(),
        updated_at=now_str(),
    )
    short = Topic(
        id=str(uuid.uuid4()),
        key="ai",
        title="AI",
        content_md="short body",
        status="active",
        topic_type="entity",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add_all([article, topic, short])
    db_session.flush()
    db_session.add_all(
        [
            ArticleTopic(
                id=str(uuid.uuid4()),
                article_id=article.id,
                topic_id=topic.id,
                source="test",
                created_at=now_str(),
                updated_at=now_str(),
            ),
            ArticleTopic(
                id=str(uuid.uuid4()),
                article_id=article.id,
                topic_id=short.id,
                source="test",
                created_at=now_str(),
                updated_at=now_str(),
            ),
        ]
    )
    db_session.commit()
    article = (
        db_session.query(Article)
        .options(__import__("sqlalchemy.orm", fromlist=["joinedload"]).joinedload(Article.topic_links).joinedload(ArticleTopic.topic))
        .filter(Article.id == article.id)
        .one()
    )
    lite = service.serialize_article_topics(article)
    assert [item["key"] for item in lite] == ["ai", "long-topic-name"]
    assert set(lite[0].keys()) == {"key", "title", "topic_type"}
    assert "summary" not in lite[0]

    full = service.serialize_article_topics(article, lite=False)
    assert "summary" in full[0]


def test_apply_compile_results_batches_counts_and_links(db_session):
    make_admin(db_session)
    service = TopicService()
    articles = [make_article(db_session, title=f"A{i}") for i in range(5)]
    article_ids = [article.id for article in articles]

    result = service.apply_compile_results(
        db_session,
        {
            "compiler": "llm_wiki",
            "compiled_at": "2026-07-29T12:00:00+00:00",
            "topics": [
                {
                    "key": "alpha",
                    "title": "Alpha",
                    "content_md": "Alpha body",
                    "article_ids": article_ids[:3],
                    "claims": [{"text": "c1", "article_ids": article_ids[:2]}],
                },
                {
                    "key": "beta",
                    "title": "Beta",
                    "content_md": "Beta body",
                    "article_ids": article_ids[2:],
                    "claims": [{"text": "c2", "article_ids": article_ids[2:4]}],
                },
            ],
            "articles": [
                {
                    "article_id": article_id,
                    "compile_status": "compiled",
                    "topic_keys": ["alpha"] if idx < 3 else ["beta"],
                    "replace_topics": True,
                }
                for idx, article_id in enumerate(article_ids)
            ],
        },
    )
    assert result["ok"] is True
    assert result["upserted_topics"] == 2
    assert result["updated_articles"] == 5

    alpha = service.get_topic_detail(db_session, "alpha", is_admin=True)
    beta = service.get_topic_detail(db_session, "beta", is_admin=True)
    assert alpha["article_count"] == 3
    assert beta["article_count"] == 2
    assert alpha["claims"][0]["text"] == "c1"
    assert beta["claims"][0]["text"] == "c2"

    # second writeback with unchanged compiled_at newer content replaces claims in batch
    result2 = service.apply_compile_results(
        db_session,
        {
            "compiler": "llm_wiki",
            "compiled_at": "2026-07-29T13:00:00+00:00",
            "topics": [
                {
                    "key": "alpha",
                    "title": "Alpha",
                    "content_md": "Alpha body v2",
                    "article_ids": article_ids[:2],
                    "claims": [{"text": "c1-new", "article_ids": article_ids[:1]}],
                }
            ],
            "articles": [
                {
                    "article_id": article_ids[0],
                    "compile_status": "compiled",
                    "topic_keys": ["alpha"],
                    "replace_topics": True,
                },
                {
                    "article_id": article_ids[2],
                    "compile_status": "compiled",
                    "topic_keys": ["beta"],
                    "replace_topics": True,
                },
            ],
        },
    )
    assert result2["ok"] is True
    alpha2 = service.get_topic_detail(db_session, "alpha", is_admin=True)
    assert alpha2["claims"][0]["text"] == "c1-new"
    assert alpha2["article_count"] == 2
