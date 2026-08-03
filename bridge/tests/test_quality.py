from pathlib import Path

from topic_bridge.config import BridgeConfig
from topic_bridge.quality import audit_local_knowledge
from topic_bridge.state import BridgeState
from topic_bridge import sync as sync_mod


def _config(tmp_path: Path) -> BridgeConfig:
    project = tmp_path / "project"
    (project / "raw" / "sources" / "lumina").mkdir(parents=True)
    (project / "wiki" / "entities").mkdir(parents=True)
    (project / "wiki" / "concepts").mkdir(parents=True)
    return BridgeConfig(
        host="127.0.0.1",
        port=8787,
        bridge_token=None,
        lumina_base_url="http://127.0.0.1:8000/backend",
        lumina_internal_token="token",
        llm_wiki_api_url="http://127.0.0.1:19828",
        project_path=project,
        project_id="proj",
        project_name="proj",
        raw_subdir="raw/sources/lumina",
        state_path=tmp_path / "state.json",
    )


def _page(path: Path, *, title: str, body: str, sources: str = "[\"lumina/demo.md\"]") -> None:
    kind = {"entities": "entity", "concepts": "concept"}[path.parent.name]
    path.write_text(
        "\n".join(
            [
                "---",
                f"type: {kind}",
                f"title: {title}",
                "tags: []",
                "related: []",
                f"sources: {sources}",
                "---",
                "",
                f"# {title}",
                "",
                body,
            ]
        ),
        encoding="utf-8",
    )


def test_audit_blocks_model_leak_and_missing_sources(tmp_path: Path):
    config = _config(tmp_path)
    _page(config.wiki_dir / "concepts" / "valid.md", title="Valid", body="A valid concept.")
    _page(
        config.wiki_dir / "entities" / "leaked.md",
        title="Leaked",
        body="<think>The user wants me to merge this page.</think>",
        sources="[]",
    )

    result = audit_local_knowledge(
        config,
        compile_status={"queue_size": 0, "active": 0, "failed": 0},
    )

    assert result["ready"] is False
    assert result["hard_failure_counts"]["model_text_leak"] == 1
    assert result["hard_failure_counts"]["missing_sources"] == 1


def test_audit_keeps_review_and_ingest_warnings_non_blocking(tmp_path: Path):
    config = _config(tmp_path)
    _page(config.wiki_dir / "concepts" / "valid.md", title="Valid", body="A valid concept.")
    runtime = config.project_path / ".llm-wiki"
    runtime.mkdir()
    (runtime / "review.json").write_text(
        '[{"type":"suggestion","resolved":false}]', encoding="utf-8"
    )
    (runtime / "ingest-warnings.log").write_text(
        '1. FILE block was not closed before end of stream\n', encoding="utf-8"
    )

    result = audit_local_knowledge(
        config,
        compile_status={"queue_size": 0, "active": 0, "failed": 0},
    )

    assert result["ready"] is True
    assert result["warning_counts"]["unresolved_review"] == 1
    assert result["warning_counts"]["ingest_warning"] == 1
    assert result["warning_counts"]["ingest_warning_active"] == 1


def test_ingest_warning_count_ignores_log_headers_and_blank_lines(tmp_path: Path):
    config = _config(tmp_path)
    _page(config.wiki_dir / "concepts" / "valid.md", title="Valid", body="A valid concept.")
    runtime = config.project_path / ".llm-wiki"
    runtime.mkdir()
    (runtime / "ingest-warnings.log").write_text(
        "## 2026-07-29T00:00:00Z | lumina/demo.md\n\n"
        "1. FILE block \"wiki/concepts/demo.md\" was not closed before end of stream\n\n"
        "## 2026-07-29T00:01:00Z | lumina/demo-2.md\n\n"
        "1. unsafe path rejected\n",
        encoding="utf-8",
    )

    result = audit_local_knowledge(
        config,
        compile_status={"queue_size": 0, "active": 0, "failed": 0},
    )

    assert result["warning_counts"]["ingest_warning"] == 2
    assert result["ingest_warnings"] == {"truncation": 1, "unsafe_path": 1}


