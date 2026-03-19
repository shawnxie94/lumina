from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import AIAnalysis, Article, Tag, article_tags, now_str

_LEADING_HASH_RE = re.compile(r"^#+")
_MULTI_SPACE_RE = re.compile(r"\s+")
_SPLIT_RE = re.compile(r"[\n,，;；]+")
_BULLET_RE = re.compile(r"^[-*•\d\.\)\s]+")


class ArticleTagService:
    MAX_TAGS_PER_ARTICLE = 5

    def normalize_tag_name(self, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _LEADING_HASH_RE.sub("", str(value).strip())
        cleaned = _MULTI_SPACE_RE.sub(" ", cleaned).strip()
        if not cleaned:
            return None
        return cleaned

    def get_normalized_name(self, value: str | None) -> str | None:
        cleaned = self.normalize_tag_name(value)
        if not cleaned:
            return None
        return cleaned.casefold()

    def normalize_tag_names(self, values: Iterable[str] | None) -> list[str]:
        if values is None:
            return []
        deduped: list[str] = []
        seen: set[str] = set()
        for raw in values:
            cleaned = self.normalize_tag_name(raw)
            if not cleaned:
                continue
            normalized = cleaned.casefold()
            if normalized in seen:
                continue
            deduped.append(cleaned)
            seen.add(normalized)
            if len(deduped) >= self.MAX_TAGS_PER_ARTICLE:
                break
        return deduped

    def has_same_tag_names(
        self,
        article: Article,
        tag_names: Iterable[str] | None,
    ) -> bool:
        current_names = self.normalize_tag_names(
            [tag.name for tag in getattr(article, "tags", [])]
        )
        desired_names = self.normalize_tag_names(tag_names)
        return sorted(name.casefold() for name in current_names) == sorted(
            name.casefold() for name in desired_names
        )

    def parse_tag_names(self, raw_output) -> list[str]:
        if raw_output is None:
            return []
        if isinstance(raw_output, list):
            items: list[str] = []
            for item in raw_output:
                if isinstance(item, dict):
                    value = item.get("name") or item.get("tag") or item.get("label")
                else:
                    value = item
                items.append("" if value is None else str(value))
            return self.normalize_tag_names(items)
        if isinstance(raw_output, dict):
            for key in ("tags", "items", "data"):
                if key in raw_output:
                    return self.parse_tag_names(raw_output.get(key))
            return []

        raw_text = str(raw_output).strip()
        if not raw_text:
            return []
        try:
            parsed = json.loads(raw_text)
        except Exception:
            parsed = None
        if parsed is not None and parsed is not raw_output:
            parsed_names = self.parse_tag_names(parsed)
            if parsed_names:
                return parsed_names

        chunks = []
        for piece in _SPLIT_RE.split(raw_text):
            cleaned = _BULLET_RE.sub("", piece or "").strip()
            if cleaned:
                chunks.append(cleaned)
        return self.normalize_tag_names(chunks)

    def get_tagging_source_text(self, article: Article) -> str:
        content = _MULTI_SPACE_RE.sub(" ", (article.content_md or "").strip())
        return content

    def get_tagging_source_hash(self, article: Article) -> str | None:
        source_text = self.get_tagging_source_text(article)
        if not source_text:
            return None
        return hashlib.sha256(source_text.encode("utf-8")).hexdigest()

    def ensure_analysis(self, db: Session, article: Article) -> AIAnalysis:
        analysis = article.ai_analysis
        if analysis:
            return analysis
        analysis = AIAnalysis(
            article_id=article.id,
            updated_at=now_str(),
        )
        db.add(analysis)
        db.flush()
        article.ai_analysis = analysis
        return analysis

    def set_article_tags(
        self,
        db: Session,
        article: Article,
        tag_names: Iterable[str] | None,
        *,
        manual_override: bool,
        tagging_status: str | None,
        source_hash: str | None,
    ) -> list[Tag]:
        previous_tag_ids = {
            tag.id for tag in getattr(article, "tags", []) if getattr(tag, "id", None)
        }
        normalized_tag_names = self.normalize_tag_names(tag_names)
        existing_tags = {}
        normalized_names = [name.casefold() for name in normalized_tag_names]
        if normalized_names:
            for tag in db.query(Tag).filter(Tag.normalized_name.in_(normalized_names)).all():
                existing_tags[tag.normalized_name] = tag

        desired_tags: list[Tag] = []
        for tag_name in normalized_tag_names:
            normalized_name = tag_name.casefold()
            tag = existing_tags.get(normalized_name)
            if not tag:
                tag = Tag(
                    name=tag_name,
                    normalized_name=normalized_name,
                    created_at=now_str(),
                    updated_at=now_str(),
                )
                db.add(tag)
                db.flush()
                existing_tags[normalized_name] = tag
            desired_tags.append(tag)

        article.tags = desired_tags
        article.updated_at = now_str()

        analysis = self.ensure_analysis(db, article)
        analysis.tagging_manual_override = bool(manual_override)
        analysis.tagging_status = tagging_status
        analysis.tagging_source_hash = source_hash
        analysis.updated_at = now_str()

        db.flush()
        affected_tag_ids = previous_tag_ids | {
            tag.id for tag in desired_tags if getattr(tag, "id", None)
        }
        self.cleanup_orphan_tags(db, tag_ids=affected_tag_ids)
        return desired_tags

    def mark_tagging_pending(
        self,
        db: Session,
        article: Article,
        *,
        manual_override: bool = False,
    ) -> AIAnalysis:
        analysis = self.ensure_analysis(db, article)
        analysis.tagging_manual_override = bool(manual_override)
        analysis.tagging_status = "pending"
        analysis.updated_at = now_str()
        db.flush()
        return analysis

    def cleanup_orphan_tags(
        self,
        db: Session,
        *,
        tag_ids: Iterable[str] | None = None,
    ) -> int:
        candidate_tag_ids = [
            str(tag_id).strip() for tag_id in (tag_ids or []) if str(tag_id).strip()
        ]
        query = db.query(Tag.id).outerjoin(article_tags, Tag.id == article_tags.c.tag_id)
        if candidate_tag_ids:
            query = query.filter(Tag.id.in_(candidate_tag_ids))
        elif tag_ids is not None:
            return 0
        orphan_ids = [
            row.id
            for row in (
                query.group_by(Tag.id)
                .having(func.count(article_tags.c.article_id) == 0)
                .all()
            )
        ]
        if not orphan_ids:
            return 0
        return (
            db.query(Tag)
            .filter(Tag.id.in_(orphan_ids))
            .delete(synchronize_session=False)
        )

    def list_tags_with_count(
        self,
        db: Session,
        *,
        include_hidden: bool = False,
    ) -> list[dict]:
        article_count = func.count(Article.id).label("article_count")
        query = db.query(
            Tag.id,
            Tag.name,
            article_count,
        )
        if include_hidden:
            query = query.outerjoin(article_tags, Tag.id == article_tags.c.tag_id).outerjoin(
                Article, Article.id == article_tags.c.article_id
            )
        else:
            query = (
                query.join(article_tags, Tag.id == article_tags.c.tag_id)
                .join(Article, Article.id == article_tags.c.article_id)
                .filter(Article.is_visible == True)
            )

        rows = (
            query.group_by(Tag.id, Tag.name)
            .order_by(article_count.desc(), Tag.name.asc())
            .all()
        )
        return [
            {
                "id": row.id,
                "name": row.name,
                "article_count": int(row.article_count or 0),
            }
            for row in rows
        ]

    def serialize_tags(self, article: Article) -> list[dict[str, str]]:
        if not getattr(article, "tags", None):
            return []
        return [
            {"id": tag.id, "name": tag.name}
            for tag in sorted(article.tags, key=lambda item: item.name.casefold())
        ]
