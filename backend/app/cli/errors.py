from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException


@dataclass
class CLIError(Exception):
    code: str
    message: str
    exit_code: int
    details: Any = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


def _exit_code_from_status(status_code: int) -> int:
    if status_code in {400, 401, 403, 412, 422}:
        return 3 if status_code in {401, 403} else 2
    if status_code in {404, 409}:
        return 4
    if status_code >= 500:
        return 5
    return 5


def _code_from_status(status_code: int) -> str:
    if status_code == 400:
        return "bad_request"
    if status_code == 401:
        return "unauthorized"
    if status_code == 403:
        return "forbidden"
    if status_code == 404:
        return "not_found"
    if status_code == 409:
        return "conflict"
    if status_code == 422:
        return "validation_error"
    if status_code >= 500:
        return "remote_error"
    return f"http_{status_code}"


def cli_error_from_http_exception(exc: HTTPException) -> CLIError:
    detail = exc.detail
    if isinstance(detail, dict):
        message = str(detail.get("message") or detail.get("detail") or detail)
    else:
        message = str(detail)
    return CLIError(
        code=_code_from_status(exc.status_code),
        message=message,
        exit_code=_exit_code_from_status(exc.status_code),
        details=detail,
    )
