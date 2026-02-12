from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.schemas import PromptConfigBase
from auth import get_current_admin
from models import ModelAPIConfig, PromptConfig, get_db

router = APIRouter()


def serialize_prompt_config(config: PromptConfig) -> dict:
    return {
        "id": config.id,
        "name": config.name,
        "category_id": config.category_id,
        "category_name": config.category.name if config.category else None,
        "type": config.type,
        "prompt": config.prompt,
        "system_prompt": config.system_prompt,
        "response_format": config.response_format,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "top_p": config.top_p,
        "chunk_size_tokens": config.chunk_size_tokens,
        "chunk_overlap_tokens": config.chunk_overlap_tokens,
        "max_continue_rounds": config.max_continue_rounds,
        "model_api_config_id": config.model_api_config_id,
        "model_api_config_name": config.model_api_config.name
        if config.model_api_config
        else None,
        "is_enabled": config.is_enabled,
        "is_default": config.is_default,
        "created_at": config.created_at,
        "updated_at": config.updated_at,
    }


def _has_advanced_chunk_options(config: PromptConfigBase) -> bool:
    return any(
        value is not None
        for value in (
            config.chunk_size_tokens,
            config.chunk_overlap_tokens,
            config.max_continue_rounds,
        )
    )


def _validate_advanced_chunk_options(config: PromptConfigBase, db: Session) -> None:
    if not _has_advanced_chunk_options(config):
        return

    if (
        config.chunk_size_tokens is None
        or config.chunk_overlap_tokens is None
        or config.max_continue_rounds is None
    ):
        raise HTTPException(
            status_code=400,
            detail="已启用高级分块参数时，必须同时填写 chunk_size_tokens、chunk_overlap_tokens、max_continue_rounds",
        )

    if config.chunk_size_tokens <= 0:
        raise HTTPException(status_code=400, detail="chunk_size_tokens 必须大于 0")
    if config.chunk_overlap_tokens < 0:
        raise HTTPException(status_code=400, detail="chunk_overlap_tokens 不能小于 0")
    if config.max_continue_rounds < 0:
        raise HTTPException(status_code=400, detail="max_continue_rounds 不能小于 0")

    if not config.model_api_config_id:
        raise HTTPException(
            status_code=400,
            detail="配置高级分块参数时，必须绑定模型配置（model_api_config_id）",
        )

    model_config = (
        db.query(ModelAPIConfig)
        .filter(ModelAPIConfig.id == config.model_api_config_id)
        .first()
    )
    if not model_config:
        raise HTTPException(status_code=400, detail="绑定的模型配置不存在")

    if model_config.context_window_tokens is None:
        raise HTTPException(
            status_code=400,
            detail="绑定模型未配置 context_window_tokens，无法启用高级分块参数",
        )
    if model_config.reserve_output_tokens is None:
        raise HTTPException(
            status_code=400,
            detail="绑定模型未配置 reserve_output_tokens，无法启用高级分块参数",
        )


@router.get("/api/prompt-configs")
async def get_prompt_configs(
    category_id: Optional[str] = None,
    type: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    query = db.query(PromptConfig)
    if category_id:
        query = query.filter(PromptConfig.category_id == category_id)
    if type:
        query = query.filter(PromptConfig.type == type)

    configs = query.order_by(PromptConfig.created_at.desc()).all()
    return [serialize_prompt_config(config) for config in configs]


@router.get("/api/prompt-configs/{config_id}")
async def get_prompt_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(PromptConfig).filter(PromptConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="提示词配置不存在")
    return serialize_prompt_config(config)


@router.post("/api/prompt-configs")
async def create_prompt_config(
    config: PromptConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        _validate_advanced_chunk_options(config, db)

        if config.is_default:
            db.query(PromptConfig).filter(
                PromptConfig.type == config.type,
                PromptConfig.is_default == True,
            ).update({"is_default": False})

        new_config = PromptConfig(**config.dict())
        db.add(new_config)
        db.commit()
        db.refresh(new_config)
        return serialize_prompt_config(new_config)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/api/prompt-configs/{config_id}")
async def update_prompt_config(
    config_id: str,
    config: PromptConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    existing_config = db.query(PromptConfig).filter(PromptConfig.id == config_id).first()
    if not existing_config:
        raise HTTPException(status_code=404, detail="提示词配置不存在")

    try:
        _validate_advanced_chunk_options(config, db)

        if config.is_default:
            db.query(PromptConfig).filter(
                PromptConfig.type == config.type,
                PromptConfig.is_default == True,
                PromptConfig.id != config_id,
            ).update({"is_default": False})

        existing_config.name = config.name
        existing_config.category_id = config.category_id
        existing_config.type = config.type
        existing_config.prompt = config.prompt
        existing_config.system_prompt = config.system_prompt
        existing_config.response_format = config.response_format
        existing_config.temperature = config.temperature
        existing_config.max_tokens = config.max_tokens
        existing_config.top_p = config.top_p
        existing_config.chunk_size_tokens = config.chunk_size_tokens
        existing_config.chunk_overlap_tokens = config.chunk_overlap_tokens
        existing_config.max_continue_rounds = config.max_continue_rounds
        existing_config.model_api_config_id = config.model_api_config_id
        existing_config.is_enabled = config.is_enabled
        existing_config.is_default = config.is_default

        db.commit()
        db.refresh(existing_config)
        return serialize_prompt_config(existing_config)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/prompt-configs/{config_id}")
async def delete_prompt_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(PromptConfig).filter(PromptConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="提示词配置不存在")

    db.delete(config)
    db.commit()
    return {"message": "删除成功"}
