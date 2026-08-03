from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from ..bridge_runtime import BridgeRuntime
from ..config import mask_secret, set_by_path
from ..context import CliContext
from ..errors import CliError, DependencyError
from ..http import HttpClient
from ..knowledge import get_provider, list_providers
from ..knowledge_repair import (
    force_reingest_sources,
    quarantine_review_anomalies,
    restore_history_pages,
    retry_missing_truncations,
    sanitize_source_model_leaks,
)
from ..output import emit


def _runtime(ctx: CliContext) -> BridgeRuntime:
    return BridgeRuntime(ctx.profile, ctx.project)


def cmd_bridge(ctx: CliContext, args: argparse.Namespace) -> int:
    action = args.bridge_action
    rt = _runtime(ctx)
    if action == "install":
        result = rt.install(
            force=bool(args.force),
            yes=bool(ctx.yes or args.yes),
            start=not bool(args.no_start),
            init_project=not bool(args.no_init_project),
        )
        emit(result, output=ctx.output)
        return 0
    if action == "update":
        result = rt.install(force=True, yes=True, start=True, init_project=False)
        emit({"ok": True, "updated": True, **result}, output=ctx.output)
        return 0
    if action == "start":
        emit(rt.start(use_service=not bool(getattr(args, "no_service", False))), output=ctx.output)
        return 0
    if action == "stop":
        emit(
            rt.stop(
                use_service=not bool(getattr(args, "no_service", False)),
                disable_service=bool(getattr(args, "disable_service", False)),
            ),
            output=ctx.output,
        )
        return 0
    if action == "restart":
        emit(rt.restart(use_service=not bool(getattr(args, "no_service", False))), output=ctx.output)
        return 0
    if action == "status":
        emit(rt.status(), output=ctx.output)
        return 0

    if action == "logs":
        text = rt.logs(lines=int(args.lines or 100))
        if ctx.output == "json":
            emit({"log_file": str(rt.log_file), "content": text}, output="json")
        else:
            print(text)
        return 0
    if action == "doctor":
        data = rt.doctor()
        emit(data, output=ctx.output, ok=bool(data.get("ok")))
        return 0 if data.get("ok") else 1
    if action == "serve":
        code = rt.serve()
        return code
    if action == "install-service":
        emit(rt.install_service(start=not bool(getattr(args, "no_start", False))), output=ctx.output)
        return 0
    if action == "uninstall-service":
        emit(rt.uninstall_service(), output=ctx.output)
        return 0
    if action == "service-status":
        emit(rt.service_status(), output=ctx.output)
        return 0
    raise CliError(f"unknown bridge action: {action}")


