from pathlib import Path

from app.core.db_migrations import resolve_database_url


def test_resolve_database_url_prefers_explicit_override():
    assert (
        resolve_database_url(
            override_url="sqlite:///override.db",
            env_url="sqlite:///env.db",
            ini_url="sqlite:///ini.db",
            settings_url="sqlite:///settings.db",
        )
        == "sqlite:///override.db"
    )


def test_resolve_database_url_prefers_env_over_ini():
    assert (
        resolve_database_url(
            env_url="sqlite:///env.db",
            ini_url="sqlite:///ini.db",
            settings_url="sqlite:///settings.db",
        )
        == "sqlite:///env.db"
    )


def test_resolve_database_url_falls_back_to_ini_then_settings():
    assert (
        resolve_database_url(
            ini_url="sqlite:///ini.db",
            settings_url="sqlite:///settings.db",
        )
        == "sqlite:///ini.db"
    )
    assert (
        resolve_database_url(settings_url="sqlite:///settings.db")
        == "sqlite:///settings.db"
    )


def test_infographic_related_migrations_are_ordered_and_explicit():
    versions_dir = Path(__file__).resolve().parents[3] / "alembic" / "versions"
    infographic_migrations = sorted(versions_dir.glob("*infographic*.py"))

    assert [path.name for path in infographic_migrations] == [
        "20260326_0011_ai_infographic.py",
        "20260326_0012_rss_toggle_and_infographic_image.py",
    ]
