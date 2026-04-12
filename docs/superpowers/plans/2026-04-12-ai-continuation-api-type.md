# AI Continuation API Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add model-level API type selection plus task-node AI continuation for article AI content, with `chat_completions` snapshot replay and `responses` provider-first continuation.

**Architecture:** Extend model API configs with an explicit `api_type`, persist continuation-capable session records beside AI usage logs, and route article AI content generation through a unified invocation adapter. Expose a usage-node continuation endpoint and merge infographic repair into the new admin continuation modal while preserving the old repair endpoint as a compatibility wrapper.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, Alembic, pytest, Next.js pages router, TypeScript, Axios, OpenAI Python SDK

---

## File Map

- Create: `backend/app/domain/ai_invocation_service.py`
  Responsible for unified `chat_completions` / `responses` invocation and continuation handling.
- Create: `backend/app/domain/ai_call_session_service.py`
  Responsible for persisting and reading `ai_call_sessions`.
- Create: `backend/tests/unit/api/test_ai_usage_router.py`
  Covers continuation endpoint and compatibility wrapper behavior.
- Create: `backend/tests/unit/api/test_model_api_router.py`
  Covers `api_type` serialization and CRUD validation.
- Modify: `backend/models.py`
  Add `ModelAPIConfig.api_type` and new `AICallSession` model.
- Modify: `backend/alembic/versions/20260412_0019_ai_call_sessions_and_api_type.py`
  Add new DB schema for `api_type` and `ai_call_sessions`.
- Modify: `backend/app/schemas/ai.py`
  Add `api_type` to model config schema and request schema for usage continuation.
- Modify: `backend/app/schemas/__init__.py`
  Export the new continuation request schema.
- Modify: `backend/app/api/routers/model_api_router.py`
  Read/write `api_type`; test model config endpoint against selected API type.
- Modify: `backend/app/api/routers/ai_usage_router.py`
  Expose `POST /api/ai-usage/{usage_id}/continue`.
- Modify: `backend/app/api/routers/article_router.py`
  Forward `repair-infographic` to the continuation path.
- Modify: `backend/app/api/routers/ai_tasks_router.py`
  Include session metadata in timeline usage payloads.
- Modify: `backend/app/domain/article_ai_pipeline_service.py`
  Route article AI content generation and continuation through the new invocation adapter.
- Modify: `backend/app/domain/article_command_service.py`
  Replace direct infographic repair enqueue logic with continuation-aware flow.
- Modify: `backend/ai_client.py`
  Either reduce to transport helpers or keep only low-level call helpers used by the new adapter.
- Modify: `backend/pyproject.toml`
  Upgrade OpenAI SDK to a version that supports `responses`.
- Modify: `backend/uv.lock`
  Refresh dependency lock after SDK update.
- Modify: `frontend/lib/api.ts`
  Add `api_type`, timeline session info, and usage continuation API client.
- Modify: `frontend/pages/admin.tsx`
  Add unified continuation modal and merge infographic repair behavior into it.
- Modify: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`
  Add invocation/session persistence and continuation tests.
- Modify: `backend/tests/unit/api/test_ai_tasks_router.py`
  Assert timeline usage entries expose session metadata.
- Modify: `backend/tests/unit/core/test_db_migrations.py`
  Assert new migration ordering and schema effects.

### Task 1: Add backend regression tests for `api_type` and DB schema

**Files:**
- Create: `backend/tests/unit/api/test_model_api_router.py`
- Modify: `backend/tests/unit/core/test_db_migrations.py`
- Modify: `backend/models.py`
- Test: `backend/tests/unit/api/test_model_api_router.py`
- Test: `backend/tests/unit/core/test_db_migrations.py`

- [ ] **Step 1: Write the failing API router tests**

```python
from app.api.routers import model_api_router
from app.schemas.ai import ModelAPIConfigBase


async def test_create_model_api_config_returns_explicit_api_type(db_session):
    payload = ModelAPIConfigBase(
        name="Responses Model",
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        provider="openai",
        model_name="gpt-4.1",
        model_type="general",
        api_type="responses",
        is_enabled=True,
        is_default=False,
    )

    response = await model_api_router.create_model_api_config(
        config=payload,
        db=db_session,
        _=True,
    )

    assert response["api_type"] == "responses"


