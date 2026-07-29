from __future__ import annotations

from pathlib import Path

from topic_bridge import config as config_mod


def test_load_config_prefers_cli_yaml_over_legacy_env(tmp_path: Path, monkeypatch):
    home = tmp_path / "home"
    cfg_path = home / "config.yaml"
    cfg_path.parent.mkdir(parents=True)
    cfg_path.write_text(
        """
active_profile: default
active_project: main
profiles:
  default:
    lumina:
      base_url: https://prod.example/backend
      token: prod-token-value
    bridge:
      host: 127.0.0.1
      port: 8787
      token: ''
projects:
  main:
    provider: llm_wiki
    path: {project}
    name: Demo
providers:
  llm_wiki:
    enabled: true
    options:
      api_url: http://127.0.0.1:19828
""".format(project=str(tmp_path / "Knowledge")),
        encoding="utf-8",
    )

    bridge_root = tmp_path / "topic-bridge"
    (bridge_root / "topic_bridge").mkdir(parents=True)
    # Fake package location used by _bridge_root()
    monkeypatch.setattr(config_mod, "_bridge_root", lambda: bridge_root)
    monkeypatch.setattr(config_mod, "DEFAULT_CLI_CONFIG", cfg_path)
    monkeypatch.setenv("LUMINA_CONFIG", str(cfg_path))

    # Legacy env file should NOT win over CLI yaml.
    (bridge_root / ".env").write_text(
        "\n".join(
            [
                "LUMINA_BASE_URL=http://127.0.0.1:8000/backend",
                "LUMINA_INTERNAL_TOKEN=dev-internal-token-change-me",
                "LLM_WIKI_PROJECT_PATH=/tmp/old",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    # Clear process overrides
    for key in [
        "LUMINA_BASE_URL",
        "LUMINA_INTERNAL_TOKEN",
        "LLM_WIKI_PROJECT_PATH",
        "LLM_WIKI_API_URL",
        "BRIDGE_HOST",
        "BRIDGE_PORT",
        "BRIDGE_TOKEN",
    ]:
        monkeypatch.delenv(key, raising=False)

    config_mod.clear_config_cache()
    cfg = config_mod.load_config(force_reload=True)
    assert cfg.config_source == "cli_config"
    assert cfg.lumina_base_url == "https://prod.example/backend"
    assert cfg.lumina_internal_token == "prod-token-value"
    assert cfg.project_name == "Demo"
    assert cfg.project_path == tmp_path / "Knowledge"

    # Hot reload when yaml changes
    text = cfg_path.read_text(encoding="utf-8")
    cfg_path.write_text(
        text.replace("https://prod.example/backend", "https://prod-2.example/backend").replace(
            "prod-token-value", "prod-token-2"
        ),
        encoding="utf-8",
    )
    cfg2 = config_mod.load_config()
    assert cfg2.lumina_base_url == "https://prod-2.example/backend"
    assert cfg2.lumina_internal_token == "prod-token-2"


def test_process_env_does_not_override_cli_yaml_by_default(tmp_path: Path, monkeypatch):
    cfg_path = tmp_path / "config.yaml"
    cfg_path.write_text(
        """
active_profile: default
active_project: main
profiles:
  default:
    lumina:
      base_url: https://prod.example/backend
      token: prod-token
    bridge:
      host: 127.0.0.1
      port: 8787
projects:
  main:
    provider: llm_wiki
    path: /tmp/knowledge
    name: Demo
""",
        encoding="utf-8",
    )
    bridge_root = tmp_path / "topic-bridge"
    (bridge_root / "topic_bridge").mkdir(parents=True)
    monkeypatch.setattr(config_mod, "_bridge_root", lambda: bridge_root)
    monkeypatch.setenv("LUMINA_CONFIG", str(cfg_path))
    monkeypatch.setenv("LUMINA_BASE_URL", "http://override.example/backend")
    monkeypatch.setenv("LUMINA_INTERNAL_TOKEN", "override-token")
    monkeypatch.delenv("LUMINA_BRIDGE_ENV_OVERRIDE", raising=False)
    config_mod.clear_config_cache()
    cfg = config_mod.load_config(force_reload=True)
    assert cfg.lumina_base_url == "https://prod.example/backend"
    assert cfg.lumina_internal_token == "prod-token"


def test_process_env_override_flag_wins(tmp_path: Path, monkeypatch):
    cfg_path = tmp_path / "config.yaml"
    cfg_path.write_text(
        """
active_profile: default
active_project: main
profiles:
  default:
    lumina:
      base_url: https://prod.example/backend
      token: prod-token
    bridge:
      host: 127.0.0.1
      port: 8787
projects:
  main:
    provider: llm_wiki
    path: /tmp/knowledge
    name: Demo
""",
        encoding="utf-8",
    )
    bridge_root = tmp_path / "topic-bridge"
    (bridge_root / "topic_bridge").mkdir(parents=True)
    monkeypatch.setattr(config_mod, "_bridge_root", lambda: bridge_root)
    monkeypatch.setenv("LUMINA_CONFIG", str(cfg_path))
    monkeypatch.setenv("LUMINA_BRIDGE_ENV_OVERRIDE", "1")
    monkeypatch.setenv("LUMINA_BASE_URL", "http://override.example/backend")
    monkeypatch.setenv("LUMINA_INTERNAL_TOKEN", "override-token")
    config_mod.clear_config_cache()
    cfg = config_mod.load_config(force_reload=True)
    assert cfg.lumina_base_url == "http://override.example/backend"
    assert cfg.lumina_internal_token == "override-token"
