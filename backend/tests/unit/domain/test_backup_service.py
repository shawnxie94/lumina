from __future__ import annotations

import io
import json
import sqlite3
import uuid
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.domain.backup_service import BackupService
from models import (
    AIAnalysis,
    AIAnalysisVersion,
    AITask,
    AITaskEvent,
    AIUsageLog,
    AdminSettings,
    Article,
    ArticleComment,
    ArticleEmbedding,
    Base,
    Category,
    MediaAsset,
    ModelAPIConfig,
    PromptConfig,
    Tag,
    now_str,
)


CURRENT_SCHEMA_VERSION = "20260331_0015_article_view_count"


def _make_session(db_path: Path) -> tuple[Session, object]:
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return SessionLocal(), engine


def _write_media(media_root: Path, relative_path: str, content: bytes) -> Path:
    target = media_root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


def _build_archive_fixture(db_session: Session, media_root: Path) -> dict[str, str]:
    category = Category(
        id=str(uuid.uuid4()),
        name="Tech",
        sort_order=1,
        created_at=now_str(),
    )
    tag = Tag(
        id=str(uuid.uuid4()),
        name="AI",
        normalized_name="ai",
        created_at=now_str(),
        updated_at=now_str(),
    )
    model = ModelAPIConfig(
        id=str(uuid.uuid4()),
        name="Primary Model",
        base_url="https://api.example.com/v1",
        api_key="secret-api-key",
        provider="openai",
        model_name="gpt-test",
        model_type="general",
        is_enabled=True,
        is_default=True,
        created_at=now_str(),
        updated_at=now_str(),
    )
    prompt = PromptConfig(
        id=str(uuid.uuid4()),
        name="Summary Prompt",
        type="summary",
        prompt="Summarize the article",
        system_prompt="Keep it concise",
        model_api_config_id=model.id,
        category_id=category.id,
        is_enabled=True,
        is_default=True,
        created_at=now_str(),
        updated_at=now_str(),
    )
    admin = AdminSettings(
        id=str(uuid.uuid4()),
        password_hash="hashed-password",
        jwt_secret="jwt-secret",
        github_client_secret="github-secret",
        google_client_secret="google-secret",
        nextauth_secret="nextauth-secret",
        comments_enabled=True,
        media_storage_enabled=True,
        site_name="Lumina Test",
        created_at=now_str(),
        updated_at=now_str(),
    )
    article = Article(
        id=str(uuid.uuid4()),
        title="Mirror Backup Article",
        slug="mirror-backup-article",
        content_md="Body",
        created_at=now_str(),
        updated_at=now_str(),
        status="completed",
        is_visible=True,
        view_count=27,
        category_id=category.id,
        top_image="/backend/media/2026/04/top.webp",
    )
    article.tags.append(tag)

    comment = ArticleComment(
        article_id=article.id,
        user_id="user-1",
        user_name="Backup Tester",
        content="Looks good",
        created_at=now_str(),
        updated_at=now_str(),
    )
    analysis = AIAnalysis(
        article_id=article.id,
        summary="summary",
        summary_status="completed",
        infographic_html="<div>chart</div>",
        infographic_image_url="/backend/media/2026/04/infographic.png",
        infographic_status="completed",
        updated_at=now_str(),
    )
    version = AIAnalysisVersion(
        article_id=article.id,
        content_type="summary",
        version_number=1,
        status="completed",
        content_text="summary-v1",
        source_task_id="task-source",
        source_model_config_id=model.id,
        source_prompt_config_id=prompt.id,
        created_by_mode="generation",
        created_at=now_str(),
    )

    media_asset = MediaAsset(
        article_id=article.id,
        storage_path="2026/04/infographic.png",
        content_type="image/png",
        size=7,
        created_at=now_str(),
    )
    task = AITask(
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at=now_str(),
        created_at=now_str(),
        updated_at=now_str(),
        finished_at=now_str(),
    )
    usage_log = AIUsageLog(
        article_id=article.id,
        task_id="task-log",
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        total_tokens=100,
        created_at=now_str(),
    )
    embedding = ArticleEmbedding(
        article_id=article.id,
        model="embedding-test",
        embedding="[0.1, 0.2]",
        source_hash="hash",
        created_at=now_str(),
        updated_at=now_str(),
    )

    db_session.add_all(
        [
            category,
            tag,
            model,
            prompt,
            admin,
            article,
            comment,
            analysis,
            version,
            media_asset,
            task,
            usage_log,
            embedding,
        ]
    )
    db_session.commit()
    db_session.refresh(version)
    analysis.current_summary_version_id = version.id
    db_session.commit()

    task_event = AITaskEvent(
        task_id=task.id,
        event_type="completed",
        created_at=now_str(),
    )
    db_session.add(task_event)
    db_session.commit()

    _write_media(media_root, "2026/04/infographic.png", b"PNGDATA")
    _write_media(media_root, "2026/04/top.webp", b"WEBPDATA")

    return {
        "article_id": article.id,
        "article_slug": article.slug,
        "model_id": model.id,
        "prompt_id": prompt.id,
    }


