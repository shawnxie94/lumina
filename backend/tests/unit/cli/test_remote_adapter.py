from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

from app.cli.common import CLIContext
from app.cli.errors import CLIError
from app.cli.remote_adapter import RemoteAdapter


def make_ctx(**overrides) -> CLIContext:
    payload = {
        "mode": "remote",
        "json_output": True,
        "command_name": "article.list",
        "base_url": "https://lumina.test/backend",
        "admin_token": None,
        "password": None,
        "timeout": 5.0,
        "database_url": None,
    }
    payload.update(overrides)
    return CLIContext(**payload)


def make_article_list_args():
    return SimpleNamespace(
        page=1,
        size=20,
        category_id=None,
        search=None,
        source_domain=None,
        author=None,
        is_visible=None,
        published_at_start=None,
        published_at_end=None,
        created_at_start=None,
        created_at_end=None,
        sort_by="created_at_desc",
    )


def test_remote_adapter_logs_in_with_password_and_lists_articles():
    seen_auth_headers: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_auth_headers.append(request.headers.get("Authorization"))
        if request.url.path == "/backend/api/auth/login":
            return httpx.Response(200, json={"token": "jwt-token", "message": "登录成功"})
        if request.url.path == "/backend/api/articles":
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "1", "slug": "cli-article", "title": "CLI"}],
                    "pagination": {"page": 1, "size": 20, "total": 1, "total_pages": 1},
                },
            )
        raise AssertionError(f"unexpected path: {request.url.path}")

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://lumina.test/backend",
    )
    adapter = RemoteAdapter(make_ctx(password="secret"), client=client)
    try:
        payload = adapter.article_list(make_article_list_args())
    finally:
        adapter.close()

    assert payload["items"][0]["slug"] == "cli-article"
    assert seen_auth_headers == [None, "Bearer jwt-token"]


def test_remote_adapter_maps_conflict_to_cli_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/backend/api/articles/report-url":
            return httpx.Response(
                409,
                json={
                    "detail": {
                        "code": "source_url_exists",
                        "existing": {"id": "article-1", "slug": "dup-article"},
                    }
                },
            )
        raise AssertionError(f"unexpected path: {request.url.path}")

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://lumina.test/backend",
        headers={"Authorization": "Bearer token"},
    )
    adapter = RemoteAdapter(make_ctx(admin_token="token", command_name="article.report-url"), client=client)
    try:
        with pytest.raises(CLIError) as exc_info:
            adapter.article_report_url(
                SimpleNamespace(),
                {"url": "https://example.com/dup"},
            )
    finally:
        adapter.close()

    assert exc_info.value.code == "conflict"
    assert exc_info.value.exit_code == 4
