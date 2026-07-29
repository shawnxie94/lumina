from __future__ import annotations

import argparse
from copy import deepcopy

from ..config import (
    Profile,
    Project,
    get_by_path,
    mask_secret,
    save_config,
    set_by_path,
    validate_config,
)
from ..context import CliContext
from ..errors import ConfigError
from ..output import emit


def cmd_config(ctx: CliContext, args: argparse.Namespace) -> int:
    action = args.config_action
    if action == "path":
        emit({"path": str(ctx.config_path)}, output=ctx.output)
        return 0
    if action == "get":
        value = get_by_path(ctx.config, args.key, reveal=bool(args.reveal))
        emit(value if not isinstance(value, (dict, list)) else value, output=ctx.output)
        if ctx.output != "json" and not isinstance(value, (dict, list)):
            # already emitted raw via emit for non-dict; ensure key form for scalars in table mode
            pass
        return 0
    if action == "set":
        set_by_path(ctx.config, args.key, args.value)
        ctx.save()
        emit({"ok": True, "key": args.key, "value": get_by_path(ctx.config, args.key)}, output=ctx.output)
        return 0
    if action == "unset":
        # limited unset support
        key = args.key
        if key in {"lumina.token", "token"}:
            set_by_path(ctx.config, "lumina.token", "")
        elif key in {"bridge.token"}:
            set_by_path(ctx.config, "bridge.token", "")
        else:
            raise ConfigError(f"unset not supported for key: {key}", hint="Supported: lumina.token, bridge.token")
        ctx.save()
        emit({"ok": True, "unset": key}, output=ctx.output)
        return 0
    if action == "validate":
        errors = validate_config(ctx.config)
        ok = not errors
        emit({"ok": ok, "errors": errors}, output=ctx.output, ok=ok)
        return 0 if ok else 2
    raise ConfigError(f"unknown config action: {action}")


def cmd_profile(ctx: CliContext, args: argparse.Namespace) -> int:
    action = args.profile_action
    cfg = ctx.config
    if action == "list":
        rows = []
        for name, profile in cfg.profiles.items():
            rows.append(
                {
                    "name": name,
                    "active": name == cfg.active_profile,
                    "base_url": profile.lumina.base_url,
                    "bridge": f"{profile.bridge.host}:{profile.bridge.port}",
                }
            )
        emit(rows, output=ctx.output)
        return 0
    if action == "show":
        name = args.name or cfg.active_profile
        profile = cfg.profile(name)
        data = {
            "name": name,
            "active": name == cfg.active_profile,
            "lumina": {
                "base_url": profile.lumina.base_url,
                "token": mask_secret(profile.lumina.token),
                "timeout_sec": profile.lumina.timeout_sec,
            },
            "bridge": {
                "host": profile.bridge.host,
                "port": profile.bridge.port,
                "token": mask_secret(profile.bridge.token),
                "root": profile.bridge.root,
                "autostart": profile.bridge.autostart,
            },
            "defaults": {
                "output": profile.defaults.output,
                "sync_mode": profile.defaults.sync_mode,
            },
        }
        emit(data, output=ctx.output)
        return 0
    if action == "use":
        if args.name not in cfg.profiles:
            raise ConfigError(f"profile not found: {args.name}")
        cfg.active_profile = args.name
        ctx.profile_name = args.name
        ctx.save()
        emit({"ok": True, "active_profile": args.name}, output=ctx.output)
        return 0
    if action == "create":
        name = args.name
        if name in cfg.profiles:
            raise ConfigError(f"profile already exists: {name}")
        base = deepcopy(cfg.profile())
        cfg.profiles[name] = base
        if args.use:
            cfg.active_profile = name
            ctx.profile_name = name
        ctx.save()
        emit({"ok": True, "created": name, "active_profile": cfg.active_profile}, output=ctx.output)
        return 0
    if action == "delete":
        name = args.name
        if name not in cfg.profiles:
            raise ConfigError(f"profile not found: {name}")
        if len(cfg.profiles) == 1:
            raise ConfigError("cannot delete the last profile")
        del cfg.profiles[name]
        if cfg.active_profile == name:
            cfg.active_profile = next(iter(cfg.profiles.keys()))
            ctx.profile_name = cfg.active_profile
        ctx.save()
        emit({"ok": True, "deleted": name, "active_profile": cfg.active_profile}, output=ctx.output)
        return 0
    raise ConfigError(f"unknown profile action: {action}")


def cmd_auth(ctx: CliContext, args: argparse.Namespace) -> int:
    action = args.auth_action
    profile = ctx.profile
    if action == "status":
        token = profile.lumina.token
        emit(
            {
                "profile": ctx.profile_name,
                "base_url": profile.lumina.base_url,
                "has_token": bool(token),
                "token": mask_secret(token),
            },
            output=ctx.output,
        )
        return 0
    if action == "token":
        sub = args.token_action
        if sub == "set":
            set_by_path(ctx.config, "lumina.token", args.token_value)
            # keep active profile in sync if --profile selected
            if ctx.profile_name != ctx.config.active_profile:
                # set_by_path writes active profile; mirror into selected profile
                ctx.config.profiles[ctx.profile_name].lumina.token = args.token_value
            ctx.save()
            emit({"ok": True, "profile": ctx.profile_name, "token": mask_secret(args.token_value)}, output=ctx.output)
            return 0
        if sub == "show":
            token = profile.lumina.token
            value = token if args.reveal else mask_secret(token)
            emit({"profile": ctx.profile_name, "token": value, "has_token": bool(token)}, output=ctx.output)
            return 0
    raise ConfigError(f"unknown auth action: {action}")


def cmd_whoami(ctx: CliContext, args: argparse.Namespace) -> int:
    profile = ctx.profile
    project = ctx.project
    remote_ok = None
    remote_error = None
    if not args.local_only and profile.lumina.token:
        try:
            # lightweight probe: topics export or articles list may require auth; use a cheap settings-ish path if available
            client = ctx.remote_client()
            # Prefer internal-friendly endpoint
            resp = client.get("/api/topics", params={"limit": 1})
            remote_ok = resp.ok
        except Exception as exc:  # noqa: BLE001
            remote_ok = False
            remote_error = str(exc)
    emit(
        {
            "profile": ctx.profile_name,
            "base_url": ctx.base_url_override or profile.lumina.base_url,
            "has_token": bool(ctx.token_override or profile.lumina.token),
            "token": mask_secret(ctx.token_override or profile.lumina.token),
            "project": {
                "name": ctx.config.active_project,
                "provider": project.provider,
                "path": project.path,
            },
            "bridge": f"{profile.bridge.host}:{profile.bridge.port}",
            "remote_ok": remote_ok,
            "remote_error": remote_error,
        },
        output=ctx.output,
    )
    return 0
