from __future__ import annotations

import json

from models import AICallSession, AIUsageLog, now_str


class AICallSessionService:
    def create_session(
        self,
        db,
        *,
        usage_log_id: str,
        task_id: str | None,
        article_id: str | None,
        task_type: str | None,
        content_type: str | None,
        session_info: dict,
    ) -> AICallSession:
        session = AICallSession(
            usage_log_id=usage_log_id,
            task_id=task_id,
            article_id=article_id,
            task_type=task_type,
            content_type=content_type,
            api_type=(session_info.get("api_type") or "chat_completions"),
            continuation_mode=(session_info.get("continuation_mode") or "snapshot"),
            provider_response_id=session_info.get("provider_response_id"),
            provider_request_id=session_info.get("provider_request_id"),
            provider_conversation_id=session_info.get("provider_conversation_id"),
            input_snapshot=json.dumps(
                session_info.get("input_snapshot") or {},
                ensure_ascii=False,
            ),
            output_snapshot=json.dumps(
                session_info.get("output_snapshot") or {},
                ensure_ascii=False,
            ),
            source_usage_log_id=session_info.get("source_usage_log_id"),
            created_at=now_str(),
            updated_at=now_str(),
        )
        db.add(session)
        db.flush()
        return session

    def serialize_session(self, session: AICallSession | None) -> dict | None:
        if not session:
            return None
        return {
            "api_type": session.api_type or "chat_completions",
            "continuation_mode": session.continuation_mode or "snapshot",
            "provider_response_id": session.provider_response_id,
            "provider_request_id": session.provider_request_id,
            "provider_conversation_id": session.provider_conversation_id,
            "input_snapshot": self._parse_json(session.input_snapshot),
            "output_snapshot": self._parse_json(session.output_snapshot),
            "source_usage_log_id": session.source_usage_log_id,
        }

    def get_session_for_usage(self, db, usage_id: str) -> AICallSession | None:
        return (
            db.query(AICallSession)
            .filter(AICallSession.usage_log_id == usage_id)
            .order_by(AICallSession.created_at.desc(), AICallSession.id.desc())
            .first()
        )

    def build_fallback_session_info(self, usage: AIUsageLog) -> dict | None:
        request_payload = self._parse_json(usage.request_payload)
        response_payload = self._parse_json(usage.response_payload)
        if request_payload is None and response_payload is None:
            return None

        input_snapshot = {}
        if isinstance(request_payload, dict):
            messages = request_payload.get("messages")
            if isinstance(messages, list):
                system_prompt = ""
                user_prompt = ""
                for message in messages:
                    if not isinstance(message, dict):
                        continue
                    role = str(message.get("role") or "")
                    content = str(message.get("content") or "")
                    if role == "system" and not system_prompt:
                        system_prompt = content
                    if role == "user":
                        user_prompt = content
                input_snapshot = {
                    "system_prompt": system_prompt or None,
                    "user_prompt": user_prompt or None,
                }

        output_snapshot = {}
        if isinstance(response_payload, dict):
            output_snapshot = {
                "content": response_payload.get("content"),
            }

        return {
            "api_type": "chat_completions",
            "continuation_mode": "snapshot",
            "provider_response_id": None,
            "provider_request_id": None,
            "provider_conversation_id": None,
            "input_snapshot": input_snapshot,
            "output_snapshot": output_snapshot,
            "source_usage_log_id": usage.id,
        }

    def resolve_session_info(self, db, usage: AIUsageLog) -> dict | None:
        session = self.get_session_for_usage(db, usage.id)
        return self.serialize_session(session) or self.build_fallback_session_info(usage)

    def _parse_json(self, raw: str | None):
        if not raw:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return raw
