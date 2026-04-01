from __future__ import annotations

from app.domain.article_ai_version_service import ArticleAIVersionService
from models import AIAnalysis, AIAnalysisVersion, Article, now_str


def make_article_with_analysis(db_session):
    article = Article(
        title="Versioned Article",
        slug="versioned-article",
        content_md="正文内容",
        created_at=now_str(),
        updated_at=now_str(),
        status="completed",
        is_visible=True,
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    analysis = AIAnalysis(
        article_id=article.id,
        summary="当前摘要 v1",
        summary_status="completed",
        key_points="当前总结",
        key_points_status="completed",
        infographic_html="<section>当前信息图</section>",
        infographic_image_url="/media/current.png",
        infographic_status="completed",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()
    db_session.refresh(article)
    db_session.refresh(analysis)
    return article, analysis


def test_record_version_persists_text_snapshot_and_updates_current_pointer(db_session):
    service = ArticleAIVersionService()
    article, analysis = make_article_with_analysis(db_session)

    version = service.record_version(
        db_session,
        article_id=article.id,
        content_type="summary",
        source_task_id="task-summary-1",
        source_model_config_id="model-1",
        source_prompt_config_id="prompt-1",
    )

    db_session.refresh(analysis)
    stored = db_session.get(AIAnalysisVersion, version.id)

    assert stored is not None
    assert stored.article_id == article.id
    assert stored.content_type == "summary"
    assert stored.version_number == 1
    assert stored.status == "completed"
    assert stored.content_text == "当前摘要 v1"
    assert stored.content_html is None
    assert stored.content_image_url is None
    assert stored.source_task_id == "task-summary-1"
    assert stored.source_model_config_id == "model-1"
    assert stored.source_prompt_config_id == "prompt-1"
    assert stored.created_by_mode == "generation"
    assert analysis.current_summary_version_id == version.id


def test_rollback_to_version_creates_new_version_and_restores_current_content(db_session):
    service = ArticleAIVersionService()
    article, analysis = make_article_with_analysis(db_session)

    first_version = service.record_version(
        db_session,
        article_id=article.id,
        content_type="summary",
    )
    analysis.summary = "当前摘要 v2"
    analysis.updated_at = now_str()
    db_session.commit()
    second_version = service.record_version(
        db_session,
        article_id=article.id,
        content_type="summary",
    )

    rolled_back = service.rollback_to_version(
        db_session,
        article_id=article.id,
        content_type="summary",
        version_id=first_version.id,
    )

    versions = (
        db_session.query(AIAnalysisVersion)
        .filter(AIAnalysisVersion.article_id == article.id)
        .filter(AIAnalysisVersion.content_type == "summary")
        .order_by(AIAnalysisVersion.version_number.asc())
        .all()
    )
    db_session.refresh(analysis)

    assert db_session.get(AIAnalysisVersion, first_version.id) is None
    assert [item.version_number for item in versions] == [2, 3]
    assert second_version.version_number == 2
    assert rolled_back.version_number == 3
    assert rolled_back.created_by_mode == "rollback"
    assert rolled_back.rollback_from_version_id is None
    assert rolled_back.content_text == "当前摘要 v1"
    assert analysis.summary == "当前摘要 v1"
    assert analysis.current_summary_version_id == rolled_back.id
