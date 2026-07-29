from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import AppConfig, Profile, Project, ProviderConfig
from ..errors import CliError
from .base import ProviderInfo


class GenericFsProvider:
    """Filesystem-oriented knowledge provider skeleton.

    P0/P1 skeleton only:
    - manages a local markdown/wiki-like directory layout
    - does not implement full compile/sync semantics
    - proves provider plug-in surface without hardcoding llm_wiki
    """

    info = ProviderInfo(
        name="generic_fs",
        title="Generic Filesystem",
        description="Skeleton provider for local markdown/wiki folders (no external app)",
        homepage="",
        install_url="",
    )

    def status(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        path = Path(project.path).expanduser()
        layout = self._layout_status(path)
        return {
            "provider": self.info.name,
            "title": self.info.title,
            "enabled": provider_cfg.enabled,
            "online": layout["ok"],  # no daemon; directory readiness is the "online" signal
            "api_url": None,
            "install": {"installed": True, "kind": "builtin", "path": None},
            "project": {
                "path": str(path),
                "exists": path.exists(),
                "name": project.name,
                "layout": layout,
            },
            "capabilities": {
                "compile": False,
                "daemon": False,
                "sync_via_bridge": False,
                "notes": "Skeleton only. Bridge sync still targets llm_wiki-compatible projects in current phase.",
            },
        }

    def doctor(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        st = self.status(cfg, profile, project, provider_cfg)
        layout = st["project"]["layout"]
        checks = [
            {"name": "provider_enabled", "ok": bool(provider_cfg.enabled)},
            {"name": "project_path_exists", "ok": bool(st["project"]["exists"]), "detail": st["project"]["path"]},
            {"name": "layout_ready", "ok": bool(layout.get("ok")), "detail": layout},
        ]
        ok = all(c["ok"] for c in checks)
        hint = None
        if not st["project"]["exists"] or not layout.get("ok"):
            hint = "Run `lumina knowledge init` then `lumina knowledge use generic_fs`"
        return {"ok": ok, "checks": checks, "status": st, "hint": hint}

    def install_guidance(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        return {
            "provider": self.info.name,
            "title": self.info.title,
            "install_url": "",
            "notes": [
                "generic_fs is built into Lumina CLI; no desktop app install required.",
                "It only scaffolds a local folder layout in this phase.",
                "Full compile/writeback still requires a compile-capable provider (e.g. llm_wiki).",
            ],
            "commands": {
                "use": "lumina knowledge use generic_fs",
                "init": "lumina knowledge init",
                "doctor": "lumina knowledge doctor",
            },
            "detect": {"installed": True, "kind": "builtin"},
        }

    def start(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        # no daemon
        st = self.status(cfg, profile, project, provider_cfg)
        return {
            "ok": True,
            "supported": False,
            "already_running": True,
            "message": "generic_fs has no background service; directory readiness is enough.",
            "status": st,
        }

    def stop(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        return {
            "ok": True,
            "supported": False,
            "message": "generic_fs has no background service to stop.",
            "status": self.status(cfg, profile, project, provider_cfg),
        }

    def init_project(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig, path: str | None = None) -> dict[str, Any]:
        target = Path(path or project.path).expanduser()
        created: list[str] = []
        for sub in [
            target,
            target / "raw" / "sources" / "lumina",
            target / "wiki" / "entities",
            target / "wiki" / "concepts",
            target / "wiki" / "sources",
            target / "notes",
            target / ".bridge",
        ]:
            if not sub.exists():
                sub.mkdir(parents=True, exist_ok=True)
                created.append(str(sub))
        readme = target / "README.md"
        if not readme.exists():
            readme.write_text(
                "\n".join(
                    [
                        f"# {project.name}",
                        "",
                        "Managed by Lumina CLI provider `generic_fs`.",
                        "",
                        "This is a filesystem skeleton. Drop markdown notes under `notes/` or `wiki/`.",
                        "Compile/sync writeback still needs a compile-capable provider in later phases.",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            created.append(str(readme))
        marker = target / ".lumina-provider"
        marker.write_text("generic_fs\n", encoding="utf-8")
        return {"ok": True, "path": str(target), "created": created, "provider": self.info.name}

    def _layout_status(self, root: Path) -> dict[str, Any]:
        required = [
            root,
            root / "raw" / "sources" / "lumina",
            root / "wiki",
        ]
        missing = [str(p) for p in required if not p.exists()]
        return {
            "ok": root.exists() and not missing,
            "missing": missing,
            "has_notes": (root / "notes").exists(),
            "has_provider_marker": (root / ".lumina-provider").exists(),
        }
