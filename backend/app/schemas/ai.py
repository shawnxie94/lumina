from typing import Optional

from pydantic import BaseModel, ConfigDict, validator


class AITaskRetryRequest(BaseModel):
    task_ids: list[str]


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
    price_input_per_1k: Optional[float] = None
    price_output_per_1k: Optional[float] = None
    currency: Optional[str] = None
    is_enabled: bool = True
    is_default: bool = False

    @validator("name")
    def validate_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("模型API配置名称不能为空")
        return trimmed


class PromptConfigBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str
    category_id: Optional[str] = None
    type: str
    prompt: str
    system_prompt: Optional[str] = None
    response_format: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    model_api_config_id: Optional[str] = None
    is_enabled: bool = True
    is_default: bool = False
