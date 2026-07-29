from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from topic_bridge.config import BridgeConfig
from topic_bridge.state import BridgeState
from topic_bridge import sync as sync_mod
from topic_bridge import knowledge_ops as knowledge_ops_mod


def _config(tmp_path: Path) -> BridgeConfig:
    project = tmp_path / "project"
    project.mkdir()
    (project / "raw" / "sources" / "lumina").mkdir(parents=True)
    (project / "wiki" / "concepts").mkdir(parents=True)
    state_path = tmp_path / "state.json"
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
        state_path=state_path,
    )


def test_reset_local_knowledge_data_wipes_raw_wiki_and_state(tmp_path: Path):
    config = _config(tmp_path)
    raw_file = config.raw_dir / "demo.md"
    raw_file.write_text("old source", encoding="utf-8")
    wiki_file = config.wiki_dir / "concepts" / "demo.md"
    wiki_file.write_text("old wiki", encoding="utf-8")
    state = BridgeState(
        last_article_sync_at="2026-01-01T00:00:00Z",
        article_hashes={"a1": "hash"},
        article_paths={"a1": "raw/sources/lumina/demo.md"},
    )
    state.save(config.state_path)
    cache = config.project_path / ".llm-wiki"
    cache.mkdir()
    (cache / "cache.bin").write_text("x", encoding="utf-8")
    (cache / "review.json").write_text('[{"id":"stale"}]', encoding="utf-8")

    info = sync_mod.reset_local_knowledge_data(config)

    assert info["ok"] is True
    assert not raw_file.exists()
    assert not wiki_file.exists()
    assert config.raw_dir.exists()
    assert (config.wiki_dir / "entities").exists()
    assert (config.wiki_dir / "concepts").exists()
    assert (config.wiki_dir / "index.md").exists()
    # runtime dir is recreated cleanly (not left with old cache.bin/review)
    assert cache.exists()
    assert not (cache / "cache.bin").exists()
    assert (cache / "review.json").read_text(encoding="utf-8").strip() == "[]"
    reloaded = BridgeState.load(config.state_path)
    assert reloaded.last_article_sync_at is None
    assert reloaded.article_hashes == {}
    assert reloaded.article_paths == {}
    assert reloaded.topic_hashes == {}
    assert reloaded.article_topic_hashes == {}


def test_run_sync_rebuild_dry_run_plans_wipe_and_full_export(tmp_path: Path):
    config = _config(tmp_path)
    BridgeState(last_article_sync_at="2026-01-01T00:00:00Z").save(config.state_path)

    result = sync_mod.run_sync(config, mode="full", rebuild=True, dry_run=True)

    assert result["accepted"] is True
    assert result["dry_run"] is True
    assert result["rebuild"] is True
    assert result["mode"] == "full"
    assert result["updated_after"] is None
    assert result["would_export_all"] is True
    assert result["reset"]["planned"] is True
    assert any(str(config.wiki_dir) in item for item in result["reset"]["would_remove"])


def test_run_sync_rebuild_exports_all_and_skips_empty_writeback(tmp_path: Path, monkeypatch):
    config = _config(tmp_path)
    # seed old local data that should be wiped
    (config.raw_dir / "old.md").write_text("old", encoding="utf-8")
    (config.wiki_dir / "concepts" / "old.md").write_text("old", encoding="utf-8")
    BridgeState(
        last_article_sync_at="2026-01-01T00:00:00Z",
        article_hashes={"old": "x"},
        article_paths={"old": "raw/sources/lumina/old.md"},
    ).save(config.state_path)

    exported_params: dict[str, Any] = {}

    class FakeClient:
        def __init__(self, _config):
            pass

        def export_articles(self, updated_after=None):
            exported_params["updated_after"] = updated_after
            return [
                {
                    "id": "a1",
                    "slug": "demo-article",
                    "title": "Demo",
                    "title_zh": "演示",
                    "content_md": "hello world",
                    "content_md_zh": "你好世界",
                    "updated_at": "2026-07-01T00:00:00Z",
                    "tags": [],
                    "category": {"name": "tech"},
                }
            ]

        def write_compile_results(self, payload):
            raise AssertionError("writeback should be skipped when wiki is empty after rebuild")

    monkeypatch.setattr(sync_mod, "LuminaClient", FakeClient)
    monkeypatch.setattr(
        sync_mod,
        "request_llm_wiki_recompile",
        lambda _config: {"ok": False, "attempted": True, "detail": "no_compile_endpoint"},
    )

    result = sync_mod.run_sync(config, rebuild=True)

    assert result["accepted"] is True
    assert result["rebuild"] is True
    assert result["mode"] == "full"
    assert result["status"] == "awaiting_compile"
    assert result["writeback_skipped"] is True
    assert exported_params["updated_after"] is None
    assert result["exported_articles"] == 1
    assert not (config.raw_dir / "old.md").exists()
    assert list(config.raw_dir.glob("*.md"))
    reloaded = BridgeState.load(config.state_path)
    assert "a1" in reloaded.article_hashes
    assert reloaded.last_article_sync_at == "2026-07-01T00:00:00Z"


