from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class TopicSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    bridge_base_url: Optional[str] = None
    bridge_token: Optional[str] = None
    auto_sync_on_enable: Optional[bool] = None
    knowledge_type: Optional[str] = None
    project_path: Optional[str] = None
    last_sync_at: Optional[str] = None
    last_sync_status: Optional[str] = None
    last_sync_error: Optional[str] = None
    last_sync_result: Optional[dict[str, Any]] = None
    health: Optional[dict[str, Any]] = None


class TopicClaimWriteback(BaseModel):
    text: str
    article_ids: list[str] = Field(default_factory=list)


class TopicWritebackItem(BaseModel):
    key: str
    title: str
    # Deprecated compatibility field. Ignored on write; API summary is derived from content_md.
    summary: Optional[str] = None
    content_md: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    status: Optional[str] = "active"
    topic_type: Optional[str] = None
    article_ids: list[str] = Field(default_factory=list)
    claims: list[TopicClaimWriteback] = Field(default_factory=list)
    related_topic_keys: list[str] = Field(default_factory=list)
    compiler_ref: Optional[str] = None
    relation_reasons: dict[str, str] = Field(default_factory=dict)


class ArticleCompileWritebackItem(BaseModel):
    article_id: str
    compile_status: Optional[str] = "compiled"
    compiled_at: Optional[str] = None
    topic_keys: list[str] = Field(default_factory=list)
    compile_error: Optional[str] = None
    replace_topics: bool = True


class TopicCompileResultsRequest(BaseModel):
    compiler: str = "llm_wiki"
    compiler_project_id: Optional[str] = None
    compiled_at: str
    topics: list[TopicWritebackItem] = Field(default_factory=list)
    articles: list[ArticleCompileWritebackItem] = Field(default_factory=list)


class TopicOrphanCleanupRequest(BaseModel):
    dry_run: bool = True
    # Optional. When empty, backend fetches current keys from Bridge /wiki/topics.
    known_keys: list[str] = Field(default_factory=list)
