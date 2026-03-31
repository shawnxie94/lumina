from __future__ import annotations

import json
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.domain.backup_service import BackupService
from models import AIAnalysis, Article, Base, PromptConfig, now_str


def test_backup_service_exports_and_imports_infographic_fields(db_session, tmp_path):
    article = Article(
        id=str(uuid.uuid4()),
        title="backup-infographic",
        slug="backup-infographic",
        content_md="正文内容",
        created_at=now_str(),
        updated_at=now_str(),
        status="completed",
        is_visible=True,
    )
    db_session.add(article)
    db_session.commit()

    analysis = AIAnalysis(
        article_id=article.id,
        summary="summary",
        summary_status="completed",
        infographic_html="<div>infographic</div>",
        infographic_status="completed",
        infographic_image_url="/media/infographic.png",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    service = BackupService()
    export_payload = json.loads("".join(service.export_backup_stream(db_session)))
    exported_analysis = export_payload["data"]["ai_analyses"][0]

    assert exported_analysis["infographic_html"] == "<div>infographic</div>"
    assert exported_analysis["infographic_status"] == "completed"
    assert exported_analysis["infographic_image_url"] == "/media/infographic.png"

    import_engine = create_engine(
        f"sqlite:///{tmp_path / 'backup-import.db'}",
        connect_args={"check_same_thread": False},
    )
    ImportSession = sessionmaker(autocommit=False, autoflush=False, bind=import_engine)
    Base.metadata.create_all(bind=import_engine)
    import_session = ImportSession()
    try:
        result = service.import_backup(import_session, export_payload)
        assert result["stats"]["ai_analyses"]["created"] == 1

        imported_article = (
            import_session.query(Article)
            .filter(Article.slug == "backup-infographic")
            .one()
        )
        imported_analysis = (
            import_session.query(AIAnalysis)
            .filter(AIAnalysis.article_id == imported_article.id)
            .one()
        )
        assert imported_analysis.infographic_html == "<div>infographic</div>"
        assert imported_analysis.infographic_status == "completed"
        assert imported_analysis.infographic_image_url == "/media/infographic.png"
    finally:
        import_session.close()
        Base.metadata.drop_all(bind=import_engine)
        import_engine.dispose()


def test_backup_service_prompt_config_omits_response_format_and_resets_on_import(
    db_session, tmp_path
):
    prompt_config = PromptConfig(
        id=str(uuid.uuid4()),
        name="分类提示词",
        type="classification",
        prompt="请输出分类结果",
        system_prompt="只返回结构化结果",
        is_enabled=True,
        is_default=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(prompt_config)
    db_session.commit()

    service = BackupService()
    export_payload = json.loads("".join(service.export_backup_stream(db_session)))
    exported_prompt = export_payload["data"]["prompt_configs"][0]

    assert "response_format" not in exported_prompt

    import_engine = create_engine(
        f"sqlite:///{tmp_path / 'backup-import-prompts.db'}",
        connect_args={"check_same_thread": False},
    )
    ImportSession = sessionmaker(autocommit=False, autoflush=False, bind=import_engine)
    Base.metadata.create_all(bind=import_engine)
    import_session = ImportSession()
    try:
        prompt_payload = dict(exported_prompt)
        prompt_payload["response_format"] = "text"
        export_payload["data"]["prompt_configs"] = [prompt_payload]

        result = service.import_backup(import_session, export_payload)
        assert result["stats"]["prompt_configs"]["created"] == 1

        imported_prompt = (
            import_session.query(PromptConfig)
            .filter(PromptConfig.name == "分类提示词")
            .one()
        )
        assert imported_prompt.prompt == "请输出分类结果"
    finally:
        import_session.close()
        Base.metadata.drop_all(bind=import_engine)
        import_engine.dispose()
