from __future__ import annotations

import copy
import time
from typing import Any

from openai import AsyncOpenAI


class AIInvocationService:
    def _serialize_usage(self, usage: Any) -> dict[str, Any] | None:
        if usage is None:
            return None
        if hasattr(usage, "model_dump"):
            data = usage.model_dump()
        elif hasattr(usage, "dict"):
            data = usage.dict()
        elif isinstance(usage, dict):
            data = dict(usage)
        else:
            data = {
                "prompt_tokens": getattr(usage, "prompt_tokens", None),
                "completion_tokens": getattr(usage, "completion_tokens", None),
                "total_tokens": getattr(usage, "total_tokens", None),
            }
        if "prompt_tokens" in data or "completion_tokens" in data:
            return data
        input_tokens = data.get("input_tokens")
        output_tokens = data.get("output_tokens")
        total_tokens = data.get("total_tokens")
        return {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": total_tokens,
        }

    def _build_messages(self, system_prompt: str | None, user_prompt: str) -> list[dict]:
        messages: list[dict] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})
        return messages

    async def _create_chat_completion(self, **request_params):
        client = AsyncOpenAI(
            base_url=request_params.pop("base_url"),
            api_key=request_params.pop("api_key"),
        )
        return await client.chat.completions.create(**request_params)

    async def _create_response(self, **request_params):
        client = AsyncOpenAI(
            base_url=request_params.pop("base_url"),
            api_key=request_params.pop("api_key"),
        )
        if not hasattr(client, "responses"):
            raise RuntimeError("当前 OpenAI SDK 不支持 Responses API")
        return await client.responses.create(**request_params)

    async def invoke_generation(
        self,
        *,
        db,
        api_type: str,
        model_name: str,
        base_url: str,
        api_key: str,
        system_prompt: str | None,
        user_prompt: str,
        article_id: str | None,
        task_type: str | None,
        content_type: str | None,
        task_id: str | None,
        request_context: dict | None = None,
        client=None,
        content: str | None = None,
        prompt: str | None = None,
        parameters: dict | None = None,
        max_tokens: int | None = None,
    ) -> dict:
        normalized_api_type = (api_type or "chat_completions").strip() or "chat_completions"
        if client is not None and content is not None:
            return await self._invoke_client_generation(
                api_type=normalized_api_type,
                client=client,
                content=content,
                prompt=prompt,
                parameters=parameters or {},
                max_tokens=max_tokens,
                article_id=article_id,
                task_type=task_type,
                content_type=content_type,
                task_id=task_id,
            )
        if normalized_api_type == "responses":
            return await self._invoke_responses_generation(
                model_name=model_name,
                base_url=base_url,
                api_key=api_key,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                article_id=article_id,
                task_type=task_type,
                content_type=content_type,
                task_id=task_id,
                request_context=request_context or {},
            )
        return await self._invoke_chat_generation(
            model_name=model_name,
            base_url=base_url,
            api_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            article_id=article_id,
            task_type=task_type,
            content_type=content_type,
            task_id=task_id,
            request_context=request_context or {},
        )

    async def _invoke_client_generation(
        self,
        *,
        api_type: str,
        client,
        content: str,
        prompt: str | None,
        parameters: dict,
        max_tokens: int | None,
        article_id: str | None,
        task_type: str | None,
        content_type: str | None,
        task_id: str | None,
    ) -> dict:
        result = await client.generate_summary(
            content,
            prompt=prompt,
            parameters=parameters,
            max_tokens=max_tokens or 500,
        )
        response_payload = dict(result.get("response_payload") or {})
        provider_response_id = response_payload.get("id")
        continuation_mode = "provider" if api_type == "responses" and provider_response_id else "snapshot"
        return {
            **result,
            "session_info": {
                "api_type": api_type,
                "continuation_mode": continuation_mode,
                "provider_response_id": provider_response_id if api_type == "responses" else None,
                "provider_request_id": None,
                "provider_conversation_id": None,
                "input_snapshot": {
                    "system_prompt": parameters.get("system_prompt"),
                    "user_prompt": prompt,
                    "parameters": copy.deepcopy(parameters),
                    "max_tokens": max_tokens,
                    "article_id": article_id,
                    "task_type": task_type,
                    "content_type": content_type,
                    "task_id": task_id,
                },
                "output_snapshot": {
                    "content": result.get("content"),
                    "finish_reason": response_payload.get("finish_reason"),
                },
            },
        }

    async def invoke_continuation(
        self,
        *,
        db,
        session_info: dict,
        feedback: str,
        model_config: dict,
    ) -> dict:
        api_type = (session_info.get("api_type") or "chat_completions").strip()
        if api_type == "responses":
            try:
                return await self._invoke_responses_continuation(
                    previous_response_id=session_info.get("provider_response_id"),
                    feedback=feedback,
                    model_config=model_config,
                    session_info=session_info,
                )
            except Exception:
                return await self._invoke_snapshot_continuation(
                    feedback=feedback,
                    model_config=model_config,
                    session_info=session_info,
                )
        return await self._invoke_snapshot_continuation(
            feedback=feedback,
            model_config=model_config,
            session_info=session_info,
        )

    async def _invoke_chat_generation(
        self,
        *,
        model_name: str,
        base_url: str,
        api_key: str,
        system_prompt: str | None,
        user_prompt: str,
        article_id: str | None,
        task_type: str | None,
        content_type: str | None,
        task_id: str | None,
        request_context: dict,
    ) -> dict:
        parameters = dict(request_context.get("parameters") or {})
        max_tokens = request_context.get("max_tokens")
        messages = self._build_messages(system_prompt, user_prompt)
        request_payload = {
            "model": model_name,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        for key in ("temperature", "top_p", "response_format"):
            if key in parameters:
                request_payload[key] = parameters[key]
        start = time.monotonic()
        response = await self._create_chat_completion(
            base_url=base_url,
            api_key=api_key,
            **request_payload,
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        content = response.choices[0].message.content
        usage = self._serialize_usage(getattr(response, "usage", None))
        response_payload = {
            "id": getattr(response, "id", None),
            "content": content,
            "model": getattr(response, "model", model_name),
            "usage": usage,
            "finish_reason": getattr(response.choices[0], "finish_reason", None),
        }
        return {
            "content": content,
            "usage": usage,
            "latency_ms": latency_ms,
            "request_payload": request_payload,
            "response_payload": response_payload,
            "session_info": {
                "api_type": "chat_completions",
                "continuation_mode": "snapshot",
                "provider_response_id": None,
                "provider_request_id": None,
                "provider_conversation_id": None,
                "input_snapshot": {
                    "system_prompt": system_prompt,
                    "user_prompt": user_prompt,
                    "parameters": copy.deepcopy(parameters),
                    "max_tokens": max_tokens,
                    "article_id": article_id,
                    "task_type": task_type,
                    "content_type": content_type,
                    "task_id": task_id,
                },
                "output_snapshot": {
                    "content": content,
                    "finish_reason": response_payload["finish_reason"],
                },
            },
        }

    async def _invoke_responses_generation(
        self,
        *,
        model_name: str,
        base_url: str,
        api_key: str,
        system_prompt: str | None,
        user_prompt: str,
        article_id: str | None,
        task_type: str | None,
        content_type: str | None,
        task_id: str | None,
        request_context: dict,
    ) -> dict:
        parameters = dict(request_context.get("parameters") or {})
        request_payload = {
            "model": model_name,
            "input": user_prompt,
            "instructions": system_prompt,
        }
        if request_context.get("max_tokens") is not None:
            request_payload["max_output_tokens"] = request_context["max_tokens"]
        for key in ("temperature", "top_p"):
            if key in parameters:
                request_payload[key] = parameters[key]
        start = time.monotonic()
        response = await self._create_response(
            base_url=base_url,
            api_key=api_key,
            **request_payload,
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        content = getattr(response, "output_text", None) or ""
        usage = self._serialize_usage(getattr(response, "usage", None))
        response_payload = {
            "id": getattr(response, "id", None),
            "content": content,
            "model": getattr(response, "model", model_name),
            "usage": usage,
        }
        return {
            "content": content,
            "usage": usage,
            "latency_ms": latency_ms,
            "request_payload": request_payload,
            "response_payload": response_payload,
            "session_info": {
                "api_type": "responses",
                "continuation_mode": "provider",
                "provider_response_id": getattr(response, "id", None),
                "provider_request_id": None,
                "provider_conversation_id": None,
                "input_snapshot": {
                    "system_prompt": system_prompt,
                    "user_prompt": user_prompt,
                    "parameters": copy.deepcopy(parameters),
                    "max_tokens": request_context.get("max_tokens"),
                    "article_id": article_id,
                    "task_type": task_type,
                    "content_type": content_type,
                    "task_id": task_id,
                },
                "output_snapshot": {"content": content},
            },
        }

    async def _invoke_responses_continuation(
        self,
        *,
        previous_response_id: str | None,
        feedback: str,
        model_config: dict,
        session_info: dict,
    ) -> dict:
        if not previous_response_id:
            raise ValueError("缺少 previous_response_id")
        request_payload = {
            "model": model_config["model_name"],
            "previous_response_id": previous_response_id,
            "input": feedback,
        }
        response = await self._create_response(
            base_url=model_config["base_url"],
            api_key=model_config["api_key"],
            **request_payload,
        )
        content = getattr(response, "output_text", None) or ""
        usage = self._serialize_usage(getattr(response, "usage", None))
        return {
            "content": content,
            "usage": usage,
            "latency_ms": None,
            "request_payload": request_payload,
            "response_payload": {"id": getattr(response, "id", None), "content": content},
            "session_info": {
                "api_type": "responses",
                "continuation_mode": "provider",
                "provider_response_id": getattr(response, "id", None),
                "provider_request_id": None,
                "provider_conversation_id": None,
                "input_snapshot": {
                    **dict(session_info.get("input_snapshot") or {}),
                    "feedback": feedback,
                },
                "output_snapshot": {"content": content},
                "source_usage_log_id": session_info.get("source_usage_log_id"),
            },
        }

    async def _invoke_snapshot_continuation(
        self,
        *,
        feedback: str,
        model_config: dict,
        session_info: dict,
    ) -> dict:
        input_snapshot = dict(session_info.get("input_snapshot") or {})
        output_snapshot = dict(session_info.get("output_snapshot") or {})
        prior_content = str(output_snapshot.get("content") or "").strip()
        system_prompt = input_snapshot.get("system_prompt")
        user_prompt = str(input_snapshot.get("user_prompt") or "").strip()
        continuation_prompt = user_prompt
        if prior_content:
            continuation_prompt = (
                f"{user_prompt}\n\n"
                f"以上是原始生成要求。\n\n"
                f"这是上一版输出：\n{prior_content}\n\n"
                f"请基于以上上下文，根据以下修改意见生成更新后的完整结果：\n{feedback}"
            )
        else:
            continuation_prompt = (
                f"{user_prompt}\n\n请根据以下修改意见生成更新后的完整结果：\n{feedback}"
            )
        return await self._invoke_chat_generation(
            model_name=model_config["model_name"],
            base_url=model_config["base_url"],
            api_key=model_config["api_key"],
            system_prompt=system_prompt,
            user_prompt=continuation_prompt,
            article_id=input_snapshot.get("article_id"),
            task_type=input_snapshot.get("task_type"),
            content_type=input_snapshot.get("content_type"),
            task_id=input_snapshot.get("task_id"),
            request_context={
                "parameters": input_snapshot.get("parameters") or {},
                "max_tokens": input_snapshot.get("max_tokens"),
            },
        )
