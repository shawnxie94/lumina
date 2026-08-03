from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from lumina_cli.knowledge_repair import (
    force_reingest_sources,
    quarantine_review_anomalies,
    restore_history_pages,
    retry_missing_truncations,
    sanitize_source_model_leaks,
)


class KnowledgeRepairTests(unittest.TestCase):
    def test_restore_history_is_dry_run_then_backed_up_and_atomic(self):
        with tempfile.TemporaryDirectory() as td:
            project = Path(td)
            page = project / "wiki" / "concepts" / "broken.md"
            page.parent.mkdir(parents=True)
            page.write_text("<think>model planning leaked</think>\n", encoding="utf-8")
            history = project / ".llm-wiki" / "history"
            history.mkdir(parents=True)
            valid = (
                "---\n"
                "type: concept\n"
                "title: Recovered\n"
                "tags: []\n"
                "sources: [lumina/demo.md]\n"
                "---\n\n"
                "# Recovered\n\nA stable local page.\n"
            )
            (history / "snapshot.json").write_text(
                json.dumps(
                    [
                        {
                            "id": "record-1",
                            "path": str(page),
                            "timestamp": 2,
                            "author": "human",
                            "tool": "ui.write_file",
                            "content": valid,
                        }
                    ]
                ),
                encoding="utf-8",
            )

            planned = restore_history_pages(project, dry_run=True)
            self.assertTrue(planned["ok"])
            self.assertEqual(planned["restored_count"], 0)
            self.assertEqual(page.read_text(encoding="utf-8"), "<think>model planning leaked</think>\n")

            result = restore_history_pages(project)
            self.assertTrue(result["ok"])
            self.assertEqual(result["restored_count"], 1)
            self.assertEqual(page.read_text(encoding="utf-8"), valid)
            backup = Path(result["backup_root"]) / "wiki" / "concepts" / "broken.md"
            self.assertEqual(backup.read_text(encoding="utf-8"), "<think>model planning leaked</think>\n")
            self.assertFalse((project / ".llm-wiki" / "history" / "snapshot.json").stat().st_size == 0)

    def test_retry_truncated_dry_run_only_lists_missing_targets(self):
        with tempfile.TemporaryDirectory() as td:
            project = Path(td)
            raw = project / "raw" / "sources" / "lumina" / "demo.md"
            raw.parent.mkdir(parents=True)
            raw.write_text("# Demo\n\nSource body.\n", encoding="utf-8")
            runtime = project / ".llm-wiki"
            runtime.mkdir(parents=True)
            (runtime / "ingest-warnings.log").write_text(
                "## 2026-07-31T00:00:00Z | lumina/demo.md\n\n"
                "1. FILE block \"wiki/concepts/missing.md\" was not closed before end of stream\n",
                encoding="utf-8",
            )

            before = raw.read_bytes()
            result = retry_missing_truncations(project, dry_run=True)

            self.assertTrue(result["ok"])
            self.assertEqual(result["target_count"], 1)
            self.assertEqual(result["targets"][0]["target"], "wiki/concepts/missing.md")
            self.assertEqual(raw.read_bytes(), before)

    def test_force_reingest_invalidates_only_selected_runtime_entries(self):
        with tempfile.TemporaryDirectory() as td:
            project = Path(td)
            raw = project / "raw" / "sources" / "lumina" / "demo.md"
            other = project / "raw" / "sources" / "lumina" / "other.md"
            raw.parent.mkdir(parents=True)
            raw.write_text("# Demo\n", encoding="utf-8")
            other.write_text("# Other\n", encoding="utf-8")
            runtime = project / ".llm-wiki"
            runtime.mkdir(parents=True)
            (runtime / "file-snapshot.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "files": {
                            "raw/sources/lumina/demo.md": {"hash": "demo"},
                            "raw/sources/lumina/other.md": {"hash": "other"},
                        },
                    }
                ),
                encoding="utf-8",
            )
            (runtime / "ingest-cache.json").write_text(
                json.dumps(
                    {
                        "entries": {
                            "lumina/demo.md": {"hash": "demo"},
                            "lumina/other.md": {"hash": "other"},
                        }
                    }
                ),
                encoding="utf-8",
            )
            (runtime / "ingest-queue.json").write_text("[]", encoding="utf-8")

            class Response:
                status = 200

                def __enter__(self):
                    return self

                def __exit__(self, *_args):
                    return False

                def read(self):
                    return b'{"ok": true, "result": {"changedTasks": ["demo"]}}'

            with patch("lumina_cli.knowledge_repair.urllib.request.urlopen", return_value=Response()):
                result = force_reingest_sources(project, ["lumina/demo.md"], api_url="http://local")

            self.assertTrue(result["ok"])
            self.assertEqual(result["invalidated_snapshot_entries"], 1)
            self.assertEqual(result["invalidated_cache_entries"], 1)
            snapshot = json.loads((runtime / "file-snapshot.json").read_text(encoding="utf-8"))
            cache = json.loads((runtime / "ingest-cache.json").read_text(encoding="utf-8"))
            self.assertNotIn("raw/sources/lumina/demo.md", snapshot["files"])
            self.assertIn("raw/sources/lumina/other.md", snapshot["files"])
            self.assertNotIn("lumina/demo.md", cache["entries"])
            self.assertIn("lumina/other.md", cache["entries"])
            self.assertTrue(result["backups"])

    def test_force_reingest_dry_run_does_not_touch_runtime_metadata(self):
        with tempfile.TemporaryDirectory() as td:
            project = Path(td)
            raw = project / "raw" / "sources" / "lumina" / "demo.md"
            raw.parent.mkdir(parents=True)
            raw.write_text("# Demo\n", encoding="utf-8")
            runtime = project / ".llm-wiki"
            runtime.mkdir(parents=True)
            snapshot = runtime / "file-snapshot.json"
            snapshot.write_text('{"files": {"raw/sources/lumina/demo.md": {}}}', encoding="utf-8")
            cache = runtime / "ingest-cache.json"
            cache.write_text('{"entries": {"lumina/demo.md": {}}}', encoding="utf-8")

            result = force_reingest_sources(project, ["lumina/demo.md"], dry_run=True)

            self.assertTrue(result["ok"])
            self.assertEqual(result["status"], "dry_run")
            self.assertEqual(snapshot.read_text(encoding="utf-8"), '{"files": {"raw/sources/lumina/demo.md": {}}}')
            self.assertEqual(cache.read_text(encoding="utf-8"), '{"entries": {"lumina/demo.md": {}}}')

    def test_sanitize_source_leak_is_scoped_and_backed_up(self):
        with tempfile.TemporaryDirectory() as td:
            project = Path(td)
            source = project / "wiki" / "sources" / "demo.md"
            source.parent.mkdir(parents=True)
            original = "---\ntype: source\n---\n\n<think>plan this source</think>\n\n# Final\n\nBody.\n"
            source.write_text(original, encoding="utf-8")
            unrelated = project / "wiki" / "entities" / "keep.md"
            unrelated.parent.mkdir(parents=True)
            unrelated.write_text("<think>keep unrelated</think>\n", encoding="utf-8")

            planned = sanitize_source_model_leaks(project, dry_run=True)
            self.assertTrue(planned["ok"])
            self.assertEqual(planned["target_count"], 1)
            self.assertEqual(source.read_text(encoding="utf-8"), original)

            result = sanitize_source_model_leaks(project)
            self.assertTrue(result["ok"])
            self.assertEqual(result["sanitized_count"], 1)
            self.assertNotIn("<think>", source.read_text(encoding="utf-8"))
            self.assertIn("# Final", source.read_text(encoding="utf-8"))
            self.assertEqual(unrelated.read_text(encoding="utf-8"), "<think>keep unrelated</think>\n")
            backup = Path(result["backup_root"]) / "wiki" / "sources" / "demo.md"
            self.assertEqual(backup.read_text(encoding="utf-8"), original)

    def test_quarantine_review_anomalies_preserves_records_without_resolving_them(self):
        with tempfile.TemporaryDirectory() as td:
            project = Path(td)
            runtime = project / ".llm-wiki"
            runtime.mkdir(parents=True)
            valid = {"id": "keep", "type": "suggestion", "resolved": False}
            anomalous = {
                "id": "bad",
                "type": "confirm",
                "title": "Title",
                "description": "description",
                "affectedPages": ["wiki/page1.md"],
                "resolved": False,
            }
            review_path = runtime / "review.json"
            review_path.write_text(json.dumps([valid, anomalous]), encoding="utf-8")

            planned = quarantine_review_anomalies(project, dry_run=True)
            self.assertTrue(planned["ok"])
            self.assertEqual(planned["target_count"], 1)
            self.assertEqual(json.loads(review_path.read_text(encoding="utf-8")), [valid, anomalous])

            result = quarantine_review_anomalies(project)
            self.assertTrue(result["ok"])
            self.assertEqual(result["quarantined_count"], 1)
            self.assertEqual(json.loads(review_path.read_text(encoding="utf-8")), [valid])
            quarantine = json.loads(Path(result["quarantine_path"]).read_text(encoding="utf-8"))
            self.assertEqual(quarantine["records"][0]["record"], anomalous)
            self.assertFalse(quarantine["records"][0]["record"]["resolved"])
            backup = json.loads(Path(result["backup_path"]).read_text(encoding="utf-8"))
            self.assertEqual(backup, [valid, anomalous])


if __name__ == "__main__":
    unittest.main()
