from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lumina_cli.app import build_parser, main
from lumina_cli.config import ensure_config, get_by_path, load_config, save_config, set_by_path, validate_config


class ConfigTests(unittest.TestCase):
    def test_ensure_and_set(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "config.yaml"
            cfg, saved, created = ensure_config(path)
            self.assertTrue(created)
            self.assertTrue(saved.exists())
            set_by_path(cfg, "lumina.base_url", "http://example.com/backend")
            set_by_path(cfg, "lumina.token", "secret-token-value")
            set_by_path(cfg, "project.provider", "llm_wiki")
            save_config(cfg, path)
            loaded = load_config(path)
            self.assertEqual(get_by_path(loaded, "lumina.base_url"), "http://example.com/backend")
            self.assertIn("***", get_by_path(loaded, "lumina.token"))
            self.assertEqual(get_by_path(loaded, "lumina.token", reveal=True), "secret-token-value")
            self.assertEqual(validate_config(loaded), [])


class ParserTests(unittest.TestCase):
    def test_parser_has_p0_commands(self):
        parser = build_parser()
        # ensure critical commands exist by parsing help paths
        for argv in [
            ["version"],
            ["init", "--non-interactive"],
            ["profile", "list"],
            ["config", "path"],
            ["auth", "status"],
            ["bridge", "status"],
            ["bridge", "start"],
            ["bridge", "start", "--no-service"],
            ["bridge", "stop"],
            ["bridge", "stop", "--disable-service"],
            ["bridge", "restart"],
            ["knowledge", "providers"],
            ["knowledge", "audit"],
            ["knowledge", "repair", "--restore-history", "--dry-run"],
            ["knowledge", "retry-truncated", "--dry-run"],
            ["knowledge", "reingest", "--source", "lumina/demo.md", "--dry-run"],
            ["knowledge", "sanitize-source", "--dry-run"],
            ["sync", "status"],
            ["sync", "full", "--rebuild", "--yes", "--dry-run"],
            ["sync", "full", "--local-only"],
            ["doctor"],
            ["articles", "list"],
            ["topics", "list"],
            ["api", "get", "/api/topics"],
            ["completion", "zsh"],
            ["knowledge", "provider", "show", "generic_fs"],
        ]:
            args = parser.parse_args(argv)
            self.assertTrue(hasattr(args, "func"))


if __name__ == "__main__":
    unittest.main()
