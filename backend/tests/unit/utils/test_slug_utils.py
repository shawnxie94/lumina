import re

from slug_utils import extract_id_from_slug, generate_article_slug, generate_slug


def test_generate_slug_returns_untitled_for_empty_title():
    assert generate_slug("") == "untitled"


def test_generate_slug_returns_untitled_when_slugify_result_is_empty():
    assert generate_slug("###") == "untitled"


def test_generate_slug_truncates_on_word_boundary():
    assert generate_slug("alpha beta gamma", max_length=11) == "alpha-beta"


def test_generate_slug_truncates_single_long_word():
    assert generate_slug("superlongword", max_length=5) == "super"


def test_generate_slug_outputs_ascii_url_safe_text():
    slug = generate_slug("Hello World 教程")
    assert slug == "hello-world-jiao-cheng"
    assert re.fullmatch(r"[a-z0-9-]+", slug)


def test_generate_article_slug_appends_uuid_prefix():
    article_id = "550e8400-e29b-41d4-a716-446655440000"
    full_slug = generate_article_slug("测试文章", article_id)
    assert full_slug.endswith("-550e8400")


def test_extract_id_from_slug_handles_standard_and_edge_cases():
    assert extract_id_from_slug("shen-du-xue-xi-550e8400") == "550e8400"
    assert extract_id_from_slug("550e8400") == "550e8400"
    assert extract_id_from_slug("") == ""
