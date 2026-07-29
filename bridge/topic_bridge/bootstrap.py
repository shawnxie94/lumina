from __future__ import annotations

import json
import platform
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any

from .config import BridgeConfig
from .state import utc_now_iso
from .sync import check_llm_wiki, project_status

LLM_WIKI_RELEASES_URL = "https://github.com/nashsu/llm_wiki/releases/latest"
LLM_WIKI_REPO_URL = "https://github.com/nashsu/llm_wiki"
DEFAULT_MAC_APP_PATHS = (
    Path("/Applications/LLM Wiki.app"),
    Path.home() / "Applications" / "LLM Wiki.app",
)

PURPOSE_MD = """# Project Purpose

## Goal

把 Lumina 中沉淀的内容，编译成可复利的个人知识库；桌面端负责知识编译，Lumina 继续作为 web 展示与内容工作区。

## Key Questions

1. 哪些主题值得从单篇文章升级成持续维护的知识页？
2. 如何用尽量轻的流程完成：留存 → 解读沉淀 → 关联聚合 → 检索？
3. 哪些编译结果适合写回 Lumina 展示，哪些应只留在桌面端？

## Scope

**In scope:**
- 从文章/资料中提取主题、实体、主张
- 维护交叉引用与主题综合
- 为后续 Lumina 写回准备结构化结果

**Out of scope:**
- 在本项目内重建完整 Lumina 产品能力
- 把桌面端做成公开发布站

## Thesis

> 知识应先编译、后检索；Lumina 负责展示与运营，LLM Wiki 负责编译与维护。
"""

SCHEMA_MD = """# Wiki Schema

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | wiki/entities/ | Named things (models, companies, people, datasets) |
| concept | wiki/concepts/ | Ideas, techniques, phenomena |
| source | wiki/sources/ | Papers, articles, talks, blog posts |
| query | wiki/queries/ | Open questions under investigation |
| comparison | wiki/comparisons/ | Side-by-side analysis of related entities |
| synthesis | wiki/synthesis/ | Cross-cutting summaries and conclusions |

## Naming Conventions

- Files: `kebab-case.md`
- Entities: match official name where possible
- Concepts: descriptive noun phrases
- Sources: `author-year-slug.md`
- Queries: question as slug

## Frontmatter

All pages must include YAML frontmatter:

```yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
title: Human-readable title
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```
"""

WIKI_INDEX_MD = """---
type: overview
title: Index
tags: []
related: []
---

# Index

Lumina knowledge project initialized by topic bridge bootstrap.
"""


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def _which(name: str) -> str | None:
    return shutil.which(name)


def detect_llm_wiki_app() -> dict[str, Any]:
    system = platform.system().lower()
    found: list[str] = []
    if system == "darwin":
        for candidate in DEFAULT_MAC_APP_PATHS:
            if candidate.exists():
                found.append(str(candidate))
        # mdfind can be slow/flaky; only use as fallback when default paths miss.
        if not found and _which("mdfind"):
            try:
                proc = subprocess.run(
                    ["mdfind", 'kMDItemCFBundleIdentifier == "com.llmwiki.app"'],
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=2,
                )
                for line in (proc.stdout or "").splitlines():
                    line = line.strip()
                    if line and line not in found and Path(line).exists():
                        found.append(line)
            except Exception:
                pass
    cli = _which("llm-wiki") or _which("llm_wiki")
    return {
        "platform": system,
        "app_paths": found,
        "cli_path": cli,
        "installed": bool(found or cli),
        "install_url": LLM_WIKI_RELEASES_URL,
        "docs_url": LLM_WIKI_REPO_URL,
    }


def probe_llm_wiki_health(api_url: str, timeout: float = 2.5) -> dict[str, Any]:
    url = api_url.rstrip("/") + "/health"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body) if body else {}
            return {
                "ok": bool(data.get("ok", True)),
                "status": data.get("status") or "online",
                "detail": None,
                "version": data.get("version"),
                "checked_at": utc_now_iso(),
            }
    except Exception as exc:
        return {
            "ok": False,
            "status": "offline",
            "detail": str(exc),
            "version": None,
            "checked_at": utc_now_iso(),
        }


