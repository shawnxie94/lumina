from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class BridgeConfig:
    host: str
    port: int
    bridge_token: str | None
    lumina_base_url: str
    lumina_internal_token: str
    llm_wiki_api_url: str
    project_path: Path
    project_id: str
    project_name: str
    raw_subdir: str
    state_path: Path

    @property
    def raw_dir(self) -> Path:
        return self.project_path / self.raw_subdir

    @property
    def wiki_dir(self) -> Path:
        return self.project_path / "wiki"


def load_config() -> BridgeConfig:
    root = Path(__file__).resolve().parents[1]
    _load_dotenv(root / ".env")
    project_path = Path(
        os.environ.get(
            "LLM_WIKI_PROJECT_PATH",
            str(Path.home() / ".lumina" / "knowledge" / "Lumina-Knowledge"),
        )
    ).expanduser()
    state_env = os.environ.get("STATE_PATH", ".bridge/state.json")
    state_path = Path(state_env)
    if not state_path.is_absolute():
        state_path = (root / state_path).resolve()
    token = (os.environ.get("BRIDGE_TOKEN") or "").strip() or None
    return BridgeConfig(
        host=os.environ.get("BRIDGE_HOST", "127.0.0.1"),
        port=int(os.environ.get("BRIDGE_PORT", "8787")),
        bridge_token=token,
        lumina_base_url=os.environ.get(
            "LUMINA_BASE_URL", "http://127.0.0.1:8000/backend"
        ).rstrip("/"),
        lumina_internal_token=os.environ.get(
            "LUMINA_INTERNAL_TOKEN", "dev-internal-token-change-me"
        ),
        llm_wiki_api_url=os.environ.get(
            "LLM_WIKI_API_URL", "http://127.0.0.1:19828"
        ).rstrip("/"),
        project_path=project_path,
        project_id=os.environ.get(
            "LLM_WIKI_PROJECT_ID", "72f8b995-45ed-4972-bb89-a2172a6c136b"
        ),
        project_name=os.environ.get("LLM_WIKI_PROJECT_NAME", project_path.name),
        raw_subdir=os.environ.get("RAW_SUBDIR", "raw/sources/lumina"),
        state_path=state_path,
    )
