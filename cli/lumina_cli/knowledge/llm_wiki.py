from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from ..config import AppConfig, Profile, Project, ProviderConfig
from ..errors import DependencyError
from .base import ProviderInfo


class LlmWikiProvider:
    info = ProviderInfo(
        name="llm_wiki",
        title="LLM Wiki",
        description="Local knowledge compile engine (first provider adapter)",
        homepage="https://github.com/nashsu/llm_wiki",
        install_url="https://github.com/nashsu/llm_wiki/releases/latest",
    )

    def _api_url(self, provider_cfg: ProviderConfig) -> str:
        return str(provider_cfg.options.get("api_url") or "http://127.0.0.1:19828").rstrip("/")

    def _probe(self, api_url: str) -> dict[str, Any]:
        url = api_url.rstrip("/") + "/health"
        try:
            with urlopen(url, timeout=2.5) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(raw)
                except Exception:
                    data = {"raw": raw}
                return {"ok": True, "online": True, "url": url, "data": data}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "online": False, "url": url, "error": str(exc)}

    def _detect_app(self) -> dict[str, Any]:
        candidates = [
            Path("/Applications/LLM Wiki.app"),
            Path.home() / "Applications" / "LLM Wiki.app",
        ]
        for path in candidates:
            if path.exists():
                return {"installed": True, "path": str(path), "kind": "app"}
        which = subprocess.run(["bash", "-lc", "command -v llm-wiki || true"], capture_output=True, text=True)
        binary = (which.stdout or "").strip()
        if binary:
            return {"installed": True, "path": binary, "kind": "cli"}
        return {"installed": False, "path": None, "kind": None}

    def status(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        api_url = self._api_url(provider_cfg)
        health = self._probe(api_url)
        app = self._detect_app()
        path = Path(project.path).expanduser()
        return {
            "provider": self.info.name,
            "title": self.info.title,
            "enabled": provider_cfg.enabled,
            "api_url": api_url,
            "online": bool(health.get("online")),
            "health": health,
            "install": app,
            "project": {
                "path": str(path),
                "exists": path.exists(),
                "name": project.name,
            },
        }

    def doctor(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        st = self.status(cfg, profile, project, provider_cfg)
        checks = [
            {"name": "provider_enabled", "ok": bool(provider_cfg.enabled)},
            {"name": "provider_installed_or_online", "ok": bool(st["install"]["installed"] or st["online"]), "detail": st["install"]},
            {"name": "provider_online", "ok": bool(st["online"]), "detail": st["health"]},
            {"name": "project_path_exists", "ok": bool(st["project"]["exists"]), "detail": st["project"]["path"]},
        ]
        ok = all(c["ok"] for c in checks[:2])  # installed/enabled matter more than currently online
        hint = None
        if not st["install"]["installed"] and not st["online"]:
            hint = f"Install from {self.info.install_url}"
        elif not st["online"]:
            hint = "Run `lumina knowledge start` or open LLM Wiki app"
        elif not st["project"]["exists"]:
            hint = "Run `lumina knowledge init`"
        return {"ok": ok and st["project"]["exists"], "checks": checks, "status": st, "hint": hint}

    def install_guidance(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        return {
            "provider": self.info.name,
            "title": self.info.title,
            "install_url": self.info.install_url,
            "homepage": self.info.homepage,
            "notes": [
                "LLM Wiki is a desktop app; browser/CLI cannot silently install it.",
                "After install, run `lumina knowledge start` then `lumina knowledge doctor`.",
            ],
            "commands": {
                "open_releases": f"open '{self.info.install_url}'",
                "doctor": "lumina knowledge doctor",
                "start": "lumina knowledge start",
            },
            "detect": self._detect_app(),
        }

    def start(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        st = self.status(cfg, profile, project, provider_cfg)
        if st["online"]:
            return {"ok": True, "already_running": True, "status": st}
        app = st["install"]
        if app.get("kind") == "app" and app.get("path"):
            subprocess.run(["open", "-a", app["path"]], check=False)
            return {"ok": True, "launched": app["path"], "status": self.status(cfg, profile, project, provider_cfg)}
        if app.get("kind") == "cli" and app.get("path"):
            subprocess.Popen([app["path"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return {"ok": True, "launched": app["path"], "status": self.status(cfg, profile, project, provider_cfg)}
        raise DependencyError(
            "LLM Wiki is not installed",
            hint=f"Download: {self.info.install_url}",
        )

    def stop(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig) -> dict[str, Any]:
        # Desktop app stop is best-effort / manual in P0.
        return {
            "ok": True,
            "supported": False,
            "message": "P0 does not force-quit desktop LLM Wiki; close the app manually if needed.",
            "status": self.status(cfg, profile, project, provider_cfg),
        }

    def init_project(self, cfg: AppConfig, profile: Profile, project: Project, provider_cfg: ProviderConfig, path: str | None = None) -> dict[str, Any]:
        target = Path(path or project.path).expanduser()
        for sub in [
            target,
            target / "raw" / "sources" / "lumina",
            target / "wiki",
            target / ".bridge",
        ]:
            sub.mkdir(parents=True, exist_ok=True)
        readme = target / "README.md"
        if not readme.exists():
            readme.write_text(
                f"# {project.name}\n\nManaged by Lumina CLI knowledge provider `{self.info.name}`.\n",
                encoding="utf-8",
            )
        return {"ok": True, "path": str(target), "created": True}