def _export_archive_bytes(db_session: Session, media_root: Path) -> bytes:
    service = BackupService(
        media_root=str(media_root),
        current_schema_version=CURRENT_SCHEMA_VERSION,
        source_commit="test-commit",
    )
    return b"".join(service.export_backup_stream(db_session))


def _snapshot_connection(zip_bytes: bytes, tmp_path: Path) -> sqlite3.Connection:
    tmp_path.mkdir(parents=True, exist_ok=True)
    archive_path = tmp_path / "archive.zip"
    archive_path.write_bytes(zip_bytes)
    with zipfile.ZipFile(archive_path) as zf:
        snapshot_path = tmp_path / "snapshot.db"
        snapshot_path.write_bytes(zf.read("snapshot.db"))
    return sqlite3.connect(snapshot_path)


def test_backup_service_exports_zip_archive_with_filtered_snapshot(
    db_session: Session, tmp_path: Path
):
    media_root = tmp_path / "source-media"
    _build_archive_fixture(db_session, media_root)
    db_session.execute(text("CREATE TABLE aux_runtime_cache (id INTEGER PRIMARY KEY, payload TEXT)"))
    db_session.execute(text("INSERT INTO aux_runtime_cache (payload) VALUES ('stale-runtime-data')"))
    db_session.commit()

    archive_bytes = _export_archive_bytes(db_session, media_root)

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as zf:
        names = set(zf.namelist())
        assert "manifest.json" in names
        assert "snapshot.db" in names
        assert "media/2026/04/infographic.png" in names
        assert "media/2026/04/top.webp" in names

        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert manifest["format_version"] == 1
        assert manifest["app"] == "lumina"
        assert manifest["source_schema_version"] == CURRENT_SCHEMA_VERSION
        assert manifest["source_commit"] == "test-commit"
        assert manifest["includes"] == {
            "comments": True,
            "media": True,
            "secrets": True,
        }

    snapshot = _snapshot_connection(archive_bytes, tmp_path / "inspect")
    try:
        article_row = snapshot.execute(
            "SELECT slug, view_count, top_image FROM articles WHERE slug = ?",
            ("mirror-backup-article",),
        ).fetchone()
        assert article_row == (
            "mirror-backup-article",
            0,
            "/backend/media/2026/04/top.webp",
        )

        assert (
            snapshot.execute("SELECT COUNT(*) FROM article_comments").fetchone()[0] == 1
        )
        assert (
            snapshot.execute("SELECT COUNT(*) FROM ai_analysis_versions").fetchone()[0]
            == 1
        )
        assert (
            snapshot.execute(
                "SELECT github_client_secret FROM admin_settings LIMIT 1"
            ).fetchone()[0]
            == "github-secret"
        )
        assert snapshot.execute("SELECT COUNT(*) FROM ai_tasks").fetchone()[0] == 0
        assert snapshot.execute("SELECT COUNT(*) FROM ai_task_events").fetchone()[0] == 0
        assert snapshot.execute("SELECT COUNT(*) FROM ai_usage_logs").fetchone()[0] == 0
        assert (
            snapshot.execute("SELECT COUNT(*) FROM article_embeddings").fetchone()[0]
            == 0
        )
        assert (
            snapshot.execute("SELECT COUNT(*) FROM aux_runtime_cache").fetchone()[0] == 0
        )
    finally:
        snapshot.close()


def test_backup_service_restores_snapshot_and_media(
    db_session: Session, tmp_path: Path
):
    source_media_root = tmp_path / "source-media"
    _build_archive_fixture(db_session, source_media_root)
    archive_bytes = _export_archive_bytes(db_session, source_media_root)

    target_db_path = tmp_path / "restore-target.db"
    restore_session, restore_engine = _make_session(target_db_path)
    target_media_root = tmp_path / "target-media"
    try:
        legacy_article = Article(
            id=str(uuid.uuid4()),
            title="Legacy",
            slug="legacy-article",
            content_md="old",
            created_at=now_str(),
            updated_at=now_str(),
            status="completed",
            is_visible=True,
            view_count=5,
        )
        restore_session.add(legacy_article)
        restore_session.commit()
        _write_media(target_media_root, "legacy/file.txt", b"legacy")

        service = BackupService(
            database_url=f"sqlite:///{target_db_path}",
            media_root=str(target_media_root),
            current_schema_version=CURRENT_SCHEMA_VERSION,
            source_commit="restore-commit",
        )
        result = service.import_backup(restore_session, io.BytesIO(archive_bytes))

        assert result["success"] is True
        assert result["meta"]["backup_source_schema_version"] == CURRENT_SCHEMA_VERSION
        assert result["restored"]["includes"] == {
            "comments": True,
            "media": True,
            "secrets": True,
        }

        verification_session, verification_engine = _make_session(tmp_path / "verify.db")
        verification_session.close()
        verification_engine.dispose()

        reopened_engine = create_engine(
            f"sqlite:///{target_db_path}",
            connect_args={"check_same_thread": False},
        )
        ReopenedSession = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=reopened_engine,
        )
        reopened_session = ReopenedSession()
        try:
            article = (
                reopened_session.query(Article)
                .filter(Article.slug == "mirror-backup-article")
                .one()
            )
            assert article.view_count == 0
            assert (
                reopened_session.query(Article)
                .filter(Article.slug == "legacy-article")
                .count()
                == 0
            )
            assert (
                reopened_session.query(ArticleComment)
                .filter(ArticleComment.article_id == article.id)
                .count()
                == 1
            )
            analysis = (
                reopened_session.query(AIAnalysis)
                .filter(AIAnalysis.article_id == article.id)
                .one()
            )
            version = (
                reopened_session.query(AIAnalysisVersion)
                .filter(AIAnalysisVersion.article_id == article.id)
                .one()
            )
            assert analysis.current_summary_version_id == version.id

            admin = reopened_session.query(AdminSettings).one()
            assert admin.github_client_secret == "github-secret"

            assert reopened_session.query(AITask).count() == 0
            assert reopened_session.query(ArticleEmbedding).count() == 0
        finally:
            reopened_session.close()
            reopened_engine.dispose()

        assert not (target_media_root / "legacy/file.txt").exists()
        assert (target_media_root / "2026/04/infographic.png").read_bytes() == b"PNGDATA"
        assert (target_media_root / "2026/04/top.webp").read_bytes() == b"WEBPDATA"
    finally:
        restore_session.close()
        Base.metadata.drop_all(bind=restore_engine)
        restore_engine.dispose()


