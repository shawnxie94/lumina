import json

from models import AIUsageLog, AITask, now_str
from task_state import append_task_event


class _UsageMixin:
    def _extract_usage_value(self, usage, key: str):
        if usage is None:
            return None
        if isinstance(usage, dict):
            return usage.get(key)
        return getattr(usage, key, None)

    def _log_ai_usage(
        self,
        db,
        model_config_id: str | None,
        article_id: str | None,
        task_type: str | None,
        content_type: str | None,
        usage,
        latency_ms: int | None,
        status: str,
        error_message: str | None,
        price_input_per_1k: float | None,
        price_output_per_1k: float | None,
        currency: str | None,
        request_payload: dict | str | None = None,
        response_payload: dict | str | None = None,
        task_id: str | None = None,
        finish_reason: str | None = None,
        truncated: bool | None = None,
        chunk_index: int | None = None,
        continue_round: int | None = None,
        estimated_input_tokens: int | None = None,
    ) -> AIUsageLog:
        def normalize_payload(payload: dict | str | None) -> str | None:
            if payload is None:
                return None
            if isinstance(payload, str):
                return payload
            return json.dumps(payload, ensure_ascii=False)

        prompt_tokens = self._extract_usage_value(usage, "prompt_tokens")
        completion_tokens = self._extract_usage_value(usage, "completion_tokens")
        total_tokens = self._extract_usage_value(usage, "total_tokens")

        if prompt_tokens is None and completion_tokens is None:
            cost_input = None
            cost_output = None
            cost_total = None
        else:
            input_price = price_input_per_1k or 0
            output_price = price_output_per_1k or 0
            cost_input = ((prompt_tokens or 0) / 1000) * input_price
            cost_output = ((completion_tokens or 0) / 1000) * output_price
            cost_total = cost_input + cost_output

        usage_log = AIUsageLog(
            model_api_config_id=model_config_id,
            task_id=task_id or self.current_task_id,
            article_id=article_id,
            task_type=task_type,
            content_type=content_type,
            status=status,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_input=cost_input,
            cost_output=cost_output,
            cost_total=cost_total,
            currency=currency,
            latency_ms=latency_ms,
            finish_reason=finish_reason,
            truncated=truncated,
            chunk_index=chunk_index,
            continue_round=continue_round,
            estimated_input_tokens=estimated_input_tokens,
            error_message=error_message,
            request_payload=normalize_payload(request_payload),
            response_payload=normalize_payload(response_payload),
            created_at=now_str(),
        )
        db.add(usage_log)
        db.flush()
        return usage_log

    def _append_media_ingest_event(self, db, stats: dict, stage: str) -> None:
        if not self.current_task_id:
            return
        total = int(stats.get("total", 0))
        success = int(stats.get("success", 0))
        failed = int(stats.get("failed", 0))
        updated = bool(stats.get("updated", False))
        append_task_event(
            db,
            task_id=self.current_task_id,
            event_type="media_ingest",
            from_status=None,
            to_status=None,
            message=f"图片转储统计（{stage}）：成功 {success}，失败 {failed}",
            details={
                "stage": stage,
                "total": total,
                "success": success,
                "failed": failed,
                "updated": updated,
            },
        )

    def _update_current_task_payload(self, db, **updates) -> None:
        if not self.current_task_id or not updates:
            return
        task = db.query(AITask).filter(AITask.id == self.current_task_id).first()
        if not task:
            return
        try:
            payload = json.loads(task.payload or "{}")
        except Exception:
            payload = {}
        changed = False
        for key, value in updates.items():
            if payload.get(key) != value:
                payload[key] = value
                changed = True
        if changed:
            task.payload = json.dumps(
                payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            task.updated_at = now_str()
            db.commit()
