from topic_bridge.export_body import (
    article_topic_set_fingerprint,
    body_hash,
    select_export_body,
    topic_fingerprint,
)


def test_english_prefers_completed_translation():
    article = {
        "title": "Hello",
        "title_trans": "你好",
        "original_language": "en",
        "translation_status": "completed",
        "content_md": "Hello world",
        "content_trans": "你好，世界",
    }
    selected = select_export_body(article)
    assert selected["title"] == "你好"
    assert selected["body"] == "你好，世界"
    assert selected["body_source"] == "content_trans"
    assert body_hash(selected["title"], selected["body"])


def test_non_english_uses_markdown():
    article = {
        "title": "中文标题",
        "original_language": "zh",
        "content_md": "正文",
        "content_trans": "不该用",
        "translation_status": "completed",
    }
    selected = select_export_body(article)
    assert selected["body"] == "正文"
    assert selected["body_source"] == "content_md"


def test_topic_fingerprint_stable_and_order_insensitive():
    base = {
        "key": "demo",
        "title": "Demo",
        "content_md": "Body",
        "tags": ["b", "a"],
        "status": "active",
        "topic_type": "concept",
        "article_ids": ["2", "1"],
        "related_topic_keys": ["y", "x"],
        "claims": [{"text": "c1"}, {"text": "c2"}],
        "compiler_ref": "wiki/concepts/demo.md",
    }
    alt = dict(base)
    alt["tags"] = ["a", "b"]
    alt["article_ids"] = ["1", "2"]
    alt["related_topic_keys"] = ["x", "y"]
    assert topic_fingerprint(base) == topic_fingerprint(alt)
    changed = dict(base)
    changed["content_md"] = "Body changed"
    assert topic_fingerprint(base) != topic_fingerprint(changed)
    assert article_topic_set_fingerprint(["b", "a"]) == article_topic_set_fingerprint(["a", "b"])
