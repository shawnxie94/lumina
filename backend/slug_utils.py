"""URL slug生成工具，支持中文转拼音"""

from slugify import slugify


def generate_slug(title: str, max_length: int = 50) -> str:
    """
    将标题转换为拼音slug

    示例：
        "深度学习入门指南" -> "shen-du-xue-xi-ru-men-zhi-nan"
        "Hello World 教程" -> "hello-world-jiao-cheng"

    Args:
        title: 文章标题
        max_length: 最大长度限制

    Returns:
        URL友好的slug字符串
    """
    if not title:
        return "untitled"

    # 使用 python-slugify 转拼音
    # allow_unicode=False 确保中文转为拼音
    slug = slugify(title, allow_unicode=False)

    if not slug:
        return "untitled"

    # 限制长度，保留完整单词
    if len(slug) > max_length:
        parts = slug.split("-")
        result = []
        current_len = 0
        for part in parts:
            if current_len + len(part) + 1 <= max_length:
                result.append(part)
                current_len += len(part) + 1
            else:
                break
        slug = "-".join(result) if result else slug[:max_length]

    return slug


def generate_article_slug(title: str, article_id: str) -> str:
    """
    生成完整的文章slug: {pinyin}-{short_id}

    示例：
        title="深度学习入门指南", article_id="550e8400-e29b-41d4-a716-446655440000"
        -> "shen-du-xue-xi-ru-men-zhi-nan-550e8400"

    Args:
        title: 文章标题
        article_id: 文章UUID

    Returns:
        完整的slug，包含拼音和ID前8位保证唯一性
    """
    slug = generate_slug(title)
    short_id = article_id.split("-")[0]  # 取UUID第一段（8字符）保证唯一性
    return f"{slug}-{short_id}"


def extract_id_from_slug(slug: str) -> str:
    """
    从slug中提取short_id部分

    示例：
        "shen-du-xue-xi-550e8400" -> "550e8400"

    Args:
        slug: 文章slug

    Returns:
        short_id用于数据库查询
    """
    if not slug:
        return ""
    parts = slug.split("-")
    if len(parts) >= 2:
        # 最后一部分是short_id
        return parts[-1]
    return slug