async def test_get_model_api_configs_defaults_legacy_rows_to_chat_completions(db_session):
    from models import ModelAPIConfig

    row = ModelAPIConfig(
        name="Legacy Model",
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        provider="openai",
        model_name="gpt-4o",
        model_type="general",
        api_type=None,
        is_enabled=True,
        is_default=False,
    )
    db_session.add(row)
    db_session.commit()

    response = await model_api_router.get_model_api_configs(db=db_session, _=True)

    assert response[0]["api_type"] == "chat_completions"
```

- [ ] **Step 2: Run the focused API router tests to verify failure**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/api/test_model_api_router.py -q`

Expected: FAIL because `ModelAPIConfigBase` does not accept `api_type` and `serialize_model_api_config` does not return it.

- [ ] **Step 3: Write the failing migration regression tests**

```python
def test_ai_continuation_migration_is_ordered_and_explicit():
    versions_dir = Path(__file__).resolve().parents[2] / "alembic" / "versions"
    assert any("ai_call_sessions" in path.name for path in versions_dir.glob("*.py"))


def test_ai_call_sessions_table_and_api_type_column_exist_after_upgrade(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    run_migrations(engine)
    inspector = inspect(engine)

    model_columns = {col["name"] for col in inspector.get_columns("model_api_configs")}
    session_columns = {col["name"] for col in inspector.get_columns("ai_call_sessions")}

    assert "api_type" in model_columns
    assert {"usage_log_id", "api_type", "input_snapshot", "output_snapshot"} <= session_columns
```

- [ ] **Step 4: Run the migration tests to verify failure**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/core/test_db_migrations.py -q`

Expected: FAIL because the new migration file and schema are not present yet.

- [ ] **Step 5: Commit the red tests**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/tests/unit/api/test_model_api_router.py backend/tests/unit/core/test_db_migrations.py
git commit -m "test: cover ai continuation schema expectations"
```

### Task 2: Add DB schema, model/schema support, and model API config CRUD updates

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/app/schemas/ai.py`
- Modify: `backend/app/schemas/__init__.py`
- Modify: `backend/app/api/routers/model_api_router.py`
- Modify: `backend/alembic/versions/20260412_0019_ai_call_sessions_and_api_type.py`
- Test: `backend/tests/unit/api/test_model_api_router.py`
- Test: `backend/tests/unit/core/test_db_migrations.py`

- [ ] **Step 1: Add the failing schema validation test for required API type**

```python
import pytest
from pydantic import ValidationError
from app.schemas.ai import ModelAPIConfigBase


def test_model_api_config_rejects_unknown_api_type():
    with pytest.raises(ValidationError):
        ModelAPIConfigBase(
            name="Bad API Type",
            base_url="https://api.openai.com/v1",
            api_key="sk-test",
            provider="openai",
            model_name="gpt-4o",
            model_type="general",
            api_type="legacy_completions",
        )
```

- [ ] **Step 2: Run schema and API tests to verify failure**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/api/test_model_api_router.py -q`

Expected: FAIL because schema validation still has no `api_type`.

- [ ] **Step 3: Implement the minimal schema and model changes**

```python
class ModelAPIConfig(Base):
    __tablename__ = "model_api_configs"
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    base_url = Column(String, nullable=False, default="https://api.openai.com/v1")
    api_key = Column(String, nullable=False)
    provider = Column(String, nullable=False, default="openai")
    model_name = Column(String, nullable=False, default="gpt-4o")
    model_type = Column(String, nullable=False, default="general")
    api_type = Column(String, nullable=False, default="chat_completions")


class AICallSession(Base):
    __tablename__ = "ai_call_sessions"

    id = Column(String, primary_key=True, default=generate_uuid)
    usage_log_id = Column(String, ForeignKey("ai_usage_logs.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(String, nullable=True)
    article_id = Column(String, ForeignKey("articles.id", ondelete="SET NULL"), nullable=True)
    task_type = Column(String, nullable=True)
    content_type = Column(String, nullable=True)
    api_type = Column(String, nullable=False)
    continuation_mode = Column(String, nullable=False)
    provider_response_id = Column(String, nullable=True)
    provider_request_id = Column(String, nullable=True)
    provider_conversation_id = Column(String, nullable=True)
    input_snapshot = Column(Text, nullable=True)
    output_snapshot = Column(Text, nullable=True)
    source_usage_log_id = Column(String, ForeignKey("ai_usage_logs.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(String, default=now_str)
    updated_at = Column(String, default=now_str)
```

