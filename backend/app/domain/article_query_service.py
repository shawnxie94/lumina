from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import re
from urllib.parse import urlencode
from xml.sax.saxutils import escape

from sqlalchemy import func, literal, or_
from sqlalchemy.orm import Session, joinedload, load_only

from models import AIAnalysis, Article, ArticleComment, Category, Tag


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


def _article_created_desc_sort_key(article: Article) -> tuple[datetime, str, str]:
    created = _parse_datetime_value(article.created_at)
    default_dt = datetime.min
    return (
        created or default_dt,
        article.created_at or "",
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


def _normalize_public_asset_url(
    base_url: str,
    asset_url: str | None,
) -> str | None:
    raw = (asset_url or "").strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        return raw
    if raw.startswith("/"):
        return f"{base_url}{raw}"
    return f"{base_url}/{raw.lstrip('/')}"


def _split_quotes_content(value: str | None) -> list[str]:
    raw = (value or "").strip()
    if not raw:
        return []
    lines = []
    for chunk in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        normalized = chunk.strip().lstrip("-").lstrip("•").strip()
        if normalized:
            lines.append(normalized)
    return lines


def _normalize_public_base_url(public_base_url: str | None) -> str:
    return (public_base_url or "").strip().rstrip("/")


def _normalize_tag_ids(tag_ids: list[str] | None) -> list[str]:
    normalized = sorted({tag_id.strip() for tag_id in (tag_ids or []) if tag_id and tag_id.strip()})
    return normalized


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
    tag_ids: list[str] | None = None,
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
    if tag_ids:
        normalized_tag_ids = [tag_id.strip() for tag_id in tag_ids if tag_id and tag_id.strip()]
        if normalized_tag_ids:
            query = query.filter(Article.tags.any(Tag.id.in_(normalized_tag_ids)))
    query = _apply_title_search_filter(query, search)
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


def _apply_title_search_filter(query, search: str | None):
    normalized_search = (search or "").strip()
    if not normalized_search:
        return query
    return query.filter(
        or_(
            Article.title.contains(normalized_search),
            func.coalesce(Article.title_trans, "").contains(normalized_search),
        )
    )


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
            preferred_title = _get_preferred_article_title(article)
            lines.append(f"### [{preferred_title}]({article_url})")
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


def _load_public_comment_count_map(
    db: Session,
    article_ids: list[str],
) -> dict[str, int]:
    normalized_ids = [article_id for article_id in article_ids if article_id]
    if not normalized_ids:
        return {}
    rows = (
        db.query(
            ArticleComment.article_id,
            func.count(ArticleComment.id).label("comment_count"),
        )
        .filter(ArticleComment.article_id.in_(normalized_ids))
        .filter(
            (ArticleComment.is_hidden == False)
            | (ArticleComment.is_hidden.is_(None))
        )
        .group_by(ArticleComment.article_id)
        .all()
    )
    return {
        str(row.article_id): int(row.comment_count or 0)
        for row in rows
    }


def _to_rfc2822_datetime(value: str | None) -> str:
    parsed = _parse_datetime_value(value)
    if parsed is None:
        return ""
    return format_datetime(parsed.replace(tzinfo=timezone.utc), usegmt=True)


def _wrap_cdata(value: str | None) -> str:
    normalized = (value or "").replace("]]>", "]]]]><![CDATA[>")
    return f"<![CDATA[{normalized}]]>"


def _get_preferred_article_title(article: Article) -> str:
    translated_title = (article.title_trans or "").strip()
    if translated_title:
        return translated_title
    return article.title or ""


def _build_query_string(*, category_id: str | None = None, tag_ids: list[str] | None = None) -> str:
    params: dict[str, str] = {}
    normalized_tag_ids = _normalize_tag_ids(tag_ids)
    if category_id:
        params["category_id"] = category_id
    if normalized_tag_ids:
        params["tag_ids"] = ",".join(normalized_tag_ids)
    if not params:
        return ""
    return urlencode(params)


def _build_public_feed_url(
    public_base_url: str,
    path: str,
    *,
    category_id: str | None = None,
    tag_ids: list[str] | None = None,
) -> str:
    query_string = _build_query_string(category_id=category_id, tag_ids=tag_ids)
    normalized_path = path if path.startswith("/") else f"/{path}"
    url = f"{public_base_url}{normalized_path}" if public_base_url else normalized_path
    if query_string:
        return f"{url}?{query_string}"
    return url


class ArticleQueryService:
    RSS_ITEM_LIMIT = 50

    def search_articles_by_title(self, db: Session, query_text: str, limit: int = 20):
        query = _apply_title_search_filter(
            db.query(Article.id, Article.title, Article.title_trans, Article.slug),
            query_text,
        )
        return query.order_by(Article.created_at.desc()).limit(limit).all()

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
                Article.title_trans,
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
                joinedload(Article.tags).load_only(Tag.id, Tag.name),
                joinedload(Article.ai_analysis).load_only(
                    AIAnalysis.summary,
                    AIAnalysis.summary_status,
                    AIAnalysis.current_summary_version_id,
                    AIAnalysis.key_points,
                    AIAnalysis.key_points_status,
                    AIAnalysis.current_key_points_version_id,
                    AIAnalysis.outline,
                    AIAnalysis.outline_status,
                    AIAnalysis.current_outline_version_id,
                    AIAnalysis.quotes,
                    AIAnalysis.quotes_status,
                    AIAnalysis.current_quotes_version_id,
                    AIAnalysis.infographic_status,
                    AIAnalysis.infographic_image_url,
                    AIAnalysis.infographic_html,
                    AIAnalysis.current_infographic_version_id,
                    AIAnalysis.classification_status,
                    AIAnalysis.tagging_status,
                    AIAnalysis.tagging_manual_override,
                    AIAnalysis.error_message,
                    AIAnalysis.updated_at,
                ),
            )
        article = query.filter(Article.slug == slug).first()
        if article is not None:
            article.comment_count = self.get_public_comment_count(db, article.id)
        return article

    def get_articles(
        self,
        db: Session,
        page: int = 1,
        size: int = 20,
        category_id: str | None = None,
        tag_ids: list[str] | None = None,
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
            tag_ids=tag_ids,
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
            joinedload(Article.tags).load_only(Tag.id, Tag.name),
            joinedload(Article.ai_analysis).load_only(AIAnalysis.summary),
        )

        if sort_by == "created_at_desc":
            query = query.order_by(Article.created_at.desc())
            articles = query.offset((page - 1) * size).limit(size).all()
            self.attach_public_comment_counts(db, articles)
            return articles, total

        if sort_by == "published_at_desc":
            query = query.order_by(
                func.coalesce(Article.published_at, datetime.min).desc(),
                Article.created_at.desc(),
            )
            articles = query.offset((page - 1) * size).limit(size).all()
            self.attach_public_comment_counts(db, articles)
            return articles, total

        articles = query.all()
        articles.sort(key=_article_published_desc_sort_key, reverse=True)
        offset = max(0, (page - 1) * size)
        articles = articles[offset : offset + size]
        self.attach_public_comment_counts(db, articles)
        return articles, total

    def attach_public_comment_counts(
        self,
        db: Session,
        articles: list[Article],
    ) -> None:
        comment_count_map = _load_public_comment_count_map(
            db,
            [article.id for article in articles],
        )
        for article in articles:
            article.comment_count = int(comment_count_map.get(article.id, 0))

    def get_public_comment_count(self, db: Session, article_id: str) -> int:
        comment_count_map = _load_public_comment_count_map(db, [article_id])
        return int(comment_count_map.get(article_id, 0))

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
        tag_ids: list[str] | None = None,
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
            tag_ids=tag_ids,
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
            joinedload(Article.tags).load_only(Tag.id, Tag.name),
            joinedload(Article.ai_analysis).load_only(AIAnalysis.summary),
        ).all()
        return _render_export_markdown(articles, public_base_url=public_base_url)

    def get_articles_for_rss(
        self,
        db: Session,
        *,
        category_id: str | None = None,
        tag_ids: list[str] | None = None,
    ) -> list[Article]:
        query = _build_filtered_query(
            db.query(Article),
            is_admin=False,
            category_id=category_id,
            tag_ids=_normalize_tag_ids(tag_ids),
        )
        query = query.options(
            load_only(
                Article.id,
                Article.slug,
                Article.title,
                Article.top_image,
                Article.author,
                Article.published_at,
                Article.created_at,
            ),
            joinedload(Article.category).load_only(Category.name),
            joinedload(Article.tags).load_only(Tag.name),
            joinedload(Article.ai_analysis).load_only(
                AIAnalysis.summary,
                AIAnalysis.quotes,
                AIAnalysis.infographic_image_url,
            ),
        )
        articles = query.all()
        articles.sort(key=_article_created_desc_sort_key, reverse=True)
        return articles[: self.RSS_ITEM_LIMIT]

    def render_articles_rss(
        self,
        *,
        articles: list[Article],
        public_base_url: str | None = None,
        site_name: str,
        site_description: str,
        category_id: str | None = None,
        tag_ids: list[str] | None = None,
    ) -> str:
        base_url = _normalize_public_base_url(public_base_url)
        normalized_tag_ids = _normalize_tag_ids(tag_ids)
        feed_link = _build_public_feed_url(
            base_url,
            "/list",
            category_id=category_id,
            tag_ids=normalized_tag_ids,
        )
        feed_self_link = _build_public_feed_url(
            base_url,
            "/backend/api/articles/rss.xml",
            category_id=category_id,
            tag_ids=normalized_tag_ids,
        )
        safe_site_name = escape(site_name or "Lumina")
        safe_site_description = escape(site_description or "")

        lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">',
            "<channel>",
            f"<title>{safe_site_name}</title>",
            f"<description>{safe_site_description}</description>",
            f"<link>{escape(feed_link)}</link>",
            (
                '<atom:link href="'
                f'{escape(feed_self_link)}'
                '" rel="self" type="application/rss+xml" />'
            ),
        ]

        for article in articles:
            article_link = _build_public_feed_url(base_url, f"/article/{article.slug}")
            pub_date = _to_rfc2822_datetime(article.created_at)
            display_title = _get_preferred_article_title(article)
            author = (article.author or "").strip()
            category_name = (
                (article.category.name or "").strip()
                if article.category
                else ""
            )
            tag_names = [
                (tag.name or "").strip()
                for tag in (article.tags or [])
                if (tag.name or "").strip()
            ]
            summary = article.ai_analysis.summary if article.ai_analysis else ""
            quotes = article.ai_analysis.quotes if article.ai_analysis else ""
            infographic_image_url = (
                article.ai_analysis.infographic_image_url if article.ai_analysis else ""
            )
            top_image_url = _normalize_public_asset_url(base_url, article.top_image)
            infographic_image_url = _normalize_public_asset_url(
                base_url,
                infographic_image_url,
            )
            description_parts: list[str] = []
            if (summary or "").strip():
                description_parts.append(f"<p>{escape(summary.strip())}</p>")

            quote_lines = _split_quotes_content(quotes)
            if quote_lines:
                quotes_html = "".join(
                    f"<li>{escape(line)}</li>" for line in quote_lines
                )
                description_parts.append(f"<h3>金句</h3><ul>{quotes_html}</ul>")

            if infographic_image_url:
                description_parts.append(
                    "<h3>信息图</h3>"
                    f'<p><img src="{escape(infographic_image_url)}" '
                    f'alt="{escape(display_title)} 信息图" /></p>'
                )
            lines.extend(
                [
                    "<item>",
                    f"<title>{escape(display_title)}</title>",
                    f"<link>{escape(article_link)}</link>",
                    f'<guid isPermaLink="true">{escape(article_link)}</guid>',
                    (
                        "<description><![CDATA["
                        f"{''.join(description_parts)}"
                        "]]></description>"
                    ),
                ]
            )
            if top_image_url:
                lines.append(
                    f'<enclosure url="{escape(top_image_url)}" type="image/*" />'
                )
                lines.append(
                    f'<media:content url="{escape(top_image_url)}" medium="image" />'
                )
            if pub_date:
                lines.append(f"<pubDate>{escape(pub_date)}</pubDate>")
            if author:
                lines.append(f"<dc:creator>{_wrap_cdata(author)}</dc:creator>")
            if category_name:
                lines.append(f"<category>{_wrap_cdata(category_name)}</category>")
            for tag_name in tag_names:
                lines.append(f"<category>{_wrap_cdata(tag_name)}</category>")
            lines.append("</item>")

        lines.extend(["</channel>", "</rss>"])
        return "\n".join(lines)