def test_backup_service_rejects_newer_schema_backup(
    db_session: Session, tmp_path: Path
):
    media_root = tmp_path / "source-media"
    _build_archive_fixture(db_session, media_root)
    archive_bytes = _export_archive_bytes(db_session, media_root)

    modified_archive = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as source_zip, zipfile.ZipFile(
        modified_archive, "w", compression=zipfile.ZIP_DEFLATED
    ) as target_zip:
        for name in source_zip.namelist():
            payload = source_zip.read(name)
            if name == "manifest.json":
                manifest = json.loads(payload.decode("utf-8"))
                manifest["source_schema_version"] = "99999999_9999_future_revision"
                payload = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
            target_zip.writestr(name, payload)

    target_db_path = tmp_path / "reject-target.db"
    restore_session, restore_engine = _make_session(target_db_path)
    try:
        service = BackupService(
            database_url=f"sqlite:///{target_db_path}",
            media_root=str(tmp_path / "reject-media"),
            current_schema_version=CURRENT_SCHEMA_VERSION,
        )
        with pytest.raises(ValueError, match="备份来自更高版本"):
            service.import_backup(restore_session, io.BytesIO(modified_archive.getvalue()))
    finally:
        restore_session.close()
        Base.metadata.drop_all(bind=restore_engine)
        restore_engine.dispose()


def test_backup_service_rolls_back_database_and_media_when_restore_fails(
    db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    source_media_root = tmp_path / "source-media"
    _build_archive_fixture(db_session, source_media_root)
    archive_bytes = _export_archive_bytes(db_session, source_media_root)

    target_db_path = tmp_path / "rollback-target.db"
    restore_session, restore_engine = _make_session(target_db_path)
    target_media_root = tmp_path / "rollback-media"
    try:
        legacy_article = Article(
            id=str(uuid.uuid4()),
            title="Legacy",
            slug="legacy-article",
            content_md="old",
            created_at=now_str(),
            updated_at=now_str(),
            status="completed",
            is_visible=True,
            view_count=9,
        )
        restore_session.add(legacy_article)
        restore_session.commit()
        _write_media(target_media_root, "legacy/file.txt", b"legacy")

        service = BackupService(
            database_url=f"sqlite:///{target_db_path}",
            media_root=str(target_media_root),
            current_schema_version=CURRENT_SCHEMA_VERSION,
        )

        def _boom(*args, **kwargs):
            raise RuntimeError("media restore failed")

        monkeypatch.setattr(service, "_restore_media_directory", _boom)

        with pytest.raises(RuntimeError, match="media restore failed"):
            service.import_backup(restore_session, io.BytesIO(archive_bytes))

        reopened_engine = create_engine(
            f"sqlite:///{target_db_path}",
            connect_args={"check_same_thread": False},
        )
        ReopenedSession = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=reopened_engine,
        )
        reopened_session = ReopenedSession()
        try:
            legacy = (
                reopened_session.query(Article)
                .filter(Article.slug == "legacy-article")
                .one()
            )
            assert legacy.view_count == 9
            assert (
                reopened_session.query(Article)
                .filter(Article.slug == "mirror-backup-article")
                .count()
                == 0
            )
        finally:
            reopened_session.close()
            reopened_engine.dispose()

        assert (target_media_root / "legacy/file.txt").read_bytes() == b"legacy"
        assert not (target_media_root / "2026/04/infographic.png").exists()
    finally:
        restore_session.close()
        Base.metadata.drop_all(bind=restore_engine)
        restore_engine.dispose()