def cmd_knowledge(ctx: CliContext, args: argparse.Namespace) -> int:
    action = args.knowledge_action
    cfg = ctx.config
    project = ctx.project
    profile = ctx.profile

    if action == "providers":
        rows = []
        for p in list_providers():
            rows.append(
                {
                    "name": p.info.name,
                    "title": p.info.title,
                    "active": project.provider == p.info.name,
                    "description": p.info.description,
                }
            )
        emit(rows, output=ctx.output)
        return 0

    if action == "provider":
        sub = args.provider_action
        name = args.name or project.provider
        provider = get_provider(name)
        from ..config import ProviderConfig
        provider_cfg = cfg.providers.get(name)
        if provider_cfg is None:
            provider_cfg = ProviderConfig()
            cfg.providers[name] = provider_cfg
        if sub == "show":
            emit(
                {
                    "name": provider.info.name,
                    "title": provider.info.title,
                    "homepage": provider.info.homepage,
                    "install_url": provider.info.install_url,
                    "enabled": provider_cfg.enabled,
                    "options": provider_cfg.options,
                    "status": provider.status(cfg, profile, project, provider_cfg),
                },
                output=ctx.output,
            )
            return 0
        if sub == "install":
            guidance = provider.install_guidance(cfg, profile, project, provider_cfg)
            emit(guidance, output=ctx.output)
            return 0
        if sub == "doctor":
            data = provider.doctor(cfg, profile, project, provider_cfg)
            emit(data, output=ctx.output, ok=bool(data.get("ok")))
            return 0 if data.get("ok") else 1
        raise CliError(f"unknown provider action: {sub}")

    provider = get_provider(project.provider)
    provider_cfg = cfg.providers.get(project.provider)
    if provider_cfg is None:
        from ..config import ProviderConfig

        provider_cfg = ProviderConfig()
        cfg.providers[project.provider] = provider_cfg

    if action == "status":
        emit(
            {
                "active_project": cfg.active_project,
                "provider": project.provider,
                "path": project.path,
                "provider_status": provider.status(cfg, profile, project, provider_cfg),
            },
            output=ctx.output,
        )
        return 0
    if action == "audit":
        result = _runtime(ctx).audit()
        emit(result, output=ctx.output, ok=bool(result.get("ready")))
        return 0 if result.get("ready") else 5
    if action == "repair":
        if not bool(getattr(args, "restore_history", False)):
            raise CliError(
                "knowledge repair requires --restore-history",
                hint="Use --dry-run first; this operation only restores local wiki pages from .llm-wiki/history.",
                error_code="repair_mode_required",
            )
        result = restore_history_pages(
            Path(project.path),
            dry_run=bool(getattr(args, "dry_run", False)),
        )
        emit(result, output=ctx.output, ok=bool(result.get("ok")))
        return 0 if result.get("ok") else 5
    if action == "retry-truncated":
        result = retry_missing_truncations(
            Path(project.path),
            api_url=str(provider_cfg.options.get("api_url") or "http://127.0.0.1:19828"),
            dry_run=bool(getattr(args, "dry_run", False)),
        )
        emit(result, output=ctx.output, ok=bool(result.get("ok")))
        return 0 if result.get("ok") else 5
    if action == "reingest":
        result = force_reingest_sources(
            Path(project.path),
            list(getattr(args, "source", []) or []),
            api_url=str(provider_cfg.options.get("api_url") or "http://127.0.0.1:19828"),
            dry_run=bool(getattr(args, "dry_run", False)),
        )
        emit(result, output=ctx.output, ok=bool(result.get("ok")))
        return 0 if result.get("ok") else 5
    if action == "sanitize-source":
        result = sanitize_source_model_leaks(
            Path(project.path),
            source_files=list(getattr(args, "source", []) or []) or None,
            dry_run=bool(getattr(args, "dry_run", False)),
        )
        emit(result, output=ctx.output, ok=bool(result.get("ok")))
        return 0 if result.get("ok") else 5
    if action == "quarantine-review-anomalies":
        result = quarantine_review_anomalies(
            Path(project.path),
            dry_run=bool(getattr(args, "dry_run", False)),
        )
        emit(result, output=ctx.output, ok=bool(result.get("ok")))
        return 0 if result.get("ok") else 5
    if action == "use":
        name = args.provider_name
        get_provider(name)  # validate
        project.provider = name
        if name not in cfg.providers:
            from ..config import ProviderConfig

            cfg.providers[name] = ProviderConfig(enabled=True)
        ctx.save()
        emit({"ok": True, "provider": name}, output=ctx.output)
        return 0
    if action == "set-path":
        path = str(Path(args.path).expanduser())
        project.path = path
        ctx.save()
        emit({"ok": True, "path": path}, output=ctx.output)
        return 0
    if action == "init":
        path = args.path
        data = provider.init_project(cfg, profile, project, provider_cfg, path=path)
        if path:
            project.path = str(Path(path).expanduser())
            ctx.save()
        # also ask bridge to init if installed
        rt = _runtime(ctx)
        bridge_result = None
        if rt.installed():
            try:
                bridge_result = rt.init_project(project.path)
            except Exception as exc:  # noqa: BLE001
                bridge_result = {"ok": False, "error": str(exc)}
        emit({"ok": True, "provider": data, "bridge": bridge_result}, output=ctx.output)
        return 0
    if action == "start":
        emit(provider.start(cfg, profile, project, provider_cfg), output=ctx.output)
        return 0
    if action == "stop":
        emit(provider.stop(cfg, profile, project, provider_cfg), output=ctx.output)
        return 0
    if action == "restart":
        provider.stop(cfg, profile, project, provider_cfg)
        emit(provider.start(cfg, profile, project, provider_cfg), output=ctx.output)
        return 0
    if action == "doctor":
        data = provider.doctor(cfg, profile, project, provider_cfg)
        emit(data, output=ctx.output, ok=bool(data.get("ok")))
        return 0 if data.get("ok") else 1
    raise CliError(f"unknown knowledge action: {action}")


