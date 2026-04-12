from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException, UploadFile

from app.api.routers import media_router
from app.schemas import MediaIngestRequest
from models import ReviewIssue, ReviewTemplate, now_str


@pytest.fixture
def anyio_backend():
    return "asyncio"


def make_template(db_session) -> ReviewTemplate:
    template = ReviewTemplate(
        id=str(uuid.uuid4()),
        name="每周回顾",
        slug="weekly-review",
        description="",
        is_enabled=True,
        schedule_type="weekly",
        anchor_date="2026-04-01",
        timezone="Asia/Shanghai",
        trigger_time="09:00",
        include_all_categories=True,
        prompt_template="请生成回顾\n\n{content}",
        title_template="第 {period_label} 回顾",
        next_run_at="2026-04-07T09:00:00+08:00",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(template)
    db_session.commit()
    db_session.refresh(template)
    return template


def make_issue(db_session, template_id: str) -> ReviewIssue:
    issue = ReviewIssue(
        id=str(uuid.uuid4()),
        template_id=template_id,
        slug=f"issue-{uuid.uuid4().hex[:8]}",
        title="第 14 周回顾",
        status="draft",
        window_start="2026-03-30T00:00:00+08:00",
        window_end="2026-04-06T00:00:00+08:00",
        markdown_content="# 回顾\n\n{{review_article_sections}}",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(issue)
    db_session.commit()
    db_session.refresh(issue)
    return issue


@pytest.mark.anyio
async def test_upload_media_accepts_review_issue_owner(db_session, monkeypatch):
    issue = make_issue(db_session, make_template(db_session).id)
    upload_file = UploadFile(filename="cover.png", file=BytesIO(b"fake-image"))

    async def fake_save_upload_image(
        db,
        article_id,
        file,
        kind="image",
        *,
        review_issue_id=None,
    ):
        assert article_id is None
        assert review_issue_id == issue.id
        assert kind == "image"
        return (
            SimpleNamespace(
                id="asset-1",
                storage_path="2026/04/cover.png",
                size=10,
                content_type="image/png",
            ),
            "/media/2026/04/cover.png",
        )

    monkeypatch.setattr(media_router, "is_media_enabled", lambda db: True)
    monkeypatch.setattr(media_router, "save_upload_image", fake_save_upload_image)

    payload = await media_router.upload_media(
        file=upload_file,
        article_id=None,
        review_issue_id=issue.id,
        kind="image",
        request=None,
        db=db_session,
        _=True,
    )

    assert payload["asset_id"] == "asset-1"
    assert payload["url"] == "/media/2026/04/cover.png"
    assert payload["filename"] == "cover.png"
    assert payload["size"] == 10
    assert payload["content_type"] == "image/png"


@pytest.mark.anyio
async def test_ingest_media_requires_owner_reference(db_session, monkeypatch):
    monkeypatch.setattr(media_router, "is_media_enabled", lambda db: True)

    with pytest.raises(HTTPException) as exc_info:
        await media_router.ingest_media(
            payload=MediaIngestRequest(url="https://example.com/cover.png"),
            request=None,
            db=db_session,
            _=True,
        )

    assert exc_info.value.status_code == 400
    assert "归属" in exc_info.value.detail
