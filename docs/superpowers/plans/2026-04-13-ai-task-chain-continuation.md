# AI Task Chain Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI 续写从“新开独立任务”改成“挂到同一任务链”，让任务列表和任务详情都围绕同一条链展示。

**Architecture:** 保留当前“一次后台执行对应一条 `AITask`”的 worker 模型，只给 `ai_tasks` 增加 `parent_task_id/root_task_id` 轻量链路字段。后端在入队续写时把新 task 挂到原链下，任务列表和 timeline API 再按 `root_task_id` 聚合；前端管理页保持当前入口，但改成始终停留在链视角详情中刷新最新节点。

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest, Next.js pages router, TypeScript, node:test

---

## File Map

**Backend**
- Create: `backend/alembic/versions/20260413_0020_ai_task_chain_fields.py`
  - 为 `ai_tasks` 增加 `parent_task_id`、`root_task_id` 和索引。
- Modify: `backend/models.py`
  - 扩展 `AITask` ORM 字段定义。
- Modify: `backend/app/domain/ai_task_service.py`
  - 为 `enqueue_task(...)` 增加链路参数，并在默认新链时写入 `root_task_id = task.id`。
- Modify: `backend/tests/unit/domain/test_ai_task_service.py`
  - 校验默认新链与显式传入 root/parent 的行为。
- Modify: `backend/app/domain/article_command_service.py`
  - 续写时解析来源 task，并把新 task 挂到原链。
- Modify: `backend/tests/unit/domain/test_article_command_service.py`
  - 校验续写任务挂到来源 task 所在链。
- Modify: `backend/app/api/routers/ai_usage_router.py`
  - 续写接口返回 `root_task_id`。
- Modify: `backend/app/api/routers/ai_tasks_router.py`
  - 列表、详情、timeline 改成链视角聚合。
- Modify: `backend/tests/unit/core/test_db_migrations.py`
  - 校验新字段迁移存在。
- Modify: `backend/tests/unit/api/test_ai_usage_router.py`
  - 校验续写响应返回 `root_task_id`。
- Modify: `backend/tests/unit/api/test_ai_tasks_router.py`
  - 覆盖链聚合列表与 timeline。

**Frontend**
- Modify: `frontend/lib/api.ts`
  - 扩展 AI 任务列表项、timeline 和续写响应类型。
- Modify: `frontend/pages/admin.tsx`
  - 任务列表与详情改为链视角；续写提交后刷新当前链，不再跳独立 task。
- Create: `frontend/tests/aiTaskChain.test.ts`
  - 覆盖链标签、续写后留在同一详情、列表只展示一条链。

## Task 1: 给 AITask 增加链路字段并打通基础入队能力

**Files:**
- Create: `backend/alembic/versions/20260413_0020_ai_task_chain_fields.py`
- Modify: `backend/models.py`
- Modify: `backend/app/domain/ai_task_service.py`
- Modify: `backend/tests/unit/domain/test_ai_task_service.py`
- Modify: `backend/tests/unit/core/test_db_migrations.py`

- [ ] **Step 1: 先写迁移失败测试，锁定 `ai_tasks` 新字段存在**

```python
def test_ai_task_chain_columns_exist_after_upgrade(tmp_path):
    db_path = tmp_path / "migration-ai-task-chain.db"
    backend_dir = Path(__file__).resolve().parents[3]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    config.attributes["database_url_override"] = f"sqlite:///{db_path}"

    command.upgrade(config, "head")

    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    with engine.begin() as conn:
        task_columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(ai_tasks)")).fetchall()
        }
        task_indexes = {
            row[1] for row in conn.execute(text("PRAGMA index_list(ai_tasks)")).fetchall()
        }

    assert {"parent_task_id", "root_task_id"} <= task_columns
    assert any("root_task_id" in index_name for index_name in task_indexes)
    engine.dispose()
```

