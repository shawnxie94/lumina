from pathlib import Path

from topic_bridge.wiki_scan import (
    derive_summary_from_markdown,
    rewrite_wiki_links_for_lumina,
    scan_wiki_topics,
)


def test_rewrite_sources_to_article_links(tmp_path: Path):
    project = tmp_path
    raw = project / "raw" / "sources" / "lumina"
    wiki = project / "wiki"
    concepts = wiki / "concepts"
    sources = wiki / "sources"
    raw.mkdir(parents=True)
    concepts.mkdir(parents=True)
    sources.mkdir(parents=True)

    article_id = "f0bcf0bf-c2ca-4111-b58e-868721eda80f"
    slug = "how-does-cursor-index-your-codebase-f0bcf0bf"
    (raw / f"{slug}__f0bcf0bf.md").write_text(
        "\n".join(
            [
                "---",
                f"lumina_id: {article_id}",
                f"lumina_slug: {slug}",
                "title: Cursor 如何索引你的代码库？",
                "---",
                "",
                "body",
            ]
        ),
        encoding="utf-8",
    )
    (sources / "6-lumina--52-how-does-cursor-index-your-codebase-f0bcf0bff0bcf0bf--nrf7m5.md").write_text(
        "\n".join(
            [
                "---",
                "type: source",
                "title: Cursor 如何索引你的代码库？",
                f'sources: ["lumina/{slug}__f0bcf0bf.md"]',
                "---",
                "",
                "# source",
            ]
        ),
        encoding="utf-8",
    )
    (concepts / "稀疏-n-gram-正则索引.md").write_text(
        "\n".join(
            [
                "---",
                "type: concept",
                "title: 稀疏 n-gram 正则索引",
                "tags: [trigram, n-gram]",
                "related: [cursor, sources/6-lumina--52-how-does-cursor-index-your-codebase-f0bcf0bff0bcf0bf--nrf7m5]",
                f'sources: ["lumina/{slug}__f0bcf0bf.md"]',
                "---",
                "",
                "# 稀疏 n-gram 正则索引",
                "",
                "稀疏 n-gram 正则索引是扩展。[[cursor]] 在 [[sources/6-lumina--52-how-does-cursor-index-your-codebase-f0bcf0bff0bcf0bf--nrf7m5]] 中描述了实现。",
            ]
        ),
        encoding="utf-8",
    )

    topics = scan_wiki_topics(
        wiki,
        article_paths={
            article_id: f"raw/sources/lumina/{slug}__f0bcf0bf.md",
        },
        slug_to_id={slug: article_id},
    )
    assert len(topics) == 1
    topic = topics[0]
    assert topic["key"] == "稀疏-n-gram-正则索引"
    assert f"](/article/{slug})" in topic["content_md"]
    assert "6-lumina--" not in topic["content_md"]
    assert "](/topics/cursor)" in topic["content_md"]
    from topic_bridge.wiki_scan import derive_summary_from_markdown
    assert derive_summary_from_markdown(topic["content_md"]).startswith("稀疏 n-gram 正则索引是扩展")
    assert "summary" not in topic
    assert "sources-" not in ",".join(topic["related_topic_keys"])
    assert article_id in topic["article_ids"]
    assert topic["tags"] == ["trigram", "n-gram"]


def test_derive_summary_strips_markdown_links():
    summary = derive_summary_from_markdown(
        "这是 [Cursor](/topics/cursor) 的说明。\n\n## 下一节\n\n更多"
    )
    assert summary == "这是 Cursor 的说明。"


def test_rewrite_without_source_index_drops_ugly_source_labels():
    text = rewrite_wiki_links_for_lumina(
        "见 [[sources/6-lumina--52-how-does-cursor-index-your-codebase-f0bcf0bff0bcf0bf--nrf7m5]]。"
    )
    assert "6-lumina" not in text
    assert "见 。" in text or text.startswith("见")


def test_scan_wiki_topics_reuses_file_cache(tmp_path: Path):
    project = tmp_path
    wiki = project / "wiki"
    concepts = wiki / "concepts"
    concepts.mkdir(parents=True)
    path = concepts / "demo.md"
    path.write_text(
        "\n".join(
            [
                "---",
                "type: concept",
                "title: Demo",
                "tags: []",
                "related: []",
                "sources: []",
                "---",
                "",
                "# Demo",
                "",
                "Body v1",
            ]
        ),
        encoding="utf-8",
    )
    cache: dict = {}
    first = scan_wiki_topics(wiki, article_paths={}, slug_to_id={}, file_cache=cache)
    assert len(first) == 1
    assert len(cache) == 1
    # mutate cache topic marker; if reuse works, second scan keeps marker without reread parse changes
    rel = next(iter(cache))
    cache[rel]["topic"] = {**cache[rel]["topic"], "content_md": "FROM_CACHE"}
    second = scan_wiki_topics(wiki, article_paths={}, slug_to_id={}, file_cache=cache)
    assert second[0]["content_md"] == "FROM_CACHE"

    # file change should bust cache
    path.write_text(path.read_text(encoding="utf-8") + "\nBody v2\n", encoding="utf-8")
    third = scan_wiki_topics(wiki, article_paths={}, slug_to_id={}, file_cache=cache)
    assert third[0]["content_md"] != "FROM_CACHE"
    assert "Body v2" in third[0]["content_md"] or "Body v1" in third[0]["content_md"]
