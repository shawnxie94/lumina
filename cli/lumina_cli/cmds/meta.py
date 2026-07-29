from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path

from .. import __version__
from ..completion import render_completion
from ..config import (
    DEFAULT_BRIDGE_ROOT,
    ensure_config,
    load_config,
    mask_secret,
    save_config,
    set_by_path,
)
from ..context import CliContext
from ..errors import CliError
from ..output import emit


def cmd_version(ctx: CliContext, args: argparse.Namespace) -> int:
    emit({"name": "lumina", "version": __version__}, output=ctx.output)
    return 0


def _prompt(label: str, default: str = "", *, secret: bool = False, required: bool = False) -> str:
    """Prompt with default. Empty input keeps default.

    secret+required=True forces non-empty; optional secrets may be empty.
    """
    display_default = default
    if secret and default and not default.startswith("*"):
        # show masked default for known secrets when caller didn't pre-mask
        pass
    suffix = f" [{display_default}]" if display_default != "" else ""
    while True:
        try:
            if secret:
                raw = getpass.getpass(f"{label}{suffix}: ")
            else:
                raw = input(f"{label}{suffix}: ")
        except EOFError as exc:
            raise CliError(
                "interactive input closed",
                code=2,
                error_code="usage_error",
                hint="Re-run with flags or --non-interactive",
            ) from exc
        value = (raw or "").strip()
        if value:
            return value
        if not required:
            return default
        print("  (required)")


def _prompt_bool(label: str, default: bool = True) -> bool:
    tip = "Y/n" if default else "y/N"
    raw = _prompt(f"{label} ({tip})", "y" if default else "n")
    return raw.lower() in {"1", "y", "yes", "true", "on"}


def _coalesce(*values: str | None, default: str = "") -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return default


def _stdin_is_tty() -> bool:
    try:
        return bool(os.isatty(0))
    except Exception:
        return False


def _ensure_path_export(bin_dir: Path) -> dict:
    bin_dir = bin_dir.expanduser()
    shell = Path(os.environ.get("SHELL", "zsh")).name
    rc = Path.home() / (".bashrc" if shell == "bash" else ".zshrc")
    export_line = f'export PATH="{bin_dir}:$PATH"'
    result = {"bin_dir": str(bin_dir), "rc": str(rc), "line": export_line, "written": False}
    try:
        existing = rc.read_text(encoding="utf-8") if rc.exists() else ""
        if str(bin_dir) in existing:
            result["message"] = "already present"
            return result
        with rc.open("a", encoding="utf-8") as fh:
            fh.write(f"\n# Lumina CLI\n{export_line}\n")
        result["written"] = True
        result["message"] = "appended"
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)
        result["message"] = "failed to write rc; add PATH manually"
    return result


