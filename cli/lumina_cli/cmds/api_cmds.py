from __future__ import annotations

import argparse
import json
from typing import Any

from ..context import CliContext
from ..errors import CliError
from ..output import emit


def _parse_json_arg(value: str | None) -> Any:
    if value is None:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise CliError(f"invalid JSON body: {exc}", error_code="invalid_json") from exc


def cmd_api(ctx: CliContext, args: argparse.Namespace) -> int:
    client = ctx.remote_client()
    action = args.api_action
    path = args.path
    if not path.startswith("/"):
        path = "/" + path
    params = {}
    if getattr(args, "param", None):
        for item in args.param:
            if "=" not in item:
                raise CliError(f"invalid --param {item}, expected key=value")
            k, v = item.split("=", 1)
            params[k] = v
    body = _parse_json_arg(getattr(args, "data", None))
    if action == "get":
        resp = client.get(path, params=params or None)
    elif action == "post":
        resp = client.post(path, params=params or None, json_body=body if body is not None else {})
    elif action == "put":
        resp = client.put(path, params=params or None, json_body=body if body is not None else {})
    elif action == "call":
        method = (args.method or "GET").upper()
        resp = client.request(method, path, params=params or None, json_body=body)
    else:
        raise CliError(f"unknown api action: {action}")
    emit(
        {
            "status": resp.status,
            "data": resp.data,
        },
        output=ctx.output,
        ok=resp.ok,
    )
    return 0 if resp.ok else 1


def cmd_articles(ctx: CliContext, args: argparse.Namespace) -> int:
    client = ctx.remote_client()
    action = args.articles_action
    if action == "list":
        params = {
            "limit": getattr(args, "limit", None) or 20,
            "offset": getattr(args, "offset", None) or 0,
        }
        if getattr(args, "q", None):
            params["q"] = args.q
        if getattr(args, "topic", None):
            params["topic"] = args.topic
        resp = client.get("/api/articles", params=params)
        data = resp.data
        # normalize rows if possible
        rows = data
        if isinstance(data, dict):
            rows = data.get("items") or data.get("articles") or data.get("data") or data
        emit(rows, output=ctx.output, ok=resp.ok)
        return 0 if resp.ok else 1
    if action == "get":
        article_id = args.article_id
        resp = client.get(f"/api/articles/{article_id}")
        emit(resp.data, output=ctx.output, ok=resp.ok)
        return 0 if resp.ok else 1
    raise CliError(f"unknown articles action: {action}")


def cmd_topics(ctx: CliContext, args: argparse.Namespace) -> int:
    client = ctx.remote_client()
    action = args.topics_action
    if action == "list":
        params = {
            "limit": getattr(args, "limit", None) or 50,
            "offset": getattr(args, "offset", None) or 0,
        }
        if getattr(args, "q", None):
            params["q"] = args.q
        resp = client.get("/api/topics", params=params)
        data = resp.data
        rows = data
        if isinstance(data, dict):
            rows = data.get("items") or data.get("topics") or data.get("data") or data
        emit(rows, output=ctx.output, ok=resp.ok)
        return 0 if resp.ok else 1
    if action == "get":
        key = args.topic_key
        resp = client.get(f"/api/topics/{key}")
        emit(resp.data, output=ctx.output, ok=resp.ok)
        return 0 if resp.ok else 1
    raise CliError(f"unknown topics action: {action}")


def cmd_logs(ctx: CliContext, args: argparse.Namespace) -> int:
    target = args.target
    if target == "bridge":
        from ..bridge_runtime import BridgeRuntime

        rt = BridgeRuntime(ctx.profile, ctx.project)
        text = rt.logs(lines=int(args.lines or 100))
        if ctx.output == "json":
            emit({"target": "bridge", "log_file": str(rt.log_file), "content": text}, output="json")
        else:
            print(text)
        return 0
    raise CliError(f"unknown logs target: {target}")


def cmd_update(ctx: CliContext, args: argparse.Namespace) -> int:
    target = getattr(args, "update_target", None) or "all"
    results = {}
    if target in {"all", "cli"}:
        results["cli"] = {
            "ok": True,
            "message": "Re-run install script to update CLI",
            "command": "curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-lumina-cli.sh | bash",
        }
    if target in {"all", "bridge"}:
        from ..bridge_runtime import BridgeRuntime

        rt = BridgeRuntime(ctx.profile, ctx.project)
        results["bridge"] = rt.install(force=True, yes=True, start=True, init_project=False)
    emit({"ok": True, "updated": results}, output=ctx.output)
    return 0
