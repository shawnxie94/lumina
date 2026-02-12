import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, load_only

from app.schemas import AITaskCancelRequest, AITaskRetryRequest
from auth import get_current_admin
from models import (
    AIUsageLog,
    AITask,
    AITaskEvent,
    Article,
    ModelAPIConfig,
    PromptConfig,
    get_db,
    now_str,
)
from task_state import append_task_event, ensure_task_status_transition

router = APIRouter()


@router.get("/api/ai-tasks")
async def list_ai_tasks(
    page: int = 1,
    size: int = 20,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    content_type: Optional[str] = None,
    article_id: Optional[str] = None,
    article_title: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    page = max(page, 1)
    size = max(1, min(size, 100))

    query = db.query(AITask)

    if status:
        query = query.filter(AITask.status == status)
    if task_type:
        query = query.filter(AITask.task_type == task_type)
    if content_type:
        query = query.filter(AITask.content_type == content_type)
    if article_id:
        query = query.filter(AITask.article_id == article_id)
    if article_title:
        matching_articles = (
            db.query(Article.id).filter(Article.title.contains(article_title)).all()
        )
        article_ids = [article.id for article in matching_articles]
        if article_ids:
            query = query.filter(AITask.article_id.in_(article_ids))
        else:
            query = query.filter(False)

    total = query.count()
    tasks = (
        query.options(
            load_only(
                AITask.id,
                AITask.article_id,
                AITask.task_type,
                AITask.content_type,
                AITask.status,
                AITask.attempts,
                AITask.max_attempts,
                AITask.run_at,
                AITask.locked_at,
                AITask.locked_by,
                AITask.last_error,
                AITask.last_error_type,
                AITask.created_at,
                AITask.updated_at,
                AITask.finished_at,
            )
        )
        .order_by(AITask.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    article_ids = [task.article_id for task in tasks if task.article_id]
    article_map = {}
    if article_ids:
        articles = (
            db.query(Article.id, Article.title, Article.slug)
            .filter(Article.id.in_(article_ids))
            .all()
        )
        article_map = {
            article.id: {"title": article.title, "slug": article.slug}
            for article in articles
        }

    return {
        "data": [
            {
                "id": task.id,
                "article_id": task.article_id,
                "article_title": article_map.get(task.article_id, {}).get("title")
                if task.article_id
                else None,
                "article_slug": article_map.get(task.article_id, {}).get("slug")
                if task.article_id
                else None,
                "task_type": task.task_type,
                "content_type": task.content_type,
                "status": task.status,
                "attempts": task.attempts,
                "max_attempts": task.max_attempts,
                "run_at": task.run_at,
                "locked_at": task.locked_at,
                "locked_by": task.locked_by,
                "last_error": task.last_error,
                "last_error_type": task.last_error_type,
                "created_at": task.created_at,
                "updated_at": task.updated_at,
                "finished_at": task.finished_at,
            }
            for task in tasks
        ],
        "pagination": {
            "page": page,
            "size": size,
            "total": total,
            "total_pages": (total + size - 1) // size,
        },
    }


@router.get("/api/ai-tasks/{task_id}")
async def get_ai_task(
    task_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    task = db.query(AITask).filter(AITask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    article_title = None
    if task.article_id:
        article = (
            db.query(Article.id, Article.title)
            .filter(Article.id == task.article_id)
            .first()
        )
        if article:
            article_title = article.title

    return {
        "id": task.id,
        "article_id": task.article_id,
        "article_title": article_title,
        "task_type": task.task_type,
        "content_type": task.content_type,
        "status": task.status,
        "payload": task.payload,
        "attempts": task.attempts,
        "max_attempts": task.max_attempts,
        "run_at": task.run_at,
        "locked_at": task.locked_at,
        "locked_by": task.locked_by,
        "last_error": task.last_error,
        "last_error_type": task.last_error_type,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "finished_at": task.finished_at,
    }


@router.get("/api/ai-tasks/{task_id}/timeline")
async def get_ai_task_timeline(
    task_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    task = db.query(AITask).filter(AITask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    article = None
    if task.article_id:
        article = (
            db.query(Article.id, Article.title, Article.slug)
            .filter(Article.id == task.article_id)
            .first()
        )

    events = (
        db.query(AITaskEvent)
        .filter(AITaskEvent.task_id == task_id)
        .order_by(AITaskEvent.created_at.asc())
        .all()
    )

    usage_query = (
        db.query(AIUsageLog, ModelAPIConfig.name)
        .outerjoin(ModelAPIConfig, AIUsageLog.model_api_config_id == ModelAPIConfig.id)
        .filter(AIUsageLog.task_id == task_id)
    )
    if task.task_type:
        usage_query = usage_query.filter(
            or_(AIUsageLog.task_type == task.task_type, AIUsageLog.task_type.is_(None))
        )
    if task.article_id:
        usage_query = usage_query.filter(
            or_(AIUsageLog.article_id == task.article_id, AIUsageLog.article_id.is_(None))
        )
    if task.content_type:
        usage_query = usage_query.filter(
            or_(
                AIUsageLog.content_type == task.content_type,
                AIUsageLog.content_type.is_(None),
            )
        )

    usage_rows = usage_query.order_by(AIUsageLog.created_at.asc()).all()

    event_items = []
    for event in events:
        details = None
        if event.details:
            try:
                details = json.loads(event.details)
            except Exception:
                details = event.details
        event_items.append(
            {
                "id": event.id,
                "event_type": event.event_type,
                "from_status": event.from_status,
                "to_status": event.to_status,
                "message": event.message,
                "error_type": event.error_type,
                "details": details,
                "created_at": event.created_at,
            }
        )

    usage_items = []
    for log, model_name in usage_rows:
        usage_items.append(
            {
                "id": log.id,
                "model_api_config_id": log.model_api_config_id,
                "model_api_config_name": model_name,
                "task_type": log.task_type,
                "content_type": log.content_type,
                "status": log.status,
                "prompt_tokens": log.prompt_tokens,
                "completion_tokens": log.completion_tokens,
                "total_tokens": log.total_tokens,
                "cost_total": log.cost_total,
                "currency": log.currency,
                "latency_ms": log.latency_ms,
                "finish_reason": log.finish_reason,
                "truncated": log.truncated,
                "chunk_index": log.chunk_index,
                "continue_round": log.continue_round,
                "estimated_input_tokens": log.estimated_input_tokens,
                "error_message": log.error_message,
                "request_payload": log.request_payload,
                "response_payload": log.response_payload,
                "created_at": log.created_at,
            }
        )

    return {
        "task": {
            "id": task.id,
            "article_id": task.article_id,
            "article_title": article.title if article else None,
            "article_slug": article.slug if article else None,
            "task_type": task.task_type,
            "content_type": task.content_type,
            "status": task.status,
            "attempts": task.attempts,
            "max_attempts": task.max_attempts,
            "run_at": task.run_at,
            "locked_at": task.locked_at,
            "locked_by": task.locked_by,
            "last_error": task.last_error,
            "last_error_type": task.last_error_type,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
            "finished_at": task.finished_at,
        },
        "events": event_items,
        "usage": usage_items,
    }


@router.post("/api/ai-tasks/retry")
async def retry_ai_tasks(
    request: AITaskRetryRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="请选择任务")

    def normalize_optional(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    def resolve_prompt_type(task: AITask) -> Optional[str]:
        if task.task_type == "process_article_cleaning":
            return "content_cleaning"
        if task.task_type == "process_article_translation":
            return "translation"
        if task.task_type == "process_article_validation":
            return "content_validation"
        if task.task_type == "process_article_classification":
            return "classification"
        if task.task_type == "process_ai_content":
            return task.content_type
        return None

    def parse_task_payload(task: AITask) -> dict:
        if not task.payload:
            return {}
        try:
            payload = json.loads(task.payload)
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}

    def serialize_payload(payload: dict) -> str:
        return json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )

    task_ids = list(dict.fromkeys(request.task_ids))
    tasks = db.query(AITask).filter(AITask.id.in_(task_ids)).all()
    task_map = {task.id: task for task in tasks}
    now_iso = now_str()
    override_model_id = normalize_optional(request.model_config_id)
    override_prompt_id = normalize_optional(request.prompt_config_id)

    if override_model_id:
        model_config = (
            db.query(ModelAPIConfig)
            .filter(
                ModelAPIConfig.id == override_model_id,
                ModelAPIConfig.is_enabled == True,
            )
            .first()
        )
        if not model_config:
            raise HTTPException(status_code=400, detail="所选模型不存在或未启用")
        if model_config.model_type == "vector":
            raise HTTPException(status_code=400, detail="重试仅支持通用模型")

    if override_prompt_id:
        prompt_config = (
            db.query(PromptConfig)
            .filter(
                PromptConfig.id == override_prompt_id,
                PromptConfig.is_enabled == True,
            )
            .first()
        )
        if not prompt_config:
            raise HTTPException(status_code=400, detail="所选提示词不存在或未启用")

    updated_ids: list[str] = []
    skipped_ids: list[str] = []
    skipped_reasons: dict[str, str] = {}

    def find_active_duplicate(task: AITask, payload_json: str) -> str | None:
        duplicate_query = db.query(AITask.id).filter(
            AITask.id != task.id,
            AITask.status.in_(["pending", "processing"]),
            AITask.task_type == task.task_type,
        )
        if task.article_id is None:
            duplicate_query = duplicate_query.filter(AITask.article_id.is_(None))
        else:
            duplicate_query = duplicate_query.filter(AITask.article_id == task.article_id)

        if task.content_type is None:
            duplicate_query = duplicate_query.filter(AITask.content_type.is_(None))
        else:
            duplicate_query = duplicate_query.filter(AITask.content_type == task.content_type)

        duplicate_query = duplicate_query.filter(AITask.payload == payload_json)

        duplicate = (
            duplicate_query.order_by(AITask.created_at.desc(), AITask.id.desc()).first()
        )
        return duplicate.id if duplicate else None

    for task_id in task_ids:
        task = task_map.get(task_id)
        if not task:
            skipped_ids.append(task_id)
            skipped_reasons[task_id] = "任务不存在"
            continue

        payload = parse_task_payload(task)

        if override_prompt_id:
            prompt_type = resolve_prompt_type(task)
            if not prompt_type:
                skipped_ids.append(task_id)
                skipped_reasons[task_id] = "该任务类型不支持提示词覆盖"
                continue
            prompt_match = (
                db.query(PromptConfig.id)
                .filter(
                    PromptConfig.id == override_prompt_id,
                    PromptConfig.is_enabled == True,
                    PromptConfig.type == prompt_type,
                )
                .first()
            )
            if not prompt_match:
                skipped_ids.append(task_id)
                skipped_reasons[task_id] = "提示词类型与任务不匹配"
                continue
            payload["prompt_config_id"] = override_prompt_id

        if override_model_id:
            payload["model_config_id"] = override_model_id

        payload_json = serialize_payload(payload)

        duplicate_id = find_active_duplicate(task, payload_json)
        if duplicate_id:
            append_task_event(
                db,
                task_id=task.id,
                event_type="retry_skipped_duplicate",
                from_status=task.status,
                to_status=task.status,
                message="重试被跳过：存在活跃重复任务",
                details={
                    "source": "api",
                    "duplicate_task_id": duplicate_id,
                    "model_config_id": override_model_id,
                    "prompt_config_id": override_prompt_id,
                },
            )
            skipped_ids.append(task_id)
            skipped_reasons[task_id] = "存在活跃重复任务"
            continue

        try:
            ensure_task_status_transition(task.status, "pending")
        except ValueError:
            skipped_ids.append(task_id)
            skipped_reasons[task_id] = "当前任务状态不支持重试"
            continue

        from_status = task.status
        task.status = "pending"
        task.attempts = 0
        task.max_attempts = 1
        task.payload = payload_json
        task.run_at = now_iso
        task.locked_at = None
        task.locked_by = None
        task.last_error = None
        task.last_error_type = None
        task.finished_at = None
        task.updated_at = now_iso
        append_task_event(
            db,
            task_id=task.id,
            event_type="retried",
            from_status=from_status,
            to_status="pending",
            message="任务已重试",
            details={
                "source": "api",
                "attempts_reset": True,
                "manual_intervention": True,
                "model_config_id": override_model_id,
                "prompt_config_id": override_prompt_id,
            },
        )
        updated_ids.append(task_id)

    db.commit()
    return {
        "updated": len(updated_ids),
        "updated_ids": updated_ids,
        "skipped": len(skipped_ids),
        "skipped_ids": skipped_ids,
        "skipped_reasons": skipped_reasons,
    }


@router.post("/api/ai-tasks/cancel")
async def cancel_ai_tasks(
    request: AITaskCancelRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="请选择任务")

    task_ids = list(dict.fromkeys(request.task_ids))
    tasks = db.query(AITask).filter(AITask.id.in_(task_ids)).all()
    task_map = {task.id: task for task in tasks}
    now_iso = now_str()

    updated_ids: list[str] = []
    skipped_ids: list[str] = []

    for task_id in task_ids:
        task = task_map.get(task_id)
        if not task:
            skipped_ids.append(task_id)
            continue

        try:
            ensure_task_status_transition(task.status, "cancelled")
        except ValueError:
            skipped_ids.append(task_id)
            continue

        from_status = task.status
        task.status = "cancelled"
        task.locked_at = None
        task.locked_by = None
        task.updated_at = now_iso
        task.finished_at = now_iso
        append_task_event(
            db,
            task_id=task.id,
            event_type="cancelled_by_api",
            from_status=from_status,
            to_status="cancelled",
            message="任务已取消",
            details={"source": "api"},
        )
        updated_ids.append(task_id)

    db.commit()
    return {
        "updated": len(updated_ids),
        "updated_ids": updated_ids,
        "skipped": len(skipped_ids),
        "skipped_ids": skipped_ids,
    }
