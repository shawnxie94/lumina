from models import AIAnalysis, Article, now_str
from app.domain.article_command_service import ArticleCommandService


class DummyTaskService:
    def __init__(self):
        self.calls = []

    def enqueue_task(self, db, **kwargs):
        self.calls.append(kwargs)
        return "task-digest-1"


def test_enqueue_digest_prefill_requires_material(db_session):
    article = Article(
        id="a1",
        slug="a1",
        title="t",
        content_md="",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()

    service = ArticleCommandService()
    service.ai_task_service = DummyTaskService()
    try:
        service.enqueue_digest_prefill(db_session, "a1")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "缺少" in str(exc)


def test_enqueue_digest_prefill_enqueues_task(db_session):
    article = Article(
        id="a2",
        slug="a2",
        title="t",
        content_md="body",
        created_at=now_str(),
        updated_at=now_str(),
    )
    analysis = AIAnalysis(article_id="a2", summary="s", updated_at=now_str())
    db_session.add(article)
    db_session.add(analysis)
    db_session.commit()

    service = ArticleCommandService()
    dummy = DummyTaskService()
    service.ai_task_service = dummy
    task_id = service.enqueue_digest_prefill(db_session, "a2")
    assert task_id == "task-digest-1"
    assert dummy.calls[0]["task_type"] == "process_ai_content"
    assert dummy.calls[0]["content_type"] == "digest_prefill"