```python
class ModelAPIConfigBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    name: str
    base_url: str
    api_key: str
    provider: str = "openai"
    model_name: str = "gpt-4o"
    model_type: str = "general"
    api_type: str = "chat_completions"
    price_input_per_1k: Optional[float] = None
    price_output_per_1k: Optional[float] = None
    currency: Optional[str] = None
    context_window_tokens: Optional[int] = None
    reserve_output_tokens: Optional[int] = None
    is_enabled: bool = True
    is_default: bool = False

    @validator("api_type")
    def validate_api_type(cls, value: str) -> str:
        normalized = (value or "").strip()
        if normalized not in {"chat_completions", "responses"}:
            raise ValueError("API 类型不支持")
        return normalized
```

```python
def serialize_model_api_config(config: ModelAPIConfig) -> dict:
    return {
        "id": config.id,
        "name": config.name,
        "base_url": config.base_url,
        "api_key": config.api_key,
        "provider": config.provider or "openai",
        "model_name": config.model_name,
        "model_type": config.model_type or "general",
        "api_type": (config.api_type or "chat_completions"),
        "price_input_per_1k": config.price_input_per_1k,
        "price_output_per_1k": config.price_output_per_1k,
        "currency": config.currency,
        "context_window_tokens": config.context_window_tokens,
        "reserve_output_tokens": config.reserve_output_tokens,
        "is_enabled": config.is_enabled,
        "is_default": config.is_default,
        "created_at": config.created_at,
        "updated_at": config.updated_at,
    }
```

- [ ] **Step 4: Add the Alembic migration**

```python
def upgrade() -> None:
    with op.batch_alter_table("model_api_configs") as batch_op:
        batch_op.add_column(sa.Column("api_type", sa.String(), nullable=True))

    op.execute(
        "UPDATE model_api_configs SET api_type = 'chat_completions' WHERE api_type IS NULL"
    )

    with op.batch_alter_table("model_api_configs") as batch_op:
        batch_op.alter_column("api_type", existing_type=sa.String(), nullable=False)

    op.create_table(
        "ai_call_sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("usage_log_id", sa.String(), sa.ForeignKey("ai_usage_logs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("article_id", sa.String(), sa.ForeignKey("articles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_type", sa.String(), nullable=True),
        sa.Column("content_type", sa.String(), nullable=True),
        sa.Column("api_type", sa.String(), nullable=False),
        sa.Column("continuation_mode", sa.String(), nullable=False),
        sa.Column("provider_response_id", sa.String(), nullable=True),
        sa.Column("provider_request_id", sa.String(), nullable=True),
        sa.Column("provider_conversation_id", sa.String(), nullable=True),
        sa.Column("input_snapshot", sa.Text(), nullable=True),
        sa.Column("output_snapshot", sa.Text(), nullable=True),
        sa.Column("source_usage_log_id", sa.String(), sa.ForeignKey("ai_usage_logs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
```

- [ ] **Step 5: Run the DB and API tests to verify green**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/api/test_model_api_router.py tests/unit/core/test_db_migrations.py -q`

Expected: PASS with `api_type` serialized and migration schema present.

- [ ] **Step 6: Commit the schema slice**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/models.py backend/app/schemas/ai.py backend/app/schemas/__init__.py backend/app/api/routers/model_api_router.py backend/alembic/versions/*.py backend/tests/unit/api/test_model_api_router.py backend/tests/unit/core/test_db_migrations.py
git commit -m "feat: add api type and ai call session schema"
```

### Task 3: Add the unified invocation/session persistence layer

**Files:**
- Create: `backend/app/domain/ai_invocation_service.py`
- Create: `backend/app/domain/ai_call_session_service.py`
- Modify: `backend/ai_client.py`
- Modify: `backend/pyproject.toml`
- Modify: `backend/uv.lock`
- Modify: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`
- Test: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`

- [ ] **Step 1: Write the failing invocation tests**

