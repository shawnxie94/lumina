from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx

from app.cli.common import CLIContext
from app.cli.errors import CLIError


class RemoteAdapter:
    def __init__(self, ctx: CLIContext, *, client: httpx.Client | None = None):
        if not ctx.base_url:
            raise CLIError(
                code="missing_base_url",
                message="远程模式需要提供 --base-url 或 LUMINA_BASE_URL",
                exit_code=3,
            )
        self.ctx = ctx
        self._client = client or httpx.Client(
            base_url=ctx.base_url,
            timeout=ctx.timeout,
            headers={"Content-Type": "application/json"},
        )
        self._owns_client = client is None
        self._authenticated = False
        self._origin = self._derive_origin(ctx.base_url)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    @staticmethod
    def _derive_origin(base_url: str) -> str:
        parsed = urlparse(base_url)
        return f"{parsed.scheme}://{parsed.netloc}"

    def _raise_for_response(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        detail: Any = None
        message = ""
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            detail = payload.get("detail", payload)
            if isinstance(detail, dict):
                message = str(detail.get("message") or detail.get("detail") or detail)
            else:
                message = str(detail)
        else:
            detail = response.text.strip() or None
            message = response.text.strip()
        if not message:
            message = f"远程请求失败（HTTP {response.status_code}）"

        if response.status_code == 401:
            code = "unauthorized"
            exit_code = 3
        elif response.status_code == 403:
            code = "forbidden"
            exit_code = 3
        elif response.status_code in {400, 422}:
            code = "bad_request" if response.status_code == 400 else "validation_error"
            exit_code = 2
        elif response.status_code in {404, 409}:
            code = "not_found" if response.status_code == 404 else "conflict"
            exit_code = 4
        else:
            code = "remote_error"
            exit_code = 5
        raise CLIError(code=code, message=message, exit_code=exit_code, details=detail)

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        require_auth: bool = False,
    ) -> Any:
        if require_auth:
            self.ensure_authenticated()
        try:
            response = self._client.request(
                method,
                path,
                params=params,
                json=json_body,
                headers=headers,
            )
        except httpx.TimeoutException as exc:
            raise CLIError(
                code="remote_timeout",
                message="远程请求超时",
                exit_code=5,
            ) from exc
        except httpx.HTTPError as exc:
            raise CLIError(
                code="remote_unreachable",
                message=f"远程请求失败：{exc}",
                exit_code=5,
            ) from exc
        self._raise_for_response(response)
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return response.text

    def ensure_authenticated(self) -> None:
        if self._authenticated:
            return
        token = self.ctx.admin_token
        if token:
            self._client.headers["Authorization"] = f"Bearer {token}"
            self._authenticated = True
            return
        if not self.ctx.password:
            raise CLIError(
                code="missing_credentials",
                message="远程命令需要 --admin-token 或 --password",
                exit_code=3,
            )
        payload = self._request(
            "POST",
            "/api/auth/login",
            json_body={"password": self.ctx.password},
            require_auth=False,
        )
        token = payload.get("token") if isinstance(payload, dict) else None
        if not token:
            raise CLIError(
                code="login_failed",
                message="远程登录失败，未获取到 token",
                exit_code=3,
                details=payload,
            )
        self._client.headers["Authorization"] = f"Bearer {token}"
        self._authenticated = True

    def system_doctor(self) -> dict[str, Any]:
        auth_status = self._request("GET", "/api/auth/status")
        result = {
            "base_url": self.ctx.base_url,
            "reachable": True,
            "auth_status": auth_status,
            "authenticated": False,
        }
        if self.ctx.admin_token or self.ctx.password:
            verify = self._request("GET", "/api/auth/verify", require_auth=True)
            result["authenticated"] = bool(verify.get("valid")) if isinstance(verify, dict) else False
            result["auth_verify"] = verify
        return result

    def db_migrate(self) -> dict[str, Any]:
        raise CLIError(
            code="unsupported_mode",
            message="db migrate 仅支持 local 模式",
            exit_code=3,
        )

    def article_list(self, args) -> dict[str, Any]:
        payload = self._request(
            "GET",
            "/api/articles",
            params={
                "page": args.page,
                "size": args.size,
                "category_id": args.category_id,
                "search": args.search,
                "source_domain": args.source_domain,
                "author": args.author,
                "is_visible": args.is_visible,
                "published_at_start": args.published_at_start,
                "published_at_end": args.published_at_end,
                "created_at_start": args.created_at_start,
                "created_at_end": args.created_at_end,
                "sort_by": args.sort_by,
            },
            require_auth=True,
        )
        return {"items": payload["data"], "pagination": payload["pagination"]}

    def article_get(self, args) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/articles/{args.article_slug}",
            require_auth=True,
        )

    def article_create(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/articles",
            json_body=payload,
            require_auth=True,
        )

    def article_report_url(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/articles/report-url",
            json_body=payload,
            require_auth=True,
        )

    def article_update(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "PUT",
            f"/api/articles/{args.article_slug}",
            json_body=payload,
            require_auth=True,
        )

    def article_delete(self, args) -> dict[str, Any]:
        return self._request(
            "DELETE",
            f"/api/articles/{args.article_slug}",
            require_auth=True,
        )

    def article_export(self, args) -> dict[str, Any]:
        payload = {
            "article_slugs": args.article_slugs,
            "category_id": args.category_id,
            "search": args.search,
            "source_domain": args.source_domain,
            "author": args.author,
            "is_visible": args.is_visible,
            "published_at_start": args.published_at_start,
            "published_at_end": args.published_at_end,
            "created_at_start": args.created_at_start,
            "created_at_end": args.created_at_end,
        }
        headers = {"Origin": getattr(args, "public_base_url", None) or self._origin}
        return self._request(
            "POST",
            "/api/export",
            json_body=payload,
            headers=headers,
            require_auth=True,
        )

    def article_retry(self, args) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/articles/{args.article_slug}/retry",
            params={
                "model_config_id": args.model_config_id,
                "prompt_config_id": args.prompt_config_id,
            },
            require_auth=True,
        )

    def article_retry_translation(self, args) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/articles/{args.article_slug}/retry-translation",
            params={
                "model_config_id": args.model_config_id,
                "prompt_config_id": args.prompt_config_id,
            },
            require_auth=True,
        )

    def article_generate(self, args) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/articles/{args.article_slug}/generate/{args.content_type}",
            params={
                "model_config_id": args.model_config_id,
                "prompt_config_id": args.prompt_config_id,
            },
            require_auth=True,
        )

    def category_list(self, args) -> list[dict[str, Any]]:
        return self._request("GET", "/api/categories", require_auth=False)

    def task_list(self, args) -> dict[str, Any]:
        payload = self._request(
            "GET",
            "/api/ai-tasks",
            params={
                "page": args.page,
                "size": args.size,
                "status": args.status,
                "task_type": args.task_type,
                "content_type": args.content_type,
                "article_id": args.article_id,
                "article_title": args.article_title,
            },
            require_auth=True,
        )
        return {"items": payload["data"], "pagination": payload["pagination"]}

    def task_get(self, args) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/ai-tasks/{args.task_id}",
            require_auth=True,
        )

    def task_timeline(self, args) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/ai-tasks/{args.task_id}/timeline",
            require_auth=True,
        )

    def task_retry(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/ai-tasks/retry",
            json_body=payload,
            require_auth=True,
        )

    def task_cancel(self, args, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/ai-tasks/cancel",
            json_body=payload,
            require_auth=True,
        )