def _wipe_local_knowledge_project(project_path: Path) -> dict:
    """Delete local knowledge artifacts in the current CLI process.

    Bridge may run under LaunchAgent without macOS Documents access; doing the
    destructive wipe here keeps rebuild usable for common ~/Documents paths.

    Also clears llm_wiki runtime residues (review/history/lancedb/ingest-cache)
    that can make a "fresh" rebuild still look contaminated.
    """
    import json

    removed: list[str] = []
    created: list[str] = []
    project_path = project_path.expanduser().resolve()
    for rel in ("raw", "wiki", ".llm-wiki", ".bridge/state.json"):
        target = project_path / rel
        if not target.exists():
            continue
        if target.is_file() or target.is_symlink():
            target.unlink()
        else:
            shutil.rmtree(target)
        removed.append(str(target))

    raw_dir = project_path / "raw" / "sources" / "lumina"
    raw_dir.mkdir(parents=True, exist_ok=True)
    created.append(str(raw_dir))
    for sub in ("entities", "concepts", "sources", "queries", "comparisons", "synthesis"):
        d = project_path / "wiki" / sub
        d.mkdir(parents=True, exist_ok=True)
        created.append(str(d))
    index = project_path / "wiki" / "index.md"
    index.write_text(
        "---\n"
        "type: overview\n"
        "title: Index\n"
        "tags: []\n"
        "related: []\n"
        "---\n\n"
        "# Index\n\n"
        "Lumina knowledge project initialized by topic bridge bootstrap.\n",
        encoding="utf-8",
    )
    created.append(str(index))
    log = project_path / "wiki" / "log.md"
    log.write_text("# Wiki Log\n\n", encoding="utf-8")
    created.append(str(log))

    runtime = project_path / ".llm-wiki"
    runtime.mkdir(parents=True, exist_ok=True)
    seed = {
        "ingest-queue.json": "[]\n",
        "file-change-queue.json": json.dumps({"version": 1, "tasks": []}, ensure_ascii=False, indent=2) + "\n",
        "file-snapshot.json": json.dumps({"version": 1, "updatedAt": 0, "files": {}}, ensure_ascii=False, indent=2) + "\n",
        "ingest-cache.json": json.dumps({"entries": {}}, ensure_ascii=False, indent=2) + "\n",
        "review.json": "[]\n",
    }
    for name, body in seed.items():
        path = runtime / name
        path.write_text(body, encoding="utf-8")
        created.append(str(path))
    history = runtime / "history"
    history.mkdir(parents=True, exist_ok=True)
    created.append(str(history))

    return {
        "ok": True,
        "project_path": str(project_path),
        "removed": removed,
        "created": created,
    }