def local_setup_report(config: BridgeConfig) -> dict[str, Any]:
    llm_app = detect_llm_wiki_app()
    llm_health = check_llm_wiki(config)
    project = project_status(config)
    python_ok = sys.version_info >= (3, 9)
    actions: list[dict[str, str]] = []
    if not llm_app["installed"]:
        actions.append(
            {
                "id": "install_llm_wiki",
                "title": "Install LLM Wiki",
                "detail": "Download the desktop app from GitHub Releases, then reopen this page.",
            }
        )
    elif not llm_health.get("ok"):
        actions.append(
            {
                "id": "start_llm_wiki",
                "title": "Start LLM Wiki",
                "detail": "LLM Wiki is installed but its local API is offline.",
            }
        )

    if not project.get("ok"):
        actions.append(
            {
                "id": "init_project",
                "title": "Initialize knowledge project",
                "detail": f"Create wiki skeleton under {config.project_path}",
            }
        )

    # Guidance commands must be portable (no machine-local absolute paths).
    install_cmd = (
        "curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-lumina-cli.sh | bash"
    )
    commands = {
        "install": install_cmd,
        "start_bridge": "lumina bridge start",
        "init_project": "lumina knowledge init",
        "start_llm_wiki": "lumina knowledge start",
        "setup": "lumina up --install",
        "status": "lumina status",
        "sync": "lumina sync",
        "doctor": "lumina doctor",
    }

    return {
        "ok": True,
        "checked_at": utc_now_iso(),
        "bridge": {
            "ok": True,
            "status": "online",
            "host": config.host,
            "port": config.port,
            "python": platform.python_version(),
            "python_ok": python_ok,
        },
        "llm_wiki": {
            **llm_health,
            "install": llm_app,
        },
        "project": project,
        "actions": actions,
        "commands": commands,
        "notes": [
            "Install one local entrypoint: Lumina CLI (`~/.lumina/bin/lumina`).",
            "CLI manages Bridge + knowledge providers; no full repo clone required.",
            "Browser pages cannot silently install desktop software.",
            "LLM Wiki desktop app still needs official install once.",
        ],
    }


def ensure_project(config: BridgeConfig, project_path: str | None = None) -> dict[str, Any]:
    root = Path(project_path).expanduser() if project_path else config.project_path
    root = root.resolve()
    created: list[str] = []

    def ensure_dir(path: Path) -> None:
        if not path.exists():
            path.mkdir(parents=True, exist_ok=True)
            created.append(str(path))

    ensure_dir(root)
    ensure_dir(root / "wiki")
    for sub in ("entities", "concepts", "sources", "queries", "comparisons", "synthesis"):
        ensure_dir(root / "wiki" / sub)
    ensure_dir(root / "raw" / "sources" / "lumina")
    ensure_dir(root / ".llm-wiki")

    purpose = root / "purpose.md"
    if not purpose.exists():
        purpose.write_text(PURPOSE_MD, encoding="utf-8")
        created.append(str(purpose))
    schema = root / "schema.md"
    if not schema.exists():
        schema.write_text(SCHEMA_MD, encoding="utf-8")
        created.append(str(schema))
    index = root / "wiki" / "index.md"
    if not index.exists():
        index.write_text(WIKI_INDEX_MD, encoding="utf-8")
        created.append(str(index))

    status = {
        "ok": root.exists() and (root / "wiki").exists(),
        "id": config.project_id,
        "name": root.name or config.project_name,
        "path": str(root),
        "created": created,
    }
    return {
        "ok": True,
        "action": "init_project",
        "project": status,
        "checked_at": utc_now_iso(),
    }