```python
def test_invoke_generation_records_chat_completion_snapshot(db_session, monkeypatch):
    service = AIInvocationService()
    captured = {}

    async def fake_chat_create(**kwargs):
        captured["request"] = kwargs
        return SimpleNamespace(
            id="chatcmpl-1",
            model="gpt-4o",
            choices=[SimpleNamespace(message=SimpleNamespace(content="摘要结果"), finish_reason="stop")],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15),
        )

    monkeypatch.setattr(service, "_create_chat_completion", fake_chat_create)

    result = asyncio.run(
        service.invoke_generation(
            db=db_session,
            api_type="chat_completions",
            model_name="gpt-4o",
            base_url="https://api.openai.com/v1",
            api_key="sk-test",
            system_prompt="sys",
            user_prompt="user",
            article_id="article-1",
            task_type="process_ai_content",
            content_type="summary",
            task_id="task-1",
        )
    )

    assert result["session_info"]["continuation_mode"] == "snapshot"
    assert result["session_info"]["input_snapshot"]["user_prompt"] == "user"
```

```python
def test_invoke_continuation_prefers_responses_previous_response_id(db_session, monkeypatch):
    service = AIInvocationService()
    called = {}

    async def fake_response_continue(**kwargs):
        called["kwargs"] = kwargs
        return {
            "content": "更新后的摘要",
            "usage": None,
            "request_payload": kwargs,
            "response_payload": {"id": "resp-2"},
            "session_info": {
                "api_type": "responses",
                "continuation_mode": "provider",
                "provider_response_id": "resp-2",
                "input_snapshot": {"feedback": "请更短"},
                "output_snapshot": {"content": "更新后的摘要"},
            },
        }

    monkeypatch.setattr(service, "_invoke_responses_continuation", fake_response_continue)

    result = asyncio.run(
        service.invoke_continuation(
            db=db_session,
            session_info={"api_type": "responses", "provider_response_id": "resp-1", "input_snapshot": {}, "output_snapshot": {}},
            feedback="请更短",
            model_config={"base_url": "https://api.openai.com/v1", "api_key": "sk-test", "model_name": "gpt-4.1"},
        )
    )

    assert called["kwargs"]["previous_response_id"] == "resp-1"
    assert result["session_info"]["provider_response_id"] == "resp-2"
```

- [ ] **Step 2: Run the invocation tests to verify failure**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`

Expected: FAIL because `AIInvocationService` and session persistence helpers do not exist.

- [ ] **Step 3: Implement minimal invocation and session services**

```python
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
    ):
        session = AICallSession(
            usage_log_id=usage_log_id,
            task_id=task_id,
            article_id=article_id,
            task_type=task_type,
            content_type=content_type,
            api_type=session_info["api_type"],
            continuation_mode=session_info["continuation_mode"],
            provider_response_id=session_info.get("provider_response_id"),
            provider_request_id=session_info.get("provider_request_id"),
            provider_conversation_id=session_info.get("provider_conversation_id"),
            input_snapshot=json.dumps(session_info.get("input_snapshot") or {}, ensure_ascii=False),
            output_snapshot=json.dumps(session_info.get("output_snapshot") or {}, ensure_ascii=False),
            source_usage_log_id=session_info.get("source_usage_log_id"),
            updated_at=now_str(),
        )
        db.add(session)
        db.flush()
        return session
```

```python
class AIInvocationService:
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
    ):
        if api_type == "responses":
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

    async def invoke_continuation(
        self,
        *,
        db,
        session_info: dict,
        feedback: str,
        model_config: dict,
    ):
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
```

- [ ] **Step 4: Upgrade the OpenAI dependency and lockfile**

```toml
dependencies = [
    "fastapi==0.104.1",
    "uvicorn==0.24.0",
    "sqlalchemy==2.0.23",
    "openai==2.31.0",
]
```

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv lock`

Expected: `uv.lock` updates successfully and keeps the backend dependency graph consistent.

- [ ] **Step 5: Re-run the invocation tests to verify green**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`

Expected: PASS for the new invocation/session tests and existing focused AI pipeline tests.

- [ ] **Step 6: Commit the invocation layer**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/app/domain/ai_invocation_service.py backend/app/domain/ai_call_session_service.py backend/ai_client.py backend/pyproject.toml backend/uv.lock backend/tests/unit/domain/test_article_ai_pipeline_service.py
git commit -m "feat: add ai invocation continuation adapter"
```

### Task 4: Route article AI content and infographic repair through continuation-aware services