def cmd_init(ctx: CliContext, args: argparse.Namespace) -> int:
    """Initialize local CLI config with defaults + staged guided setup."""
    cfg_path = ctx.config_path
    existed = cfg_path.exists()
    cfg = load_config(cfg_path) if existed else ensure_config(cfg_path)[0]
    cfg.ensure_defaults()
    profile = cfg.profile()
    project = cfg.project()

    env_base = os.environ.get("LUMINA_BASE_URL") or os.environ.get("LUMINA_URL")
    env_token = os.environ.get("LUMINA_TOKEN") or os.environ.get("LUMINA_INTERNAL_TOKEN")
    env_project = os.environ.get("LUMINA_PROJECT_PATH")
    env_provider = os.environ.get("LUMINA_PROVIDER")
    env_bridge_host = os.environ.get("LUMINA_BRIDGE_HOST")
    env_bridge_port = os.environ.get("LUMINA_BRIDGE_PORT")
    env_bridge_token = os.environ.get("LUMINA_BRIDGE_TOKEN")

    base_url = _coalesce(
        getattr(args, "base_url", None),
        getattr(ctx, "base_url_override", None),
        env_base,
        default=profile.lumina.base_url or "http://127.0.0.1:8000/backend",
    )
    token = _coalesce(
        getattr(args, "token", None),
        getattr(ctx, "token_override", None),
        env_token,
        default=profile.lumina.token or "",
    )
    project_path = _coalesce(
        getattr(args, "project_path", None),
        env_project,
        default=project.path or str(Path.home() / ".lumina" / "knowledge" / "Lumina-Knowledge"),
    )
    provider = _coalesce(
        getattr(args, "provider", None),
        env_provider,
        default=project.provider or "llm_wiki",
    )
    bridge_host = _coalesce(
        getattr(args, "bridge_host", None),
        env_bridge_host,
        default=profile.bridge.host or "127.0.0.1",
    )
    bridge_port = _coalesce(
        str(getattr(args, "bridge_port", "") or ""),
        env_bridge_port,
        default=str(profile.bridge.port or 8787),
    )
    bridge_token = _coalesce(
        getattr(args, "bridge_token", None),
        env_bridge_token,
        default=profile.bridge.token or "",
    )
    project_name = _coalesce(
        getattr(args, "project_name", None),
        default=project.name or Path(project_path).name or "Lumina-Knowledge",
    )

    non_interactive = bool(
        getattr(args, "non_interactive", False)
        or getattr(args, "yes", False)
        or not _stdin_is_tty()
    )
    if getattr(args, "guided", False):
        non_interactive = False

    skip_bridge = bool(getattr(args, "skip_bridge", False))
    install_bridge = bool(getattr(args, "install_bridge", False))
    # PATH is auto-added by default; only --no-add-path disables it.
    if getattr(args, "no_add_path", False):
        add_path = False
    else:
        add_path = True

    # Defaults always exist.
    default_base_url = base_url or "http://127.0.0.1:8000/backend"
    default_token = token or ""
    default_bridge_host = bridge_host or "127.0.0.1"
    default_bridge_port = str(bridge_port or 8787)
    default_bridge_token = bridge_token or ""
    default_provider = provider or "llm_wiki"
    default_project_path = project_path or str(Path.home() / ".lumina" / "knowledge" / "Lumina-Knowledge")
    default_project_name = project_name or Path(default_project_path).name or "Lumina-Knowledge"

    base_url = default_base_url
    token = default_token
    bridge_host = default_bridge_host
    bridge_port = default_bridge_port
    bridge_token = default_bridge_token
    provider = default_provider
    project_path = default_project_path
    project_name = default_project_name
    setup_local_knowledge = install_bridge and not skip_bridge

    if not non_interactive:
        print("Lumina CLI setup")
        print("Press Enter to keep the default value shown in [brackets].")
        print("")
        if existed:
            print(f"Existing config: {cfg_path}")
            if not _prompt_bool("Reconfigure now", True):
                emit(
                    {
                        "ok": True,
                        "created": False,
                        "updated": False,
                        "config_path": str(cfg_path),
                        "message": "kept existing config",
                    },
                    output=ctx.output,
                )
                return 0

        print("1) Lumina connection")
        base_url = _prompt("Lumina base URL", default_base_url)
        token_default_hint = mask_secret(default_token) if default_token else ""
        print("   Token = Lumina INTERNAL/API token for CLI sync/API calls.")
        print("   Leave empty to fill later with: lumina auth token set <token>")
        # Use non-secret prompt when no existing token so Enter can cleanly keep empty default.
        if default_token:
            entered = _prompt("Lumina token", token_default_hint, secret=True)
            if entered == token_default_hint:
                token = default_token
            else:
                token = entered
        else:
            token = _prompt("Lumina token", "", secret=False)

        print("")
        print("2) Local knowledge runtime")
        if skip_bridge:
            setup_local_knowledge = False
            install_bridge = False
            print("   Skip local knowledge setup (--skip-bridge).")
        else:
            setup_local_knowledge = _prompt_bool("Install local knowledge runtime now", True)
            install_bridge = setup_local_knowledge

        if setup_local_knowledge:
            print("")
            print("3) Local knowledge details")
            bridge_host = _prompt("Bridge host", default_bridge_host)
            bridge_port = _prompt("Bridge port", default_bridge_port)
            bridge_token = _prompt("Bridge token (optional)", default_bridge_token, secret=True)
            provider = _prompt("Knowledge provider", default_provider)
            project_path = _prompt("Knowledge project path", default_project_path)
            project_name = _prompt(
                "Knowledge project name",
                default_project_name or Path(project_path).name or "Lumina-Knowledge",
            )
        else:
            bridge_host = default_bridge_host
            bridge_port = default_bridge_port
            bridge_token = default_bridge_token
            provider = default_provider
            project_path = default_project_path
            project_name = default_project_name

        # PATH is enabled by default (no prompt).
    else:
        if skip_bridge:
            install_bridge = False
            setup_local_knowledge = False

    base_url = base_url.rstrip("/")
    project_path = str(Path(project_path).expanduser())
    try:
        bridge_port_int = int(bridge_port)
    except Exception as exc:  # noqa: BLE001
        raise CliError(f"invalid bridge port: {bridge_port}", code=2) from exc

    set_by_path(cfg, "lumina.base_url", base_url)
    set_by_path(cfg, "lumina.token", token or "")
    set_by_path(cfg, "bridge.host", bridge_host)
    set_by_path(cfg, "bridge.port", str(bridge_port_int))
    set_by_path(cfg, "bridge.token", bridge_token or "")
    set_by_path(cfg, "bridge.root", str(Path(profile.bridge.root or DEFAULT_BRIDGE_ROOT).expanduser()))
    set_by_path(cfg, "project.provider", provider)
    set_by_path(cfg, "project.path", project_path)
    set_by_path(cfg, "project.name", project_name)
    path = save_config(cfg, cfg_path)
    ctx.config = cfg

    path_note = None
    if add_path:
        path_note = _ensure_path_export(Path.home() / ".lumina" / "bin")
        if not non_interactive:
            bin_dir = Path.home() / ".lumina" / "bin"
            msg = (path_note or {}).get("message") or "ok"
            print("")
            print(f"PATH: {bin_dir} ({msg})")
            if (path_note or {}).get("written"):
                print("      Open a new terminal, or run: source ~/.zshrc")

    bridge_result = None
    if install_bridge and not skip_bridge:
        try:
            from ..bridge_runtime import BridgeRuntime

            rt = BridgeRuntime(cfg.profile(), cfg.project())
            bridge_result = rt.install(
                force=bool(getattr(args, "force", False)),
                yes=True,
                start=True,
                init_project=True,
            )
        except Exception as exc:  # noqa: BLE001
            bridge_result = {"ok": False, "error": str(exc), "hint": getattr(exc, "hint", None)}

    incomplete = not bool(token)
    next_steps = []
    if incomplete:
        next_steps.append("lumina auth token set <INTERNAL_API_TOKEN>")
    if install_bridge and not (bridge_result or {}).get("ok"):
        next_steps.append("lumina bridge install --yes")
    elif not install_bridge:
        next_steps.append("lumina init --guided --force   # setup local knowledge later")
    next_steps.extend(["lumina doctor", "lumina up", "lumina sync"])

    payload = {
        "ok": True,
        "created": not existed,
        "updated": True,
        "config_path": str(path),
        "guided": not non_interactive,
        "incomplete": incomplete,
        "setup_local_knowledge": bool(setup_local_knowledge),
        "profile": {
            "name": cfg.active_profile,
            "base_url": base_url,
            "token": mask_secret(token),
            "has_token": bool(token),
            "bridge": f"{bridge_host}:{bridge_port_int}",
        },
        "project": {
            "name": cfg.active_project,
            "provider": provider,
            "path": project_path,
            "project_name": project_name,
        },
        "path_setup": path_note,
        "local_knowledge_install": bridge_result,
        "bridge_install": bridge_result,
        "next": next_steps,
    }
    if incomplete:
        payload["warning"] = "token is empty; remote sync/API calls will fail until you set it"
    emit(payload, output=ctx.output)
    if incomplete and ctx.output != "json":
        print("Warning: token is empty. Run: lumina auth token set <token>")
    return 0


def cmd_completion(ctx: CliContext, args: argparse.Namespace) -> int:
    try:
        script = render_completion(args.shell)
    except ValueError as exc:
        raise CliError(str(exc), code=2, error_code="usage_error") from exc
    print(script, end="" if script.endswith("\n") else "\n")
    return 0
