from ai_client import ConfigurableAIClient
from sqlalchemy import or_
from models import ModelAPIConfig, PromptConfig
from task_errors import TaskConfigError

from .common import PromptOutputContract, build_parameters


class _ConfigMixin:
    def _prompt_ordering(self, query):
        return query.order_by(
            PromptConfig.is_default.desc(),
            PromptConfig.updated_at.desc(),
            PromptConfig.created_at.desc(),
            PromptConfig.id.asc(),
        )

    def _model_ordering(self, query):
        return query.order_by(
            ModelAPIConfig.updated_at.desc(),
            ModelAPIConfig.created_at.desc(),
            ModelAPIConfig.id.asc(),
        )

    def _get_prompt_config(
        self,
        db,
        category_id: str | None = None,
        prompt_type: str = "summary",
    ):
        prompt_query = db.query(PromptConfig).filter(
            PromptConfig.is_enabled == True,
            PromptConfig.type == prompt_type,
        )

        prompt_config = None
        if category_id:
            prompt_config = self._prompt_ordering(
                prompt_query.filter(PromptConfig.category_id == category_id)
            ).first()

        if not prompt_config:
            prompt_config = self._prompt_ordering(
                prompt_query.filter(PromptConfig.category_id.is_(None))
            ).first()

        return prompt_config

    def get_ai_config(
        self, db, category_id: str | None = None, prompt_type: str = "summary"
    ):
        model_query = db.query(ModelAPIConfig).filter(
            ModelAPIConfig.is_enabled == True,
            or_(
                ModelAPIConfig.model_type.is_(None),
                ModelAPIConfig.model_type != "vector",
            ),
        )
        prompt_config = self._get_prompt_config(
            db, category_id=category_id, prompt_type=prompt_type
        )

        model_config = None
        if prompt_config and prompt_config.model_api_config_id:
            bound_model = (
                db.query(ModelAPIConfig)
                .filter(ModelAPIConfig.id == prompt_config.model_api_config_id)
                .first()
            )
            if not bound_model:
                raise TaskConfigError("提示词绑定的模型不存在，请检查模型配置")
            if not bound_model.is_enabled:
                raise TaskConfigError("提示词绑定的模型已禁用，请启用后再试")
            self._assert_general_model(bound_model)
            model_config = bound_model

        if not model_config:
            model_config = self._model_ordering(
                model_query.filter(ModelAPIConfig.is_default == True)
            ).first()

        if not model_config:
            model_config = self._model_ordering(model_query).first()

        if not model_config:
            return None

        result = {
            "base_url": model_config.base_url,
            "api_key": model_config.api_key,
            "model_name": model_config.model_name,
            "provider": model_config.provider or "openai",
            "model_api_config_id": model_config.id,
            "api_type": model_config.api_type or "chat_completions",
            "thinking_level": model_config.thinking_level or "disabled",
            "price_input_per_1k": model_config.price_input_per_1k,
            "price_output_per_1k": model_config.price_output_per_1k,
            "currency": model_config.currency,
            "context_window_tokens": model_config.context_window_tokens,
            "reserve_output_tokens": model_config.reserve_output_tokens,
            "prompt_template": prompt_config.prompt if prompt_config else None,
        }

        parameters = build_parameters(prompt_config) if prompt_config else {}
        result["parameters"] = parameters or None
        return result

    def create_ai_client(self, config: dict) -> ConfigurableAIClient:
        return ConfigurableAIClient(
            base_url=config["base_url"],
            api_key=config["api_key"],
            model_name=config["model_name"],
            api_type=config.get("api_type") or "chat_completions",
            provider=config.get("provider") or "openai",
            thinking_level=config.get("thinking_level") or "disabled",
        )

    def _get_prompt_output_contract(self, prompt_type: str) -> PromptOutputContract:
        return self.STRUCTURED_OUTPUT_CONTRACTS.get(
            prompt_type,
            PromptOutputContract(mode="text", response_format=None),
        )

    def _merge_protocol_parameters(
        self,
        prompt_type: str,
        parameters: dict | None,
    ) -> dict:
        contract = self._get_prompt_output_contract(prompt_type)
        return self._merge_parameters_with_contract(parameters, contract)

    def _merge_parameters_with_contract(
        self,
        parameters: dict | None,
        contract: PromptOutputContract,
    ) -> dict:
        merged = dict(parameters or {})
        if contract.response_format is not None:
            merged["response_format"] = contract.response_format
        if contract.system_instruction:
            existing_system_prompt = str(merged.get("system_prompt") or "").strip()
            protocol_block = (
                "固定输出协议（系统注入，不可配置）：\n"
                f"{contract.system_instruction}"
            )
            if existing_system_prompt:
                merged["system_prompt"] = (
                    f"{existing_system_prompt}\n\n{protocol_block}"
                )
            else:
                merged["system_prompt"] = protocol_block
        # Structured JSON outputs need tokens for the payload itself. MiniMax-M3
        # defaults to adaptive thinking which can exhaust max_tokens on <think>
        # only. Prefer disabling thinking unless the prompt config overrides.
        if (
            contract.mode in {"json_object", "structured_json"}
            and "thinking" not in merged
            and "disable_thinking" not in merged
        ):
            merged["disable_thinking"] = True
        return merged

    def _assert_general_model(self, model_config: ModelAPIConfig) -> None:
        if (model_config.model_type or "general") == "vector":
            raise TaskConfigError("当前任务仅支持通用模型，不能使用向量模型")
