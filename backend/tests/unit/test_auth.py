from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

import auth
from app.api.routers import auth_router
from models import get_db


def create_auth_test_client(db_session):
    app = FastAPI()
    app.include_router(auth_router.router)

    @app.get("/protected")
    async def protected(_: bool = Depends(auth.get_current_admin)):
        return {"ok": True}

    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def test_login_sets_http_only_admin_cookie(db_session):
    client = create_auth_test_client(db_session)
    auth.create_admin_settings(db_session, "secret123")

    response = client.post("/api/auth/login", json={"password": "secret123"})

    assert response.status_code == 200
    assert "token" in response.json()
    set_cookie = response.headers.get("set-cookie", "")
    assert "lumina_admin_token=" in set_cookie
    assert "HttpOnly" in set_cookie


def test_cookie_can_access_admin_protected_route(db_session):
    client = create_auth_test_client(db_session)
    admin = auth.create_admin_settings(db_session, "secret123")
    token = auth.create_token(admin.jwt_secret)
    client.cookies.set("lumina_admin_token", token)

    response = client.get("/protected")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_logout_clears_admin_cookie(db_session):
    client = create_auth_test_client(db_session)
    auth.create_admin_settings(db_session, "secret123")

    login_response = client.post("/api/auth/login", json={"password": "secret123"})
    assert login_response.status_code == 200

    response = client.post("/api/auth/logout")

    assert response.status_code == 200
    set_cookie = response.headers.get("set-cookie", "")
    assert "lumina_admin_token=" in set_cookie
    assert "Max-Age=0" in set_cookie or "max-age=0" in set_cookie.lower()


def test_verify_backfills_cookie_from_bearer_token(db_session):
    client = create_auth_test_client(db_session)
    admin = auth.create_admin_settings(db_session, "secret123")
    token = auth.create_token(admin.jwt_secret)

    response = client.get(
        "/api/auth/verify",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json() == {"valid": True, "role": "admin"}
    set_cookie = response.headers.get("set-cookie", "")
    assert "lumina_admin_token=" in set_cookie
    assert "HttpOnly" in set_cookie


def test_extension_token_returns_token_for_authenticated_admin(db_session):
    client = create_auth_test_client(db_session)
    admin = auth.create_admin_settings(db_session, "secret123")
    token = auth.create_token(admin.jwt_secret)
    client.cookies.set("lumina_admin_token", token)

    response = client.post("/api/auth/extension-token")

    assert response.status_code == 200
    payload = response.json()
    assert payload["token"]
    assert payload["message"] == "扩展授权 token 已生成"
