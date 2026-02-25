from datetime import datetime, timedelta, timezone
import re

from sqlalchemy import func, literal
from sqlalchemy.orm import Session, joinedload, load_only

from models import AIAnalysis, Article, Category


def _normalize_start_date_bound(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip() or None


def _normalize_end_date_bound(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        day = datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return raw
    next_day = day + timedelta(days=1)
    return next_day.strftime("%Y-%m-%d")


def _parse_datetime_value(value: str | None) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None

    candidates: list[str] = [raw]
    if raw.endswith("Z"):
        candidates.append(raw[:-1] + "+00:00")

    replaced = raw.replace("/", "-")
    if replaced != raw:
        candidates.append(replaced)
        if replaced.endswith("Z"):
            candidates.append(replaced[:-1] + "+00:00")

    padded_match = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$", raw)
    if padded_match:
        year, month, day, suffix = padded_match.groups()
        padded = f"{year}-{int(month):02d}-{int(day):02d}{suffix}"
        candidates.append(padded)
        if padded.endswith("Z"):
            candidates.append(padded[:-1] + "+00:00")

    try:
        for candidate in candidates:
            try:
                parsed = datetime.fromisoformat(candidate)
                if parsed.tzinfo is not None:
                    return parsed.astimezone(timezone.utc).replace(tzinfo=None)
                return parsed
            except Exception:
                continue
    except Exception:
        pass

    strptime_patterns = (
        "%Y-%m-%d",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
    )
    for candidate in candidates:
        for pattern in strptime_patterns:
            try:
                parsed = datetime.strptime(candidate, pattern)
                if parsed.tzinfo is not None:
                    return parsed.astimezone(timezone.utc).replace(tzinfo=None)
                return parsed
            except Exception:
                continue
    return None


def _article_published_desc_sort_key(article: Article) -> tuple[datetime, datetime, str, str]:
    published = _parse_datetime_value(article.published_at)
    created = _parse_datetime_value(article.created_at)
    default_dt = datetime.min
    return (
        published or created or default_dt,
        created or published or default_dt,
        article.published_at or "",
        article.id or "",
    )


def _article_time_sort_key(article: Article) -> tuple[datetime, datetime, str]:
    primary = _parse_datetime_value(article.published_at) or _parse_datetime_value(
        article.created_at
    )
    secondary = _parse_datetime_value(article.created_at) or primary
    fallback = article.created_at or article.published_at or ""
    default_dt = datetime.max
    return (
        primary or default_dt,
        secondary or default_dt,
        fallback,
    )


def _normalize_public_base_url(public_base_url: str | None) -> str:
    return (public_base_url or "").strip().rstrip("/")


def _to_absolute_url(url: str | None, public_base_url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://", "data:")):
        return value
    if value.startswith("//"):
        return f"https:{value}"
    if value.startswith("/") and public_base_url:
        return f"{public_base_url}{value}"
    return value


def _build_filtered_query(
    query,
    *,
    is_admin: bool,
    category_id: str | None = None,
    search: str | None = None,
    source_domain: str | None = None,
    author: str | None = None,
    is_visible: bool | None = None,
    published_at_start: str | None = None,
    published_at_end: str | None = None,
    created_at_start: str | None = None,
    created_at_end: str | None = None,
):
    if not is_admin:
        query = query.filter(Article.is_visible == True)
    elif is_visible is not None:
        query = query.filter(Article.is_visible == is_visible)

    if category_id:
        query = query.filter(Article.category_id == category_id)
    if search:
        query = query.filter(Article.title.contains(search))
    if source_domain:
        query = query.filter(Article.source_domain == source_domain)
    if author:
        normalized_author = author.strip().replace(" ", "")
        if normalized_author:
            normalized_article_authors = func.replace(
                func.replace(func.coalesce(Article.author, ""), "，", ","),
                " ",
                "",
            )
            wrapped_article_authors = literal(",") + normalized_article_authors + literal(",")
            query = query.filter(wrapped_article_authors.like(f"%,{normalized_author},%"))
    published_start_bound = _normalize_start_date_bound(published_at_start)
    if published_start_bound:
        query = query.filter(Article.published_at >= published_start_bound)
    published_end_bound = _normalize_end_date_bound(published_at_end)
    if published_end_bound:
        query = query.filter(Article.published_at < published_end_bound)
    created_start_bound = _normalize_start_date_bound(created_at_start)
    if created_start_bound:
        query = query.filter(Article.created_at >= created_start_bound)
    created_end_bound = _normalize_end_date_bound(created_at_end)
    if created_end_bound:
        query = query.filter(Article.created_at < created_end_bound)
    return query


def _render_export_markdown(articles: list[Article], public_base_url: str | None = None) -> str:
    if not articles:
        return ""

    base_url = _normalize_public_base_url(public_base_url)
    grouped: dict[tuple[int, int, str], list[Article]] = {}
    for article in articles:
        if article.category:
            key = (
                0,
                article.category.sort_order
                if article.category.sort_order is not None
                else 999999,
                article.category.name or "未分类",
            )
        else:
            key = (1, 999999, "未分类")
        grouped.setdefault(key, []).append(article)

    lines: list[str] = []
    for (_, _, category_name), category_articles in sorted(grouped.items()):
        lines.append(f"## {category_name}")
        lines.append("")
        for article in sorted(category_articles, key=_article_time_sort_key):
            article_url = (
                f"{base_url}/article/{article.slug}" if base_url else f"/article/{article.slug}"
            )
            lines.append(f"### [{article.title}]({article_url})")
            lines.append("")
            top_image = _to_absolute_url(article.top_image, base_url)
            if top_image:
                lines.append(f"![]({top_image})")
                lines.append("")
            summary = article.ai_analysis.summary if article.ai_analysis else ""
            if summary:
                lines.append(summary)
                lines.append("")

    return "\n".join(lines).strip()


class ArticleQueryService:
    def get_article_neighbors(
        self,
        db: Session,
        article: Article,
        is_admin: bool = False,
    ):
        query = db.query(Article).options(
            load_only(
                Article.id,
                Article.slug,
                Article.title,
                Article.created_at,
                Article.is_visible,
            )
        )
        if not is_admin:
            query = query.filter(Article.is_visible == True)

        prev_article = (
            query.filter(Article.created_at > article.created_at)
            .order_by(Article.created_at.asc())
            .first()
        )
        next_article = (
            query.filter(Article.created_at < article.created_at)
            .order_by(Article.created_at.desc())
            .first()
        )
        return prev_article, next_article

    def get_article_by_slug(
        self,
        db: Session,
        slug: str,
        include_relations: bool = False,
    ) -> Article | None:
        query = db.query(Article)
        if include_relations:
            query = query.options(
                joinedload(Article.category).load_only(Category.id, Category.name, Category.color),
                joinedload(Article.ai_analysis).load_only(
                    AIAnalysis.summary,
                    AIAnalysis.summary_status,
                    AIAnalysis.key_points,
                    AIAnalysis.key_points_status,
                    AIAnalysis.outline,
                    AIAnalysis.outline_status,
                    AIAnalysis.quotes,
                    AIAnalysis.quotes_status,
                    AIAnalysis.classification_status,
                    AIAnalysis.error_message,
                    AIAnalysis.updated_at,
                ),
            )
        return query.filter(Article.slug == slug).first()

    def get_articles(
        self,
        db: Session,
        page: int = 1,
        size: int = 20,
        category_id: str | None = None,
        search: str | None = None,
        source_domain: str | None = None,
        author: str | None = None,
        is_visible: bool | None = None,
        published_at_start: str | None = None,
        published_at_end: str | None = None,
        created_at_start: str | None = None,
        created_at_end: str | None = None,
        sort_by: str | None = "created_at_desc",
        is_admin: bool = False,
    ):
        query = _build_filtered_query(
            db.query(Article),
            is_admin=is_admin,
            category_id=category_id,
            search=search,
            source_domain=source_domain,
            author=author,
            is_visible=is_visible,
            published_at_start=published_at_start,
            published_at_end=published_at_end,
            created_at_start=created_at_start,
            created_at_end=created_at_end,
        )

        total = query.count()

        query = query.options(
            load_only(
                Article.id,
                Article.slug,
                Article.title,
                Article.top_image,
                Article.author,
                Article.status,
                Article.source_domain,
                Article.published_at,
                Article.created_at,
                Article.is_visible,
                Article.original_language,
                Article.category_id,
            ),
            joinedload(Article.category).load_only(Category.id, Category.name, Category.color),
            joinedload(Article.ai_analysis).load_only(AIAnalysis.summary),
        )

        if sort_by == "created_at_desc":
            query = query.order_by(Article.created_at.desc())
            articles = query.offset((page - 1) * size).limit(size).all()
            return articles, total

        articles = query.all()
        articles.sort(key=_article_published_desc_sort_key, reverse=True)
        offset = max(0, (page - 1) * size)
        articles = articles[offset : offset + size]
        return articles, total

    def export_articles(
        self,
        db: Session,
        article_slugs: list[str],
        public_base_url: str | None = None,
    ) -> str:
        if not article_slugs:
            return ""

        articles = (
            db.query(Article)
            .options(
                joinedload(Article.category).load_only(
                    Category.id, Category.name, Category.sort_order
                ),
                joinedload(Article.ai_analysis).load_only(AIAnalysis.summary),
            )
            .filter(Article.slug.in_(article_slugs))
            .all()
        )

        return _render_export_markdown(articles, public_base_url=public_base_url)

    def export_articles_by_filters(
        self,
        db: Session,
        *,
        category_id: str | None = None,
        search: str | None = None,
        source_domain: str | None = None,
        author: str | None = None,
        is_visible: bool | None = None,
        published_at_start: str | None = None,
        published_at_end: str | None = None,
        created_at_start: str | None = None,
        created_at_end: str | None = None,
        is_admin: bool = True,
        public_base_url: str | None = None,
    ) -> str:
        query = _build_filtered_query(
            db.query(Article),
            is_admin=is_admin,
            category_id=category_id,
            search=search,
            source_domain=source_domain,
            author=author,
            is_visible=is_visible,
            published_at_start=published_at_start,
            published_at_end=published_at_end,
            created_at_start=created_at_start,
            created_at_end=created_at_end,
        )
        articles = query.options(
            joinedload(Article.category).load_only(
                Category.id,
                Category.name,
                Category.sort_order,
            ),
            joinedload(Article.ai_analysis).load_only(AIAnalysis.summary),
        ).all()
        return _render_export_markdown(articles, public_base_url=public_base_url)