**Files:**
- Modify: `backend/app/domain/article_ai_pipeline_service.py`
- Modify: `backend/app/domain/article_command_service.py`
- Modify: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`
- Test: `backend/tests/unit/domain/test_article_ai_pipeline_service.py`

- [ ] **Step 1: Write the failing pipeline continuation tests**

```python
def test_process_ai_content_uses_invocation_service_and_persists_session(db_session, monkeypatch):
    service = ArticleAIPipelineService()
    recorded = {}

    async def fake_generation(**kwargs):
        recorded["kwargs"] = kwargs
        return {
            "content": "新的摘要版本",
            "usage": None,
            "latency_ms": 8,
            "request_payload": {"messages": []},
            "response_payload": {"id": "resp-1"},
            "session_info": {
                "api_type": "chat_completions",
                "continuation_mode": "snapshot",
                "input_snapshot": {"user_prompt": "原始提示词"},
                "output_snapshot": {"content": "新的摘要版本"},
            },
        }

    monkeypatch.setattr(service.ai_invocation_service, "invoke_generation", fake_generation)
    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    asyncio.run(service.process_ai_content(article.id, None, "summary"))

    usage = db_session.query(AIUsageLog).filter(AIUsageLog.article_id == article.id).one()
    session = db_session.query(AICallSession).filter(AICallSession.usage_log_id == usage.id).one()
    assert session.api_type == "chat_completions"