def start_llm_wiki(config: BridgeConfig) -> dict[str, Any]:
    health = check_llm_wiki(config)
    if health.get("ok"):
        return {
            "ok": True,
            "action": "start_llm_wiki",
            "already_running": True,
            "llm_wiki": health,
            "checked_at": utc_now_iso(),
        }

    install = detect_llm_wiki_app()
    launched = False
    detail = None
    system = platform.system().lower()

    try:
        if system == "darwin" and install["app_paths"]:
            app = install["app_paths"][0]
            proc = _run(["open", "-a", app])
            launched = proc.returncode == 0
            detail = (proc.stderr or proc.stdout or "").strip() or None
        elif install["cli_path"]:
            subprocess.Popen(
                [install["cli_path"]],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            launched = True
        else:
            return {
                "ok": False,
                "action": "start_llm_wiki",
                "error": "llm_wiki_not_installed",
                "install": install,
                "checked_at": utc_now_iso(),
            }
    except Exception as exc:
        return {
            "ok": False,
            "action": "start_llm_wiki",
            "error": str(exc),
            "install": install,
            "checked_at": utc_now_iso(),
        }

    health = probe_llm_wiki_health(config.llm_wiki_api_url, timeout=1.5)
    return {
        "ok": bool(launched),
        "action": "start_llm_wiki",
        "launched": launched,
        "detail": detail,
        "llm_wiki": health,
        "install": install,
        "checked_at": utc_now_iso(),
        "hint": None
        if health.get("ok")
        else "Launch requested. If health stays offline, open LLM Wiki manually and wait for local API.",
    }



def doctor_report(config: BridgeConfig) -> dict[str, Any]:
    """CLI-aligned local diagnosis payload for settings page / lumina doctor consumers."""
    setup = local_setup_report(config)
    llm = setup.get("llm_wiki") or {}
    project = setup.get("project") or {}
    bridge_ok = bool((setup.get("bridge") or {}).get("ok", True))
    provider_online = bool(llm.get("ok") or llm.get("online") or (llm.get("status") == "running"))
    provider_installed = bool(((llm.get("install") or {}).get("installed")) or provider_online)
    project_ok = bool(project.get("ok") or project.get("exists"))
    checks = [
        {
            "name": "bridge_online",
            "ok": bridge_ok,
            "detail": {
                "host": config.host,
                "port": config.port,
                "version": (setup.get("bridge") or {}).get("version"),
            },
        },
        {
            "name": "knowledge_provider",
            "ok": provider_installed,
            "detail": {
                "online": provider_online,
                "install": llm.get("install"),
                "status": llm.get("status"),
                "version": llm.get("version"),
            },
        },
        {
            "name": "provider_online",
            "ok": provider_online,
            "detail": llm.get("status") or llm.get("detail"),
        },
        {
            "name": "project_ready",
            "ok": project_ok,
            "detail": {
                "path": project.get("path") or str(config.project_path),
                "name": project.get("name") or config.project_name,
            },
        },
    ]
    # overall ok mirrors CLI non-strict doctor: bridge + project matter most; provider install required
    ok = bridge_ok and project_ok and provider_installed
    hints: list[str] = []
    commands = setup.get("commands") or {}
    if not bridge_ok:
        hints.append(commands.get("start_bridge") or "lumina bridge start")
    if not provider_installed:
        hints.append(commands.get("install") or "lumina knowledge provider install llm_wiki")
    elif not provider_online:
        hints.append(commands.get("start_llm_wiki") or "lumina knowledge start")
    if not project_ok:
        hints.append(commands.get("init_project") or "lumina knowledge init")
    if ok:
        hints.append(commands.get("sync") or "lumina sync")

    return {
        "ok": ok,
        "source": "bridge-doctor",
        "aligned_with": "lumina doctor",
        "checked_at": utc_now_iso(),
        "checks": checks,
        "summary": {
            "bridge": "online" if bridge_ok else "offline",
            "provider": "online" if provider_online else ("installed" if provider_installed else "missing"),
            "project": "ready" if project_ok else "missing",
        },
        "health": {
            "bridge": {
                "ok": bridge_ok,
                "status": "online" if bridge_ok else "offline",
                "detail": None,
                "checked_at": utc_now_iso(),
                "version": (setup.get("bridge") or {}).get("version"),
            },
            "provider": {
                "ok": provider_online,
                "status": llm.get("status") or ("online" if provider_online else "offline"),
                "detail": llm.get("detail"),
                "checked_at": llm.get("checked_at") or utc_now_iso(),
                "version": llm.get("version"),
                "install": llm.get("install"),
                "name": "llm_wiki",
            },
            # keep llm_wiki key for backward compatibility with existing settings UI
            "llm_wiki": {
                "ok": provider_online,
                "status": llm.get("status") or ("online" if provider_online else "offline"),
                "detail": llm.get("detail"),
                "checked_at": llm.get("checked_at") or utc_now_iso(),
                "version": llm.get("version"),
                "install": llm.get("install"),
            },
            "project": {
                "ok": project_ok,
                "name": project.get("name") or config.project_name,
                "path": project.get("path") or str(config.project_path),
                "detail": None if project_ok else "project missing or incomplete",
            },
        },
        "setup": {
            "actions": setup.get("actions") or [],
            "commands": commands,
            "notes": setup.get("notes") or [],
        },
        "hints": [h for h in hints if h],
        "cli": {
            "doctor": "lumina doctor",
            "up": "lumina up --install",
            "sync": "lumina sync",
            "status": "lumina status",
        },
    }


def install_guidance(config: BridgeConfig) -> dict[str, Any]:
    install = detect_llm_wiki_app()
    system = platform.system().lower()
    machine = platform.machine().lower()
    dmg = None
    if system == "darwin":
        if "arm" in machine or "aarch64" in machine:
            dmg = "https://github.com/nashsu/llm_wiki/releases/download/v0.6.6/LLM.Wiki_0.6.6_aarch64.dmg"
        else:
            dmg = "https://github.com/nashsu/llm_wiki/releases/download/v0.6.6/LLM.Wiki_0.6.6_x64.dmg"
    steps = [
        "Install Lumina CLI: curl -fsSL .../install-lumina-cli.sh | bash",
        "Run `lumina up --install` (Bridge + provider guidance).",
        "Install LLM Wiki desktop app once if provider doctor asks.",
        "Return to Lumina Topic Settings and click Recheck, or `lumina sync`.",
    ]
    return {
        "ok": True,
        "action": "install_guidance",
        "platform": system,
        "arch": machine,
        "llm_wiki": install,
        "download_url": dmg or LLM_WIKI_RELEASES_URL,
        "releases_url": LLM_WIKI_RELEASES_URL,
        "steps": steps,
        "commands": local_setup_report(config)["commands"],
        "checked_at": utc_now_iso(),
    }
