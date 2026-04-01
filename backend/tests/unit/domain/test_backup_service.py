from __future__ import annotations

import json
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.domain.backup_service import BackupService
from models import (
    AIAnalysis,
    AIAnalysisVersion,
    Article,
    Base,
    ModelAPIConfig,
    PromptConfig,
    now_str,
)


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


def test_backup_service_exports_and_imports_ai_analysis_versions(db_session, tmp_path):
    article = Article(
        id=str(uuid.uuid4()),
        title="backup-versions",
        slug="backup-versions",
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
        summary="当前摘要",
        summary_status="completed",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    version = AIAnalysisVersion(
        article_id=article.id,
        content_type="summary",
        version_number=1,
        status="completed",
        content_text="历史摘要 v1",
        source_task_id="task-1",
        source_model_config_id="model-1",
        source_prompt_config_id="prompt-1",
        created_by_mode="generation",
        created_at=now_str(),
    )
    db_session.add(version)
    db_session.commit()
    analysis.current_summary_version_id = version.id
    db_session.commit()

    service = BackupService()
    export_payload = json.loads("".join(service.export_backup_stream(db_session)))

    exported_versions = export_payload["data"]["ai_analysis_versions"]
    assert len(exported_versions) == 1
    assert exported_versions[0]["content_type"] == "summary"
    assert exported_versions[0]["content_text"] == "历史摘要 v1"

    import_engine = create_engine(
        f"sqlite:///{tmp_path / 'backup-import-versions.db'}",
        connect_args={"check_same_thread": False},
    )
    ImportSession = sessionmaker(autocommit=False, autoflush=False, bind=import_engine)
    Base.metadata.create_all(bind=import_engine)
    import_session = ImportSession()
    try:
        result = service.import_backup(import_session, export_payload)
        assert result["stats"]["ai_analysis_versions"]["created"] == 1

        imported_article = (
            import_session.query(Article)
            .filter(Article.slug == "backup-versions")
            .one()
        )
        imported_version = (
            import_session.query(AIAnalysisVersion)
            .filter(AIAnalysisVersion.article_id == imported_article.id)
            .filter(AIAnalysisVersion.content_type == "summary")
            .one()
        )
        imported_analysis = (
            import_session.query(AIAnalysis)
            .filter(AIAnalysis.article_id == imported_article.id)
            .one()
        )
        assert imported_version.content_text == "历史摘要 v1"
        assert imported_analysis.current_summary_version_id == imported_version.id
    finally:
        import_session.close()
        Base.metadata.drop_all(bind=import_engine)
        import_engine.dispose()


def test_backup_service_import_remaps_ai_analysis_version_source_ids(
    db_session, tmp_path
):
    model = ModelAPIConfig(
        id=str(uuid.uuid4()),
        name="测试模型",
        base_url="https://api.example.com/v1",
        api_key="secret-key",
        provider="openai",
        model_name="gpt-test",
        model_type="general",
        is_enabled=True,
        is_default=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(model)
    db_session.commit()

    prompt = PromptConfig(
        id=str(uuid.uuid4()),
        name="摘要提示词",
        type="summary",
        prompt="请输出摘要",
        system_prompt="保持简洁",
        model_api_config_id=model.id,
        is_enabled=True,
        is_default=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(prompt)
    db_session.commit()

    article = Article(
        id=str(uuid.uuid4()),
        title="backup-version-source-remap",
        slug="backup-version-source-remap",
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
        summary="当前摘要",
        summary_status="completed",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    version = AIAnalysisVersion(
        article_id=article.id,
        content_type="summary",
        version_number=1,
        status="completed",
        content_text="历史摘要 v1",
        source_task_id="task-1",
        source_model_config_id=model.id,
        source_prompt_config_id=prompt.id,
        created_by_mode="generation",
        created_at=now_str(),
    )
    db_session.add(version)
    db_session.commit()
    analysis.current_summary_version_id = version.id
    db_session.commit()

    service = BackupService()
    export_payload = json.loads("".join(service.export_backup_stream(db_session)))

    import_engine = create_engine(
        f"sqlite:///{tmp_path / 'backup-import-version-source-remap.db'}",
        connect_args={"check_same_thread": False},
    )
    ImportSession = sessionmaker(autocommit=False, autoflush=False, bind=import_engine)
    Base.metadata.create_all(bind=import_engine)
    import_session = ImportSession()
    try:
        service.import_backup(import_session, export_payload)

        imported_model = (
            import_session.query(ModelAPIConfig)
            .filter(ModelAPIConfig.name == "测试模型")
            .one()
        )
        imported_prompt = (
            import_session.query(PromptConfig)
            .filter(PromptConfig.name == "摘要提示词")
            .filter(PromptConfig.type == "summary")
            .one()
        )
        imported_article = (
            import_session.query(Article)
            .filter(Article.slug == "backup-version-source-remap")
            .one()
        )
        imported_version = (
            import_session.query(AIAnalysisVersion)
            .filter(AIAnalysisVersion.article_id == imported_article.id)
            .filter(AIAnalysisVersion.content_type == "summary")
            .one()
        )

        assert imported_version.source_model_config_id == imported_model.id
        assert imported_version.source_prompt_config_id == imported_prompt.id
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
