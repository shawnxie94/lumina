from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from models import AIAnalysis, AIAnalysisVersion, Article, now_str

TEXT_CONTENT_TYPES = {"summary", "key_points", "outline", "quotes"}
VISUAL_CONTENT_TYPES = {"infographic"}
SUPPORTED_CONTENT_TYPES = TEXT_CONTENT_TYPES | VISUAL_CONTENT_TYPES

CONTENT_FIELD_MAP: dict[str, tuple[str, ...]] = {
    "summary": ("summary",),
    "key_points": ("key_points",),
    "outline": ("outline",),
    "quotes": ("quotes",),
    "infographic": ("infographic_html", "infographic_image_url"),
}

CURRENT_VERSION_FIELD_MAP = {
    "summary": "current_summary_version_id",
    "key_points": "current_key_points_version_id",
    "outline": "current_outline_version_id",
    "quotes": "current_quotes_version_id",
    "infographic": "current_infographic_version_id",
}


class ArticleAIVersionService:
    def ensure_analysis(self, db: Session, article_id: str) -> AIAnalysis:
        analysis = db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
        if analysis:
            return analysis
        analysis = AIAnalysis(article_id=article_id, updated_at=now_str())
        db.add(analysis)
        db.flush()
        return analysis

    def record_version(
        self,
        db: Session,
        article_id: str,
        content_type: str,
        source_task_id: str | None = None,
        source_model_config_id: str | None = None,
        source_prompt_config_id: str | None = None,
        created_by_mode: str = "generation",
        rollback_from_version_id: str | None = None,
    ) -> AIAnalysisVersion:
        self._validate_content_type(content_type)
        analysis = self.ensure_analysis(db, article_id)
        payload = self._extract_current_content(analysis, content_type)
        if not self._has_content(payload):
            raise ValueError("当前 AI 内容为空，无法创建版本")

        last_version = (
            db.query(AIAnalysisVersion)
            .filter(AIAnalysisVersion.article_id == article_id)
            .filter(AIAnalysisVersion.content_type == content_type)
            .order_by(AIAnalysisVersion.version_number.desc())
            .first()
        )
        next_number = (last_version.version_number if last_version else 0) + 1
        version = AIAnalysisVersion(
            article_id=article_id,
            content_type=content_type,
            version_number=next_number,
            status="completed",
            content_text=payload.get("content_text"),
            content_html=payload.get("content_html"),
            content_image_url=payload.get("content_image_url"),
            source_task_id=source_task_id,
            source_model_config_id=source_model_config_id,
            source_prompt_config_id=source_prompt_config_id,
            created_by_mode=created_by_mode,
            rollback_from_version_id=rollback_from_version_id,
            created_at=now_str(),
        )
        db.add(version)
        db.flush()
        setattr(analysis, CURRENT_VERSION_FIELD_MAP[content_type], version.id)
        analysis.updated_at = now_str()
        db.flush()
        return version

    def list_versions(
        self,
        db: Session,
        article_id: str,
        content_type: str,
    ) -> list[dict[str, Any]]:
        self._validate_content_type(content_type)
        analysis = db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
        current_version_id = (
            getattr(analysis, CURRENT_VERSION_FIELD_MAP[content_type], None) if analysis else None
        )
        rows = (
            db.query(AIAnalysisVersion)
            .filter(AIAnalysisVersion.article_id == article_id)
            .filter(AIAnalysisVersion.content_type == content_type)
            .order_by(AIAnalysisVersion.version_number.desc())
            .all()
        )
        return [
            {
                "id": row.id,
                "content_type": row.content_type,
                "version_number": row.version_number,
                "status": row.status,
                "content_text": row.content_text,
                "content_html": row.content_html,
                "content_image_url": row.content_image_url,
                "created_by_mode": row.created_by_mode,
                "rollback_from_version_id": row.rollback_from_version_id,
                "created_at": row.created_at,
                "is_current": row.id == current_version_id,
            }
            for row in rows
        ]

    def rollback_to_version(
        self,
        db: Session,
        article_id: str,
        content_type: str,
        version_id: str,
    ) -> AIAnalysisVersion:
        self._validate_content_type(content_type)
        target_version = self._get_version(db, article_id, content_type, version_id)
        analysis = self.ensure_analysis(db, article_id)
        self._apply_version_to_analysis(analysis, content_type, target_version)
        analysis.updated_at = now_str()
        db.flush()
        new_version = self.record_version(
            db,
            article_id=article_id,
            content_type=content_type,
            created_by_mode="rollback",
            rollback_from_version_id=target_version.id,
        )
        # Product decision: rollback copies the selected version into a new
        # current version, then removes that selected historical snapshot.
        db.delete(target_version)
        new_version.rollback_from_version_id = None
        db.flush()
        db.commit()
        return new_version

    def clear_current_content(
        self,
        db: Session,
        article_id: str,
        content_type: str,
    ) -> None:
        self._validate_content_type(content_type)
        analysis = self.ensure_analysis(db, article_id)
        if content_type == "infographic":
            analysis.infographic_html = None
            analysis.infographic_image_url = None
            analysis.infographic_status = None
        else:
            setattr(analysis, content_type, None)
            setattr(analysis, f"{content_type}_status", None)
        setattr(analysis, CURRENT_VERSION_FIELD_MAP[content_type], None)
        analysis.error_message = None
        analysis.updated_at = now_str()
        db.flush()

    def _get_version(
        self,
        db: Session,
        article_id: str,
        content_type: str,
        version_id: str,
    ) -> AIAnalysisVersion:
        version = (
            db.query(AIAnalysisVersion)
            .filter(AIAnalysisVersion.id == version_id)
            .filter(AIAnalysisVersion.article_id == article_id)
            .filter(AIAnalysisVersion.content_type == content_type)
            .first()
        )
        if not version:
            raise ValueError("版本不存在")
        return version

    def _extract_current_content(
        self,
        analysis: AIAnalysis,
        content_type: str,
    ) -> dict[str, str | None]:
        if content_type in TEXT_CONTENT_TYPES:
            return {
                "content_text": getattr(analysis, content_type),
                "content_html": None,
                "content_image_url": None,
            }
        return {
            "content_text": None,
            "content_html": analysis.infographic_html,
            "content_image_url": analysis.infographic_image_url,
        }

    def _has_content(self, payload: dict[str, str | None]) -> bool:
        return any((value or "").strip() for value in payload.values() if isinstance(value, str))

    def _apply_version_to_analysis(
        self,
        analysis: AIAnalysis,
        content_type: str,
        version: AIAnalysisVersion,
    ) -> None:
        if content_type in TEXT_CONTENT_TYPES:
            setattr(analysis, content_type, version.content_text)
            setattr(analysis, f"{content_type}_status", "completed")
            return
        analysis.infographic_html = version.content_html
        analysis.infographic_image_url = version.content_image_url
        analysis.infographic_status = "completed"

    def _serialize_version(self, version: AIAnalysisVersion) -> dict[str, Any]:
        return {
            "id": version.id,
            "content_type": version.content_type,
            "version_number": version.version_number,
            "status": version.status,
            "content_text": version.content_text,
            "content_html": version.content_html,
            "content_image_url": version.content_image_url,
            "created_by_mode": version.created_by_mode,
            "rollback_from_version_id": version.rollback_from_version_id,
            "created_at": version.created_at,
        }

    def _validate_content_type(self, content_type: str) -> None:
        if content_type not in SUPPORTED_CONTENT_TYPES:
            raise ValueError("不支持的 AI 内容类型")