- [ ] **Step 2: 运行迁移测试确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run pytest tests/unit/core/test_db_migrations.py -q`
Expected: FAIL，提示 `ai_tasks` 缺少 `parent_task_id` / `root_task_id`。

- [ ] **Step 3: 写迁移文件和 ORM 字段定义**

```python
# backend/alembic/versions/20260413_0020_ai_task_chain_fields.py
"""add ai task chain fields

Revision ID: 20260413_0020
Revises: 20260412_0019
"""

from alembic import op
import sqlalchemy as sa


revision = "20260413_0020"
down_revision = "20260412_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.add_column(sa.Column("parent_task_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("root_task_id", sa.String(), nullable=True))
        batch_op.create_index(
            "ix_ai_tasks_root_task_id",
            ["root_task_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.drop_index("ix_ai_tasks_root_task_id")
        batch_op.drop_column("root_task_id")
        batch_op.drop_column("parent_task_id")
```

```python
# backend/models.py
class AITask(Base):
    __tablename__ = "ai_tasks"

    id = Column(String, primary_key=True, default=generate_uuid)
    article_id = Column(String, ForeignKey("articles.id"), nullable=True)
    parent_task_id = Column(String, nullable=True)
    root_task_id = Column(String, nullable=True, index=True)
    task_type = Column(String, nullable=False)
```

- [ ] **Step 4: 为 `enqueue_task(...)` 写失败测试，锁定默认新链行为**

```python
def test_enqueue_task_creates_new_root_chain(db_session):
    service = AITaskService(worker_id="worker-test")

    task_id = service.enqueue_task(
        db_session,
        task_type="process_ai_content",
        article_id="article-1",
        content_type="summary",
        payload={"mode": "initial"},
    )

    task = db_session.query(AITask).filter(AITask.id == task_id).one()
    assert task.parent_task_id is None
    assert task.root_task_id == task.id
```

- [ ] **Step 5: 运行目标测试确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run pytest tests/unit/core/test_db_migrations.py tests/unit/domain/test_ai_task_service.py -q`
Expected: FAIL，提示 `AITask` 没有新字段或 `root_task_id` 未赋值。

- [ ] **Step 6: 给 `enqueue_task(...)` 增加链路参数和默认新链逻辑**

```python
def enqueue_task(
    self,
    db,
    task_type: str,
    article_id: str | None = None,
    content_type: str | None = None,
    payload: dict | None = None,
    parent_task_id: str | None = None,
    root_task_id: str | None = None,
) -> str:
    payload_json = json.dumps(
        payload or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    now_iso = get_now_iso()
    task = AITask(
        article_id=article_id,
        parent_task_id=parent_task_id,
        root_task_id=root_task_id,
        task_type=task_type,
        content_type=content_type,
        payload=payload_json,
        status="pending",
        attempts=0,
        max_attempts=1,
        run_at=now_iso,
        updated_at=now_iso,
    )
    db.add(task)
    db.flush()
    if not task.root_task_id:
        task.root_task_id = task.id
```

- [ ] **Step 7: 跑测试确认迁移与默认链逻辑通过**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run pytest tests/unit/core/test_db_migrations.py tests/unit/domain/test_ai_task_service.py -q`
Expected: PASS，新增迁移用例通过，`enqueue_task` 默认写入自有 `root_task_id`。

- [ ] **Step 8: 提交本任务**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/alembic/versions/20260413_0020_ai_task_chain_fields.py backend/models.py backend/app/domain/ai_task_service.py backend/tests/unit/domain/test_ai_task_service.py backend/tests/unit/core/test_db_migrations.py
git commit -m "feat: add ai task chain fields"
```

## Task 2: 让续写任务挂入原链并返回链主信息

**Files:**
- Modify: `backend/app/domain/article_command_service.py`
- Modify: `backend/app/api/routers/ai_usage_router.py`
- Modify: `backend/tests/unit/domain/test_article_command_service.py`
- Modify: `backend/tests/unit/api/test_ai_usage_router.py`

- [ ] **Step 1: 先写失败测试，锁定续写响应带上 `root_task_id`**

```python
@pytest.mark.anyio
async def test_continue_ai_usage_returns_root_task_id(db_session, monkeypatch):
    article = Article(
        title="Continuation Article",
        slug="continuation-article",
        content_md="content",
        created_at="2026-04-12T10:00:00",
        updated_at="2026-04-12T10:00:00",
    )
    db_session.add(article)
    db_session.commit()
    db_session.add(
        AIAnalysis(
            article_id=article.id,
            summary_status="completed",
            updated_at="2026-04-12T10:00:00",
        )
    )
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

    monkeypatch.setattr(
        ai_usage_router.article_command_service,
        "enqueue_ai_continuation",
        lambda **kwargs: ("task-continuation-1", "task-root-1"),
    )

    response = await ai_usage_router.continue_ai_usage(
        usage_id=usage.id,
        payload=AIUsageContinuationRequest(feedback="请更短"),
        db=db_session,
        _=True,
    )

    assert response == {
        "usage_id": usage.id,
        "task_id": "task-continuation-1",
        "root_task_id": "task-root-1",
        "status": "pending",
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run pytest tests/unit/api/test_ai_usage_router.py -q`
Expected: FAIL，提示返回结构缺少 `root_task_id` 或 `enqueue_ai_continuation` 返回值不匹配。

- [ ] **Step 3: 在 `enqueue_ai_continuation(...)` 中解析来源 task 并挂链**

```python
def enqueue_ai_continuation(
    self,
    db: Session,
    usage_id: str,
    feedback: str,
    model_config_id: str | None = None,
) -> tuple[str, str]:
    usage = db.query(AIUsageLog).filter(AIUsageLog.id == usage_id).first()
    normalized_feedback = (feedback or "").strip()
    if not usage.task_id:
        raise ValueError("当前 AI 调用缺少来源任务")

    source_task = db.query(AITask).filter(AITask.id == usage.task_id).first()
    if not source_task:
        raise ValueError("来源任务不存在")

    root_task_id = source_task.root_task_id or source_task.id
    task_id = self.ai_task_service.enqueue_task(
        db,
        task_type="process_ai_content",
        article_id=usage.article_id,
        content_type=usage.content_type,
        payload={
            "category_id": article.category_id,
            "model_config_id": model_config_id,
            "continuation_feedback": normalized_feedback,
            "continuation_source_usage_id": usage.id,
        },
        parent_task_id=source_task.id,
        root_task_id=root_task_id,
    )
    return task_id, root_task_id
```

- [ ] **Step 4: 更新续写 router 返回值**

```python
task_id, root_task_id = article_command_service.enqueue_ai_continuation(
    db=db,
    usage_id=usage.id,
    feedback=payload.feedback,
    model_config_id=payload.model_config_id,
)

return {
    "usage_id": usage.id,
    "task_id": task_id,
    "root_task_id": root_task_id,
    "status": "pending",
}
```

- [ ] **Step 5: 再补一个失败测试，锁定续写 task 的 `parent_task_id/root_task_id`**

```python
def test_enqueue_ai_continuation_links_new_task_to_source_chain(db_session):
    service = ArticleCommandService()
    article = Article(
        title="Continuation Chain Article",
        slug="continuation-chain-article",
        content_md="content",
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
    )
    db_session.add(article)
    db_session.commit()
    db_session.add(
        AIAnalysis(
            article_id=article.id,
            summary_status="completed",
            updated_at="2026-04-13T10:00:00",
        )
    )
    source_task = AITask(
        id="task-source",
        article_id=article.id,
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:00:00",
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
    )
    usage = AIUsageLog(
        task_id=source_task.id,
        article_id=article.id,
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        request_payload="{}",
        response_payload="{}",
        created_at="2026-04-13T10:01:00",
    )
    db_session.add_all([source_task, usage])
    db_session.commit()
    task_id, root_task_id = service.enqueue_ai_continuation(
        db_session,
        usage_id=usage.id,
        feedback="请更短",
    )

    created = db_session.query(AITask).filter(AITask.id == task_id).one()
    assert root_task_id == "task-root"
    assert created.parent_task_id == "task-source"
    assert created.root_task_id == "task-root"
```

- [ ] **Step 6: 跑测试确认续写挂链通过**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run pytest tests/unit/domain/test_article_command_service.py tests/unit/api/test_ai_usage_router.py -q`
Expected: PASS，续写响应包含 `root_task_id`，新 task 被挂到原链下。

- [ ] **Step 7: 提交本任务**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/app/domain/article_command_service.py backend/app/api/routers/ai_usage_router.py backend/tests/unit/domain/test_article_command_service.py backend/tests/unit/api/test_ai_usage_router.py
git commit -m "feat: link ai continuations into task chains"
```

## Task 3: 把任务列表、详情和 timeline 改成链视角聚合

**Files:**
- Modify: `backend/app/api/routers/ai_tasks_router.py`
- Modify: `backend/tests/unit/api/test_ai_tasks_router.py`

- [ ] **Step 1: 先写失败测试，锁定列表只返回一条链主任务**

```python
@pytest.mark.anyio
async def test_list_ai_tasks_collapses_same_chain_to_root_row(db_session):
    article = Article(
        title="Chain Aggregation Article",
        title_trans="链路聚合文章",
        slug="chain-aggregation-article",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-04-13T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
    )
    db_session.add(article)
    db_session.commit()

    root_task = AITask(
        id="task-root",
        article_id=article.id,
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:00:00",
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
        finished_at="2026-04-13T10:00:00",
    )
    continuation_task = AITask(
        id="task-cont-1",
        article_id=article.id,
        parent_task_id="task-root",
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload='{\"continuation_feedback\":\"请更短\"}',
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:05:00",
        created_at="2026-04-13T10:05:00",
        updated_at="2026-04-13T10:06:00",
        finished_at="2026-04-13T10:06:00",
        last_error="too long",
    )
    db_session.add_all([root_task, continuation_task])
    db_session.commit()

    response = await ai_tasks_router.list_ai_tasks(
        page=1,
        size=20,
        status=None,
        task_type=None,
        content_type=None,
        article_id=None,
        article_title=None,
        db=db_session,
        _=True,
    )

    assert len(response["data"]) == 1
    assert response["data"][0]["id"] == "task-root"
    assert response["data"][0]["latest_task_id"] == "task-cont-1"
    assert response["data"][0]["status"] == "failed"
    assert response["data"][0]["chain_length"] == 2
    assert response["data"][0]["has_continuations"] is True
```

- [ ] **Step 2: 再写失败测试，锁定 timeline 聚合同链所有事件与 usage**

```python
@pytest.mark.anyio
async def test_get_ai_task_timeline_merges_chain_tasks(db_session):
    article = Article(
        title="Timeline Chain Article",
        title_trans="时间线链路文章",
        slug="timeline-chain-article",
        content_md="content",
        content_trans="",
        top_image="",
        author="Tester",
        published_at="2026-04-13T10:00:00",
        source_domain="example.com",
        status="completed",
        is_visible=True,
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:00:00",
    )
    db_session.add(article)
    db_session.commit()
    root_task = AITask(
        id="task-root",
        article_id=article.id,
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="completed",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:00:00",
        created_at="2026-04-13T10:00:00",
        updated_at="2026-04-13T10:01:00",
        finished_at="2026-04-13T10:01:00",
    )
    continuation_task = AITask(
        id="task-cont-1",
        article_id=article.id,
        parent_task_id="task-root",
        root_task_id="task-root",
        task_type="process_ai_content",
        content_type="summary",
        status="failed",
        payload='{\"continuation_feedback\":\"请更短\"}',
        attempts=1,
        max_attempts=1,
        run_at="2026-04-13T10:05:00",
        created_at="2026-04-13T10:05:00",
        updated_at="2026-04-13T10:06:00",
        finished_at="2026-04-13T10:06:00",
    )
    root_event = AITaskEvent(task_id="task-root", event_type="completed", created_at="2026-04-13T10:01:00")
    continuation_event = AITaskEvent(task_id="task-cont-1", event_type="failed", created_at="2026-04-13T10:06:00")
    root_usage = AIUsageLog(id="usage-root", task_id="task-root", article_id=article.id, task_type="process_ai_content", content_type="summary", status="completed", created_at="2026-04-13T10:00:30")
    continuation_usage = AIUsageLog(id="usage-cont", task_id="task-cont-1", article_id=article.id, task_type="process_ai_content", content_type="summary", status="completed", created_at="2026-04-13T10:05:30")
    db_session.add_all([
        root_task,
        continuation_task,
        root_event,
        continuation_event,
        root_usage,
        continuation_usage,
    ])
    db_session.commit()

    response = await ai_tasks_router.get_ai_task_timeline(
        task_id="task-cont-1",
        db=db_session,
        _=True,
    )

    assert response["task"]["id"] == "task-root"
    assert [item["task_id"] for item in response["events"]] == ["task-root", "task-cont-1"]
    assert [item["task_id"] for item in response["usage"]] == ["task-root", "task-cont-1"]
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run pytest tests/unit/api/test_ai_tasks_router.py -q`
Expected: FAIL，提示列表仍返回多条 task，timeline 仍只返回单 task 数据。

- [ ] **Step 4: 在 router 中抽链路解析 helper**

```python
from sqlalchemy import func

def _resolve_root_task(task: AITask) -> tuple[str, str]:
    root_task_id = (task.root_task_id or task.id or "").strip() or task.id
    return root_task_id, task.id


def _list_chain_tasks(db: Session, task: AITask) -> list[AITask]:
    root_task_id, _ = _resolve_root_task(task)
    return (
        db.query(AITask)
        .filter(func.coalesce(AITask.root_task_id, AITask.id) == root_task_id)
        .order_by(AITask.created_at.asc(), AITask.id.asc())
        .all()
    )
```

- [ ] **Step 5: 改造列表接口，按链主返回聚合结果**

```python
chain_tasks = (
    query.order_by(AITask.created_at.desc(), AITask.id.desc())
    .all()
)

chains: dict[str, list[AITask]] = {}
for task in chain_tasks:
    root_id = (task.root_task_id or task.id or "").strip() or task.id
    chains.setdefault(root_id, []).append(task)

items = []
for root_id, grouped_tasks in chains.items():
    ordered = sorted(grouped_tasks, key=lambda item: (item.created_at, item.id))
    root_task = next(
        (item for item in ordered if item.id == root_id),
        ordered[0],
    )
    latest_task = max(
        ordered,
        key=lambda item: (
            item.updated_at or "",
            item.created_at or "",
            item.id or "",
        ),
    )
    items.append(
        {
            "id": root_task.id,
            "root_task_id": root_id,
            "latest_task_id": latest_task.id,
            "chain_length": len(ordered),
            "has_continuations": len(ordered) > 1,
            "status": latest_task.status,
            "last_error": latest_task.last_error,
            "updated_at": latest_task.updated_at,
            "finished_at": latest_task.finished_at,
            "attempts": latest_task.attempts,
            "max_attempts": latest_task.max_attempts,
        }
    )
```

- [ ] **Step 6: 改造 `get_ai_task(...)` 和 `get_ai_task_timeline(...)` 返回链视角**

```python
chain_tasks = _list_chain_tasks(db, task)
root_task = next(
    (item for item in chain_tasks if item.id == (task.root_task_id or task.id)),
    chain_tasks[0],
)
task_ids = [item.id for item in chain_tasks]

events = (
    db.query(AITaskEvent)
    .filter(AITaskEvent.task_id.in_(task_ids))
    .order_by(AITaskEvent.created_at.asc(), AITaskEvent.id.asc())
    .all()
)

usage_rows = (
    db.query(AIUsageLog, ModelAPIConfig.name)
    .outerjoin(ModelAPIConfig, AIUsageLog.model_api_config_id == ModelAPIConfig.id)
    .filter(AIUsageLog.task_id.in_(task_ids))
    .order_by(AIUsageLog.created_at.asc(), AIUsageLog.id.asc())
    .all()
)
```

同时给返回项补：

```python
{
    "task_id": event.task_id,
    "root_task_id": root_task.id,
}
```

和：

```python
{
    "task_id": log.task_id,
    "root_task_id": root_task.id,
}
```

- [ ] **Step 7: 运行测试确认链聚合通过**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run pytest tests/unit/api/test_ai_tasks_router.py tests/unit/api/test_ai_usage_router.py -q`
Expected: PASS，列表只返回链主，timeline 能合并同链 events/usage。

- [ ] **Step 8: 提交本任务**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/app/api/routers/ai_tasks_router.py backend/tests/unit/api/test_ai_tasks_router.py backend/tests/unit/api/test_ai_usage_router.py
git commit -m "feat: aggregate ai tasks by chain"
```

## Task 4: 更新前端任务列表与详情，让续写留在同一链视角

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/pages/admin.tsx`
- Create: `frontend/tests/aiTaskChain.test.ts`

- [ ] **Step 1: 先写失败测试，锁定续写响应包含 `root_task_id` 类型和链式任务字段**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import type { AITaskListItem } from "@/lib/api";

test("ai task list item supports chain metadata", () => {
	const item: AITaskListItem = {
		id: "task-root",
		root_task_id: "task-root",
		latest_task_id: "task-cont-1",
		chain_length: 2,
		has_continuations: true,
		article_id: "article-1",
		article_title: "任务标题",
		article_slug: "article-1",
		article_kind: "article",
		task_type: "process_ai_content",
		content_type: "summary",
		status: "failed",
		attempts: 1,
		max_attempts: 1,
		run_at: "2026-04-13T10:00:00",
		created_at: "2026-04-13T10:00:00",
		updated_at: "2026-04-13T10:06:00",
		finished_at: "2026-04-13T10:06:00",
	};

	assert.equal(item.chain_length, 2);
	assert.equal(item.latest_task_id, "task-cont-1");
});
```

- [ ] **Step 2: 再写失败测试，锁定 admin 续写后仍打开原链**

```ts
import { readFile } from "node:fs/promises";

test("admin continuation flow refreshes current chain instead of opening a new standalone task", async () => {
	const source = await readFile(
		new URL("../pages/admin.tsx", import.meta.url),
		"utf8",
	);

	assert.match(
		source,
		/await handleOpenTaskTimeline\\(result\\.root_task_id \\|\\| result\\.task_id\\)/,
	);
	assert.doesNotMatch(
		source,
		/await handleOpenTaskTimeline\\(result\\.task_id\\);/,
	);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/aiTaskChain.test.ts`
Expected: FAIL，提示 `AITaskListItem` 缺少链字段，且 `admin.tsx` 仍直接打开 `result.task_id`。

- [ ] **Step 4: 扩展前端 API 类型**

```ts
export interface AITaskListItem {
	id: string;
	root_task_id?: string | null;
	latest_task_id?: string | null;
	chain_length?: number;
	has_continuations?: boolean;
	article_id: string | null;
	article_title?: string | null;
	article_slug?: string | null;
	article_kind?: string | null;
	task_type: string;
	content_type?: string | null;
	status: string;
	attempts: number;
	max_attempts: number;
	run_at: string;
	locked_at?: string | null;
	locked_by?: string | null;
	last_error?: string | null;
	last_error_type?: string | null;
	created_at: string;
	updated_at: string;
	finished_at?: string | null;
}

export interface AITaskTimelineEvent {
	id: string;
	task_id?: string | null;
	root_task_id?: string | null;
	event_type: string;
	from_status?: string | null;
	to_status?: string | null;
	message?: string | null;
	error_type?: string | null;
	details?: unknown;
	created_at: string;
}

continueAIUsage: async (
	usageId: string,
	data: {
		feedback: string;
		model_config_id?: string;
	},
) => {
	const response = await api.post(`/api/ai-usage/${usageId}/continue`, data);
	return response.data as {
		usage_id: string;
		task_id: string;
		root_task_id?: string | null;
		status: "pending";
	};
},
```

- [ ] **Step 5: 在 admin 里把任务详情打开逻辑切到链主**

```ts
const handleSubmitAIContinuation = async () => {
	if (!aiContinuationUsageId || aiContinuationSubmitting) return;
	if (!aiContinuationFeedback.trim()) return;
	const result = await articleApi.continueAIUsage(aiContinuationUsageId, {
		feedback: aiContinuationFeedback,
		model_config_id: aiContinuationModelConfigId || undefined,
	});
	showToast(aiContinuationCopy.successMessage);
	closeAIContinuationModal();
	await handleOpenTaskTimeline(result.root_task_id || result.task_id);
};
```

同时给任务列表增加轻量提示：

```ts
{task.has_continuations && task.chain_length && task.chain_length > 1 && (
	<span className="text-xs text-text-3">
		{t("已调整 {count} 次").replace(
			"{count}",
			String(task.chain_length - 1),
		)}
	</span>
)}
```

以及给 timeline usage 节点标签加链式轮次提示：

```ts
const chainTaskLabel =
	node.usage.task_id && selectedTaskTimeline?.task.root_task_id
		? node.usage.task_id === selectedTaskTimeline.task.root_task_id
			? t("初始生成")
			: `${t("续写")} #${continuationIndex}`
		: null;
```

- [ ] **Step 6: 跑前端测试确认通过**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/aiTaskChain.test.ts`
Expected: PASS，链字段类型通过，admin 不再直接跳新 task 详情。

- [ ] **Step 7: 跑构建确认 admin 页面类型与编译通过**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm run build`
Expected: PASS，`/admin` 页面编译成功。

- [ ] **Step 8: 提交本任务**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add frontend/lib/api.ts frontend/pages/admin.tsx frontend/tests/aiTaskChain.test.ts
git commit -m "feat: keep ai continuations in one task chain"
```

## Task 5: 全量验证与收尾

**Files:**
- Verify only: backend + frontend touched files above

- [ ] **Step 1: 跑后端全量单测**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run pytest tests/unit -q`
Expected: PASS，新增链逻辑不影响现有 AI、评论、回顾、备份单测。

- [ ] **Step 2: 跑后端契约检查**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && INTERNAL_API_TOKEN=test-token PYTHONPATH=/Users/shawn/Documents/GitHub/lumina/backend uv run python scripts/check_route_coverage.py --verbose`
Expected: PASS，无新增路由缺口。

- [ ] **Step 3: 跑前端测试**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/aiTaskChain.test.ts`
Expected: PASS。

- [ ] **Step 4: 跑前端构建**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm run build`
Expected: PASS。

- [ ] **Step 5: 本地 docker compose 冒烟**

Run: `cd /Users/shawn/Documents/GitHub/lumina && docker compose up -d --build`
Expected: `api`、`web`、`worker` 都为 `Up`。

- [ ] **Step 6: 检查服务状态与关键接口**

Run: `cd /Users/shawn/Documents/GitHub/lumina && docker compose ps && curl -I http://localhost:3000/login && curl -s 'http://localhost:8000/backend/api/articles?page=1&size=1' | head -c 300`
Expected: `docker compose ps` 显示三个服务存活；`/login` 返回 `200`；文章列表返回 JSON。

- [ ] **Step 7: 整理提交状态并准备进入完成流程**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git status --short
```

Expected: 只剩本任务相关改动；不要用 `git add -A`，避免把工作区里其他未提交功能混入。

- [ ] **Step 8: 进入完成流程**

执行说明：完成全部实现与验证后，按 `verification-before-completion` 与 `finishing-a-development-branch` 收尾，不在本计划内直接合并或清理其他无关改动。
