from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_admin
from models import AIUsageLog, Article, ModelAPIConfig, get_db

router = APIRouter()


@router.get("/api/ai-usage")
async def get_ai_usage_logs(
    model_api_config_id: Optional[str] = None,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    content_type: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    page: int = 1,
    size: int = 20,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    query = db.query(AIUsageLog, ModelAPIConfig.name).outerjoin(
        ModelAPIConfig, AIUsageLog.model_api_config_id == ModelAPIConfig.id
    )

    if model_api_config_id:
        query = query.filter(AIUsageLog.model_api_config_id == model_api_config_id)
    if status:
        query = query.filter(AIUsageLog.status == status)
    if task_type:
        query = query.filter(AIUsageLog.task_type == task_type)
    if content_type:
        query = query.filter(AIUsageLog.content_type == content_type)
    if start:
        query = query.filter(AIUsageLog.created_at >= start)
    if end:
        query = query.filter(AIUsageLog.created_at <= end)

    total = query.count()
    logs = (
        query.order_by(AIUsageLog.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    article_ids = [log.article_id for log, _ in logs if log.article_id]
    article_map = {}
    if article_ids:
        articles = (
            db.query(Article.id, Article.slug).filter(Article.id.in_(article_ids)).all()
        )
        article_map = {article.id: article.slug for article in articles}

    items = []
    for log, model_name in logs:
        items.append(
            {
                "id": log.id,
                "model_api_config_id": log.model_api_config_id,
                "model_api_config_name": model_name,
                "task_id": log.task_id,
                "article_id": log.article_id,
                "article_slug": article_map.get(log.article_id)
                if log.article_id
                else None,
                "task_type": log.task_type,
                "content_type": log.content_type,
                "status": log.status,
                "prompt_tokens": log.prompt_tokens,
                "completion_tokens": log.completion_tokens,
                "total_tokens": log.total_tokens,
                "cost_input": log.cost_input,
                "cost_output": log.cost_output,
                "cost_total": log.cost_total,
                "currency": log.currency,
                "latency_ms": log.latency_ms,
                "error_message": log.error_message,
                "request_payload": log.request_payload,
                "response_payload": log.response_payload,
                "created_at": log.created_at,
            }
        )

    return {"items": items, "total": total, "page": page, "size": size}


@router.get("/api/ai-usage/summary")
async def get_ai_usage_summary(
    model_api_config_id: Optional[str] = None,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    content_type: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    base_query = db.query(AIUsageLog)

    if model_api_config_id:
        base_query = base_query.filter(
            AIUsageLog.model_api_config_id == model_api_config_id
        )
    if status:
        base_query = base_query.filter(AIUsageLog.status == status)
    if task_type:
        base_query = base_query.filter(AIUsageLog.task_type == task_type)
    if content_type:
        base_query = base_query.filter(AIUsageLog.content_type == content_type)
    if start:
        base_query = base_query.filter(AIUsageLog.created_at >= start)
    if end:
        base_query = base_query.filter(AIUsageLog.created_at <= end)

    overall = base_query.with_entities(
        func.count(AIUsageLog.id),
        func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
        func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
        func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
        func.coalesce(func.sum(AIUsageLog.cost_total), 0.0),
    ).first()

    grouped = (
        base_query.join(
            ModelAPIConfig,
            AIUsageLog.model_api_config_id == ModelAPIConfig.id,
            isouter=True,
        )
        .with_entities(
            AIUsageLog.model_api_config_id,
            ModelAPIConfig.name,
            ModelAPIConfig.currency,
            func.count(AIUsageLog.id),
            func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.cost_total), 0.0),
        )
        .group_by(
            AIUsageLog.model_api_config_id,
            ModelAPIConfig.name,
            ModelAPIConfig.currency,
        )
        .order_by(func.coalesce(func.sum(AIUsageLog.cost_total), 0.0).desc())
        .all()
    )

    by_model = []
    for (
        config_id,
        model_name,
        currency,
        calls,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cost_total,
    ) in grouped:
        by_model.append(
            {
                "model_api_config_id": config_id,
                "model_api_config_name": model_name,
                "currency": currency,
                "calls": calls,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "cost_total": cost_total,
            }
        )

    return {
        "summary": {
            "calls": overall[0] or 0,
            "prompt_tokens": overall[1] or 0,
            "completion_tokens": overall[2] or 0,
            "total_tokens": overall[3] or 0,
            "cost_total": overall[4] or 0.0,
        },
        "by_model": by_model,
    }
