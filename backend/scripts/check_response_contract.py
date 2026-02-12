#!/usr/bin/env python3
"""Check key API response contracts against a baseline."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BACKEND_DIR = Path(__file__).resolve().parents[1]
BASELINE_DEFAULT_PATH = BACKEND_DIR / "scripts" / "response_contract_baseline.json"


@dataclass(frozen=True)
class ContractCase:
    name: str
    method: str
    path: str
    expected_statuses: tuple[int, ...]
    body_type: str | None
    required_paths: tuple[str, ...]
    required_when_nonempty_paths: tuple[str, ...]


def load_cases(path: Path) -> list[ContractCase]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("response baseline 必须是数组")

    cases: list[ContractCase] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("response baseline 条目必须是对象")

        name = str(item.get("name") or "").strip()
        method = str(item.get("method") or "GET").upper().strip()
        path_value = str(item.get("path") or "").strip()
        expected = item.get("expected_status")
        body_type = item.get("body_type")
        required_paths = item.get("required_paths") or []
        required_when_nonempty = item.get("required_when_nonempty_paths") or []

        if not name:
            raise ValueError("response baseline 条目缺少 name")
        if not path_value.startswith("/"):
            raise ValueError(f"{name}: path 必须以 / 开头")

        if isinstance(expected, int):
            expected_statuses = (expected,)
        elif isinstance(expected, list) and expected and all(isinstance(v, int) for v in expected):
            expected_statuses = tuple(expected)
        else:
            raise ValueError(f"{name}: expected_status 必须是 int 或 int 数组")

        if body_type is not None and body_type not in {
            "object",
            "array",
            "string",
            "number",
            "boolean",
            "null",
        }:
            raise ValueError(f"{name}: 不支持的 body_type: {body_type}")

        cases.append(
            ContractCase(
                name=name,
                method=method,
                path=path_value,
                expected_statuses=expected_statuses,
                body_type=body_type,
                required_paths=tuple(str(v) for v in required_paths),
                required_when_nonempty_paths=tuple(str(v) for v in required_when_nonempty),
            )
        )

    return cases


def parse_json_body(raw_body: bytes) -> Any:
    if not raw_body:
        return None
    return json.loads(raw_body.decode("utf-8"))


def is_expected_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return False


def path_exists(value: Any, pointer: str) -> bool:
    if pointer in {"", "/"}:
        return True
    if not pointer.startswith("/"):
        return False

    current = value
    for token in pointer.lstrip("/").split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict):
            if token not in current:
                return False
            current = current[token]
            continue
        if isinstance(current, list):
            if not token.isdigit():
                return False
            index = int(token)
            if index < 0 or index >= len(current):
                return False
            current = current[index]
            continue
        return False
    return True


def request_once(base_url: str, case: ContractCase) -> tuple[int, bytes]:
    url = f"{base_url.rstrip('/')}{case.path}"
    request = Request(url=url, method=case.method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, response.read()
    except HTTPError as exc:
        return exc.code, exc.read()
    except URLError as exc:
        raise RuntimeError(f"请求失败: {url} ({exc.reason})") from exc


def validate_case(base_url: str, case: ContractCase) -> list[str]:
    errors: list[str] = []

    try:
        status, raw_body = request_once(base_url, case)
    except Exception as exc:
        return [f"{case.name}: {exc}"]

    if status not in case.expected_statuses:
        expected = ",".join(str(v) for v in case.expected_statuses)
        errors.append(f"{case.name}: 状态码不匹配，期望 {expected}，实际 {status}")
        return errors

    if case.body_type is None and not case.required_paths and not case.required_when_nonempty_paths:
        return errors

    try:
        body = parse_json_body(raw_body)
    except Exception as exc:
        errors.append(f"{case.name}: JSON 解析失败 ({exc})")
        return errors

    if case.body_type and not is_expected_type(body, case.body_type):
        errors.append(f"{case.name}: body_type 不匹配，期望 {case.body_type}")
        return errors

    for pointer in case.required_paths:
        if not path_exists(body, pointer):
            errors.append(f"{case.name}: 缺少字段路径 {pointer}")

    if isinstance(body, list) and body:
        for pointer in case.required_when_nonempty_paths:
            if not path_exists(body, pointer):
                errors.append(f"{case.name}: 非空数组时缺少字段路径 {pointer}")

    if isinstance(body, dict) and case.required_when_nonempty_paths:
        for pointer in case.required_when_nonempty_paths:
            if pointer.startswith("/data/0") and isinstance(body.get("data"), list) and body["data"]:
                if not path_exists(body, pointer):
                    errors.append(f"{case.name}: data 非空时缺少字段路径 {pointer}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Check API response contract baseline")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000/backend",
        help="Base URL to verify, default: http://localhost:8000/backend",
    )
    parser.add_argument(
        "--baseline",
        default=str(BASELINE_DEFAULT_PATH),
        help="Response contract baseline json path",
    )
    parser.add_argument("--verbose", action="store_true", help="Print each case status")
    args = parser.parse_args()

    baseline_path = Path(args.baseline)
    if not baseline_path.exists():
        print(f"FAIL: response baseline file not found: {baseline_path}")
        return 1

    try:
        cases = load_cases(baseline_path)
    except Exception as exc:
        print(f"FAIL: 无法读取 response baseline: {exc}")
        return 1

    all_errors: list[str] = []
    for case in cases:
        case_errors = validate_case(args.base_url, case)
        if args.verbose:
            state = "PASS" if not case_errors else "FAIL"
            print(f"{state}: {case.name}")
        all_errors.extend(case_errors)

    print("Response contract check")
    print(f"  cases   : {len(cases)}")
    print(f"  failed  : {len(all_errors)}")

    if all_errors:
        for error in all_errors:
            print(f"  - {error}")
        print("\nFAIL: response contract mismatch detected.")
        return 1

    print("\nPASS: response contract matches baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
