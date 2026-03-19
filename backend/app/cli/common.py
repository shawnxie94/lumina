from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse, urlunparse

from app.cli.errors import CLIError

ENV_BASE_URL = "LUMINA_BASE_URL"
ENV_ADMIN_TOKEN = "LUMINA_ADMIN_TOKEN"
ENV_ADMIN_PASSWORD = "LUMINA_ADMIN_PASSWORD"


@dataclass(frozen=True)
class CLIContext:
    mode: str
    json_output: bool
    command_name: str
    base_url: str | None
    admin_token: str | None
    password: str | None
    timeout: float
    database_url: str | None


class CLIArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise CLIError(
            code="invalid_arguments",
            message=message,
            exit_code=2,
        )


def parse_optional_bool(value: str) -> bool:
    normalized = (value or "").strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise argparse.ArgumentTypeError("布尔值仅支持 true/false")


def trim_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def normalize_remote_base_url(value: str | None) -> str | None:
    base_url = trim_to_none(value)
    if not base_url:
        return None

    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise CLIError(
            code="invalid_base_url",
            message="远程模式要求 --base-url 为有效的 http/https 地址",
            exit_code=2,
        )

    path = parsed.path.rstrip("/")
    if not path:
        path = "/backend"
    elif path.endswith("/backend/api"):
        path = path[: -len("/api")]
    normalized = parsed._replace(path=path, params="", query="", fragment="")
    return urlunparse(normalized).rstrip("/")


def resolve_mode(args: argparse.Namespace) -> str:
    explicit_mode = trim_to_none(getattr(args, "mode", None))
    if explicit_mode:
        return explicit_mode
    base_url = trim_to_none(getattr(args, "base_url", None)) or trim_to_none(
        os.environ.get(ENV_BASE_URL)
    )
    return "remote" if base_url else "local"


def build_context(args: argparse.Namespace) -> CLIContext:
    mode = resolve_mode(args)
    base_url = normalize_remote_base_url(
        trim_to_none(getattr(args, "base_url", None)) or trim_to_none(os.environ.get(ENV_BASE_URL))
    )
    admin_token = trim_to_none(getattr(args, "admin_token", None)) or trim_to_none(
        os.environ.get(ENV_ADMIN_TOKEN)
    )
    password = trim_to_none(getattr(args, "password", None)) or trim_to_none(
        os.environ.get(ENV_ADMIN_PASSWORD)
    )
    timeout = getattr(args, "timeout", 30.0)
    try:
        timeout = float(timeout)
    except (TypeError, ValueError):
        raise CLIError(
            code="invalid_timeout",
            message="--timeout 必须是正数",
            exit_code=2,
        )
    if timeout <= 0:
        raise CLIError(
            code="invalid_timeout",
            message="--timeout 必须大于 0",
            exit_code=2,
        )
    return CLIContext(
        mode=mode,
        json_output=bool(getattr(args, "json_output", False)),
        command_name=getattr(args, "command_name"),
        base_url=base_url,
        admin_token=admin_token,
        password=password,
        timeout=timeout,
        database_url=trim_to_none(getattr(args, "database_url", None)),
    )


def load_json_input(input_path: str | None) -> dict[str, Any]:
    if not input_path:
        return {}
    try:
        if input_path == "-":
            raw = sys.stdin.read()
        else:
            with open(input_path, "r", encoding="utf-8") as fh:
                raw = fh.read()
    except OSError as exc:
        raise CLIError(
            code="input_read_error",
            message=f"读取输入失败：{exc}",
            exit_code=2,
        ) from exc

    try:
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise CLIError(
            code="invalid_input_json",
            message=f"输入不是合法 JSON：{exc}",
            exit_code=2,
        ) from exc

    if not isinstance(payload, dict):
        raise CLIError(
            code="invalid_input_json",
            message="输入 JSON 顶层必须是对象",
            exit_code=2,
        )
    return payload


def merge_payload(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in updates.items():
        if value is not None:
            merged[key] = value
    return merged


def print_success(ctx: CLIContext, data: Any) -> None:
    if ctx.json_output:
        payload = {
            "ok": True,
            "mode": ctx.mode,
            "command": ctx.command_name,
            "data": data,
        }
        print(json.dumps(payload, ensure_ascii=False))
        return

    if isinstance(data, dict) and "content" in data and isinstance(data["content"], str):
        print(data["content"])
        return

    print(json.dumps(data, ensure_ascii=False, indent=2))


def print_error(ctx: CLIContext | None, error: CLIError) -> None:
    if ctx is not None and ctx.json_output:
        payload = {
            "ok": False,
            "mode": ctx.mode,
            "command": ctx.command_name,
            "error": error.to_payload(),
        }
        print(json.dumps(payload, ensure_ascii=False))
        return
    print(error.message, file=sys.stderr)
