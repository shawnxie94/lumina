from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.schemas import ModelAPIConfigBase, ModelAPIModelsRequest, ModelAPITestRequest
from auth import get_current_admin
from models import ModelAPIConfig, get_db

router = APIRouter()


def serialize_model_api_config(config: ModelAPIConfig) -> dict:
    return {
        "id": config.id,
        "name": config.name,
        "base_url": config.base_url,
        "api_key": config.api_key,
        "provider": config.provider or "openai",
        "model_name": config.model_name,
        "model_type": config.model_type or "general",
        "price_input_per_1k": config.price_input_per_1k,
        "price_output_per_1k": config.price_output_per_1k,
        "currency": config.currency,
        "context_window_tokens": config.context_window_tokens,
        "reserve_output_tokens": config.reserve_output_tokens,
        "is_enabled": config.is_enabled,
        "is_default": config.is_default,
        "created_at": config.created_at,
        "updated_at": config.updated_at,
    }


@router.get("/api/model-api-configs")
async def get_model_api_configs(
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    configs = db.query(ModelAPIConfig).order_by(ModelAPIConfig.created_at.desc()).all()
    return [serialize_model_api_config(config) for config in configs]


@router.get("/api/model-api-configs/{config_id}")
async def get_model_api_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")
    return serialize_model_api_config(config)


@router.post("/api/model-api-configs")
async def create_model_api_config(
    config: ModelAPIConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    try:
        if config.is_default:
            db.query(ModelAPIConfig).filter(ModelAPIConfig.is_default == True).update(
                {"is_default": False}
            )

        new_config = ModelAPIConfig(**config.dict())
        db.add(new_config)
        db.commit()
        db.refresh(new_config)
        return serialize_model_api_config(new_config)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/api/model-api-configs/{config_id}")
async def update_model_api_config(
    config_id: str,
    config: ModelAPIConfigBase,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    existing_config = (
        db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()
    )
    if not existing_config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    try:
        if config.is_default:
            db.query(ModelAPIConfig).filter(ModelAPIConfig.is_default == True).filter(
                ModelAPIConfig.id != config_id
            ).update({"is_default": False})

        existing_config.name = config.name
        existing_config.base_url = config.base_url
        existing_config.api_key = config.api_key
        existing_config.provider = config.provider or "openai"
        existing_config.model_name = config.model_name
        existing_config.model_type = config.model_type or "general"
        existing_config.price_input_per_1k = config.price_input_per_1k
        existing_config.price_output_per_1k = config.price_output_per_1k
        existing_config.currency = config.currency
        existing_config.context_window_tokens = config.context_window_tokens
        existing_config.reserve_output_tokens = config.reserve_output_tokens
        existing_config.is_enabled = config.is_enabled
        existing_config.is_default = config.is_default

        db.commit()
        db.refresh(existing_config)
        return serialize_model_api_config(existing_config)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/model-api-configs/{config_id}")
async def delete_model_api_config(
    config_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    db.delete(config)
    db.commit()
    return {"message": "删除成功"}


@router.post("/api/model-api-configs/{config_id}/test")
async def test_model_api_config(
    config_id: str,
    payload: Optional[ModelAPITestRequest] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    config = db.query(ModelAPIConfig).filter(ModelAPIConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="模型API配置不存在")

    try:
        import httpx

        prompt = payload.prompt if payload and payload.prompt else "test"
        max_tokens = payload.max_tokens if payload and payload.max_tokens else 200

        async with httpx.AsyncClient() as client:
            is_vector = (config.model_type or "general") == "vector"
            provider = (config.provider or "openai").lower()
            if is_vector:
                if provider == "jina":
                    jina_base = config.base_url.rstrip("/")
                    if not jina_base.endswith("/v1"):
                        jina_base = f"{jina_base}/v1"
                    response = await client.post(
                        f"{jina_base}/embeddings",
                        headers={
                            "Authorization": f"Bearer {config.api_key}",
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                        },
                        json={"model": config.model_name, "input": [prompt]},
                        timeout=10.0,
                    )
                else:
                    response = await client.post(
                        f"{config.base_url}/embeddings",
                        headers={
                            "Authorization": f"Bearer {config.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={"model": config.model_name, "input": prompt},
                        timeout=10.0,
                    )
            else:
                response = await client.post(
                    f"{config.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {config.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": config.model_name,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": max_tokens,
                        "temperature": 0.2,
                    },
                    timeout=10.0,
                )

            if response.status_code in [200, 201]:
                content = ""
                try:
                    data = response.json()
                    if (config.model_type or "general") == "vector":
                        embedding = (data.get("data") or [{}])[0].get("embedding") or []
                        content = f"embedding维度: {len(embedding)}"
                    else:
                        content = (
                            data.get("choices", [{}])[0]
                            .get("message", {})
                            .get("content", "")
                        )
                except Exception:
                    content = response.text
                return {
                    "success": True,
                    "message": "调用成功",
                    "content": content,
                    "raw_response": response.text,
                    "status_code": response.status_code,
                }

            return {
                "success": False,
                "message": f"调用失败: {response.status_code}",
                "content": response.text,
                "raw_response": response.text,
                "status_code": response.status_code,
            }
    except Exception as exc:
        return {"success": False, "message": f"调用失败: {str(exc)}"}


@router.post("/api/model-api-configs/models")
async def fetch_model_api_models(
    payload: ModelAPIModelsRequest,
    _: bool = Depends(get_current_admin),
):
    try:
        import httpx

        base_url = payload.base_url.rstrip("/")
        provider = (payload.provider or "openai").lower()
        if provider == "jina":
            return {"success": True, "models": [], "raw_response": "jina"}

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{base_url}/models",
                headers={
                    "Authorization": f"Bearer {payload.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=10.0,
            )
            if response.status_code not in [200, 201]:
                return {
                    "success": False,
                    "message": f"获取模型失败: {response.status_code}",
                    "raw_response": response.text,
                }

            data = response.json()
            models = []
            if isinstance(data, dict):
                items = data.get("data") or data.get("models") or []
                if isinstance(items, list):
                    models = [item.get("id") for item in items if item.get("id")]
            return {"success": True, "models": models, "raw_response": response.text}
    except Exception as exc:
        return {"success": False, "message": f"获取模型失败: {str(exc)}"}
