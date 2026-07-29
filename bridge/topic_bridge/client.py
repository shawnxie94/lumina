from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlencode

from .config import BridgeConfig


class LuminaClient:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        query = f"?{urlencode(params)}" if params else ""
        url = f"{self.config.lumina_base_url}{path}{query}"
        data = None
        headers = {
            "Accept": "application/json",
            # Cloudflare Bot Fight / WAF may block bare urllib UA with 1010.
            "User-Agent": "lumina-bridge/0.1",
            "X-Internal-Token": self.config.lumina_internal_token,
        }
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Lumina {method} {path} failed: {exc.code} {detail}") from exc

    def export_articles(self, updated_after: str | None = None) -> list[dict[str, Any]]:
        page = 1
        size = 50
        rows: list[dict[str, Any]] = []
        while True:
            params: dict[str, Any] = {"page": page, "size": size}
            if updated_after:
                params["updated_after"] = updated_after
            payload = self._request("GET", "/api/topics/export/articles", params=params)
            batch = payload.get("data") or []
            if not isinstance(batch, list):
                break
            rows.extend([item for item in batch if isinstance(item, dict)])
            pagination = payload.get("pagination") or {}
            total_pages = int(pagination.get("total_pages") or 1)
            if page >= total_pages or not batch:
                break
            page += 1
        return rows

    def write_compile_results(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/topics/compile-results", payload=payload)

