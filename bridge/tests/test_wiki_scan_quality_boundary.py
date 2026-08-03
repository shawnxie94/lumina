from pathlib import Path

from topic_bridge.wiki_scan import list_wiki_topic_keys, scan_wiki_topics


def test_scan_ignores_lint_stubs_and_wrong_page_types(tmp_path: Path):
    wiki = tmp_path / "wiki"
    concepts = wiki / "concepts"
    concepts.mkdir(parents=True)
    (concepts / "valid.md").write_text(
        "---\ntype: concept\ntitle: Valid\ntags: []\nrelated: []\nsources: []\n---\n\n# Valid\n\nBody\n",
        encoding="utf-8",
    )
    (concepts / "stub.md").write_text(
        "---\ntype: query\ntitle: Stub\ntags: [stub, lint]\n---\n\n# Stub\n\nplaceholder\n",
        encoding="utf-8",
    )
    (concepts / "invalid.md").write_text("not a page", encoding="utf-8")

    topics = scan_wiki_topics(wiki, article_paths={}, slug_to_id={})

    assert [item["title"] for item in topics] == ["Valid"]
    assert list_wiki_topic_keys(wiki) == ["valid"]
