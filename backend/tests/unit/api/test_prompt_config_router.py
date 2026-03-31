from __future__ import annotations

import pytest

from app.api.routers import prompt_config_router
from app.schemas import PromptConfigBase
from models import PromptConfig, now_str


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_create_prompt_config_ignores_response_format_and_hides_it(db_session):
    payload = PromptConfigBase(
        name="分类提示词",
        type="classification",
        prompt="请分类：{content}",
        system_prompt="只做分类判断",
        response_format="json_object",
        is_enabled=True,
        is_default=False,
    )

    response = await prompt_config_router.create_prompt_config(
        config=payload,
        db=db_session,
        _=True,
    )

    created = db_session.query(PromptConfig).filter(PromptConfig.name == "分类提示词").one()
    assert "response_format" not in response


@pytest.mark.anyio
async def test_update_prompt_config_clears_stored_response_format(db_session):
    existing = PromptConfig(
        name="旧标签提示词",
        type="tagging",
        prompt="旧提示词",
        system_prompt="旧 system",
        is_enabled=True,
        is_default=False,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(existing)
    db_session.commit()

    payload = PromptConfigBase(
        name="新标签提示词",
        type="tagging",
        prompt="新提示词",
        system_prompt="新 system",
        response_format="json_object",
        is_enabled=True,
        is_default=False,
    )

    response = await prompt_config_router.update_prompt_config(
        config_id=existing.id,
        config=payload,
        db=db_session,
        _=True,
    )

    updated = db_session.get(PromptConfig, existing.id)
    assert updated is not None
    assert updated.name == "新标签提示词"
    assert "response_format" not in response


def test_prompt_config_model_no_longer_exposes_response_format_column():
    assert "response_format" not in PromptConfig.__table__.columns