def cmd_sync(ctx: CliContext, args: argparse.Namespace) -> int:
    rt = _runtime(ctx)
    mode = getattr(args, "mode", None) or ctx.profile.defaults.sync_mode or "incremental"
    action = getattr(args, "sync_action", None)
    dry_run = bool(getattr(args, "dry_run", False))
    rebuild = bool(getattr(args, "rebuild", False))
    local_only = bool(getattr(args, "local_only", False))

    if action == "status":
        status = rt.status()
        remote = None
        try:
            client = ctx.remote_client()
            # best-effort topics list count
            resp = client.get("/api/topics", params={"limit": 1})
            remote = {"ok": resp.ok, "sample": resp.data}
        except Exception as exc:  # noqa: BLE001
            remote = {"ok": False, "error": str(exc)}
        emit({"bridge": status, "remote": remote}, output=ctx.output)
        return 0

    if action == "full":
        mode = "full"
    elif action == "incremental":
        mode = "incremental"
        rebuild = False
    elif action == "article":
        result = rt.sync(
            mode="article",
            article_id=args.article_id,
            dry_run=dry_run,
            local_only=local_only,
        )
        emit(result, output=ctx.output, ok=bool(result.get("ok", True) or result.get("accepted", True)))
        return 0 if (result.get("ok", True) is not False and result.get("status") != "failed") else 5

    local_reset = None
    if rebuild:
        if mode != "full":
            mode = "full"
        confirmed = bool(getattr(args, "yes", False) or ctx.yes or dry_run)
        project_path = Path(getattr(ctx.project, "path", None) or "").expanduser()
        if not confirmed:
            print(
                "Destructive rebuild will delete local knowledge data under:\n"
                f"  {project_path}/raw\n"
                f"  {project_path}/wiki\n"
                "then re-export all remote sources and attempt recompile/writeback."
            )
            answer = input("Type 'rebuild' to continue: ").strip().lower()
            if answer != "rebuild":
                emit(
                    {
                        "accepted": False,
                        "status": "cancelled",
                        "error": "rebuild_not_confirmed",
                        "hint": "Re-run with --yes to skip the prompt.",
                    },
                    output=ctx.output,
                    ok=False,
                )
                return 5
        if not dry_run:
            if not str(project_path):
                emit(
                    {
                        "accepted": False,
                        "status": "failed",
                        "error": "project_path_missing",
                        "hint": "Set knowledge project path via `lumina knowledge set-path`.",
                    },
                    output=ctx.output,
                    ok=False,
                )
                return 5
            try:
                local_reset = _wipe_local_knowledge_project(project_path)
            except Exception as exc:  # noqa: BLE001
                emit(
                    {
                        "accepted": False,
                        "status": "failed",
                        "error": f"local_reset_failed: {exc}",
                        "hint": (
                            "CLI could not delete the knowledge project. Check path "
                            "permissions, then retry."
                        ),
                    },
                    output=ctx.output,
                    ok=False,
                )
                return 5

    # After CLI-side wipe, still ask Bridge for full export + compile/writeback.
    # Keep rebuild=true so Bridge also resets its own state cursors and requests compile.
    result = rt.sync(
        mode=mode,
        dry_run=dry_run,
        rebuild=rebuild,
        local_only=local_only,
    )
    if local_reset is not None and isinstance(result, dict):
        result = {
            **result,
            "local_reset": local_reset,
        }
    ok = result.get("status") != "failed" and result.get("ok", True) is not False
    emit(result, output=ctx.output, ok=ok)
    return 0 if ok else 5


def cmd_status(ctx: CliContext, args: argparse.Namespace) -> int:
    rt = _runtime(ctx)
    provider = get_provider(ctx.project.provider)
    from ..config import ProviderConfig

    provider_cfg = ctx.config.providers.get(ctx.project.provider) or ProviderConfig()
    remote = {"ok": False}
    try:
        client = ctx.remote_client()
        resp = client.get("/api/topics", params={"limit": 1})
        remote = {"ok": True, "status": resp.status}
    except Exception as exc:  # noqa: BLE001
        remote = {"ok": False, "error": str(exc)}
    data = {
        "profile": ctx.profile_name,
        "lumina": {
            "base_url": ctx.base_url_override or ctx.profile.lumina.base_url,
            "has_token": bool(ctx.token_override or ctx.profile.lumina.token),
            "remote_ok": remote.get("ok"),
            "remote": remote,
        },
        "bridge": rt.status(),
        "knowledge": provider.status(ctx.config, ctx.profile, ctx.project, provider_cfg),
    }
    emit(data, output=ctx.output)
    return 0


