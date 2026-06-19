import asyncio

from app.api.routers.settings_router import (
    serialize_extraction_settings,
    update_extraction_settings,
)
from app.schemas.settings import ExtractionSettingsUpdate
from models import AdminSettings


def test_serialize_extraction_settings_maps_disabled_jina_to_local_only():
    admin = AdminSettings(
        password_hash="hash",
        jwt_secret="secret",
        jina_reader_enabled=False,
        jina_reader_prefer_mode="jina_first",
    )

    settings = serialize_extraction_settings(admin)

    assert settings["jina_reader_enabled"] is False
    assert settings["jina_reader_prefer_mode"] == "local_only"
    assert settings["auto_ai_outline_enabled"] is False
    assert settings["auto_ai_quotes_enabled"] is False


def test_update_extraction_settings_syncs_jina_enabled_from_prefer_mode(db_session):
    admin = AdminSettings(
        password_hash="hash",
        jwt_secret="secret",
        jina_reader_enabled=False,
        jina_reader_prefer_mode="local_only",
    )
    db_session.add(admin)
    db_session.commit()

    asyncio.run(
        update_extraction_settings(
            ExtractionSettingsUpdate(jina_reader_prefer_mode="local_first"),
            db_session,
            True,
        )
    )
    db_session.refresh(admin)

    assert admin.jina_reader_enabled is True
    assert admin.jina_reader_prefer_mode == "local_first"

    asyncio.run(
        update_extraction_settings(
            ExtractionSettingsUpdate(jina_reader_prefer_mode="local_only"),
            db_session,
            True,
        )
    )
    db_session.refresh(admin)

    assert admin.jina_reader_enabled is False
    assert admin.jina_reader_prefer_mode == "local_only"


def test_update_extraction_settings_saves_outline_and_quotes_toggles(db_session):
    admin = AdminSettings(
        password_hash="hash",
        jwt_secret="secret",
        jina_reader_enabled=False,
        jina_reader_prefer_mode="local_only",
        auto_ai_outline_enabled=False,
        auto_ai_quotes_enabled=False,
    )
    db_session.add(admin)
    db_session.commit()

    asyncio.run(
        update_extraction_settings(
            ExtractionSettingsUpdate(
                auto_ai_outline_enabled=True,
                auto_ai_quotes_enabled=True,
            ),
            db_session,
            True,
        )
    )
    db_session.refresh(admin)

    assert admin.auto_ai_outline_enabled is True
    assert admin.auto_ai_quotes_enabled is True


def test_update_extraction_settings_keeps_old_jina_enabled_payload_compatible(
    db_session,
):
    admin = AdminSettings(
        password_hash="hash",
        jwt_secret="secret",
        jina_reader_enabled=True,
        jina_reader_prefer_mode="jina_first",
    )
    db_session.add(admin)
    db_session.commit()

    asyncio.run(
        update_extraction_settings(
            ExtractionSettingsUpdate(jina_reader_enabled=False),
            db_session,
            True,
        )
    )
    db_session.refresh(admin)

    assert admin.jina_reader_enabled is False
    assert admin.jina_reader_prefer_mode == "local_only"


def test_update_extraction_settings_preserves_legacy_disabled_jina_without_mode(
    db_session,
):
    admin = AdminSettings(
        password_hash="hash",
        jwt_secret="secret",
        jina_reader_enabled=False,
        jina_reader_prefer_mode="jina_first",
    )
    db_session.add(admin)
    db_session.commit()

    asyncio.run(
        update_extraction_settings(
            ExtractionSettingsUpdate(jina_reader_base_url="https://r.jina.ai/"),
            db_session,
            True,
        )
    )
    db_session.refresh(admin)

    assert admin.jina_reader_enabled is False
    assert admin.jina_reader_prefer_mode == "local_only"
