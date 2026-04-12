from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.api.routers import model_api_router
from app.schemas.ai import ModelAPIConfigBase
from models import ModelAPIConfig


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_create_model_api_config_returns_explicit_api_type(db_session):
    payload = ModelAPIConfigBase(
        name="Responses Model",
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        provider="openai",
        model_name="gpt-4.1",
        model_type="general",
        api_type="responses",
        is_enabled=True,
        is_default=False,
    )

    response = await model_api_router.create_model_api_config(
        config=payload,
        db=db_session,
        _=True,
    )

    assert response["api_type"] == "responses"


@pytest.mark.anyio
async def test_get_model_api_configs_defaults_legacy_rows_to_chat_completions(
    db_session,
):
    row = ModelAPIConfig(
        name="Legacy Model",
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        provider="openai",
        model_name="gpt-4o",
        model_type="general",
        is_enabled=True,
        is_default=False,
    )
    db_session.add(row)
    db_session.commit()

    response = await model_api_router.get_model_api_configs(db=db_session, _=True)

    assert response[0]["api_type"] == "chat_completions"


def test_model_api_config_rejects_unknown_api_type():
    with pytest.raises(ValidationError):
        ModelAPIConfigBase(
            name="Bad API Type",
            base_url="https://api.openai.com/v1",
            api_key="sk-test",
            provider="openai",
            model_name="gpt-4o",
            model_type="general",
            api_type="legacy_completions",
        )