```

```python
def test_repair_infographic_html_forwards_feedback_to_continuation_enqueue(db_session):
    service = ArticleCommandService()
    article = Article(
        title="Repair Source",
        slug="repair-source",
        content_md="content",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.add(
        AIAnalysis(
            article_id=article.id,
            infographic_status="failed",
            infographic_html="<div>old html</div>",
            updated_at=now_str(),
        )
    )
    db_session.add(
        AIUsageLog(
            task_id="task-infographic-source",
            article_id=article.id,
            task_type="process_ai_content",
            content_type="infographic",
            status="failed",
            request_payload="{}",
            response_payload="{}",
            created_at=now_str(),
        )
    )
    db_session.commit()
    service.repair_infographic_html(db_session, article.id, error_message="请缩短文字")
    task = db_session.query(AITask).order_by(AITask.created_at.desc()).first()
    payload = json.loads(task.payload)
    assert payload["continuation_feedback"] == "请缩短文字"
    assert payload["continuation_source_usage_id"] is not None
```

- [ ] **Step 2: Run the pipeline tests to verify failure**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`

Expected: FAIL because `process_ai_content` still logs usage directly and infographic repair still uses the old enqueue shape.

- [ ] **Step 3: Implement the minimal pipeline integration**

```python
result = await self.ai_invocation_service.invoke_generation(
    db=db,
    api_type=(ai_config.get("api_type") or "chat_completions"),
    model_name=ai_config["model_name"],
    base_url=ai_config["base_url"],
    api_key=ai_config["api_key"],
    system_prompt=parameters.get("system_prompt"),
    user_prompt=prompt,
    article_id=article_id,
    task_type="process_ai_content",
    content_type=content_type,
    task_id=self.current_task_id,
)
```

```python
usage_log = self._log_ai_usage(
    db,
    model_config_id=pricing.get("model_api_config_id"),
    article_id=article_id,
    task_type="process_ai_content",
    content_type=content_type,
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
self.ai_call_session_service.create_session(
    db=db,
    usage_log_id=usage_log.id,
    task_id=self.current_task_id,
    article_id=article_id,
    task_type="process_ai_content",
    content_type=content_type,
    session_info=result.get("session_info") or {},
)
```

```python
self.ai_task_service.enqueue_task(
    db,
    task_type="process_ai_content",
    article_id=article_id,
    content_type="infographic",
    payload={
        "category_id": article.category_id,
        "model_config_id": model_config_id,
        "continuation_feedback": normalized_error,
        "continuation_source_usage_id": latest_infographic_usage.id,
    },
)
```

- [ ] **Step 4: Re-run the pipeline tests to verify green**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/domain/test_article_ai_pipeline_service.py -q`

Expected: PASS with sessions recorded for new AI content calls and infographic repair enqueuing continuation metadata.

- [ ] **Step 5: Commit the pipeline integration**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/app/domain/article_ai_pipeline_service.py backend/app/domain/article_command_service.py backend/tests/unit/domain/test_article_ai_pipeline_service.py
git commit -m "feat: route article ai content through continuation service"
```

### Task 5: Expose usage continuation APIs and timeline session metadata

**Files:**
- Modify: `backend/app/api/routers/ai_usage_router.py`
- Modify: `backend/app/api/routers/ai_tasks_router.py`
- Modify: `backend/app/api/routers/article_router.py`
- Create: `backend/tests/unit/api/test_ai_usage_router.py`
- Modify: `backend/tests/unit/api/test_ai_tasks_router.py`
- Test: `backend/tests/unit/api/test_ai_usage_router.py`
- Test: `backend/tests/unit/api/test_ai_tasks_router.py`

- [ ] **Step 1: Write the failing router tests**

```python
async def test_continue_ai_usage_accepts_process_ai_content_usage(db_session, monkeypatch):
    usage = AIUsageLog(
        task_id="task-1",
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        request_payload="{}",
        response_payload="{}",
        created_at="2026-04-12T10:00:00",
    )
    db_session.add(usage)
    db_session.flush()
    db_session.add(
        AICallSession(
            usage_log_id=usage.id,
            task_id="task-1",
            article_id=article.id,
            task_type="process_ai_content",
            content_type="summary",
            api_type="chat_completions",
            continuation_mode="snapshot",
            input_snapshot="{}",
            output_snapshot="{}",
            created_at="2026-04-12T10:00:00",
            updated_at="2026-04-12T10:00:00",
        )
    )
    db_session.commit()

    response = await ai_usage_router.continue_ai_usage(
        usage_id=usage.id,
        payload=AIUsageContinuationRequest(feedback="请更短"),
        db=db_session,
        _=True,
    )

    assert response["status"] == "pending"
```

```python
async def test_get_ai_task_timeline_exposes_session_info_for_usage(db_session):
    article = Article(
        title="Timeline Article",
        slug="timeline-article",
        content_md="content",
        created_at="2026-04-12T10:00:00",
        updated_at="2026-04-12T10:00:00",
    )
    db_session.add(article)
    db_session.commit()
    task = AITask(
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at="2026-04-12T10:00:00",
        created_at="2026-04-12T10:00:00",
        updated_at="2026-04-12T10:00:00",
        finished_at="2026-04-12T10:01:00",
    )
    db_session.add(task)
    db_session.flush()
    usage = AIUsageLog(
        task_id=task.id,
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        request_payload="{}",
        response_payload="{}",
        created_at="2026-04-12T10:00:30",
    )
    db_session.add(usage)
    db_session.flush()
    db_session.add(
        AICallSession(
            usage_log_id=usage.id,
            task_id=task.id,
            article_id=article.id,
            task_type="process_ai_content",
            content_type="summary",
            api_type="chat_completions",
            continuation_mode="snapshot",
            input_snapshot="{}",
            output_snapshot="{}",
            created_at="2026-04-12T10:00:30",
            updated_at="2026-04-12T10:00:30",
        )
    )
    db_session.commit()
    response = await ai_tasks_router.get_ai_task_timeline(task_id=task.id, db=db_session, _=True)
    assert response["usage"][0]["session_info"]["api_type"] == "chat_completions"
```

- [ ] **Step 2: Run router tests to verify failure**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/api/test_ai_usage_router.py tests/unit/api/test_ai_tasks_router.py -q`

Expected: FAIL because the continuation endpoint and usage session metadata do not exist yet.

- [ ] **Step 3: Implement the minimal router changes**

```python
class AIUsageContinuationRequest(BaseModel):
    feedback: str
    model_config_id: str | None = None
```

```python
@router.post("/api/ai-usage/{usage_id}/continue")
async def continue_ai_usage(
    usage_id: str,
    payload: AIUsageContinuationRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    usage = db.query(AIUsageLog).filter(AIUsageLog.id == usage_id).first()
    if not usage or usage.task_type != "process_ai_content":
        raise HTTPException(status_code=400, detail="当前 AI 调用不支持继续生成")
    task_id = article_command_service.enqueue_ai_continuation(
        db=db,
        usage_id=usage.id,
        feedback=payload.feedback,
        model_config_id=payload.model_config_id,
    )
    return {"usage_id": usage.id, "task_id": task_id, "status": "pending"}
```

```python
usage_items.append(
    {
        "id": log.id,
        "model_api_config_id": log.model_api_config_id,
        "model_api_config_name": model_name,
        "task_type": log.task_type,
        "content_type": log.content_type,
        "status": log.status,
        "prompt_tokens": log.prompt_tokens,
        "completion_tokens": log.completion_tokens,
        "total_tokens": log.total_tokens,
        "cost_total": log.cost_total,
        "currency": log.currency,
        "latency_ms": log.latency_ms,
        "finish_reason": log.finish_reason,
        "truncated": log.truncated,
        "chunk_index": log.chunk_index,
        "continue_round": log.continue_round,
        "estimated_input_tokens": log.estimated_input_tokens,
        "error_message": log.error_message,
        "request_payload": log.request_payload,
        "response_payload": log.response_payload,
        "session_info": session_payload,
        "created_at": log.created_at,
    }
)
```

```python
@router.post("/api/articles/{article_slug}/repair-infographic")
async def repair_infographic_html(
    article_slug: str,
    payload: ArticleInfographicRepairRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    return await ai_usage_router.continue_ai_usage(
        usage_id=latest_usage.id,
        payload=AIUsageContinuationRequest(
            feedback=payload.error_message,
            model_config_id=payload.model_config_id,
        ),
        db=db,
        _=True,
    )
```

- [ ] **Step 4: Re-run the router tests to verify green**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/api/test_ai_usage_router.py tests/unit/api/test_ai_tasks_router.py -q`

Expected: PASS with continuation endpoint working and timeline usage entries exposing session metadata.

- [ ] **Step 5: Commit the API layer**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/app/api/routers/ai_usage_router.py backend/app/api/routers/ai_tasks_router.py backend/app/api/routers/article_router.py backend/app/schemas/ai.py backend/app/schemas/__init__.py backend/tests/unit/api/test_ai_usage_router.py backend/tests/unit/api/test_ai_tasks_router.py
git commit -m "feat: expose ai usage continuation endpoints"
```

### Task 6: Add frontend API types and the unified continuation modal

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/pages/admin.tsx`
- Test: manual verification in local dev

- [ ] **Step 1: Add the failing type-only assertions locally by wiring the new fields**

```typescript
export interface ModelAPIConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  provider: string;
  model_name: string;
  model_type?: string | null;
  api_type?: "chat_completions" | "responses";
  price_input_per_1k?: number | null;
  price_output_per_1k?: number | null;
  currency?: string | null;
  context_window_tokens?: number | null;
  reserve_output_tokens?: number | null;
  is_enabled: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AITaskTimelineUsage {
  id: string;
  model_api_config_id: string | null;
  model_api_config_name: string | null;
  task_type: string | null;
  content_type: string | null;
  status: string;
  request_payload: string | null;
  response_payload: string | null;
  session_info?: {
    api_type: "chat_completions" | "responses";
    continuation_mode: "provider" | "snapshot";
    provider_response_id?: string | null;
    input_snapshot?: Record<string, unknown> | null;
    output_snapshot?: Record<string, unknown> | null;
    source_usage_log_id?: string | null;
  } | null;
}
```

```typescript
continueAIUsage: async (
  usageId: string,
  data: { feedback: string; model_config_id?: string },
) => {
  const response = await api.post(`/api/ai-usage/${usageId}/continue`, data);
  return response.data;
},
```

- [ ] **Step 2: Run the frontend lint/build check to surface type failures**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm run lint`

Expected: FAIL or type/lint errors until `admin.tsx` consumes the new fields and the form state is updated.

- [ ] **Step 3: Implement the unified modal state and `api_type` model config field**

```typescript
const [showAIContinuationModal, setShowAIContinuationModal] = useState(false);
const [aiContinuationFeedback, setAIContinuationFeedback] = useState("");
const [aiContinuationSubmitting, setAIContinuationSubmitting] = useState(false);
const [aiContinuationModelConfigId, setAIContinuationModelConfigId] = useState("");
```

```typescript
const [modelAPIFormData, setModelAPIFormData] = useState({
  name: "",
  base_url: "https://api.openai.com/v1",
  api_key: "",
  provider: "openai",
  model_name: "gpt-4o",
  model_type: "general",
  api_type: "chat_completions",
  price_input_per_1k: "",
  price_output_per_1k: "",
  currency: "USD",
  context_window_tokens: "",
  reserve_output_tokens: "",
  is_enabled: true,
  is_default: false,
});
```

```tsx
<FormField label={t("API 类型")}>
  <SelectField
    value={modelAPIFormData.api_type}
    onChange={(value) =>
      setModelAPIFormData({
        name: modelAPIFormData.name,
        base_url: modelAPIFormData.base_url,
        api_key: modelAPIFormData.api_key,
        provider: modelAPIFormData.provider,
        model_name: modelAPIFormData.model_name,
        model_type: modelAPIFormData.model_type,
        api_type: value as "chat_completions" | "responses",
        price_input_per_1k: modelAPIFormData.price_input_per_1k,
        price_output_per_1k: modelAPIFormData.price_output_per_1k,
        currency: modelAPIFormData.currency,
        context_window_tokens: modelAPIFormData.context_window_tokens,
        reserve_output_tokens: modelAPIFormData.reserve_output_tokens,
        is_enabled: modelAPIFormData.is_enabled,
        is_default: modelAPIFormData.is_default,
      })
    }
    className="w-full"
    options={[
      { value: "chat_completions", label: "Chat Completions API" },
      { value: "responses", label: "Responses API" },
    ]}
  />
</FormField>
```

- [ ] **Step 4: Replace infographic repair actions with the continuation modal**

```typescript
const canContinueSelectedUsage =
  selectedTaskTimeline?.task.task_type === "process_ai_content" &&
  ["summary", "key_points", "outline", "quotes", "infographic"].includes(
    selectedTaskTimelineUsageContentType || "",
  ) &&
  Boolean(selectedTaskTimelineUsageNode?.session_info || selectedTaskTimelineUsageNode?.request_payload);
```

```typescript
const handleSubmitAIContinuation = async () => {
  if (!selectedTaskTimelineUsageId || aiContinuationSubmitting) return;
  setAIContinuationSubmitting(true);
  try {
    await articleApi.continueAIUsage(selectedTaskTimelineUsageId, {
      feedback: aiContinuationFeedback,
      model_config_id: aiContinuationModelConfigId || undefined,
    });
    showToast(t("已提交修改请求"));
    setShowAIContinuationModal(false);
    await handleRefreshTaskTimeline();
  } finally {
    setAIContinuationSubmitting(false);
  }
};
```

- [ ] **Step 5: Re-run the frontend lint/build check**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm run lint`

Expected: PASS with `api_type` wired into config editing and the unified continuation modal replacing infographic repair.

- [ ] **Step 6: Commit the frontend slice**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add frontend/lib/api.ts frontend/pages/admin.tsx
git commit -m "feat: add admin ai continuation modal"
```

### Task 7: Run focused end-to-end verification and document manual checks

**Files:**
- Modify: `docs/superpowers/plans/2026-04-12-ai-continuation-api-type.md`
- Test: backend and frontend command outputs only

- [ ] **Step 1: Run focused backend tests**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/api/test_model_api_router.py tests/unit/api/test_ai_usage_router.py tests/unit/api/test_ai_tasks_router.py tests/unit/domain/test_article_ai_pipeline_service.py tests/unit/core/test_db_migrations.py -q`

Expected: PASS

- [ ] **Step 2: Run the frontend lint**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm run lint`

Expected: PASS

- [ ] **Step 3: Perform manual admin verification**

Run:

```bash
cd /Users/shawn/Documents/GitHub/lumina/backend && uv run uvicorn main:app --reload
```

```bash
cd /Users/shawn/Documents/GitHub/lumina/frontend && npm run dev
```

Expected manual checks:

- Create a model config and confirm the API type field can be set to `Chat Completions API` or `Responses API`.
- Open `后台管理 -> 任务详情 -> 调用链` for a `process_ai_content` task and confirm an eligible usage node shows `提交修改意见`.
- Submit continuation feedback for `summary` or `quotes` and verify a new task appears with updated usage/session metadata.
- Submit continuation feedback for an `infographic` node and verify the old repair-specific modal is no longer the primary path.
- Confirm an old node with no session info and no request/response payload does not offer the continuation action.

- [ ] **Step 4: Commit final verification notes if plan annotations changed**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add docs/superpowers/plans/2026-04-12-ai-continuation-api-type.md
git commit -m "docs: finalize ai continuation implementation plan"
```
