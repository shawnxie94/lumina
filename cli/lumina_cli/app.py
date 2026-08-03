from __future__ import annotations

import argparse
import sys
from typing import Callable, Sequence

from .cmds.api_cmds import cmd_api, cmd_articles, cmd_logs, cmd_topics, cmd_update
from .cmds.config_cmds import cmd_auth, cmd_config, cmd_profile, cmd_whoami
from .cmds.meta import cmd_completion, cmd_init, cmd_version
from .cmds.runtime_cmds import (
    cmd_bridge,
    cmd_doctor,
    cmd_down,
    cmd_knowledge,
    cmd_status,
    cmd_sync,
    cmd_up,
)
from .context import build_context
from .errors import CliError
from .output import emit_error


GLOBAL_VALUE_FLAGS = {
    "--profile",
    "--base-url",
    "--token",
    "--output",
    "--config",
}
GLOBAL_BOOL_FLAGS = {
    "--yes",
    "--verbose",
    "--quiet",
}



def _extract_global_flags(argv: list[str]) -> tuple[dict, list[str]]:
    """Extract global flags that appear *before* the subcommand.

    Subcommands like `init --token` need to keep their own flags, so we only
    consume globals in the leading position:
      lumina --token X doctor
      lumina --output json bridge status
    """
    values: dict = {
        "profile": None,
        "base_url": None,
        "token": None,
        "output": None,
        "config": None,
        "yes": False,
        "verbose": False,
        "quiet": False,
    }
    remaining: list[str] = []
    i = 0
    # Parse only the leading global flag section.
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            remaining.extend(argv[i + 1 :])
            break
        if arg in GLOBAL_VALUE_FLAGS:
            if i + 1 >= len(argv):
                raise CliError(f"missing value for {arg}", code=2, error_code="usage_error")
            key = arg[2:].replace("-", "_")
            values[key] = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--profile="):
            values["profile"] = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("--base-url="):
            values["base_url"] = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("--token="):
            values["token"] = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("--output="):
            values["output"] = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("--config="):
            values["config"] = arg.split("=", 1)[1]
            i += 1
            continue
        if arg in GLOBAL_BOOL_FLAGS:
            values[arg[2:].replace("-", "_")] = True
            i += 1
            continue
        # First non-global token starts the subcommand path; keep as-is
        # but still allow globals after subcommands via argparse parents? currently not.
        # Support trailing globals by a second lightweight scan that only strips known globals
        # when they are not ambiguous with subcommand options.
        remaining = argv[i:]
        break
    else:
        remaining = []

    # Second pass: allow a subset of truly global trailing flags that do not clash
    # with common subcommand options. Keep --output/--config/--profile/--verbose/--quiet.
    # Do NOT trailing-extract --token/--base-url/--yes because init/bridge/auth use them.
    trailing_value = {"--output", "--config", "--profile"}
    trailing_bool = {"--verbose", "--quiet"}
    cleaned: list[str] = []
    j = 0
    while j < len(remaining):
        arg = remaining[j]
        if arg in trailing_value:
            if j + 1 >= len(remaining):
                raise CliError(f"missing value for {arg}", code=2, error_code="usage_error")
            key = arg[2:].replace("-", "_")
            values[key] = remaining[j + 1]
            j += 2
            continue
        if any(arg.startswith(f"{flag}=") for flag in trailing_value):
            flag, val = arg.split("=", 1)
            values[flag[2:].replace("-", "_")] = val
            j += 1
            continue
        if arg in trailing_bool:
            values[arg[2:].replace("-", "_")] = True
            j += 1
            continue
        cleaned.append(arg)
        j += 1
    remaining = cleaned

    if values["output"] not in {None, "table", "json", "yaml"}:
        raise CliError(
            f"invalid --output: {values['output']}",
            code=2,
            error_code="usage_error",
            hint="Use table|json|yaml",
        )
    return values, remaining