def cmd_doctor(ctx: CliContext, args: argparse.Namespace) -> int:
    checks = []
    # python
    checks.append({"name": "python", "ok": True, "detail": f"{Path(__import__('sys').executable)}"})
    # config
    from ..config import validate_config

    errors = validate_config(ctx.config)
    checks.append({"name": "config", "ok": not errors, "detail": errors or "ok"})
    # token
    has_token = bool(ctx.token_override or ctx.profile.lumina.token)
    checks.append({"name": "auth_token", "ok": has_token, "detail": "set" if has_token else "missing"})
    # remote
    remote_ok = False
    remote_detail = None
    if has_token:
        try:
            resp = ctx.remote_client().get("/api/topics", params={"limit": 1})
            remote_ok = resp.ok
            remote_detail = {"status": resp.status}
        except Exception as exc:  # noqa: BLE001
            remote_detail = str(exc)
    checks.append({"name": "lumina_remote", "ok": remote_ok if has_token else False, "detail": remote_detail})
    # bridge
    rt = _runtime(ctx)
    bridge_doc = rt.doctor()
    checks.append({"name": "bridge", "ok": bool(bridge_doc.get("ok")), "detail": bridge_doc})
    # provider
    provider = get_provider(ctx.project.provider)
    from ..config import ProviderConfig

    provider_cfg = ctx.config.providers.get(ctx.project.provider) or ProviderConfig()
    provider_doc = provider.doctor(ctx.config, ctx.profile, ctx.project, provider_cfg)
    checks.append({"name": "knowledge_provider", "ok": bool(provider_doc.get("ok")), "detail": provider_doc})

    ok = all(c["ok"] for c in checks if c["name"] in {"config", "bridge"})  # auth/provider may warn
    # stricter if --strict
    if getattr(args, "strict", False):
        ok = all(c["ok"] for c in checks)
    emit(
        {
            "ok": ok,
            "checks": checks,
            "hints": [
                "lumina auth token set <token>" if not has_token else None,
                "lumina bridge install --yes" if not rt.installed() else None,
                "lumina knowledge start" if not provider_doc.get("ok") else None,
            ],
        },
        output=ctx.output,
        ok=ok,
    )
    return 0 if ok else 1


def cmd_up(ctx: CliContext, args: argparse.Namespace) -> int:
    rt = _runtime(ctx)
    steps = []
    if not rt.installed():
        if ctx.yes or getattr(args, "install", False):
            steps.append({"bridge_install": rt.install(yes=True, start=True)})
        else:
            raise DependencyError("bridge not installed", hint="Run `lumina bridge install --yes` or `lumina up --install`")
    else:
        steps.append({"bridge_start": rt.start()})
    provider = get_provider(ctx.project.provider)
    from ..config import ProviderConfig

    provider_cfg = ctx.config.providers.get(ctx.project.provider) or ProviderConfig()
    try:
        steps.append({"knowledge_start": provider.start(ctx.config, ctx.profile, ctx.project, provider_cfg)})
    except Exception as exc:  # noqa: BLE001
        steps.append({"knowledge_start": {"ok": False, "error": str(exc), "hint": getattr(exc, "hint", None)}})
    status = {
        "bridge": rt.status(),
        "knowledge": provider.status(ctx.config, ctx.profile, ctx.project, provider_cfg),
        "steps": steps,
    }
    ok = bool(status["bridge"].get("online"))
    emit(status, output=ctx.output, ok=ok)
    return 0 if ok else 1


def cmd_down(ctx: CliContext, args: argparse.Namespace) -> int:
    rt = _runtime(ctx)
    result = {"bridge": rt.stop()}
    if getattr(args, "all", False):
        provider = get_provider(ctx.project.provider)
        from ..config import ProviderConfig

        provider_cfg = ctx.config.providers.get(ctx.project.provider) or ProviderConfig()
        result["knowledge"] = provider.stop(ctx.config, ctx.profile, ctx.project, provider_cfg)
    emit(result, output=ctx.output)
    return 0
