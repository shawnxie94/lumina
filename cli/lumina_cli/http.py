from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from .errors import AuthError, CliError


@dataclass
class HttpResponse:
    status: int
    headers: dict[str, str]
    data: Any
    raw: bytes

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


class HttpClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str = "",
        timeout_sec: int = 30,
        token_header: str = "X-Internal-Token",
        bearer: bool = False,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token or ""
        self.timeout_sec = timeout_sec
        self.token_header = token_header
        self.bearer = bearer

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
        headers: dict[str, str] | None = None,
        raw_body: bytes | None = None,
        content_type: str | None = None,
    ) -> HttpResponse:
        url = path if path.startswith("http://") or path.startswith("https://") else f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        if params:
            query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            url = f"{url}?{query}" if query else url

        req_headers = {"Accept": "application/json", "User-Agent": "lumina-cli/0.1"}
        if headers:
            req_headers.update(headers)
        if self.token:
            if self.bearer:
                req_headers.setdefault("Authorization", f"Bearer {self.token}")
            else:
                req_headers.setdefault(self.token_header, self.token)
                req_headers.setdefault("Authorization", f"Bearer {self.token}")

        body = raw_body
        if json_body is not None:
            body = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            req_headers["Content-Type"] = content_type or "application/json"
        elif content_type and body is not None:
            req_headers["Content-Type"] = content_type

        request = urllib.request.Request(url, data=body, headers=req_headers, method=method.upper())
        context = ssl.create_default_context()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec, context=context) as resp:
                raw = resp.read()
                parsed = _parse_body(raw, resp.headers.get("Content-Type"))
                return HttpResponse(
                    status=getattr(resp, "status", 200),
                    headers={k: v for k, v in resp.headers.items()},
                    data=parsed,
                    raw=raw,
                )
        except urllib.error.HTTPError as exc:
            raw = exc.read() if hasattr(exc, "read") else b""
            parsed = _parse_body(raw, exc.headers.get("Content-Type") if exc.headers else None)
            if exc.code in {401, 403}:
                raise AuthError(
                    f"auth failed ({exc.code}) for {method.upper()} {url}",
                    hint="Check `lumina auth token set` / profile token",
                ) from exc
            message = None
            if isinstance(parsed, dict):
                message = parsed.get("detail") or parsed.get("error") or parsed.get("message")
            raise CliError(
                message or f"HTTP {exc.code} for {method.upper()} {url}",
                code=1,
                error_code="http_error",
                hint=f"status={exc.code}",
            ) from exc
        except urllib.error.URLError as exc:
            raise CliError(
                f"request failed: {exc.reason}",
                code=1,
                error_code="network_error",
                hint=f"Check connectivity to {self.base_url}",
            ) from exc

    def get(self, path: str, **kwargs: Any) -> HttpResponse:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> HttpResponse:
        return self.request("POST", path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> HttpResponse:
        return self.request("PUT", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> HttpResponse:
        return self.request("DELETE", path, **kwargs)


def _parse_body(raw: bytes, content_type: str | None) -> Any:
    if not raw:
        return None
    text = raw.decode("utf-8", errors="replace")
    ctype = (content_type or "").lower()
    if "json" in ctype or text[:1] in {"{", "["}:
        try:
            return json.loads(text)
        except Exception:
            return text
    return text
