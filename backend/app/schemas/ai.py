from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class AITaskRetryRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    task_ids: list[str]
    model_config_id: Optional[str] = None
    prompt_config_id: Optional[str] = None


class AITaskCancelRequest(BaseModel):
    task_ids: list[str]


class ModelAPITestRequest(BaseModel):
    prompt: Optional[str] = None
    max_tokens: Optional[int] = None


class ModelAPIModelsRequest(BaseModel):
    base_url: str
    api_key: str
    provider: Optional[str] = None


class ModelAPIConfigBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str
    base_url: str
    api_key: str
    provider: str = "openai"
    model_name: str = "gpt-4o"
    model_type: str = "general"
    api_type: str = "chat_completions"
    thinking_level: Optional[str] = "disabled"
    price_input_per_1k: Optional[float] = None
    price_output_per_1k: Optional[float] = None
    currency: Optional[str] = None
    context_window_tokens: Optional[int] = None
    reserve_output_tokens: Optional[int] = None
    is_enabled: bool = True
    is_default: bool = False

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("模型API配置名称不能为空")
        return trimmed

    @field_validator("thinking_level")
    @classmethod
    def validate_thinking_level(cls, value: Optional[str]) -> str:
        normalized = (value or "disabled").strip().lower()
        if normalized not in {"disabled", "auto", "low", "medium", "high", "adaptive"}:
            raise ValueError("思考等级不支持")
        return normalized

    @field_validator("api_type")
    @classmethod
    def validate_api_type(cls, value: str) -> str:
        normalized = (value or "").strip()
        if normalized not in {"chat_completions", "responses"}:
            raise ValueError("API 类型不支持")
        return normalized


class PromptConfigBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str
    category_id: Optional[str] = None
    type: str
    prompt: str
    system_prompt: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    chunk_size_tokens: Optional[int] = None
    chunk_overlap_tokens: Optional[int] = None
    max_continue_rounds: Optional[int] = None
    model_api_config_id: Optional[str] = None
    is_enabled: bool = True
    is_default: bool = False