def test_reset_clears_review_and_lancedb_residues(tmp_path: Path):
    config = _config(tmp_path)
    runtime = config.project_path / ".llm-wiki"
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "review.json").write_text('[{"id":"old"}]', encoding="utf-8")
    (runtime / "history").mkdir()
    (runtime / "history" / "old.json").write_text("{}", encoding="utf-8")
    lance = runtime / "lancedb" / "wiki_chunks_v2.lance"
    lance.mkdir(parents=True)
    (lance / "data.bin").write_text("stale", encoding="utf-8")
    (config.wiki_dir / "concepts").mkdir(parents=True, exist_ok=True)
    (config.wiki_dir / "concepts" / "old.md").write_text("old", encoding="utf-8")

    sync_mod.reset_local_knowledge_data(config)

    assert (runtime / "review.json").read_text(encoding="utf-8").strip() == "[]"
    assert list((runtime / "history").glob("*")) == []
    assert not (runtime / "lancedb").exists()
    assert not (config.wiki_dir / "concepts" / "old.md").exists()
    assert (config.wiki_dir / "index.md").exists()


def test_schedule_auto_writeback_writes_when_topics_appear(tmp_path: Path, monkeypatch):
    config = _config(tmp_path)
    (config.wiki_dir / "entities").mkdir(parents=True, exist_ok=True)
    BridgeState(
        article_paths={"a1": "raw/sources/lumina/demo.md"},
        article_hashes={"a1": "x"},
    ).save(config.state_path)
    config.raw_dir.mkdir(parents=True, exist_ok=True)
    (config.raw_dir / "demo.md").write_text(
        "---\nlumina_id: a1\nlumina_slug: demo\ntitle: Demo\n---\n\nbody\n",
        encoding="utf-8",
    )

    calls = {"n": 0}

    def fake_writeback(cfg):
        calls["n"] += 1
        return {"accepted": True, "status": "completed", "writeback_topics": 1}

    states = iter(
        [
            {"ready": False, "topic_files": 0, "active": 1, "failed": 0, "queue_size": 1},
            {"ready": True, "topic_files": 1, "active": 0, "failed": 0, "queue_size": 0},
        ]
    )
    monkeypatch.setattr(knowledge_ops_mod, "inspect_llm_wiki_compile", lambda _cfg: next(states))
    monkeypatch.setattr(knowledge_ops_mod, "writeback_topics_from_wiki", fake_writeback)
    knowledge_ops_mod.reset_writeback_job()

    scheduled = sync_mod.schedule_auto_writeback(
        config, run_id="r1", timeout_sec=2, poll_interval_sec=0.05
    )
    assert scheduled["scheduled"] is True
    import time

    for _ in range(50):
        job = knowledge_ops_mod.get_writeback_job()
        if not job.get("active"):
            break
        time.sleep(0.05)
    job = knowledge_ops_mod.get_writeback_job()
    assert job["status"] == "completed"
    assert calls["n"] == 1



def test_incremental_writeback_skips_unchanged_topics(tmp_path: Path, monkeypatch):
    config = _config(tmp_path)
    wiki_concept = config.wiki_dir / "concepts" / "demo-topic.md"
    wiki_concept.write_text(
        "\n".join(
            [
                "---",
                "type: concept",
                "title: Demo Topic",
                "tags: [demo]",
                "related: []",
                'sources: ["lumina/demo-article__a1.md"]',
                "---",
                "",
                "# Demo Topic",
                "",
                "Body stays the same.",
            ]
        ),
        encoding="utf-8",
    )
    raw = config.raw_dir / "demo-article__a1.md"
    raw.write_text(
        "\n".join(
            [
                "---",
                "lumina_id: a1",
                "lumina_slug: demo-article",
                "title: Demo",
                "---",
                "",
                "hello world",
            ]
        ),
        encoding="utf-8",
    )
    BridgeState(
        last_article_sync_at="2026-07-01T00:00:00Z",
        article_hashes={"a1": "seed"},
        article_paths={"a1": "raw/sources/lumina/demo-article__a1.md"},
    ).save(config.state_path)

    writes: list[dict] = []

    class FakeClient:
        def __init__(self, _config):
            pass

        def export_articles(self, updated_after=None):
            return [
                {
                    "id": "a1",
                    "slug": "demo-article",
                    "title": "Demo",
                    "content_md": "hello world",
                    "updated_at": "2026-07-01T00:00:00Z",
                }
            ]

        def write_compile_results(self, payload):
            writes.append(payload)
            return {"ok": True, "upserted_topics": len(payload.get("topics") or [])}

    monkeypatch.setattr(sync_mod, "LuminaClient", FakeClient)

    first = sync_mod.run_sync(config, mode="incremental")
    assert first["accepted"] is True
    assert first["scanned_topics"] == 1
    assert first["writeback_topics"] == 1
    assert first["writeback_topics_unchanged"] == 0
    assert len(writes) == 1
    assert len(writes[0]["topics"]) == 1

    second = sync_mod.run_sync(config, mode="incremental")
    assert second["accepted"] is True
    assert second["scanned_topics"] == 1
    assert second["writeback_topics"] == 0
    assert second["writeback_topics_unchanged"] == 1
    assert second["writeback_articles"] == 0
    assert second.get("writeback_skipped") is True
    assert len(writes) == 1

    # Content change should write again.
    wiki_concept.write_text(
        wiki_concept.read_text(encoding="utf-8") + "\nExtra line.\n",
        encoding="utf-8",
    )
    third = sync_mod.run_sync(config, mode="incremental")
    assert third["writeback_topics"] == 1
    assert third["writeback_topics_unchanged"] == 0
    assert len(writes) == 2
