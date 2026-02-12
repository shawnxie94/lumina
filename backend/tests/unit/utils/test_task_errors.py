import asyncio

from task_errors import (
    TaskConfigError,
    TaskDataError,
    TaskExternalError,
    TaskPipelineError,
    TaskTimeoutError,
    normalize_task_error,
)


def test_normalize_task_error_keeps_existing_pipeline_error():
    original = TaskDataError("数据异常")
    normalized = normalize_task_error(original)
    assert normalized is original


def test_normalize_task_error_maps_timeout_exception():
    normalized = normalize_task_error(asyncio.TimeoutError("request timeout"))
    assert isinstance(normalized, TaskTimeoutError)
    assert isinstance(normalized, TaskPipelineError)
    assert normalized.retryable is True
    assert normalized.error_type == "timeout"


def test_normalize_task_error_maps_config_message():
    normalized = normalize_task_error(Exception("未配置ai服务，请先设置模型"))
    assert isinstance(normalized, TaskConfigError)
    assert normalized.retryable is False
    assert normalized.error_type == "config"


def test_normalize_task_error_maps_data_message():
    normalized = normalize_task_error(Exception("文章不存在"))
    assert isinstance(normalized, TaskDataError)
    assert normalized.retryable is False
    assert normalized.error_type == "data"


def test_normalize_task_error_falls_back_to_external_error():
    normalized = normalize_task_error(Exception("upstream unavailable"))
    assert isinstance(normalized, TaskExternalError)
    assert normalized.retryable is True
    assert normalized.error_type == "external"
