from typing import Literal, Optional

from pydantic import BaseModel


class CommentSettingsUpdate(BaseModel):
    comments_enabled: Optional[bool] = None
    github_client_id: Optional[str] = None
    github_client_secret: Optional[str] = None
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    nextauth_secret: Optional[str] = None
    sensitive_filter_enabled: Optional[bool] = None
    sensitive_words: Optional[str] = None


class StorageSettingsUpdate(BaseModel):
    media_storage_enabled: Optional[bool] = None
    media_compress_threshold: Optional[int] = None
    media_max_dim: Optional[int] = None
    media_webp_quality: Optional[int] = None


class RecommendationSettingsUpdate(BaseModel):
    recommendations_enabled: Optional[bool] = None
    recommendation_model_config_id: Optional[str] = None


class ExtractionSettingsUpdate(BaseModel):
    jina_reader_enabled: Optional[bool] = None
    jina_reader_base_url: Optional[str] = None
    jina_reader_api_key: Optional[str] = None
    jina_reader_timeout_seconds: Optional[int] = None
    jina_reader_token_budget: Optional[int] = None
    jina_reader_prefer_mode: Optional[
        Literal["jina_first", "local_first", "local_only"]
    ] = None
    auto_ai_cleaning_enabled: Optional[bool] = None
    auto_ai_classification_enabled: Optional[bool] = None
    auto_ai_summary_enabled: Optional[bool] = None
    auto_ai_tagging_enabled: Optional[bool] = None
    auto_translation_enabled: Optional[bool] = None


class BasicSettingsUpdate(BaseModel):
    default_language: Optional[str] = None
    site_name: Optional[str] = None
    site_description: Optional[str] = None
    site_logo_url: Optional[str] = None
    rss_enabled: Optional[bool] = None
    home_badge_text: Optional[str] = None
    home_tagline_text: Optional[str] = None
    home_primary_button_text: Optional[str] = None
    home_primary_button_url: Optional[str] = None
    home_secondary_button_text: Optional[str] = None
    home_secondary_button_url: Optional[str] = None


class MediaIngestRequest(BaseModel):
    url: str
    article_id: Optional[str] = None
    review_issue_id: Optional[str] = None
    kind: Literal["image", "book"] = "image"
