from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.dependencies import build_basic_settings
from auth import get_admin_settings
from models import (
    AIAnalysis,
    AdminSettings,
    Article,
    Category,
    ModelAPIConfig,
    PromptConfig,
    generate_uuid,
    now_str,
)

BACKUP_SCHEMA_VERSION = 1


class _SkipRecorder:
    def __init__(self, limit: int) -> None:
        self.limit = max(1, limit)
        self.total = 0
        self.items: list[dict[str, str]] = []

    def add(self, section: str, identifier: str, reason: str) -> None:
        self.total += 1
        if len(self.items) >= self.limit:
            return
        self.items.append(
            {
                "section": section,
                "identifier": identifier,
                "reason": reason,
            }
        )


def _chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    batch_size = max(1, size)
    for index in range(0, len(items), batch_size):
        yield items[index : index + batch_size]


class BackupService:
    EXPORT_BATCH_SIZE = 500
    IMPORT_BATCH_SIZE = 200
    SKIPPED_ITEM_LIMIT = 200

    def export_backup_stream(self, db: Session) -> Iterable[str]:
        meta = {
            "schema_version": BACKUP_SCHEMA_VERSION,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "app": "lumina",
            "policy": "strict_incremental_skip_conflicts",
        }

        categories = [
            self._serialize_category(item)
            for item in db.query(Category).order_by(Category.sort_order.asc()).all()
        ]
        model_api_configs = [
            self._serialize_model_api_config(item)
            for item in db.query(ModelAPIConfig).order_by(ModelAPIConfig.created_at.desc()).all()
        ]
        prompt_configs = [
            self._serialize_prompt_config(item)
            for item in db.query(PromptConfig).order_by(PromptConfig.created_at.desc()).all()
        ]
        settings_snapshot = self._serialize_settings(db)

        def stream() -> Iterable[str]:
            yield "{"
            yield f"\"meta\":{json.dumps(meta, ensure_ascii=False)}"
            yield ",\"data\":{"
            yield f"\"categories\":{json.dumps(categories, ensure_ascii=False)}"
            yield f",\"model_api_configs\":{json.dumps(model_api_configs, ensure_ascii=False)}"
            yield f",\"prompt_configs\":{json.dumps(prompt_configs, ensure_ascii=False)}"
            yield f",\"settings\":{json.dumps(settings_snapshot, ensure_ascii=False)}"

            yield ",\"articles\":["
            first_article = True
            offset = 0
            while True:
                rows = (
                    db.query(Article)
                    .order_by(Article.created_at.desc())
                    .offset(offset)
                    .limit(self.EXPORT_BATCH_SIZE)
                    .all()
                )
                if not rows:
                    break
                for article in rows:
                    if not first_article:
                        yield ","
                    yield json.dumps(self._serialize_article(article), ensure_ascii=False)
                    first_article = False
                offset += self.EXPORT_BATCH_SIZE
            yield "]"

            yield ",\"ai_analyses\":["
            first_analysis = True
            offset = 0
            while True:
                rows = (
                    db.query(AIAnalysis, Article.slug)
                    .join(Article, Article.id == AIAnalysis.article_id)
                    .order_by(Article.created_at.desc())
                    .offset(offset)
                    .limit(self.EXPORT_BATCH_SIZE)
                    .all()
                )
                if not rows:
                    break
                for analysis, article_slug in rows:
                    if not first_analysis:
                        yield ","
                    yield json.dumps(
                        self._serialize_ai_analysis(analysis, article_slug),
                        ensure_ascii=False,
                    )
                    first_analysis = False
                offset += self.EXPORT_BATCH_SIZE
            yield "]"
            yield "}}"

        return stream()

    def import_backup(self, db: Session, payload: dict[str, Any]) -> dict[str, Any]:
        meta = payload.get("meta")
        data = payload.get("data")
        if not isinstance(meta, dict) or not isinstance(data, dict):
            raise ValueError("导入失败：备份文件格式不正确")

        schema_version = meta.get("schema_version")
        if schema_version != BACKUP_SCHEMA_VERSION:
            raise ValueError(
                f"导入失败：仅支持 schema_version={BACKUP_SCHEMA_VERSION}，当前为 {schema_version}"
            )

        stats = {
            "categories": self._new_stats(),
            "model_api_configs": self._new_stats(),
            "prompt_configs": self._new_stats(),
            "articles": self._new_stats(),
            "ai_analyses": self._new_stats(),
            "settings": self._new_stats(),
        }
        skipped = _SkipRecorder(self.SKIPPED_ITEM_LIMIT)

        category_id_map: dict[str, str] = {}
        model_id_map: dict[str, str] = {}
        article_id_map: dict[str, str] = {}
        article_slug_map: dict[str, str] = {}

        self._import_categories(
            db=db,
            items=self._as_list(data.get("categories"), "categories"),
            section_stats=stats["categories"],
            skipped=skipped,
            category_id_map=category_id_map,
        )
        self._import_model_api_configs(
            db=db,
            items=self._as_list(data.get("model_api_configs"), "model_api_configs"),
            section_stats=stats["model_api_configs"],
            skipped=skipped,
            model_id_map=model_id_map,
        )
        self._import_prompt_configs(
            db=db,
            items=self._as_list(data.get("prompt_configs"), "prompt_configs"),
            section_stats=stats["prompt_configs"],
            skipped=skipped,
            category_id_map=category_id_map,
            model_id_map=model_id_map,
        )
        self._import_articles(
            db=db,
            items=self._as_list(data.get("articles"), "articles"),
            section_stats=stats["articles"],
            skipped=skipped,
            category_id_map=category_id_map,
            article_id_map=article_id_map,
            article_slug_map=article_slug_map,
        )
        self._import_ai_analyses(
            db=db,
            items=self._as_list(data.get("ai_analyses"), "ai_analyses"),
            section_stats=stats["ai_analyses"],
            skipped=skipped,
            article_id_map=article_id_map,
            article_slug_map=article_slug_map,
        )
        self._import_settings(
            db=db,
            settings_data=data.get("settings"),
            section_stats=stats["settings"],
            skipped=skipped,
        )

        return {
            "meta": {
                "schema_version": BACKUP_SCHEMA_VERSION,
                "imported_at": datetime.now(timezone.utc).isoformat(),
                "policy": "strict_incremental_skip_conflicts",
            },
            "stats": stats,
            "skipped_total": skipped.total,
            "skipped_items": skipped.items,
        }

    @staticmethod
    def _new_stats() -> dict[str, int]:
        return {"created": 0, "skipped": 0, "errors": 0}

    @staticmethod
    def _as_list(value: Any, field_name: str) -> list[Any]:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        raise ValueError(f"导入失败：{field_name} 必须是数组")

    @staticmethod
    def _clean_str(value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()

    @staticmethod
    def _optional_str(value: Any) -> str | None:
        text = BackupService._clean_str(value)
        return text if text else None

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except Exception:
            return default

    @staticmethod
    def _safe_float(value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            return float(value)
        except Exception:
            return None

    @staticmethod
    def _safe_bool(value: Any, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "y", "on"}:
                return True
            if normalized in {"0", "false", "no", "n", "off"}:
                return False
            return default
        return bool(value)

    @staticmethod
    def _normalize_json_text(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        text = str(value)
        return text if text.strip() else None

    def _import_categories(
        self,
        db: Session,
        items: list[Any],
        section_stats: dict[str, int],
        skipped: _SkipRecorder,
        category_id_map: dict[str, str],
    ) -> None:
        existing_by_name = {
            row.name: row.id for row in db.query(Category.id, Category.name).all()
        }

        for batch in _chunked(items, self.IMPORT_BATCH_SIZE):
            pending: list[tuple[str, str, Category]] = []
            for item in batch:
                if not isinstance(item, dict):
                    section_stats["errors"] += 1
                    continue
                old_id = self._clean_str(item.get("id"))
                name = self._clean_str(item.get("name"))
                if not name:
                    section_stats["errors"] += 1
                    continue

                existing_id = existing_by_name.get(name)
                if existing_id:
                    section_stats["skipped"] += 1
                    skipped.add("categories", name, "唯一键冲突(name)")
                    if old_id:
                        category_id_map[old_id] = existing_id
                    continue

                category = Category(
                    id=generate_uuid(),
                    name=name,
                    description=self._optional_str(item.get("description")),
                    color=self._optional_str(item.get("color")),
                    sort_order=self._safe_int(item.get("sort_order"), default=0),
                    created_at=self._optional_str(item.get("created_at")),
                )
                pending.append((old_id, name, category))
                existing_by_name[name] = category.id

            if not pending:
                continue

            try:
                for _, _, category in pending:
                    db.add(category)
                db.commit()
                section_stats["created"] += len(pending)
                for old_id, _, category in pending:
                    if old_id:
                        category_id_map[old_id] = category.id
            except IntegrityError:
                db.rollback()
                for old_id, name, category in pending:
                    try:
                        db.add(category)
                        db.commit()
                        section_stats["created"] += 1
                        if old_id:
                            category_id_map[old_id] = category.id
                    except IntegrityError:
                        db.rollback()
                        section_stats["skipped"] += 1
                        skipped.add("categories", name, "唯一键冲突(name)")
                    except Exception:
                        db.rollback()
                        section_stats["errors"] += 1
            except Exception:
                db.rollback()
                section_stats["errors"] += len(pending)

    def _import_model_api_configs(
        self,
        db: Session,
        items: list[Any],
        section_stats: dict[str, int],
        skipped: _SkipRecorder,
        model_id_map: dict[str, str],
    ) -> None:
        existing_by_name = {
            row.name: row.id for row in db.query(ModelAPIConfig.id, ModelAPIConfig.name).all()
        }

        for batch in _chunked(items, self.IMPORT_BATCH_SIZE):
            pending: list[tuple[str, str, ModelAPIConfig]] = []
            for item in batch:
                if not isinstance(item, dict):
                    section_stats["errors"] += 1
                    continue
                old_id = self._clean_str(item.get("id"))
                name = self._clean_str(item.get("name"))
                if not name:
                    section_stats["errors"] += 1
                    continue
                existing_id = existing_by_name.get(name)
                if existing_id:
                    section_stats["skipped"] += 1
                    skipped.add("model_api_configs", name, "唯一键冲突(name)")
                    if old_id:
                        model_id_map[old_id] = existing_id
                    continue

                base_url = self._clean_str(item.get("base_url")) or "https://api.openai.com/v1"
                api_key = self._clean_str(item.get("api_key"))
                if not api_key:
                    section_stats["errors"] += 1
                    continue

                config = ModelAPIConfig(
                    id=generate_uuid(),
                    name=name,
                    base_url=base_url,
                    api_key=api_key,
                    provider=self._clean_str(item.get("provider")) or "openai",
                    model_name=self._clean_str(item.get("model_name")) or "gpt-4o",
                    model_type=self._clean_str(item.get("model_type")) or "general",
                    price_input_per_1k=self._safe_float(item.get("price_input_per_1k")),
                    price_output_per_1k=self._safe_float(item.get("price_output_per_1k")),
                    currency=self._optional_str(item.get("currency")),
                    context_window_tokens=(
                        self._safe_int(item.get("context_window_tokens"))
                        if item.get("context_window_tokens") is not None
                        else None
                    ),
                    reserve_output_tokens=(
                        self._safe_int(item.get("reserve_output_tokens"))
                        if item.get("reserve_output_tokens") is not None
                        else None
                    ),
                    is_enabled=self._safe_bool(item.get("is_enabled"), default=True),
                    is_default=self._safe_bool(item.get("is_default"), default=False),
                    created_at=self._optional_str(item.get("created_at")),
                    updated_at=self._optional_str(item.get("updated_at")),
                )
                pending.append((old_id, name, config))
                existing_by_name[name] = config.id

            if not pending:
                continue

            try:
                for _, _, config in pending:
                    db.add(config)
                db.commit()
                section_stats["created"] += len(pending)
                for old_id, _, config in pending:
                    if old_id:
                        model_id_map[old_id] = config.id
            except IntegrityError:
                db.rollback()
                for old_id, name, config in pending:
                    try:
                        db.add(config)
                        db.commit()
                        section_stats["created"] += 1
                        if old_id:
                            model_id_map[old_id] = config.id
                    except IntegrityError:
                        db.rollback()
                        section_stats["skipped"] += 1
                        skipped.add("model_api_configs", name, "唯一键冲突(name)")
                    except Exception:
                        db.rollback()
                        section_stats["errors"] += 1
            except Exception:
                db.rollback()
                section_stats["errors"] += len(pending)

    def _import_prompt_configs(
        self,
        db: Session,
        items: list[Any],
        section_stats: dict[str, int],
        skipped: _SkipRecorder,
        category_id_map: dict[str, str],
        model_id_map: dict[str, str],
    ) -> None:
        existing_keys = {
            (item.type, item.name, item.category_id or "")
            for item in db.query(PromptConfig).all()
        }

        for batch in _chunked(items, self.IMPORT_BATCH_SIZE):
            pending: list[tuple[tuple[str, str, str], PromptConfig]] = []
            reserved_keys: set[tuple[str, str, str]] = set()

            for item in batch:
                if not isinstance(item, dict):
                    section_stats["errors"] += 1
                    continue

                prompt_type = self._clean_str(item.get("type"))
                name = self._clean_str(item.get("name"))
                prompt = self._clean_str(item.get("prompt"))
                if not prompt_type or not name or not prompt:
                    section_stats["errors"] += 1
                    continue

                source_category_id = self._optional_str(item.get("category_id"))
                mapped_category_id: str | None = None
                if source_category_id:
                    mapped_category_id = category_id_map.get(source_category_id)
                    if not mapped_category_id:
                        section_stats["skipped"] += 1
                        skipped.add(
                            "prompt_configs",
                            f"{prompt_type}:{name}",
                            "关联分类不存在，已跳过",
                        )
                        continue

                source_model_id = self._optional_str(item.get("model_api_config_id"))
                mapped_model_id: str | None = None
                if source_model_id:
                    mapped_model_id = model_id_map.get(source_model_id)
                    if not mapped_model_id:
                        section_stats["skipped"] += 1
                        skipped.add(
                            "prompt_configs",
                            f"{prompt_type}:{name}",
                            "关联模型配置不存在，已跳过",
                        )
                        continue

                conflict_key = (prompt_type, name, mapped_category_id or "")
                if conflict_key in existing_keys or conflict_key in reserved_keys:
                    section_stats["skipped"] += 1
                    skipped.add(
                        "prompt_configs",
                        f"{prompt_type}:{name}",
                        "唯一键冲突(type+name+category_id)",
                    )
                    continue

                config = PromptConfig(
                    id=generate_uuid(),
                    name=name,
                    category_id=mapped_category_id,
                    type=prompt_type,
                    prompt=prompt,
                    system_prompt=self._optional_str(item.get("system_prompt")),
                    response_format=self._optional_str(item.get("response_format")),
                    temperature=self._safe_float(item.get("temperature")),
                    max_tokens=(
                        self._safe_int(item.get("max_tokens"))
                        if item.get("max_tokens") is not None
                        else None
                    ),
                    top_p=self._safe_float(item.get("top_p")),
                    chunk_size_tokens=(
                        self._safe_int(item.get("chunk_size_tokens"))
                        if item.get("chunk_size_tokens") is not None
                        else None
                    ),
                    chunk_overlap_tokens=(
                        self._safe_int(item.get("chunk_overlap_tokens"))
                        if item.get("chunk_overlap_tokens") is not None
                        else None
                    ),
                    max_continue_rounds=(
                        self._safe_int(item.get("max_continue_rounds"))
                        if item.get("max_continue_rounds") is not None
                        else None
                    ),
                    model_api_config_id=mapped_model_id,
                    is_enabled=self._safe_bool(item.get("is_enabled"), default=True),
                    is_default=self._safe_bool(item.get("is_default"), default=False),
                    created_at=self._optional_str(item.get("created_at")),
                    updated_at=self._optional_str(item.get("updated_at")),
                )
                pending.append((conflict_key, config))
                reserved_keys.add(conflict_key)

            if not pending:
                continue

            try:
                for _, config in pending:
                    db.add(config)
                db.commit()
                section_stats["created"] += len(pending)
                for conflict_key, _ in pending:
                    existing_keys.add(conflict_key)
            except IntegrityError:
                db.rollback()
                for conflict_key, config in pending:
                    identifier = f"{config.type}:{config.name}"
                    try:
                        db.add(config)
                        db.commit()
                        section_stats["created"] += 1
                        existing_keys.add(conflict_key)
                    except IntegrityError:
                        db.rollback()
                        section_stats["skipped"] += 1
                        skipped.add(
                            "prompt_configs",
                            identifier,
                            "唯一键冲突(type+name+category_id)",
                        )
                    except Exception:
                        db.rollback()
                        section_stats["errors"] += 1
            except Exception:
                db.rollback()
                section_stats["errors"] += len(pending)

    def _import_articles(
        self,
        db: Session,
        items: list[Any],
        section_stats: dict[str, int],
        skipped: _SkipRecorder,
        category_id_map: dict[str, str],
        article_id_map: dict[str, str],
        article_slug_map: dict[str, str],
    ) -> None:
        committed_slugs: set[str] = set()
        committed_source_urls: set[str] = set()

        for batch in _chunked(items, self.IMPORT_BATCH_SIZE):
            candidate_slugs = {
                self._clean_str(item.get("slug"))
                for item in batch
                if isinstance(item, dict) and self._clean_str(item.get("slug"))
            }
            candidate_source_urls = {
                self._clean_str(item.get("source_url"))
                for item in batch
                if isinstance(item, dict) and self._clean_str(item.get("source_url"))
            }

            existing_slugs = set()
            if candidate_slugs:
                existing_slugs = {
                    row.slug
                    for row in db.query(Article.slug).filter(Article.slug.in_(candidate_slugs)).all()
                }
            existing_source_urls = set()
            if candidate_source_urls:
                existing_source_urls = {
                    row.source_url
                    for row in db.query(Article.source_url)
                    .filter(Article.source_url.in_(candidate_source_urls))
                    .all()
                    if row.source_url
                }

            pending: list[tuple[str, str, str | None, Article]] = []
            reserved_slugs: set[str] = set()
            reserved_source_urls: set[str] = set()
            for item in batch:
                if not isinstance(item, dict):
                    section_stats["errors"] += 1
                    continue

                old_id = self._clean_str(item.get("id"))
                slug = self._clean_str(item.get("slug"))
                title = self._clean_str(item.get("title"))
                if not slug or not title:
                    section_stats["errors"] += 1
                    continue

                source_url = self._optional_str(item.get("source_url"))
                if source_url and (
                    source_url in existing_source_urls
                    or source_url in committed_source_urls
                    or source_url in reserved_source_urls
                ):
                    section_stats["skipped"] += 1
                    skipped.add("articles", source_url, "唯一键冲突(source_url)")
                    continue
                if slug in existing_slugs or slug in committed_slugs or slug in reserved_slugs:
                    section_stats["skipped"] += 1
                    skipped.add("articles", slug, "唯一键冲突(slug)")
                    continue

                source_category_id = self._optional_str(item.get("category_id"))
                mapped_category_id: str | None = None
                if source_category_id:
                    mapped_category_id = category_id_map.get(source_category_id)
                    if not mapped_category_id:
                        section_stats["skipped"] += 1
                        skipped.add("articles", slug, "关联分类不存在，已跳过")
                        continue

                article = Article(
                    id=generate_uuid(),
                    title=title,
                    slug=slug,
                    content_html=self._optional_str(item.get("content_html")),
                    content_structured=self._normalize_json_text(item.get("content_structured")),
                    content_md=self._optional_str(item.get("content_md")),
                    content_trans=self._optional_str(item.get("content_trans")),
                    translation_status=self._optional_str(item.get("translation_status")),
                    translation_error=self._optional_str(item.get("translation_error")),
                    source_url=source_url,
                    top_image=self._optional_str(item.get("top_image")),
                    author=self._optional_str(item.get("author")),
                    published_at=self._optional_str(item.get("published_at")),
                    source_domain=self._optional_str(item.get("source_domain")),
                    status=self._clean_str(item.get("status")) or "pending",
                    is_visible=self._safe_bool(item.get("is_visible"), default=False),
                    category_id=mapped_category_id,
                    created_at=self._optional_str(item.get("created_at")) or now_str(),
                    updated_at=self._optional_str(item.get("updated_at")) or now_str(),
                    note_content=self._optional_str(item.get("note_content")),
                    note_annotations=self._normalize_json_text(item.get("note_annotations")),
                    original_language=self._optional_str(item.get("original_language")),
                )
                pending.append((old_id, slug, source_url, article))
                reserved_slugs.add(slug)
                if source_url:
                    reserved_source_urls.add(source_url)

            if not pending:
                continue

            try:
                for _, _, _, article in pending:
                    db.add(article)
                db.commit()
                section_stats["created"] += len(pending)
                for old_id, slug, source_url, article in pending:
                    if old_id:
                        article_id_map[old_id] = article.id
                    article_slug_map[slug] = article.id
                    committed_slugs.add(slug)
                    if source_url:
                        committed_source_urls.add(source_url)
            except IntegrityError:
                db.rollback()
                for old_id, slug, source_url, article in pending:
                    try:
                        db.add(article)
                        db.commit()
                        section_stats["created"] += 1
                        if old_id:
                            article_id_map[old_id] = article.id
                        article_slug_map[slug] = article.id
                        committed_slugs.add(slug)
                        if source_url:
                            committed_source_urls.add(source_url)
                    except IntegrityError:
                        db.rollback()
                        section_stats["skipped"] += 1
                        skipped.add("articles", slug, "唯一键冲突(slug/source_url)")
                    except Exception:
                        db.rollback()
                        section_stats["errors"] += 1
            except Exception:
                db.rollback()
                section_stats["errors"] += len(pending)

    def _import_ai_analyses(
        self,
        db: Session,
        items: list[Any],
        section_stats: dict[str, int],
        skipped: _SkipRecorder,
        article_id_map: dict[str, str],
        article_slug_map: dict[str, str],
    ) -> None:
        committed_article_ids: set[str] = set()

        for batch in _chunked(items, self.IMPORT_BATCH_SIZE):
            resolved_targets: list[tuple[dict[str, Any], str, str]] = []
            candidate_ids: set[str] = set()
            for item in batch:
                if not isinstance(item, dict):
                    section_stats["errors"] += 1
                    continue
                source_article_id = self._clean_str(item.get("article_id"))
                source_article_slug = self._clean_str(item.get("article_slug"))
                target_article_id = article_id_map.get(source_article_id) or article_slug_map.get(
                    source_article_slug
                )
                if not target_article_id:
                    section_stats["skipped"] += 1
                    skipped.add(
                        "ai_analyses",
                        source_article_slug or source_article_id or "-",
                        "关联文章未导入，已跳过",
                    )
                    continue
                resolved_targets.append((item, target_article_id, source_article_slug))
                candidate_ids.add(target_article_id)

            existing_ids = set()
            if candidate_ids:
                existing_ids = {
                    row.article_id
                    for row in db.query(AIAnalysis.article_id)
                    .filter(AIAnalysis.article_id.in_(candidate_ids))
                    .all()
                }

            pending: list[tuple[str, str, AIAnalysis]] = []
            reserved_article_ids: set[str] = set()
            for item, target_article_id, source_article_slug in resolved_targets:
                identifier = source_article_slug or target_article_id
                if (
                    target_article_id in existing_ids
                    or target_article_id in committed_article_ids
                    or target_article_id in reserved_article_ids
                ):
                    section_stats["skipped"] += 1
                    skipped.add(
                        "ai_analyses",
                        identifier,
                        "唯一键冲突(article_id)",
                    )
                    continue

                analysis = AIAnalysis(
                    id=generate_uuid(),
                    article_id=target_article_id,
                    summary=self._optional_str(item.get("summary")),
                    summary_status=self._optional_str(item.get("summary_status")),
                    outline=self._optional_str(item.get("outline")),
                    outline_status=self._optional_str(item.get("outline_status")),
                    key_points=self._optional_str(item.get("key_points")),
                    key_points_status=self._optional_str(item.get("key_points_status")),
                    quotes=self._optional_str(item.get("quotes")),
                    quotes_status=self._optional_str(item.get("quotes_status")),
                    mindmap=self._optional_str(item.get("mindmap")),
                    classification_status=self._optional_str(item.get("classification_status")),
                    cleaned_md_draft=self._optional_str(item.get("cleaned_md_draft")),
                    error_message=self._optional_str(item.get("error_message")),
                    updated_at=self._optional_str(item.get("updated_at")) or now_str(),
                )
                pending.append((identifier, target_article_id, analysis))
                reserved_article_ids.add(target_article_id)

            if not pending:
                continue

            try:
                for _, _, analysis in pending:
                    db.add(analysis)
                db.commit()
                section_stats["created"] += len(pending)
                for _, target_article_id, _ in pending:
                    committed_article_ids.add(target_article_id)
            except IntegrityError:
                db.rollback()
                for identifier, target_article_id, analysis in pending:
                    try:
                        db.add(analysis)
                        db.commit()
                        section_stats["created"] += 1
                        committed_article_ids.add(target_article_id)
                    except IntegrityError:
                        db.rollback()
                        section_stats["skipped"] += 1
                        skipped.add("ai_analyses", identifier, "唯一键冲突(article_id)")
                    except Exception:
                        db.rollback()
                        section_stats["errors"] += 1
            except Exception:
                db.rollback()
                section_stats["errors"] += len(pending)

    def _import_settings(
        self,
        db: Session,
        settings_data: Any,
        section_stats: dict[str, int],
        skipped: _SkipRecorder,
    ) -> None:
        if not isinstance(settings_data, dict):
            return

        admin = get_admin_settings(db)
        if admin is None:
            section_stats["errors"] += 1
            skipped.add("settings", "global", "系统未初始化，无法导入设置")
            return

        provided_sections = [
            key
            for key in ("basic", "comments", "storage", "recommendations")
            if key in settings_data
        ]
        for key in provided_sections:
            section_stats["skipped"] += 1
            skipped.add("settings", key, "目标系统已存在设置，按增量策略跳过")

    @staticmethod
    def _serialize_category(category: Category) -> dict[str, Any]:
        return {
            "id": category.id,
            "name": category.name,
            "description": category.description,
            "color": category.color,
            "sort_order": category.sort_order,
            "created_at": category.created_at,
        }

    @staticmethod
    def _serialize_model_api_config(config: ModelAPIConfig) -> dict[str, Any]:
        return {
            "id": config.id,
            "name": config.name,
            "base_url": config.base_url,
            "api_key": config.api_key,
            "provider": config.provider,
            "model_name": config.model_name,
            "model_type": config.model_type,
            "price_input_per_1k": config.price_input_per_1k,
            "price_output_per_1k": config.price_output_per_1k,
            "currency": config.currency,
            "context_window_tokens": config.context_window_tokens,
            "reserve_output_tokens": config.reserve_output_tokens,
            "is_enabled": bool(config.is_enabled),
            "is_default": bool(config.is_default),
            "created_at": config.created_at,
            "updated_at": config.updated_at,
        }

    @staticmethod
    def _serialize_prompt_config(config: PromptConfig) -> dict[str, Any]:
        return {
            "id": config.id,
            "name": config.name,
            "category_id": config.category_id,
            "type": config.type,
            "prompt": config.prompt,
            "system_prompt": config.system_prompt,
            "response_format": config.response_format,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "top_p": config.top_p,
            "chunk_size_tokens": config.chunk_size_tokens,
            "chunk_overlap_tokens": config.chunk_overlap_tokens,
            "max_continue_rounds": config.max_continue_rounds,
            "model_api_config_id": config.model_api_config_id,
            "is_enabled": bool(config.is_enabled),
            "is_default": bool(config.is_default),
            "created_at": config.created_at,
            "updated_at": config.updated_at,
        }

    @staticmethod
    def _serialize_article(article: Article) -> dict[str, Any]:
        return {
            "id": article.id,
            "title": article.title,
            "slug": article.slug,
            "content_html": article.content_html,
            "content_structured": article.content_structured,
            "content_md": article.content_md,
            "content_trans": article.content_trans,
            "translation_status": article.translation_status,
            "translation_error": article.translation_error,
            "source_url": article.source_url,
            "top_image": article.top_image,
            "author": article.author,
            "published_at": article.published_at,
            "source_domain": article.source_domain,
            "status": article.status,
            "is_visible": bool(article.is_visible),
            "category_id": article.category_id,
            "created_at": article.created_at,
            "updated_at": article.updated_at,
            "note_content": article.note_content,
            "note_annotations": article.note_annotations,
            "original_language": article.original_language,
        }

    @staticmethod
    def _serialize_ai_analysis(analysis: AIAnalysis, article_slug: str | None) -> dict[str, Any]:
        return {
            "id": analysis.id,
            "article_id": analysis.article_id,
            "article_slug": article_slug,
            "summary": analysis.summary,
            "summary_status": analysis.summary_status,
            "outline": analysis.outline,
            "outline_status": analysis.outline_status,
            "key_points": analysis.key_points,
            "key_points_status": analysis.key_points_status,
            "quotes": analysis.quotes,
            "quotes_status": analysis.quotes_status,
            "mindmap": analysis.mindmap,
            "classification_status": analysis.classification_status,
            "cleaned_md_draft": analysis.cleaned_md_draft,
            "error_message": analysis.error_message,
            "updated_at": analysis.updated_at,
        }

    def _serialize_settings(self, db: Session) -> dict[str, Any]:
        admin: AdminSettings | None = get_admin_settings(db)
        basic = build_basic_settings(admin)
        if admin is None:
            return {
                "basic": basic,
                "comments": {
                    "comments_enabled": True,
                    "github_client_id": "",
                    "github_client_secret": "",
                    "google_client_id": "",
                    "google_client_secret": "",
                    "nextauth_secret": "",
                    "sensitive_filter_enabled": True,
                    "sensitive_words": "",
                },
                "storage": {
                    "media_storage_enabled": False,
                    "media_compress_threshold": 1536 * 1024,
                    "media_max_dim": 2000,
                    "media_webp_quality": 80,
                },
                "recommendations": {
                    "recommendations_enabled": False,
                    "recommendation_model_config_id": "",
                },
            }

        return {
            "basic": basic,
            "comments": {
                "comments_enabled": bool(admin.comments_enabled),
                "github_client_id": admin.github_client_id or "",
                "github_client_secret": admin.github_client_secret or "",
                "google_client_id": admin.google_client_id or "",
                "google_client_secret": admin.google_client_secret or "",
                "nextauth_secret": admin.nextauth_secret or "",
                "sensitive_filter_enabled": bool(admin.sensitive_filter_enabled),
                "sensitive_words": admin.sensitive_words or "",
            },
            "storage": {
                "media_storage_enabled": bool(admin.media_storage_enabled),
                "media_compress_threshold": admin.media_compress_threshold,
                "media_max_dim": admin.media_max_dim,
                "media_webp_quality": admin.media_webp_quality,
            },
            "recommendations": {
                "recommendations_enabled": bool(admin.recommendations_enabled),
                "recommendation_model_config_id": admin.recommendation_model_config_id
                or "",
            },
        }
