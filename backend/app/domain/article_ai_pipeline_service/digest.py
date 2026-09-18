from app.domain.article_digest import (
    build_prefill_material,
    join_digest_lines,
    parse_digest_prefill_result,
)
from models import AIAnalysis, Article, ModelAPIConfig, PromptConfig
from task_errors import TaskConfigError, TaskDataError

from . import common
from .common import build_parameters


class _DigestMixin:
    async def process_digest_prefill(
        self,
        article_id: str,
        category_id: str | None,
        model_config_id: str | None = None,
        prompt_config_id: str | None = None,
    ):
        """Generate six-line note draft; result goes to task payload only."""
        db = common.SessionLocal()
        try:
            article = db.query(Article).filter(Article.id == article_id).first()
            if not article:
                raise TaskDataError("文章不存在")

            analysis = (
                db.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).first()
            )
            summary = analysis.summary if analysis else None
            outline = analysis.outline if analysis else None
            material, flags = build_prefill_material(
                summary=summary,
                outline=outline,
                content_md=article.content_md,
            )
            if not material:
                raise TaskDataError("缺少摘要、大纲或正文，无法生成批注")

            ai_config = None
            prompt = None
            prompt_parameters: dict = {}
            default_config = self.get_ai_config(
                db, category_id, prompt_type="digest_prefill"
            )

            if model_config_id:
                model_config = (
                    db.query(ModelAPIConfig)
                    .filter(
                        ModelAPIConfig.id == model_config_id,
                        ModelAPIConfig.is_enabled == True,
                    )
                    .first()
                )
                if not model_config:
                    raise TaskConfigError("指定模型配置不存在或已禁用")
                self._assert_general_model(model_config)
                ai_config = {
                    "base_url": model_config.base_url,
                    "api_key": model_config.api_key,
                    "model_name": model_config.model_name,
                    "model_api_config_id": model_config.id,
                    "api_type": model_config.api_type or "chat_completions",
                    "price_input_per_1k": model_config.price_input_per_1k,
                    "price_output_per_1k": model_config.price_output_per_1k,
                    "currency": model_config.currency,
                    "parameters": default_config.get("parameters") if default_config else None,
                }

            if prompt_config_id:
                prompt_config = (
                    db.query(PromptConfig)
                    .filter(
                        PromptConfig.id == prompt_config_id,
                        PromptConfig.is_enabled == True,
                        PromptConfig.type == "digest_prefill",
                    )
                    .first()
                )
                if not prompt_config:
                    raise TaskConfigError(
                        "指定批注提示词不存在、已禁用或类型不匹配"
                    )
                prompt = prompt_config.prompt
                prompt_parameters = build_parameters(prompt_config)
                if not ai_config and prompt_config.model_api_config_id:
                    model_config = (
                        db.query(ModelAPIConfig)
                        .filter(
                            ModelAPIConfig.id == prompt_config.model_api_config_id,
                            ModelAPIConfig.is_enabled == True,
                        )
                        .first()
                    )
                    if not model_config:
                        raise TaskConfigError("提示词绑定的模型不存在或已禁用")
                    self._assert_general_model(model_config)
                    ai_config = {
                        "base_url": model_config.base_url,
                        "api_key": model_config.api_key,
                        "model_name": model_config.model_name,
                        "model_api_config_id": model_config.id,
                        "api_type": model_config.api_type or "chat_completions",
                        "price_input_per_1k": model_config.price_input_per_1k,
                        "price_output_per_1k": model_config.price_output_per_1k,
                        "currency": model_config.currency,
                    }

            if not ai_config and default_config:
                ai_config = default_config
            if not prompt and default_config:
                prompt = default_config.get("prompt_template")
            if not ai_config:
                raise TaskConfigError("未配置AI服务，请先在配置页面设置AI参数")
            if not prompt:
                raise TaskConfigError("未配置批注提示词，请先在配置页面设置")

            parameters = ai_config.get("parameters") or {}
            if prompt_parameters:
                parameters = {**parameters, **prompt_parameters}
            elif not parameters and default_config:
                parameters = default_config.get("parameters") or {}

            protocol = self.SINGLE_OUTPUT_PROTOCOLS.get("digest_prefill")
            instruction = str(prompt).strip()
            # Prefer explicit material block over raw article body.
            if "{content}" in instruction:
                instruction = instruction.replace("{content}", material)
                user_prompt = instruction
                if protocol:
                    user_prompt = f"{instruction}\n\n{protocol}"
            else:
                blocks = [instruction]
                if protocol:
                    blocks.append(protocol)
                blocks.append(f"客观材料：\n{material}")
                user_prompt = "\n\n".join(block for block in blocks if block)

            parameters = self._merge_protocol_parameters("digest_prefill", parameters)
            pricing = {
                "model_api_config_id": ai_config.get("model_api_config_id"),
                "price_input_per_1k": ai_config.get("price_input_per_1k"),
                "price_output_per_1k": ai_config.get("price_output_per_1k"),
                "currency": ai_config.get("currency"),
            }
            ai_client = self.create_ai_client(ai_config)
            max_tokens = self._resolve_generation_max_tokens(
                "digest_prefill", parameters
            )
            parameters = dict(parameters or {})
            parameters["max_tokens"] = max_tokens
            result = await self.ai_invocation_service.invoke_generation(
                db=db,
                api_type=ai_config.get("api_type") or "chat_completions",
                model_name=ai_config["model_name"],
                base_url=ai_config["base_url"],
                api_key=ai_config["api_key"],
                system_prompt=parameters.get("system_prompt"),
                user_prompt=user_prompt,
                article_id=article_id,
                task_type="process_ai_content",
                content_type="digest_prefill",
                task_id=self.current_task_id,
                client=ai_client,
                content=material,
                prompt=user_prompt,
                parameters=parameters,
                max_tokens=max_tokens,
                request_context={
                    "parameters": parameters,
                    "max_tokens": max_tokens,
                    "material_flags": flags,
                },
            )

            raw_content = result.get("content") if isinstance(result, dict) else result
            try:
                lines = parse_digest_prefill_result(raw_content)
            except ValueError as exc:
                raise TaskDataError(str(exc)) from exc

            note_markdown = join_digest_lines(lines)
            self._update_current_task_payload(
                db,
                digest_prefill_result={
                    "lines": lines,
                    "note_markdown": note_markdown,
                    "material_flags": flags,
                },
            )

            if isinstance(result, dict):
                usage_log = self._log_ai_usage(
                    db,
                    model_config_id=pricing.get("model_api_config_id"),
                    article_id=article_id,
                    task_type="process_ai_content",
                    content_type="digest_prefill",
                    usage=result.get("usage"),
                    latency_ms=result.get("latency_ms"),
                    status="completed",
                    error_message=None,
                    price_input_per_1k=pricing.get("price_input_per_1k"),
                    price_output_per_1k=pricing.get("price_output_per_1k"),
                    currency=pricing.get("currency"),
                    request_payload=result.get("request_payload"),
                    response_payload=result.get("response_payload"),
                )
                if usage_log is not None:
                    self.ai_call_session_service.create_session(
                        db,
                        usage_log_id=usage_log.id,
                        task_id=self.current_task_id,
                        article_id=article_id,
                        task_type="process_ai_content",
                        content_type="digest_prefill",
                        session_info=result.get("session_info") or {},
                    )
            db.commit()
        except Exception as exc:
            print(f"digest_prefill 处理失败: {exc}")
            raise
        finally:
            db.close()
