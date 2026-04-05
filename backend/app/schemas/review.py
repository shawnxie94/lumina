from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, field_validator


class ReviewTemplateBase(BaseModel):
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    is_enabled: bool = True
    schedule_type: str
    custom_interval_days: Optional[int] = None
    anchor_date: str
    timezone: str = "Asia/Shanghai"
    trigger_time: str = "09:00"
    include_all_categories: bool = True
    category_ids: list[str] = []
    model_api_config_id: Optional[str] = None
    review_input_mode: str = "abstract"
    system_prompt: Optional[str] = None
    prompt_template: str
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    title_template: str

    @field_validator("schedule_type")
    @classmethod
    def validate_schedule_type(cls, value: str) -> str:
        valid = {"weekly", "monthly", "custom_days"}
        if value not in valid:
            raise ValueError(f"schedule_type must be one of: {', '.join(sorted(valid))}")
        return value

    @field_validator("custom_interval_days")
    @classmethod
    def validate_custom_interval_days(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("custom_interval_days must be positive")
        return value

    @field_validator("review_input_mode")
    @classmethod
    def validate_review_input_mode(cls, value: str) -> str:
        valid = {"abstract", "summary", "full_text"}
        if value not in valid:
            raise ValueError(f"review_input_mode must be one of: {', '.join(sorted(valid))}")
        return value

    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 2:
            raise ValueError("temperature must be between 0 and 2")
        return value

    @field_validator("max_tokens")
    @classmethod
    def validate_max_tokens(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("max_tokens must be positive")
        return value

    @field_validator("top_p")
    @classmethod
    def validate_top_p(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 1:
            raise ValueError("top_p must be between 0 and 1")
        return value


class ReviewTemplateUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    is_enabled: Optional[bool] = None
    schedule_type: Optional[str] = None
    custom_interval_days: Optional[int] = None
    anchor_date: Optional[str] = None
    timezone: Optional[str] = None
    trigger_time: Optional[str] = None
    include_all_categories: Optional[bool] = None
    category_ids: Optional[list[str]] = None
    model_api_config_id: Optional[str] = None
    review_input_mode: Optional[str] = None
    system_prompt: Optional[str] = None
    prompt_template: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    title_template: Optional[str] = None

    @field_validator("schedule_type")
    @classmethod
    def validate_schedule_type(cls, value: str | None) -> str | None:
        if value is None:
            return value
        valid = {"weekly", "monthly", "custom_days"}
        if value not in valid:
            raise ValueError(f"schedule_type must be one of: {', '.join(sorted(valid))}")
        return value

    @field_validator("custom_interval_days")
    @classmethod
    def validate_custom_interval_days(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("custom_interval_days must be positive")
        return value

    @field_validator("review_input_mode")
    @classmethod
    def validate_review_input_mode(cls, value: str | None) -> str | None:
        if value is None:
            return value
        valid = {"abstract", "summary", "full_text"}
        if value not in valid:
            raise ValueError(f"review_input_mode must be one of: {', '.join(sorted(valid))}")
        return value

    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 2:
            raise ValueError("temperature must be between 0 and 2")
        return value

    @field_validator("max_tokens")
    @classmethod
    def validate_max_tokens(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("max_tokens must be positive")
        return value

    @field_validator("top_p")
    @classmethod
    def validate_top_p(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 1:
            raise ValueError("top_p must be between 0 and 1")
        return value


class ReviewIssueUpdateRequest(BaseModel):
    title: Optional[str] = None
    published_at: Optional[str] = None
    top_image: Optional[str] = None
    markdown_content: str


class ReviewTemplateManualRunRequest(BaseModel):
    date_start: Optional[str] = None
    date_end: Optional[str] = None
    article_ids: list[str]
    model_api_config_id: Optional[str] = None
