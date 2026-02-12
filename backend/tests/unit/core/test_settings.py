import pytest

from app.core.settings import AppSettings, MediaSettings, validate_startup_settings


def make_settings(**overrides) -> AppSettings:
    payload = {
        "DATABASE_URL": "sqlite:///./unit-tests.db",
        "INTERNAL_API_TOKEN": "test-token",
    }
    payload.update(overrides)
    return AppSettings(**payload)


@pytest.mark.parametrize(
    ("base_url", "expected"),
    [
        ("", "/backend/media"),
        ("media", "/media"),
        ("/media/", "/media"),
        ("/", "/backend/media"),
    ],
)
def test_media_settings_normalized_base_url(base_url: str, expected: str):
    media = MediaSettings(
        root="/tmp/media",
        base_url=base_url,
        public_base_url="",
        max_size=1024,
    )
    assert media.normalized_base_url == expected


def test_cors_allow_origins_supports_default_wildcard_json_and_csv():
    assert make_settings(ALLOWED_ORIGINS="").cors_allow_origins == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    assert make_settings(ALLOWED_ORIGINS="*").cors_allow_origins == ["*"]
    assert make_settings(ALLOWED_ORIGINS='["https://a.com", "https://b.com"]').cors_allow_origins == [
        "https://a.com",
        "https://b.com",
    ]
    assert make_settings(ALLOWED_ORIGINS="https://a.com, https://b.com").cors_allow_origins == [
        "https://a.com",
        "https://b.com",
    ]


def test_validate_startup_settings_accepts_valid_configuration():
    settings = make_settings()
    validate_startup_settings(settings)


def test_validate_startup_settings_reports_multiple_errors_together():
    settings = make_settings(
        INTERNAL_API_TOKEN="",
        SQLITE_BUSY_TIMEOUT_MS=0,
        AI_TASK_LOCK_TIMEOUT=10,
        AI_TASK_TIMEOUT=5,
    )
    with pytest.raises(RuntimeError) as exc_info:
        validate_startup_settings(settings)

    message = str(exc_info.value)
    assert "INTERNAL_API_TOKEN 不能为空" in message
    assert "SQLITE_BUSY_TIMEOUT_MS 必须大于 0" in message
    assert "AI_TASK_TIMEOUT 不能小于 AI_TASK_LOCK_TIMEOUT" in message
