from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from models import AdminSettings, Article, ArticleTopic, Topic, TopicClaim, now_str

from app.core.public_cache import (
    CACHE_KEY_TOPICS_ENABLED,
    CACHE_KEY_TOPICS_LIST_PREFIX,
    CACHE_KEY_TOPICS_SETTINGS,
    TOPICS_CACHE_TTL_SECONDS,
    get_public_cached,
    invalidate_topics_caches,
)
from .markdown_summary import derive_summary_from_markdown
from .timestamp_utils import is_newer_timestamp, parse_iso_timestamp


_MULTI_DASH_RE = re.compile(r"-{2,}")
_INVALID_KEY_RE = re.compile(r"[^a-z0-9\u4e00-\u9fff-]+")
_WS_RE = re.compile(r"[\s_]+")


class TopicService:
    VALID_COMPILE_STATUS = {
        "none",
        "queued",
        "synced",
        "compiled",
        "stale",
        "failed",
    }

    @staticmethod
    def derive_summary_from_content(content_md: str | None, *, limit: int = 180) -> str | None:
        return derive_summary_from_markdown(content_md, limit=limit)

    def _loads_json_obj(self, raw: str | None) -> dict[str, Any] | None:
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except Exception:
            return None
        return data if isinstance(data, dict) else None

    def _loads_json_list(self, raw: str | None) -> list[str]:
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except Exception:
            return []
        if not isinstance(data, list):
            return []
        values: list[str] = []
        seen: set[str] = set()
        for item in data:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            values.append(text)
        return values

    def _dumps_json_list(self, values: list[str] | None) -> str | None:
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in values or []:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            cleaned.append(text)
        if not cleaned:
            return None
        return json.dumps(cleaned, ensure_ascii=False)

    def normalize_topic_key(self, value: str | None) -> str | None:
        if value is None:
            return None
        key = str(value).strip().lower()
        if not key:
            return None
        key = _WS_RE.sub("-", key)
        key = _INVALID_KEY_RE.sub("", key)
        key = _MULTI_DASH_RE.sub("-", key).strip("-")
        if not key:
            return None
        return key[:80]

    def is_topics_enabled(self, db: Session) -> bool:
        def _load() -> bool:
            admin = db.query(AdminSettings).first()
            return bool(admin and admin.topics_enabled)

        return bool(
            get_public_cached(
                CACHE_KEY_TOPICS_ENABLED,
                _load,
                ttl_seconds=TOPICS_CACHE_TTL_SECONDS,
            )
        )

    def get_topic_settings(self, db: Session) -> dict[str, Any]:
        def _load() -> dict[str, Any]:
            admin = db.query(AdminSettings).first()
            if admin is None:
                raise ValueError("admin_settings_missing")
            health = None
            raw_health = getattr(admin, "topics_last_health_json", None)
            if raw_health:
                try:
                    health = json.loads(raw_health)
                except Exception:
                    health = None
            if not isinstance(health, dict):
                health = {
                    "bridge": {
                        "ok": False,
                        "status": "unknown",
                        "detail": None,
                        "checked_at": None,
                    },
                    "llm_wiki": {
                        "ok": False,
                        "status": "unknown",
                        "detail": None,
                        "checked_at": None,
                    },
                    "project": {"ok": False, "name": None, "path": None},
                }
            token = (admin.topics_bridge_token or "").strip()
            knowledge_type = (
                getattr(admin, "topics_knowledge_type", None) or "llm_wiki"
            ).strip() or "llm_wiki"
            project_path = getattr(admin, "topics_project_path", None)
            project_path = (
                project_path.strip()
                if isinstance(project_path, str) and project_path.strip()
                else None
            )
            last_sync_status = (admin.topics_last_sync_status or "idle").strip() or "idle"
            last_sync_error = admin.topics_last_sync_error
            if last_sync_status.lower() in {"completed", "success", "ok"} and last_sync_error:
                last_sync_error = None
            last_sync_result = self._loads_json_obj(
                getattr(admin, "topics_last_sync_result_json", None)
            )
            return {
                "enabled": bool(admin.topics_enabled),
                "bridge_base_url": (
                    admin.topics_bridge_base_url or "http://127.0.0.1:8787"
                ).strip(),
                "bridge_token_configured": bool(token),
                "auto_sync_on_enable": bool(
                    admin.topics_auto_sync_on_enable
                    if admin.topics_auto_sync_on_enable is not None
                    else True
                ),
                "knowledge_type": knowledge_type,
                "project_path": project_path,
                "last_sync_at": admin.topics_last_sync_at,
                "last_sync_status": last_sync_status,
                "last_sync_error": last_sync_error,
                "last_sync_result": last_sync_result,
                "health": health,
            }

        return get_public_cached(
            CACHE_KEY_TOPICS_SETTINGS,
            _load,
            ttl_seconds=TOPICS_CACHE_TTL_SECONDS,
        )

    def update_topic_settings(self, db: Session, payload: dict[str, Any]) -> dict[str, Any]:
        admin = db.query(AdminSettings).first()
        if admin is None:
            raise ValueError("admin_settings_missing")

        if "enabled" in payload and payload["enabled"] is not None:
            admin.topics_enabled = bool(payload["enabled"])
        if "bridge_base_url" in payload and payload["bridge_base_url"] is not None:
            admin.topics_bridge_base_url = (
                str(payload["bridge_base_url"]).strip() or "http://127.0.0.1:8787"
            )
        if "bridge_token" in payload and payload["bridge_token"] is not None:
            token = str(payload["bridge_token"]).strip()
            admin.topics_bridge_token = token or None
        if "auto_sync_on_enable" in payload and payload["auto_sync_on_enable"] is not None:
            admin.topics_auto_sync_on_enable = bool(payload["auto_sync_on_enable"])
        if "knowledge_type" in payload and payload["knowledge_type"] is not None:
            knowledge_type = str(payload["knowledge_type"]).strip() or "llm_wiki"
            if knowledge_type not in {"llm_wiki", "generic_fs"}:
                knowledge_type = "llm_wiki"
            admin.topics_knowledge_type = knowledge_type
        if "project_path" in payload:
            raw_path = payload.get("project_path")
            if raw_path is None:
                admin.topics_project_path = None
            else:
                cleaned = str(raw_path).strip()
                admin.topics_project_path = cleaned or None
        if "last_sync_at" in payload:
            admin.topics_last_sync_at = payload.get("last_sync_at")
        if "last_sync_status" in payload and payload["last_sync_status"] is not None:
            admin.topics_last_sync_status = str(payload["last_sync_status"])
        if "last_sync_error" in payload:
            admin.topics_last_sync_error = payload.get("last_sync_error")
        if "last_sync_result" in payload:
            raw_result = payload.get("last_sync_result")
            if raw_result is None:
                admin.topics_last_sync_result_json = None
            elif isinstance(raw_result, dict):
                admin.topics_last_sync_result_json = json.dumps(
                    raw_result, ensure_ascii=False
                )
            else:
                # ignore malformed values rather than failing settings save
                pass
        if "health" in payload and payload["health"] is not None:
            admin.topics_last_health_json = json.dumps(
                payload["health"], ensure_ascii=False
            )

        admin.updated_at = now_str()
        db.commit()
        invalidate_topics_caches()
        return self.get_topic_settings(db)

    def serialize_topic_summary(
        self,
        topic: Topic,
        *,
        include_content: bool = False,
    ) -> dict[str, Any]:
        content_md = getattr(topic, "content_md", None)
        payload = {
            "id": topic.id,
            "key": topic.key,
            "title": topic.title,
            "summary": self.derive_summary_from_content(content_md),
            "status": topic.status,
            "topic_type": topic.topic_type,
            "article_count": int(topic.article_count or 0),
            "compiled_at": topic.compiled_at,
            "updated_at": topic.updated_at,
            "tags": self._loads_json_list(getattr(topic, "tags_json", None)),
        }
        if include_content:
            payload["content_md"] = getattr(topic, "content_md", None)
            payload["compiler"] = topic.compiler
            payload["compiler_ref"] = topic.compiler_ref
        return payload

    def serialize_article_topics(
        self,
        article: Article,
        *,
        lite: bool = True,
    ) -> list[dict[str, Any]]:
        """Serialize topics linked to an article.

        lite=True (default) returns reference chips only: key/title/topic_type.
        Pass lite=False when summary/relation_reason are explicitly needed.
        """
        links = list(getattr(article, "topic_links", []) or [])
        items: list[dict[str, Any]] = []
        for link in links:
            topic = getattr(link, "topic", None)
            if not topic:
                continue
            if (topic.status or "active") == "ignored":
                continue
            title = str(topic.title or topic.key or "").strip()
            item: dict[str, Any] = {
                "key": topic.key,
                "title": title,
                "topic_type": topic.topic_type,
            }
            if not lite:
                item["summary"] = self.derive_summary_from_content(
                    getattr(topic, "content_md", None)
                )
                item["relation_reason"] = link.relation_reason
            items.append(item)
        items.sort(
            key=lambda item: (
                len(str(item.get("title") or item.get("key") or "")),
                (item.get("title") or item.get("key") or "").casefold(),
            )
        )
        return items

    def list_topics(
        self,
        db: Session,
        *,
        q: str | None = None,
        page: int = 1,
        size: int = 20,
        include_ignored: bool = False,
    ) -> dict[str, Any]:
        page = max(int(page or 1), 1)
        size = min(max(int(size or 20), 1), 100)
        keyword = (q or "").strip()
        cache_key = (
            f"{CACHE_KEY_TOPICS_LIST_PREFIX}"
            f"{'1' if include_ignored else '0'}:{page}:{size}:{keyword.casefold()}"
        )

        def _load() -> dict[str, Any]:
            query = db.query(Topic)
            if not include_ignored:
                query = query.filter(Topic.status != "ignored")
            if keyword:
                like = f"%{keyword}%"
                # Dropdown/search should stay snappy: title/key only.
                query = query.filter(
                    (Topic.title.ilike(like)) | (Topic.key.ilike(like))
                )
            total = query.count()
            rows = (
                query.order_by(Topic.updated_at.desc(), Topic.title.asc())
                .offset((page - 1) * size)
                .limit(size)
                .all()
            )
            return {
                "data": [
                    self.serialize_topic_summary(topic, include_content=False)
                    for topic in rows
                ],
                "pagination": {
                    "page": page,
                    "size": size,
                    "total": total,
                    "total_pages": (total + size - 1) // size if size else 0,
                },
            }

        return get_public_cached(
            cache_key,
            _load,
            ttl_seconds=TOPICS_CACHE_TTL_SECONDS,
        )

    def get_topic_by_key(self, db: Session, key: str) -> Topic | None:
        normalized = self.normalize_topic_key(key) or str(key or "").strip()
        if not normalized:
            return None
        return db.query(Topic).filter(Topic.key == normalized).first()

    def get_topic_detail(
        self,
        db: Session,
        key: str,
        *,
        page: int = 1,
        size: int = 20,
        include_ignored: bool = False,
        is_admin: bool | None = None,
    ) -> dict[str, Any] | None:
        if is_admin is not None:
            include_ignored = bool(is_admin)
        topic = self.get_topic_by_key(db, key)
        if topic is None:
            return None
        if not include_ignored and (topic.status or "active") == "ignored":
            return None

        page = max(int(page or 1), 1)
        size = min(max(int(size or 20), 1), 100)

        related_topics: list[dict[str, Any]] = []
        related_keys = self._loads_json_list(topic.related_topic_keys)
        if related_keys:
            rows = (
                db.query(Topic)
                .filter(Topic.key.in_(related_keys))
                .order_by(Topic.title.asc())
                .all()
            )
            for row in rows:
                if not include_ignored and (row.status or "active") == "ignored":
                    continue
                related_topics.append(self.serialize_topic_summary(row))

        claims = []
        for claim in list(getattr(topic, "claims", []) or []):
            article_ids = []
            if claim.article_ids_json:
                try:
                    parsed_ids = json.loads(claim.article_ids_json)
                    if isinstance(parsed_ids, list):
                        article_ids = [str(item) for item in parsed_ids]
                except Exception:
                    article_ids = []
            claims.append(
                {
                    "id": claim.id,
                    "text": claim.text,
                    "sort_order": int(claim.sort_order or 0),
                    "article_ids": article_ids,
                }
            )

        article_query = (
            db.query(Article)
            .join(ArticleTopic, ArticleTopic.article_id == Article.id)
            .filter(ArticleTopic.topic_id == topic.id)
            .options(joinedload(Article.ai_analysis), joinedload(Article.category))
        )
        if not include_ignored:
            article_query = article_query.filter(Article.is_visible == True)  # noqa: E712
        total = article_query.count()
        articles = (
            article_query.order_by(Article.created_at.desc())
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )

        return {
            "id": topic.id,
            "key": topic.key,
            "title": topic.title,
            "summary": self.derive_summary_from_content(
                getattr(topic, "content_md", None)
            ),
            "content_md": getattr(topic, "content_md", None),
            "tags": self._loads_json_list(getattr(topic, "tags_json", None)),
            "status": topic.status,
            "topic_type": topic.topic_type,
            "article_count": int(topic.article_count or 0),
            "compiled_at": topic.compiled_at,
            "updated_at": topic.updated_at,
            "compiler": topic.compiler,
            "compiler_ref": topic.compiler_ref,
            "claims": claims,
            "related_topics": related_topics,
            "articles": {
                "data": [
                    {
                        "id": article.id,
                        "slug": article.slug,
                        "title": article.title,
                        "title_trans": article.title_trans,
                        "summary": article.ai_analysis.summary
                        if article.ai_analysis
                        else "",
                        "top_image": article.top_image,
                        "author": article.author,
                        "source_domain": article.source_domain,
                        "published_at": article.published_at,
                        "created_at": article.created_at,
                        "is_visible": article.is_visible,
                        "compile_status": getattr(article, "compile_status", "none")
                        or "none",
                        "category": {
                            "id": article.category.id,
                            "name": article.category.name,
                            "color": article.category.color,
                        }
                        if article.category
                        else None,
                    }
                    for article in articles
                ],
                "pagination": {
                    "page": page,
                    "size": size,
                    "total": total,
                    "total_pages": (total + size - 1) // size if size else 0,
                },
            },
        }

    def refresh_topic_article_count(self, db: Session, topic_id: str) -> None:
        self.refresh_topic_article_counts(db, {topic_id})

    def refresh_topic_article_counts(self, db: Session, topic_ids: set[str] | list[str]) -> None:
        ids = [str(topic_id).strip() for topic_id in topic_ids if str(topic_id).strip()]
        if not ids:
            return
        rows = (
            db.query(ArticleTopic.topic_id, func.count(ArticleTopic.id))
            .filter(ArticleTopic.topic_id.in_(ids))
            .group_by(ArticleTopic.topic_id)
            .all()
        )
        counts = {str(topic_id): int(count or 0) for topic_id, count in rows}
        topics = db.query(Topic).filter(Topic.id.in_(ids)).all()
        stamp = now_str()
        for topic in topics:
            topic.article_count = counts.get(topic.id, 0)
            topic.updated_at = stamp

    def _parse_ts(self, value: str | None):
        return parse_iso_timestamp(value)

    def _is_newer_ts(self, left: str | None, right: str | None) -> bool:
        return is_newer_timestamp(left, right)

    def apply_compile_results(self, db: Session, payload: dict[str, Any]) -> dict[str, Any]:
        compiled_at = str(payload.get("compiled_at") or "").strip()
        if not compiled_at:
            raise ValueError("compiled_at_required")
        compiler = str(payload.get("compiler") or "llm_wiki").strip() or "llm_wiki"
        topics_payload = payload.get("topics") or []
        articles_payload = payload.get("articles") or []
        if not isinstance(topics_payload, list) or not isinstance(articles_payload, list):
            raise ValueError("invalid_payload")

        warnings: list[str] = []
        upserted_topics = 0
        touched_topic_ids: set[str] = set()
        topic_by_key: dict[str, Topic] = {}
        stamp = now_str()

        # ---- normalize topic rows once ----
        normalized_topics: list[dict[str, Any]] = []
        topic_keys: set[str] = set()
        article_ids_from_topics: set[str] = set()
        for raw in topics_payload:
            if not isinstance(raw, dict):
                continue
            key = self.normalize_topic_key(raw.get("key") or raw.get("title"))
            title = str(raw.get("title") or key or "").strip()
            if not key or not title:
                warnings.append("skip_topic_missing_key_or_title")
                continue
            article_ids: list[str] = []
            raw_article_ids = raw.get("article_ids") or []
            if isinstance(raw_article_ids, list):
                for article_id in raw_article_ids:
                    cleaned = str(article_id or "").strip()
                    if cleaned:
                        article_ids.append(cleaned)
                        article_ids_from_topics.add(cleaned)
            topic_keys.add(key)
            normalized_topics.append(
                {
                    "raw": raw,
                    "key": key,
                    "title": title,
                    "article_ids": article_ids,
                }
            )

        # ---- normalize article rows once ----
        normalized_articles: list[dict[str, Any]] = []
        article_ids_from_articles: set[str] = set()
        article_topic_keys: set[str] = set()
        for raw in articles_payload:
            if not isinstance(raw, dict):
                continue
            article_id = str(raw.get("article_id") or "").strip()
            if not article_id:
                continue
            article_ids_from_articles.add(article_id)
            topic_keys_list: list[str] = []
            raw_keys = raw.get("topic_keys") or []
            if isinstance(raw_keys, list):
                for item in raw_keys:
                    key = self.normalize_topic_key(item)
                    if key:
                        topic_keys_list.append(key)
                        article_topic_keys.add(key)
            normalized_articles.append(
                {
                    "raw": raw,
                    "article_id": article_id,
                    "topic_keys": topic_keys_list,
                    "replace_topics": bool(raw.get("replace_topics", True)),
                }
            )

        all_topic_keys = topic_keys | article_topic_keys
        all_article_ids = article_ids_from_topics | article_ids_from_articles

        # ---- preload existing rows ----
        if all_topic_keys:
            existing_topics = (
                db.query(Topic).filter(Topic.key.in_(sorted(all_topic_keys))).all()
            )
            topic_by_key = {topic.key: topic for topic in existing_topics}

        article_by_id: dict[str, Article] = {}
        if all_article_ids:
            existing_articles = (
                db.query(Article).filter(Article.id.in_(sorted(all_article_ids))).all()
            )
            article_by_id = {article.id: article for article in existing_articles}

        # Preload article-topic links for all involved articles to avoid per-row queries.
        links_by_article: dict[str, dict[str, ArticleTopic]] = {}
        if all_article_ids:
            existing_links = (
                db.query(ArticleTopic)
                .filter(ArticleTopic.article_id.in_(sorted(all_article_ids)))
                .all()
            )
            for link in existing_links:
                links_by_article.setdefault(link.article_id, {})[link.topic_id] = link

        claim_topic_ids_to_replace: set[str] = set()
        claims_to_add: list[TopicClaim] = []

        # ---- upsert topics ----
        for item in normalized_topics:
            raw = item["raw"]
            key = item["key"]
            title = item["title"]
            topic = topic_by_key.get(key)
            if topic and self._is_newer_ts(topic.compiled_at, compiled_at):
                warnings.append(f"skip_stale_topic:{key}")
                continue
            if topic is None:
                topic = Topic(
                    id=str(uuid.uuid4()),
                    key=key,
                    title=title,
                    created_at=stamp,
                )
                db.add(topic)
                topic_by_key[key] = topic
            topic.title = title
            if "content_md" in raw:
                content_md = raw.get("content_md")
                topic.content_md = str(content_md) if content_md is not None else None
            if "tags" in raw:
                tags = raw.get("tags")
                if isinstance(tags, list):
                    topic.tags_json = self._dumps_json_list([str(v) for v in tags])
                elif tags is None:
                    topic.tags_json = None
            topic.status = str(raw.get("status") or topic.status or "active")
            if raw.get("topic_type") is not None:
                topic.topic_type = raw.get("topic_type")
            topic.compiler = compiler
            if raw.get("compiler_ref") is not None:
                topic.compiler_ref = raw.get("compiler_ref")
            topic.compiled_at = compiled_at
            related = raw.get("related_topic_keys") or []
            if isinstance(related, list):
                topic.related_topic_keys = json.dumps(
                    [str(v) for v in related if str(v).strip()],
                    ensure_ascii=False,
                )
            topic.updated_at = stamp

            claims = raw.get("claims")
            if isinstance(claims, list):
                # Topic may be newly created; ensure id is available before claim insert.
                if not getattr(topic, "id", None):
                    db.flush()
                claim_topic_ids_to_replace.add(topic.id)
                for idx, claim in enumerate(claims):
                    if not isinstance(claim, dict):
                        continue
                    claim_text = str(claim.get("text") or "").strip()
                    if not claim_text:
                        continue
                    claim_article_ids = claim.get("article_ids") or []
                    if not isinstance(claim_article_ids, list):
                        claim_article_ids = []
                    claims_to_add.append(
                        TopicClaim(
                            id=str(uuid.uuid4()),
                            topic_id=topic.id,
                            text=claim_text,
                            sort_order=idx,
                            article_ids_json=json.dumps(
                                [
                                    str(v).strip()
                                    for v in claim_article_ids
                                    if str(v).strip()
                                ],
                                ensure_ascii=False,
                            ),
                            created_at=stamp,
                            updated_at=stamp,
                        )
                    )

            relation_reasons = raw.get("relation_reasons") or {}
            if not isinstance(relation_reasons, dict):
                relation_reasons = {}
            for article_id in item["article_ids"]:
                article = article_by_id.get(article_id)
                if article is None:
                    warnings.append(f"unknown_article:{article_id}")
                    continue
                article_links = links_by_article.setdefault(article_id, {})
                link = article_links.get(topic.id)
                reason = relation_reasons.get(article_id)
                if link is None:
                    link = ArticleTopic(
                        id=str(uuid.uuid4()),
                        article_id=article_id,
                        topic_id=topic.id,
                        source="bridge_writeback",
                        created_at=stamp,
                        updated_at=stamp,
                    )
                    db.add(link)
                    article_links[topic.id] = link
                if reason is not None:
                    link.relation_reason = str(reason)
                link.updated_at = stamp
                touched_topic_ids.add(topic.id)

            touched_topic_ids.add(topic.id)
            upserted_topics += 1

        # Flush once so newly created topic ids are durable for claim/link ops.
        if upserted_topics or normalized_articles:
            db.flush()

        if claim_topic_ids_to_replace:
            db.query(TopicClaim).filter(
                TopicClaim.topic_id.in_(sorted(claim_topic_ids_to_replace))
            ).delete(synchronize_session=False)
            for claim in claims_to_add:
                db.add(claim)

        # ---- article compile status + topic set replace ----
        updated_articles = 0
        for item in normalized_articles:
            raw = item["raw"]
            article_id = item["article_id"]
            article = article_by_id.get(article_id)
            if article is None:
                warnings.append(f"unknown_article:{article_id}")
                continue
            status = str(raw.get("compile_status") or "compiled").strip() or "compiled"
            if status not in self.VALID_COMPILE_STATUS:
                status = "compiled"
            article_compiled_at = str(raw.get("compiled_at") or compiled_at).strip()
            if self._is_newer_ts(article.compiled_at, article_compiled_at):
                warnings.append(f"skip_stale_article:{article_id}")
                continue
            article.compile_status = status
            article.compiled_at = article_compiled_at or compiled_at
            article.compile_error = raw.get("compile_error")
            article.updated_at = stamp

            normalized_keys = item["topic_keys"]
            replace_topics = item["replace_topics"]
            created_placeholder = False
            for key in normalized_keys:
                if key in topic_by_key:
                    continue
                topic = Topic(
                    id=str(uuid.uuid4()),
                    key=key,
                    title=key,
                    status="active",
                    compiler=compiler,
                    compiled_at=compiled_at,
                    created_at=stamp,
                    updated_at=stamp,
                )
                db.add(topic)
                topic_by_key[key] = topic
                touched_topic_ids.add(topic.id)
                created_placeholder = True
            if created_placeholder:
                db.flush()

            desired_ids = {
                topic_by_key[key].id for key in normalized_keys if key in topic_by_key
            }
            existing_map = links_by_article.setdefault(article_id, {})
            if replace_topics:
                for topic_id, link in list(existing_map.items()):
                    if topic_id not in desired_ids:
                        db.delete(link)
                        existing_map.pop(topic_id, None)
                        touched_topic_ids.add(topic_id)
            for topic_id in desired_ids:
                link = existing_map.get(topic_id)
                if link is not None:
                    link.updated_at = stamp
                    continue
                link = ArticleTopic(
                    id=str(uuid.uuid4()),
                    article_id=article_id,
                    topic_id=topic_id,
                    source="bridge_writeback",
                    created_at=stamp,
                    updated_at=stamp,
                )
                db.add(link)
                existing_map[topic_id] = link
                touched_topic_ids.add(topic_id)
            updated_articles += 1

        db.flush()
        self.refresh_topic_article_counts(db, touched_topic_ids)

        admin = db.query(AdminSettings).first()
        if admin is not None:
            admin.topics_last_sync_at = compiled_at
            admin.topics_last_sync_status = "completed"
            admin.topics_last_sync_error = None
            admin.updated_at = stamp

        db.commit()
        invalidate_topics_caches()
        return {
            "ok": True,
            "upserted_topics": upserted_topics,
            "updated_articles": updated_articles,
            "warnings": warnings,
            "compiled_at": compiled_at,
        }


    def mark_article_stale_if_needed(
        self,
        db: Session,
        article: Article,
        *,
        title_changed: bool = False,
        body_changed: bool = False,
    ) -> None:
        if not (title_changed or body_changed):
            return
        current = (getattr(article, "compile_status", None) or "none").strip() or "none"
        if current in {"compiled", "synced", "queued"}:
            article.compile_status = "stale"
            article.compile_error = None
            article.updated_at = now_str()




    def fetch_bridge_topic_keys(self, db: Session) -> list[str]:
        """Pull current wiki topic keys from local Bridge (entity/concept)."""
        settings = self.get_topic_settings(db)
        base = (settings.get("bridge_base_url") or "http://127.0.0.1:8787").rstrip("/")
        # Inside Docker, localhost points at the container itself; reach host Bridge via host.docker.internal.
        parsed = urlparse(base)
        host = (parsed.hostname or "").lower()
        in_docker = Path("/.dockerenv").exists() or bool(os.environ.get("DOCKER_CONTAINER"))
        if in_docker and host in {"127.0.0.1", "localhost"}:
            port = parsed.port or 8787
            netloc = f"host.docker.internal:{port}"
            base = urlunparse(
                (parsed.scheme or "http", netloc, parsed.path or "", "", "", "")
            ).rstrip("/")
        admin = db.query(AdminSettings).first()
        token = (admin.topics_bridge_token or "").strip() if admin else ""
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        url = f"{base}/wiki/topics"
        try:
            import httpx

            with httpx.Client(timeout=httpx.Timeout(15.0, connect=3.0)) as client:
                response = client.get(url, headers=headers)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"bridge_unreachable: {exc}") from exc
        if response.status_code >= 400:
            raise ValueError(f"bridge_wiki_topics_failed: HTTP {response.status_code}")
        try:
            payload = response.json()
        except Exception as exc:  # noqa: BLE001
            raise ValueError("bridge_wiki_topics_invalid_json") from exc
        keys: list[str] = []
        raw_keys = payload.get("keys") if isinstance(payload, dict) else None
        if isinstance(raw_keys, list):
            for item in raw_keys:
                key = self.normalize_topic_key(str(item or ""))
                if key:
                    keys.append(key)
            return keys
        raw_topics = payload.get("topics") if isinstance(payload, dict) else None
        if isinstance(raw_topics, list):
            for item in raw_topics:
                if not isinstance(item, dict):
                    continue
                key = self.normalize_topic_key(str(item.get("key") or item.get("title") or ""))
                if key:
                    keys.append(key)
        return keys

    def list_orphan_topics(
        self,
        db: Session,
        known_keys: list[str] | None,
    ) -> dict[str, Any]:
        known: set[str] = set()
        for raw in known_keys or []:
            key = self.normalize_topic_key(raw) or str(raw or "").strip().lower()
            if key:
                known.add(key)
        rows = (
            db.query(Topic)
            .order_by(Topic.updated_at.desc(), Topic.title.asc())
            .all()
        )
        orphans: list[Topic] = []
        for topic in rows:
            key = (topic.key or "").strip()
            if not key:
                orphans.append(topic)
                continue
            if key not in known:
                orphans.append(topic)
        return {
            "orphan_count": len(orphans),
            "orphans": [self.serialize_topic_summary(topic) for topic in orphans],
            "known_count": len(known),
            "total_topics": len(rows),
            "sample_keys": [topic.key for topic in orphans[:20]],
        }

    def cleanup_orphan_topics(
        self,
        db: Session,
        known_keys: list[str] | None,
        *,
        dry_run: bool = True,
        fetch_from_bridge: bool = True,
    ) -> dict[str, Any]:
        resolved_keys = list(known_keys or [])
        source = "request"
        if (not resolved_keys) and fetch_from_bridge:
            resolved_keys = self.fetch_bridge_topic_keys(db)
            source = "bridge"
        preview = self.list_orphan_topics(db, resolved_keys)
        preview["known_source"] = source
        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "deleted_count": 0,
                **preview,
            }

        orphan_keys = {
            str(item.get("key") or "").strip()
            for item in preview.get("orphans") or []
            if str(item.get("key") or "").strip()
        }
        if not orphan_keys:
            return {
                "ok": True,
                "dry_run": False,
                "deleted_count": 0,
                **preview,
            }

        topics = db.query(Topic).filter(Topic.key.in_(sorted(orphan_keys))).all()
        topic_ids = [topic.id for topic in topics]
        if topic_ids:
            db.query(ArticleTopic).filter(ArticleTopic.topic_id.in_(topic_ids)).delete(
                synchronize_session=False
            )
            db.query(TopicClaim).filter(TopicClaim.topic_id.in_(topic_ids)).delete(
                synchronize_session=False
            )
            db.query(Topic).filter(Topic.id.in_(topic_ids)).delete(
                synchronize_session=False
            )
        db.commit()
        invalidate_topics_caches()
        return {
            "ok": True,
            "dry_run": False,
            "deleted_count": len(topic_ids),
            "orphan_count": len(topic_ids),
            "orphans": preview.get("orphans") or [],
            "known_count": preview.get("known_count") or 0,
            "total_topics": max((preview.get("total_topics") or 0) - len(topic_ids), 0),
            "sample_keys": preview.get("sample_keys") or [],
            "deleted_keys": sorted(orphan_keys),
        }


topic_service = TopicService()

