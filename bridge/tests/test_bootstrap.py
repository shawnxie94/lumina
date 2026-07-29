from __future__ import annotations

from pathlib import Path

from topic_bridge.bootstrap import detect_llm_wiki_app, ensure_project
from topic_bridge.config import BridgeConfig


def _config(tmp_path: Path) -> BridgeConfig:
    return BridgeConfig(
        host="127.0.0.1",
        port=8787,
        bridge_token=None,
        lumina_base_url="http://127.0.0.1:8000/backend",
        lumina_internal_token="dev",
        llm_wiki_api_url="http://127.0.0.1:19828",
        project_path=tmp_path / "Knowledge",
        project_id="test-project",
        project_name="Knowledge",
        raw_subdir="raw/sources/lumina",
        state_path=tmp_path / "state.json",
    )


def test_ensure_project_creates_skeleton(tmp_path: Path):
    cfg = _config(tmp_path)
    result = ensure_project(cfg)
    root = cfg.project_path
    assert result["ok"] is True
    assert (root / "wiki" / "concepts").is_dir()
    assert (root / "raw" / "sources" / "lumina").is_dir()
    assert (root / "purpose.md").is_file()
    assert (root / "schema.md").is_file()
    assert (root / "wiki" / "index.md").is_file()
    again = ensure_project(cfg)
    assert again["ok"] is True


def test_detect_llm_wiki_app_shape():
    info = detect_llm_wiki_app()
    assert "installed" in info
    assert "install_url" in info
    assert isinstance(info.get("app_paths"), list)