def _remap_deprecated_bridge_argv(argv: list[str]) -> list[str]:
    """Map old service subcommands onto start/stop/status flags."""
    if len(argv) < 2 or argv[0] != "bridge":
        return argv
    action = argv[1]
    rest = argv[2:]
    if action == "install-service":
        out = ["bridge", "start"]
        # --no-start used to mean write unit only; approximate by start then no extra flag.
        # Keep simple: install-service => start (service default)
        if "--no-start" in rest:
            rest = [a for a in rest if a != "--no-start"]
        return out + rest
    if action == "uninstall-service":
        return ["bridge", "stop", "--disable-service", *rest]
    if action == "service-status":
        return ["bridge", "status", *rest]
    return argv


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lumina",
        description="Lumina local control plane (config / bridge / knowledge / sync / api)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("version", help="show CLI version")
    p.set_defaults(func=cmd_version)

    p = sub.add_parser("init", help="guided setup for ~/.lumina/config.yaml")
    p.add_argument("--non-interactive", action="store_true", help="no prompts; use flags/env/defaults")
    p.add_argument("--yes", action="store_true", help="alias of --non-interactive for scripts")
    p.add_argument("--guided", action="store_true", help="force interactive wizard")
    p.add_argument("--force", action="store_true", help="reconfigure even if config exists")
    p.add_argument("--reconfigure", action="store_true", help="same as --force")
    p.add_argument("--base-url")
    p.add_argument("--token")
    p.add_argument("--bridge-host")
    p.add_argument("--bridge-port", type=int)
    p.add_argument("--bridge-token")
    p.add_argument("--project-path")
    p.add_argument("--project-name")
    p.add_argument("--provider", default=None)
    p.add_argument("--install-bridge", action="store_true", help="install/start bridge after init")
    p.add_argument("--skip-bridge", action="store_true", help="do not offer/install bridge")
    p.add_argument("--add-path", action="store_true", help="append ~/.lumina/bin to shell rc")
    p.add_argument("--no-add-path", action="store_true", help="do not modify shell rc")
    p.add_argument("--allow-empty-token", action="store_true")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("profile", help="manage profiles")
    ps = p.add_subparsers(dest="profile_action", required=True)
    ps.add_parser("list").set_defaults(func=cmd_profile, profile_action="list")
    sp = ps.add_parser("show")
    sp.add_argument("name", nargs="?")
    sp.set_defaults(func=cmd_profile, profile_action="show")
    sp = ps.add_parser("use")
    sp.add_argument("name")
    sp.set_defaults(func=cmd_profile, profile_action="use")
    sp = ps.add_parser("create")
    sp.add_argument("name")
    sp.add_argument("--use", action="store_true")
    sp.set_defaults(func=cmd_profile, profile_action="create")
    sp = ps.add_parser("delete")
    sp.add_argument("name")
    sp.set_defaults(func=cmd_profile, profile_action="delete")

    p = sub.add_parser("config", help="get/set config values")
    ps = p.add_subparsers(dest="config_action", required=True)
    ps.add_parser("path").set_defaults(func=cmd_config, config_action="path")
    sp = ps.add_parser("get")
    sp.add_argument("key", nargs="?")
    sp.add_argument("--reveal", action="store_true")
    sp.set_defaults(func=cmd_config, config_action="get")
    sp = ps.add_parser("set")
    sp.add_argument("key")
    sp.add_argument("value")
    sp.set_defaults(func=cmd_config, config_action="set")
    sp = ps.add_parser("unset")
    sp.add_argument("key")
    sp.set_defaults(func=cmd_config, config_action="unset")
    ps.add_parser("validate").set_defaults(func=cmd_config, config_action="validate")

    p = sub.add_parser("auth", help="auth token helpers")
    ps = p.add_subparsers(dest="auth_action", required=True)
    ps.add_parser("status").set_defaults(func=cmd_auth, auth_action="status")
    sp = ps.add_parser("token")
    ts = sp.add_subparsers(dest="token_action", required=True)
    tset = ts.add_parser("set")
    tset.add_argument("token_value")
    tset.set_defaults(func=cmd_auth, auth_action="token", token_action="set")
    tshow = ts.add_parser("show")
    tshow.add_argument("--reveal", action="store_true")
    tshow.set_defaults(func=cmd_auth, auth_action="token", token_action="show")

    p = sub.add_parser("whoami", help="show active identity/config")
    p.add_argument("--local-only", action="store_true")
    p.set_defaults(func=cmd_whoami)

    p = sub.add_parser("bridge", help="manage local topic bridge")
    ps = p.add_subparsers(dest="bridge_action", required=True)
    sp = ps.add_parser("install")
    sp.add_argument("--force", action="store_true")
    sp.add_argument("--yes", action="store_true")
    sp.add_argument("--no-start", action="store_true")
    sp.add_argument("--no-init-project", action="store_true")
    sp.set_defaults(func=cmd_bridge, bridge_action="install")
    ps.add_parser("update").set_defaults(func=cmd_bridge, bridge_action="update")

    sp = ps.add_parser("start", help="start bridge (default: OS service; use --no-service for nohup)")
    sp.add_argument("--no-service", action="store_true", help="start with bare nohup instead of LaunchAgent/systemd")
    sp.set_defaults(func=cmd_bridge, bridge_action="start")

    sp = ps.add_parser("stop", help="stop bridge (default stops supervised service if present)")
    sp.add_argument("--no-service", action="store_true", help="only stop nohup/pid process")
    sp.add_argument("--disable-service", action="store_true", help="also remove OS supervised service unit")
    sp.set_defaults(func=cmd_bridge, bridge_action="stop")

    sp = ps.add_parser("restart", help="restart bridge (default: OS service)")
    sp.add_argument("--no-service", action="store_true", help="restart with bare nohup instead of service")
    sp.set_defaults(func=cmd_bridge, bridge_action="restart")

    for name in ["status", "doctor", "serve"]:
        help_map = {
            "status": "show bridge health + service backend status",
            "doctor": "diagnose bridge/provider/project",
            "serve": "run bridge in foreground (debug)",
        }
        ps.add_parser(name, help=help_map[name]).set_defaults(func=cmd_bridge, bridge_action=name)

    sp = ps.add_parser("logs")
    sp.add_argument("-n", "--lines", type=int, default=100)
    sp.set_defaults(func=cmd_bridge, bridge_action="logs")


    p = sub.add_parser("knowledge", help="manage knowledge providers/projects")
    ps = p.add_subparsers(dest="knowledge_action", required=True)
    ps.add_parser("providers").set_defaults(func=cmd_knowledge, knowledge_action="providers")
    sp = ps.add_parser("provider")
    pss = sp.add_subparsers(dest="provider_action", required=True)
    for name in ["show", "install", "doctor"]:
        x = pss.add_parser(name)
        x.add_argument("name", nargs="?")
        x.set_defaults(func=cmd_knowledge, knowledge_action="provider", provider_action=name)
    ps.add_parser("status").set_defaults(func=cmd_knowledge, knowledge_action="status")
    ps.add_parser("audit").set_defaults(func=cmd_knowledge, knowledge_action="audit")
    sp = ps.add_parser(
        "repair",
        help="repair local wiki pages from safe LLM Wiki history snapshots",
    )
    sp.add_argument(
        "--restore-history",
        action="store_true",
        help="restore malformed/leaking pages from the latest valid local history",
    )
    sp.add_argument(
        "--dry-run",
        action="store_true",
        help="show the restore plan without changing local files",
    )
    sp.set_defaults(func=cmd_knowledge, knowledge_action="repair")
    sp = ps.add_parser(
        "retry-truncated",
        help="retry only missing local outputs recorded as truncated",
    )
    sp.add_argument(
        "--dry-run",
        action="store_true",
        help="show missing targets without touching raw files or rescanning",
    )
    sp.set_defaults(func=cmd_knowledge, knowledge_action="retry-truncated")
    sp = ps.add_parser(
        "reingest",
        help="force local LLM Wiki to re-analyze selected raw source files",
    )
    sp.add_argument(
        "--source",
        action="append",
        required=True,
        help="source path under raw/sources (repeat for multiple files)",
    )
    sp.add_argument(
        "--dry-run",
        action="store_true",
        help="show selected sources without changing runtime metadata",
    )
    sp.set_defaults(func=cmd_knowledge, knowledge_action="reingest")
    sp = ps.add_parser(
        "sanitize-source",
        help="remove paired model-planning blocks from local source pages",
    )
    sp.add_argument(
        "--source",
        action="append",
        help="optional source page under wiki/sources (repeat for selected pages)",
    )
    sp.add_argument(
        "--dry-run",
        action="store_true",
        help="show paired <think> blocks without changing source pages",
    )
    sp.set_defaults(func=cmd_knowledge, knowledge_action="sanitize-source")
    sp = ps.add_parser(
        "quarantine-review-anomalies",
        help="move structurally malformed review records to a local quarantine",
    )
    sp.add_argument(
        "--dry-run",
        action="store_true",
        help="show anomalous records without changing review.json",
    )
    sp.set_defaults(func=cmd_knowledge, knowledge_action="quarantine-review-anomalies")
    sp = ps.add_parser("use")
    sp.add_argument("provider_name")
    sp.set_defaults(func=cmd_knowledge, knowledge_action="use")
    sp = ps.add_parser("set-path")
    sp.add_argument("path")
    sp.set_defaults(func=cmd_knowledge, knowledge_action="set-path")
    sp = ps.add_parser("init")
    sp.add_argument("--path")
    sp.set_defaults(func=cmd_knowledge, knowledge_action="init")
    for name in ["start", "stop", "restart", "doctor"]:
        ps.add_parser(name).set_defaults(func=cmd_knowledge, knowledge_action=name)

    p = sub.add_parser("sync", help="sync articles/topics via bridge")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_sync, sync_action="run")
    ps = p.add_subparsers(dest="sync_action")
    ps.add_parser("status").set_defaults(func=cmd_sync, sync_action="status")
    sp = ps.add_parser("full")
    sp.add_argument("--dry-run", action="store_true")
    sp.add_argument(
        "--local-only",
        action="store_true",
        help="export/inspect local knowledge but never write results to Lumina",
    )
    sp.add_argument(
        "--rebuild",
        action="store_true",
        help="delete local knowledge data, re-export all sources, then recompile/writeback",
    )
    sp.add_argument(
        "--yes",
        action="store_true",
        help="confirm destructive rebuild without prompt",
    )
    sp.set_defaults(func=cmd_sync, sync_action="full")
    sp = ps.add_parser("incremental")
    sp.add_argument("--dry-run", action="store_true")
    sp.add_argument(
        "--local-only",
        action="store_true",
        help="sync local files but never write results to Lumina",
    )
    sp.set_defaults(func=cmd_sync, sync_action="incremental")
    sp = ps.add_parser("article")
    sp.add_argument("article_id")
    sp.add_argument("--dry-run", action="store_true")
    sp.add_argument(
        "--local-only",
        action="store_true",
        help="sync the article locally but never write results to Lumina",
    )
    sp.set_defaults(func=cmd_sync, sync_action="article")

    sub.add_parser("status", help="aggregate local/remote status").set_defaults(func=cmd_status)
    p = sub.add_parser("doctor", help="diagnose local setup")
    p.add_argument("--strict", action="store_true")
    p.set_defaults(func=cmd_doctor)
    p = sub.add_parser("up", help="start bridge (+ provider if possible)")
    p.add_argument("--install", action="store_true", help="install bridge if missing")
    p.set_defaults(func=cmd_up)
    p = sub.add_parser("down", help="stop bridge")
    p.add_argument("--all", action="store_true", help="also attempt provider stop")
    p.set_defaults(func=cmd_down)

    p = sub.add_parser("articles", help="list/get articles via Lumina API")
    ps = p.add_subparsers(dest="articles_action", required=True)
    sp = ps.add_parser("list")
    sp.add_argument("--limit", type=int, default=20)
    sp.add_argument("--offset", type=int, default=0)
    sp.add_argument("--q")
    sp.add_argument("--topic")
    sp.set_defaults(func=cmd_articles, articles_action="list")
    sp = ps.add_parser("get")
    sp.add_argument("article_id")
    sp.set_defaults(func=cmd_articles, articles_action="get")

    p = sub.add_parser("topics", help="list/get topics via Lumina API")
    ps = p.add_subparsers(dest="topics_action", required=True)
    sp = ps.add_parser("list")
    sp.add_argument("--limit", type=int, default=50)
    sp.add_argument("--offset", type=int, default=0)
    sp.add_argument("--q")
    sp.set_defaults(func=cmd_topics, topics_action="list")
    sp = ps.add_parser("get")
    sp.add_argument("topic_key")
    sp.set_defaults(func=cmd_topics, topics_action="get")

    p = sub.add_parser("api", help="raw OpenAPI-style calls")
    ps = p.add_subparsers(dest="api_action", required=True)
    for method in ["get", "post", "put"]:
        sp = ps.add_parser(method)
        sp.add_argument("path")
        sp.add_argument("--param", action="append", default=[])
        if method != "get":
            sp.add_argument("--data", help="JSON body")
        sp.set_defaults(func=cmd_api, api_action=method)
    sp = ps.add_parser("call")
    sp.add_argument("method")
    sp.add_argument("path")
    sp.add_argument("--param", action="append", default=[])
    sp.add_argument("--data")
    sp.set_defaults(func=cmd_api, api_action="call")

    p = sub.add_parser("logs", help="show local logs")
    ps = p.add_subparsers(dest="target", required=True)
    sp = ps.add_parser("bridge")
    sp.add_argument("-n", "--lines", type=int, default=100)
    sp.set_defaults(func=cmd_logs, target="bridge")

    p = sub.add_parser("completion", help="print shell completion script")
    p.add_argument("shell", choices=["bash", "zsh", "fish"])
    p.set_defaults(func=cmd_completion)

    p = sub.add_parser("update", help="update cli/bridge")
    ps = p.add_subparsers(dest="update_target")
    p.set_defaults(func=cmd_update, update_target="all")
    ps.add_parser("cli").set_defaults(func=cmd_update, update_target="cli")
    ps.add_parser("bridge").set_defaults(func=cmd_update, update_target="bridge")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    raw = list(sys.argv[1:] if argv is None else argv)
    output = "table"
    try:
        gflags, remaining = _extract_global_flags(raw)
        output = gflags.get("output") or "table"
        remaining = _remap_deprecated_bridge_argv(remaining)
        parser = build_parser()
        args = parser.parse_args(remaining)
        ctx = build_context(
            config_path=gflags.get("config"),
            profile=gflags.get("profile"),
            output=gflags.get("output"),
            yes=bool(gflags.get("yes")),
            verbose=bool(gflags.get("verbose")),
            quiet=bool(gflags.get("quiet")),
            base_url=gflags.get("base_url"),
            token=gflags.get("token"),
        )
        if getattr(args, "yes", False) or ctx.yes:
            ctx.yes = True
            if hasattr(args, "yes"):
                args.yes = True
            # global --yes on init => non-interactive
            if getattr(args, "command", None) == "init" or getattr(args, "func", None).__name__ == "cmd_init":
                if hasattr(args, "non_interactive"):
                    args.non_interactive = True
        output = ctx.output
        func: Callable = args.func
        return int(func(ctx, args) or 0)
    except SystemExit as exc:
        return int(exc.code or 0)
    except CliError as exc:
        emit_error(exc, output=output)
        return int(exc.code or 1)
    except BrokenPipeError:
        return 0
    except KeyboardInterrupt:
        emit_error(CliError("interrupted", code=1, error_code="interrupted"), output=output)
        return 1
    except Exception as exc:  # noqa: BLE001
        emit_error(CliError(str(exc), code=1, error_code="internal_error"), output=output)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