def test_ingest_warning_dispositions_expose_actionable_state(tmp_path: Path):
    config = _config(tmp_path)
    _page(config.wiki_dir / "concepts" / "valid.md", title="Valid", body="A valid concept.")
    runtime = config.project_path / ".llm-wiki"
    runtime.mkdir()
    (runtime / "ingest-warnings.log").write_text(
        "## 2026-07-29T00:00:00Z | lumina/demo.md\n\n"
        "1. FILE block \"wiki/concepts/demo.md\" was not closed before end of stream\n",
        encoding="utf-8",
    )
    (runtime / "ingest-dispositions.json").write_text(
        '{"version": 1, "sources": {"lumina/demo.md": {"status": "equivalent"}}}',
        encoding="utf-8",
    )

    result = audit_local_knowledge(
        config,
        compile_status={"queue_size": 0, "active": 0, "failed": 0},
    )

    assert result["ingest_warning_status"]["dispositions"] == {"equivalent": 1}
    assert result["ingest_warning_status"]["actionable"] == 0
    assert result["ingest_warning_status"]["unclassified"] == 0


def test_audit_allows_same_title_across_entity_and_concept_namespaces(tmp_path: Path):
    config = _config(tmp_path)
    _page(config.wiki_dir / "entities" / "claude-skills.md", title="Claude Skills", body="The system.")
    _page(config.wiki_dir / "concepts" / "claude-skills.md", title="Claude Skills", body="The mechanism.")

    result = audit_local_knowledge(
        config,
        compile_status={"queue_size": 0, "active": 0, "failed": 0},
    )

    assert result["ready"] is True
    assert "duplicate_titles" not in result["hard_failure_counts"]


def test_audit_treats_lint_stubs_as_noncanonical(tmp_path: Path):
    config = _config(tmp_path)
    (config.wiki_dir / "concepts" / "stub.md").write_text(
        "---\ntype: query\ntitle: Stub\ntags: [stub, lint]\n---\n\n# Stub\n\nplaceholder\n",
        encoding="utf-8",
    )

    result = audit_local_knowledge(
        config,
        compile_status={"queue_size": 0, "active": 0, "failed": 0},
    )

    assert result["ready"] is False  # no canonical entity/concept remains
    assert result["hard_failure_counts"]["no_topics"] == 1
    assert result["warning_counts"]["noncanonical_stub"] == 1
    assert result["canonical_topics"] == 0
    assert result["ignored_noncanonical"] == 1


def test_audit_blocks_model_leak_in_source_pages(tmp_path: Path):
    config = _config(tmp_path)
    _page(config.wiki_dir / "concepts" / "valid.md", title="Valid", body="A valid concept.")
    source_dir = config.wiki_dir / "sources"
    source_dir.mkdir()
    (source_dir / "demo.md").write_text(
        "---\n"
        "type: source\n"
        "title: Demo\n"
        "sources: [\"lumina/demo.md\"]\n"
        "---\n\n"
        "<think>The user wants me to analyze this source.</think>\n",
        encoding="utf-8",
    )

    result = audit_local_knowledge(
        config,
        compile_status={"queue_size": 0, "active": 0, "failed": 0},
    )

    assert result["ready"] is False
    assert result["hard_failure_counts"]["source_model_text_leak"] == 1
    assert result["source_quality"]["pages_with_model_leak"] == 1


def test_sync_quality_gate_skips_remote_writeback(tmp_path: Path, monkeypatch):
    config = _config(tmp_path)
    bad = config.wiki_dir / "concepts" / "bad.md"
    bad.write_text("<think>model planning leaked</think>", encoding="utf-8")
    BridgeState(
        last_article_sync_at="2026-07-01T00:00:00Z",
        article_hashes={"a1": "old"},
        article_paths={"a1": "raw/sources/lumina/demo.md"},
    ).save(config.state_path)
    writes: list[dict] = []

    class FakeClient:
        def __init__(self, _config):
            pass

        def export_articles(self, updated_after=None):
            return [
                {
                    "id": "a1",
                    "slug": "demo",
                    "title": "Demo",
                    "content_md": "body",
                    "updated_at": "2026-07-02T00:00:00Z",
                }
            ]

        def write_compile_results(self, payload):
            writes.append(payload)
            return {"ok": True}

    monkeypatch.setattr(sync_mod, "LuminaClient", FakeClient)

    result = sync_mod.run_sync(config, mode="incremental")

    assert result["status"] == "quality_blocked"
    assert result["writeback_skipped"] is True
    assert writes == []
