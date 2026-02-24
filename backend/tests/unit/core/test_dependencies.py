from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core import dependencies


def test_build_basic_settings_returns_copy_of_defaults():
    result = dependencies.build_basic_settings(None)
    assert result == dependencies.DEFAULT_BASIC_SETTINGS
    assert result is not dependencies.DEFAULT_BASIC_SETTINGS

    result["site_name"] = "Changed"
    assert dependencies.DEFAULT_BASIC_SETTINGS["site_name"] == "Lumina"


def test_build_basic_settings_prefers_admin_values_and_fallbacks():
    admin = SimpleNamespace(
        default_language=None,
        site_name="",
        site_description="测试描述",
        site_logo_url=None,
        home_badge_text="Badge",
        home_tagline_text=None,
        home_primary_button_text="Read",
        home_primary_button_url="/list",
        home_secondary_button_text=None,
        home_secondary_button_url="https://example.com",
    )
    result = dependencies.build_basic_settings(admin)

    assert result["default_language"] == "zh-CN"
    assert result["site_name"] == "Lumina"
    assert result["site_description"] == "测试描述"
    assert result["site_logo_url"] == ""
    assert result["home_badge_text"] == "Badge"
    assert result["home_primary_button_url"] == "/list"
    assert result["home_secondary_button_url"] == "https://example.com"


def test_validate_home_button_url_allows_internal_and_http_links():
    assert dependencies.validate_home_button_url("/list", "home_primary_button_url") == "/list"
    assert dependencies.validate_home_button_url(
        "https://example.com",
        "home_primary_button_url",
    ) == "https://example.com"
    assert dependencies.validate_home_button_url(
        "http://example.com",
        "home_primary_button_url",
    ) == "http://example.com"


def test_validate_home_button_url_rejects_invalid_scheme():
    with pytest.raises(HTTPException) as exc_info:
        dependencies.validate_home_button_url("ftp://example.com", "home_primary_button_url")
    assert exc_info.value.status_code == 400
    assert "home_primary_button_url仅支持" in exc_info.value.detail


def test_normalize_date_bound_handles_date_iso_z_and_invalid_values():
    assert dependencies.normalize_date_bound("2026-02-01", is_end=False) == "2026-02-01T00:00:00+00:00"
    assert dependencies.normalize_date_bound("2026-02-01", is_end=True) == "2026-02-01T23:59:59+00:00"
    assert dependencies.normalize_date_bound("2026-02-01T12:30:00+08:00", is_end=False) == "2026-02-01T12:30:00+08:00"
    assert dependencies.normalize_date_bound("2026-02-01T12:30:00Z", is_end=False) == "2026-02-01T12:30:00+00:00"
    assert dependencies.normalize_date_bound("not-a-date", is_end=False) is None


def test_comments_enabled_defaults_true_when_admin_settings_missing(monkeypatch):
    monkeypatch.setattr(dependencies, "get_admin_settings", lambda db: None)
    assert dependencies.comments_enabled(object()) is True


def test_comments_enabled_reads_admin_flag(monkeypatch):
    monkeypatch.setattr(
        dependencies,
        "get_admin_settings",
        lambda db: SimpleNamespace(comments_enabled=False),
    )
    assert dependencies.comments_enabled(object()) is False


def test_get_sensitive_words_and_contains_sensitive_word(monkeypatch):
    monkeypatch.setattr(
        dependencies,
        "get_admin_settings",
        lambda db: SimpleNamespace(
            sensitive_filter_enabled=True,
            sensitive_words="foo, bar\nbaz \n",
        ),
    )
    enabled, words = dependencies.get_sensitive_words(object())
    assert enabled is True
    assert words == ["foo", "bar", "baz"]

    assert dependencies.contains_sensitive_word("this has bar content", words) is True
    assert dependencies.contains_sensitive_word("clean text", words) is False


def test_check_is_admin_or_internal_returns_true_for_internal_request(monkeypatch):
    monkeypatch.setattr(dependencies, "is_internal_request", lambda request: True)
    checker = dependencies.check_is_admin_or_internal(
        request=SimpleNamespace(headers={}),
        credentials=None,
        db=object(),
    )
    assert checker is True


def test_check_is_admin_or_internal_falls_back_to_admin_check(monkeypatch):
    monkeypatch.setattr(dependencies, "is_internal_request", lambda request: False)
    monkeypatch.setattr(
        dependencies,
        "check_is_admin",
        lambda credentials, db: credentials == "token",
    )

    assert (
        dependencies.check_is_admin_or_internal(
            request=SimpleNamespace(headers={}),
            credentials="token",
            db=object(),
        )
        is True
    )
    assert (
        dependencies.check_is_admin_or_internal(
            request=SimpleNamespace(headers={}),
            credentials=None,
            db=object(),
        )
        is False
    )
