from app.domain.ai_call_session_service import AICallSessionService
from app.domain.ai_invocation_service import AIInvocationService
from app.domain.article_ai_version_service import ArticleAIVersionService

from .classification import _ClassificationMixin
from .cleaning_translation import _CleaningTranslationMixin
from .common import _ConstantsMixin
from .config import _ConfigMixin
from .content import _ContentMixin
from .content_tasks import _ContentTasksMixin
from .digest import _DigestMixin
from .enqueue import _EnqueueMixin
from .interpretation import _InterpretationMixin
from .usage import _UsageMixin


class ArticleAIPipelineService(
    _ConstantsMixin,
    _ConfigMixin,
    _EnqueueMixin,
    _UsageMixin,
    _ContentMixin,
    _InterpretationMixin,
    _ClassificationMixin,
    _CleaningTranslationMixin,
    _ContentTasksMixin,
    _DigestMixin,
):
    def __init__(
        self,
        current_task_id: str | None = None,
        enqueue_task_func=None,
    ):
        self.current_task_id = current_task_id
        self.enqueue_task_func = enqueue_task_func
        self.article_ai_version_service = ArticleAIVersionService()
        self.ai_invocation_service = AIInvocationService()
        self.ai_call_session_service = AICallSessionService()
