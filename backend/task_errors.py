import asyncio


class TaskPipelineError(Exception):
    def __init__(self, message: str, error_type: str, retryable: bool):
        super().__init__(message)
        self.message = message
        self.error_type = error_type
        self.retryable = retryable


class TaskConfigError(TaskPipelineError):
    def __init__(self, message: str):
        super().__init__(message, error_type="config", retryable=False)


class TaskDataError(TaskPipelineError):
    def __init__(self, message: str):
        super().__init__(message, error_type="data", retryable=False)


class TaskTimeoutError(TaskPipelineError):
    def __init__(self, message: str):
        super().__init__(message, error_type="timeout", retryable=True)


class TaskExternalError(TaskPipelineError):
    def __init__(self, message: str):
        super().__init__(message, error_type="external", retryable=True)


def normalize_task_error(exc: Exception) -> TaskPipelineError:
    if isinstance(exc, TaskPipelineError):
        return exc

    message = str(exc)
    lowered = message.lower()

    if isinstance(exc, asyncio.TimeoutError) or "timeout" in lowered or "超时" in message:
        return TaskTimeoutError(message)

    if (
        "未配置ai服务" in message
        or "ai服务" in message
        or "config" in lowered
        or "禁用" in message
        or "disabled" in lowered
    ):
        return TaskConfigError(message)

    if (
        "文章不存在" in message
        or "缺少" in message
        or "未通过" in message
        or "格式异常" in message
        or "无效" in message
    ):
        return TaskDataError(message)

    return TaskExternalError(message)
