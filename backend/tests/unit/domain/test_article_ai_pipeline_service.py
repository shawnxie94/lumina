import asyncio
import json
import uuid
from types import SimpleNamespace

import app.domain.article_ai_pipeline_service as article_ai_pipeline_module
import pytest
from app.domain.ai_invocation_service import AIInvocationService
from app.domain.article_ai_pipeline_service import ArticleAIPipelineService
from app.domain.article_command_service import ArticleCommandService
from task_errors import TaskExternalError
from models import (
    AICallSession,
    AIAnalysis,
    AIAnalysisVersion,
    AITask,
    AITaskEvent,
    AIUsageLog,
    Article,
    Category,
    ModelAPIConfig,
    PromptConfig,
    now_str,
)


def test_invoke_generation_records_chat_completion_snapshot(db_session, monkeypatch):
    service = AIInvocationService()
    captured = {}

    async def fake_chat_create(**kwargs):
        captured["request"] = kwargs
        return SimpleNamespace(
            id="chatcmpl-1",
            model="gpt-4o",
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="摘要结果"),
                    finish_reason="stop",
                )
            ],
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

    assert captured["request"]["messages"][0]["content"] == "sys"
    assert result["session_info"]["continuation_mode"] == "snapshot"
    assert result["session_info"]["input_snapshot"]["user_prompt"] == "user"


def test_invoke_continuation_prefers_responses_previous_response_id(
    db_session,
    monkeypatch,
):
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
            session_info={
                "api_type": "responses",
                "provider_response_id": "resp-1",
                "input_snapshot": {},
                "output_snapshot": {},
            },
            feedback="请更短",
            model_config={
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "model_name": "gpt-4.1",
            },
        )
    )

    assert called["kwargs"]["previous_response_id"] == "resp-1"
    assert result["session_info"]["provider_response_id"] == "resp-2"


def test_invoke_continuation_fallback_from_responses_omits_original_prompts(
    db_session,
    monkeypatch,
):
    service = AIInvocationService()
    called = {}
    fallback_task = AITask(
        id="task-cont-1",
        article_id=None,
        parent_task_id="task-root-1",
        root_task_id="task-root-1",
        task_type="process_ai_content",
        content_type="summary",
        status="processing",
        payload="{}",
        attempts=1,
        max_attempts=1,
        run_at=now_str(),
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(fallback_task)
    db_session.commit()

    async def fake_response_continue(**kwargs):
        raise RuntimeError("provider continuation unsupported")

    async def fake_snapshot_continue(**kwargs):
        called["kwargs"] = kwargs
        return {
            "content": "回退后的摘要",
            "usage": None,
            "request_payload": {"messages": [{"role": "user", "content": "只保留反馈"}]},
            "response_payload": {"id": "chatcmpl-fallback"},
            "session_info": {
                "api_type": "chat_completions",
                "continuation_mode": "snapshot",
                "provider_response_id": None,
                "input_snapshot": {"feedback": "请更短"},
                "output_snapshot": {"content": "回退后的摘要"},
            },
        }

    monkeypatch.setattr(service, "_invoke_responses_continuation", fake_response_continue)
    monkeypatch.setattr(service, "_invoke_snapshot_continuation", fake_snapshot_continue)

    result = asyncio.run(
        service.invoke_continuation(
            db=db_session,
            session_info={
                "api_type": "responses",
                "provider_response_id": "resp-1",
                "continuation_task_id": fallback_task.id,
                "input_snapshot": {
                    "system_prompt": "你是一名资深内容分析师",
                    "user_prompt": "这是原始大提示词",
                },
                "output_snapshot": {"content": "上一版输出"},
            },
            feedback="请更短",
            model_config={
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "model_name": "gpt-4.1",
            },
        )
    )

    assert called["kwargs"]["session_info"]["input_snapshot"] == {
        "system_prompt": "你是一名资深内容分析师",
        "user_prompt": "这是原始大提示词",
    }
    assert called["kwargs"]["session_info"]["output_snapshot"] == {"content": "上一版输出"}
    fallback_event = (
        db_session.query(AITaskEvent)
        .filter(
            AITaskEvent.task_id == fallback_task.id,
            AITaskEvent.event_type == "continuation_provider_fallback",
        )
        .one()
    )
    assert fallback_event.message == "Responses 续写失败，已回退到快照续写"
    assert "provider continuation unsupported" in (fallback_event.details or "")
    assert result["content"] == "回退后的摘要"


def test_invoke_continuation_caches_unsupported_previous_response_id(
    db_session,
    monkeypatch,
):
    service = AIInvocationService()
    service._unsupported_previous_response_cache.clear()
    calls = {"provider": 0, "snapshot": 0}

    async def fake_response_continue(**kwargs):
        calls["provider"] += 1
        raise RuntimeError(
            "Error code: 400 - {'detail': 'Unsupported parameter: previous_response_id'}"
        )

    async def fake_snapshot_continue(**kwargs):
        calls["snapshot"] += 1
        return {
            "content": "回退后的摘要",
            "usage": None,
            "request_payload": {"messages": [{"role": "user", "content": "只保留反馈"}]},
            "response_payload": {"id": "chatcmpl-fallback"},
            "session_info": {
                "api_type": "chat_completions",
                "continuation_mode": "snapshot",
                "provider_response_id": None,
                "input_snapshot": {"feedback": "请更短"},
                "output_snapshot": {"content": "回退后的摘要"},
            },
        }

    monkeypatch.setattr(service, "_invoke_responses_continuation", fake_response_continue)
    monkeypatch.setattr(service, "_invoke_snapshot_continuation", fake_snapshot_continue)

    session_info = {
        "api_type": "responses",
        "provider_response_id": "resp-1",
        "input_snapshot": {
            "system_prompt": "你是一名资深内容分析师",
            "user_prompt": "这是原始大提示词",
        },
        "output_snapshot": {"content": "上一版输出"},
    }
    model_config = {
        "base_url": "https://www.right.codes/codex/v1",
        "api_key": "sk-test",
        "model_name": "gpt-5.4",
    }

    first = asyncio.run(
        service.invoke_continuation(
            db=db_session,
            session_info=session_info,
            feedback="请更短",
            model_config=model_config,
        )
    )
    second = asyncio.run(
        service.invoke_continuation(
            db=db_session,
            session_info=session_info,
            feedback="请更短",
            model_config=model_config,
        )
    )

    assert first["content"] == "回退后的摘要"
    assert second["content"] == "回退后的摘要"
    assert calls["provider"] == 1
    assert calls["snapshot"] == 2
    assert (
        "https://www.right.codes/codex/v1|gpt-5.4|responses"
        in service._unsupported_previous_response_cache
    )


def test_invoke_generation_uses_list_input_items_for_responses(
    db_session,
    monkeypatch,
):
    service = AIInvocationService()
    captured = {}

    async def fake_create_response(**kwargs):
        captured["request"] = kwargs
        return SimpleNamespace(
            id="resp-1",
            model="gpt-5.4",
            output_text="摘要结果",
            usage=SimpleNamespace(input_tokens=10, output_tokens=5, total_tokens=15),
        )

    monkeypatch.setattr(service, "_create_response", fake_create_response)

    result = asyncio.run(
        service.invoke_generation(
            db=db_session,
            api_type="responses",
            model_name="gpt-5.4",
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

    assert captured["request"]["instructions"] == "sys"
    assert captured["request"]["input"] == [
        {
            "role": "user",
            "content": "user",
        }
    ]
    assert result["session_info"]["continuation_mode"] == "provider"


def test_invoke_generation_extracts_responses_output_from_output_parts(
    db_session,
    monkeypatch,
):
    service = AIInvocationService()

    async def fake_create_response(**kwargs):
        return SimpleNamespace(
            id="resp-structured-1",
            model="gpt-5.4",
            output_text=None,
            output=[
                SimpleNamespace(
                    content=[
                        SimpleNamespace(type="output_text", text="从 output 数组解析出的结果")
                    ]
                )
            ],
            usage=SimpleNamespace(input_tokens=12, output_tokens=6, total_tokens=18),
        )

    monkeypatch.setattr(service, "_create_response", fake_create_response)

    result = asyncio.run(
        service.invoke_generation(
            db=db_session,
            api_type="responses",
            model_name="gpt-5.4",
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

    assert result["content"] == "从 output 数组解析出的结果"
    assert result["response_payload"]["content"] == "从 output 数组解析出的结果"


def test_invoke_generation_extracts_responses_plain_string_response(
    db_session,
    monkeypatch,
):
    service = AIInvocationService()

    async def fake_create_response(**kwargs):
        return "测试成功"

    monkeypatch.setattr(service, "_create_response", fake_create_response)

    result = asyncio.run(
        service.invoke_generation(
            db=db_session,
            api_type="responses",
            model_name="gpt-5.4",
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

    assert result["content"] == "测试成功"
    assert result["response_payload"]["content"] == "测试成功"


def test_invoke_generation_extracts_responses_event_stream_done_text(
    db_session,
    monkeypatch,
):
    service = AIInvocationService()

    async def fake_create_response(**kwargs):
        return (
            'event: response.created\n'
            'data: {"type":"response.created","response":{"id":"resp-stream-1","model":"gpt-5.4","status":"in_progress"}}\n\n'
            'event: response.output_text.delta\n'
            'data: {"type":"response.output_text.delta","delta":"过"}\n\n'
            'event: response.output_text.done\n'
            'data: {"type":"response.output_text.done","text":"最终摘要"}\n\n'
            'event: response.completed\n'
            'data: {"type":"response.completed","response":{"id":"resp-stream-1","status":"completed"}}\n\n'
        )

    monkeypatch.setattr(service, "_create_response", fake_create_response)

    result = asyncio.run(
        service.invoke_generation(
            db=db_session,
            api_type="responses",
            model_name="gpt-5.4",
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

    assert result["content"] == "最终摘要"
    assert result["response_payload"]["content"] == "最终摘要"
    assert result["response_payload"]["id"] == "resp-stream-1"
    assert result["session_info"]["provider_response_id"] == "resp-stream-1"


def test_invoke_responses_continuation_uses_list_input_items(monkeypatch):
    service = AIInvocationService()
    captured = {}

    async def fake_create_response(**kwargs):
        captured["request"] = kwargs
        return SimpleNamespace(
            id="resp-2",
            output_text="更新后的摘要",
            usage=SimpleNamespace(input_tokens=10, output_tokens=5, total_tokens=15),
        )

    monkeypatch.setattr(service, "_create_response", fake_create_response)

    result = asyncio.run(
        service._invoke_responses_continuation(
            previous_response_id="resp-1",
            feedback="请更短",
            model_config={
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "model_name": "gpt-5.4",
            },
            session_info={},
        )
    )

    assert captured["request"]["previous_response_id"] == "resp-1"
    assert captured["request"]["input"] == [
        {
            "role": "user",
            "content": "请更短",
        }
    ]
    assert "instructions" not in captured["request"]
    assert result["session_info"]["input_snapshot"] == {"feedback": "请更短"}
    assert result["session_info"]["provider_response_id"] == "resp-2"


def test_invoke_responses_continuation_extracts_output_from_output_parts(monkeypatch):
    service = AIInvocationService()

    async def fake_create_response(**kwargs):
        return SimpleNamespace(
            id="resp-structured-2",
            output_text="",
            output=[
                {
                    "content": [
                        {
                            "type": "output_text",
                            "text": "从续写 output 数组解析出的结果",
                        }
                    ]
                }
            ],
            usage=SimpleNamespace(input_tokens=8, output_tokens=4, total_tokens=12),
        )

    monkeypatch.setattr(service, "_create_response", fake_create_response)

    result = asyncio.run(
        service._invoke_responses_continuation(
            previous_response_id="resp-1",
            feedback="请更短",
            model_config={
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "model_name": "gpt-5.4",
            },
            session_info={},
        )
    )

    assert result["content"] == "从续写 output 数组解析出的结果"
    assert result["response_payload"]["content"] == "从续写 output 数组解析出的结果"


def test_invoke_responses_continuation_extracts_plain_string_response(monkeypatch):
    service = AIInvocationService()

    async def fake_create_response(**kwargs):
        return "续写测试成功"

    monkeypatch.setattr(service, "_create_response", fake_create_response)

    result = asyncio.run(
        service._invoke_responses_continuation(
            previous_response_id="resp-1",
            feedback="请更短",
            model_config={
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "model_name": "gpt-5.4",
            },
            session_info={},
        )
    )

    assert result["content"] == "续写测试成功"
    assert result["response_payload"]["content"] == "续写测试成功"


def test_invoke_responses_continuation_extracts_event_stream_done_text(monkeypatch):
    service = AIInvocationService()

    async def fake_create_response(**kwargs):
        return (
            'event: response.created\n'
            'data: {"type":"response.created","response":{"id":"resp-stream-2","model":"gpt-5.4","status":"in_progress"}}\n\n'
            'event: response.output_text.delta\n'
            'data: {"type":"response.output_text.delta","delta":"过"}\n\n'
            'event: response.output_text.done\n'
            'data: {"type":"response.output_text.done","text":"续写后的最终结果"}\n\n'
            'event: response.completed\n'
            'data: {"type":"response.completed","response":{"id":"resp-stream-2","status":"completed"}}\n\n'
        )

    monkeypatch.setattr(service, "_create_response", fake_create_response)

    result = asyncio.run(
        service._invoke_responses_continuation(
            previous_response_id="resp-1",
            feedback="请更短",
            model_config={
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "model_name": "gpt-5.4",
            },
            session_info={},
        )
    )

    assert result["content"] == "续写后的最终结果"
    assert result["response_payload"]["content"] == "续写后的最终结果"
    assert result["response_payload"]["id"] == "resp-stream-2"
    assert result["session_info"]["provider_response_id"] == "resp-stream-2"


def test_invoke_snapshot_continuation_handles_feedback_only_snapshot(monkeypatch):
    service = AIInvocationService()
    captured = {}

    async def fake_chat_create(**kwargs):
        captured["request"] = kwargs
        return SimpleNamespace(
            id="chatcmpl-2",
            model="gpt-4o",
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="更新后的结果"),
                    finish_reason="stop",
                )
            ],
            usage=SimpleNamespace(prompt_tokens=12, completion_tokens=6, total_tokens=18),
        )

    monkeypatch.setattr(service, "_create_chat_completion", fake_chat_create)

    result = asyncio.run(
        service._invoke_snapshot_continuation(
            feedback="请更短",
            model_config={
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "model_name": "gpt-4o",
            },
            session_info={
                "input_snapshot": {"feedback": "上一次反馈"},
                "output_snapshot": {"content": "上一版完整结果"},
            },
        )
    )

    user_message = captured["request"]["messages"][-1]["content"]
    assert "原始生成要求" not in user_message
    assert "上一版完整结果" in user_message
    assert "请更短" in user_message
    assert result["content"] == "更新后的结果"


def test_detect_media_kind_supports_book_links():
    service = ArticleAIPipelineService()

    assert service._detect_media_kind("https://example.com/library/demo.pdf") == "book"
    assert service._detect_media_kind("https://example.com/library/demo.epub") == "book"
    assert service._detect_media_kind("https://example.com/library/demo.mobi") == "book"


def test_build_media_markdown_link_renders_book_marker():
    service = ArticleAIPipelineService()

    assert (
        service._build_media_markdown_link(
            "book",
            "https://example.com/library/demo.pdf",
            "深度学习导论",
        )
        == "[📚 深度学习导论](https://example.com/library/demo.pdf)"
    )


def test_build_media_markdown_link_uses_book_default_title():
    service = ArticleAIPipelineService()

    assert (
        service._build_media_markdown_link(
            "book",
            "https://example.com/library/demo.epub",
        )
        == "[📚 书籍](https://example.com/library/demo.epub)"
    )


def test_merge_with_overlap_deduplicates_markdown_blocks():
    service = ArticleAIPipelineService()
    existing = "# 标题\n\n第一段内容。\n\n## 第二节\n\n重复边界段落。"
    new_text = "## 第二节\n\n重复边界段落。\n\n第三段新内容。"

    merged = service._merge_with_overlap(existing, new_text)

    assert merged.count("## 第二节") == 1
    assert merged.count("重复边界段落。") == 1
    assert merged.endswith("第三段新内容。")


def test_merge_with_overlap_deduplicates_lines_when_blocks_do_not_match():
    service = ArticleAIPipelineService()
    existing = "A\nB\nC\nD"
    new_text = "C\nD\nE\nF"

    merged = service._merge_with_overlap(existing, new_text)

    assert merged == "A\nB\nC\nD\n\nE\nF"


def test_merge_with_overlap_deduplicates_similar_sentence_boundaries():
    service = ArticleAIPipelineService()
    existing = (
        "前文介绍背景。我们认为这个方案可以显著降低重复率，并且能够保持 Markdown 结构完整。"
    )
    new_text = (
        "我们认为这个方案可以显著降低重复率, 并且能够保持Markdown结构完整。"
        "然后进入验证阶段。"
    )

    merged = service._merge_with_overlap(existing, new_text)

    assert merged.count("我们认为这个方案可以显著降低重复率") == 1
    assert merged.endswith("然后进入验证阶段。")


def test_merge_with_overlap_keeps_non_overlapping_content():
    service = ArticleAIPipelineService()
    existing = "第一部分。"
    new_text = "完全不同的第二部分。"

    merged = service._merge_with_overlap(existing, new_text)

    assert merged == "第一部分。\n\n完全不同的第二部分。"


def test_merge_with_overlap_skips_sentence_trim_when_fence_unclosed():
    service = ArticleAIPipelineService()
    existing = "```python\n# 该函数用于加载配置并初始化上下文对象以便后续处理"
    new_text = "# 该函数用于加载配置并初始化上下文对象以便后续处理。然后执行下一步。"

    merged = service._merge_with_overlap(existing, new_text)

    assert merged == f"{existing}\n\n{new_text}"
    assert merged.count("该函数用于加载配置并初始化上下文对象以便后续处理") == 2


def test_merge_with_overlap_supports_continue_round_deduplication():
    service = ArticleAIPipelineService()
    round_1 = "这是一段较长的第一段内容，用于模拟续写拼接时的重复边界。"
    round_2 = f"{round_1}随后输出第二段。"

    merged = service._merge_with_overlap("", round_1)
    merged = service._merge_with_overlap(merged, round_2)

    assert merged.count(round_1) == 1
    assert merged.endswith("随后输出第二段。")


def test_merge_with_overlap_handles_mixed_punctuation_sentence_boundaries():
    service = ArticleAIPipelineService()
    existing = (
        "这是第一句用于说明背景信息并引出上下文？"
        "这是第二句用于描述跨语言标点兼容能力并验证边界拼接稳定性。"
    )
    new_text = (
        "这是第二句用于描述跨语言标点兼容能力并验证边界拼接稳定性. "
        "接下来是第三句继续展开说明！"
    )

    merged = service._merge_with_overlap(existing, new_text)

    assert merged.count("这是第二句用于描述跨语言标点兼容能力并验证边界拼接稳定性") == 1
    assert merged.endswith("接下来是第三句继续展开说明！")


def test_build_continue_prompt_adds_boundary_dedup_instruction():
    service = ArticleAIPipelineService()

    prompt = service._build_continue_prompt("请翻译：{content}", "这是已输出内容")

    assert "如果下一段与已输出末尾有重复，必须删除重复后再继续" in prompt
    assert "禁止复述上一段最后一句" in prompt


def test_extract_title_text_handles_markdown_heading_and_quotes():
    service = ArticleAIPipelineService()

    assert service._extract_title_text('# "Hello World"') == "Hello World"
    assert service._extract_title_text("**你好，世界**") == "你好，世界"


def test_process_article_translation_also_updates_translated_title(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Hello World",
        slug="hello-world",
        content_md="This is a test article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)

    service = ArticleAIPipelineService()

    class FakeClient:
        def __init__(self):
            self.calls = 0

        async def translate_to_chinese(self, content, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return {"content": "# 你好，世界"}
            return {"content": "这是一篇测试文章。"}

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "prompt_template": "翻译为中文：{content}",
            "parameters": None,
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())

    asyncio.run(
        service.process_article_translation(
            article_id=article.id,
            category_id=None,
        )
    )

    persisted_article = db_session.get(Article, article.id)
    assert persisted_article is not None
    assert persisted_article.title_trans == "你好，世界"
    assert persisted_article.content_trans == "这是一篇测试文章。"
    assert persisted_article.translation_status == "completed"


def test_get_prompt_output_contract_returns_structured_contracts():
    service = ArticleAIPipelineService()

    outline = service._get_prompt_output_contract("outline")
    classification = service._get_prompt_output_contract("classification")
    tagging = service._get_prompt_output_contract("tagging")

    assert outline.mode == "json_object"
    assert "children" in (outline.system_instruction or "")
    assert classification.mode == "structured_json"
    assert classification.response_format["type"] == "json_schema"
    assert "category_id" in (classification.system_instruction or "")
    assert tagging.mode == "structured_json"
    assert tagging.response_format["type"] == "json_schema"
    assert "tags" in (tagging.system_instruction or "")


def test_process_ai_content_outline_normalizes_json_payload(
    db_session,
    monkeypatch,
):
    article = Article(
        id=str(uuid.uuid4()),
        title="Outline Article",
        slug="outline-article",
        content_md="这是一篇关于 AI 工作流的文章。",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    analysis = AIAnalysis(
        article_id=article.id,
        outline_status="pending",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()
    article_id = article.id

    service = ArticleAIPipelineService()

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert content == article.content_md
            assert (kwargs.get("parameters") or {}).get("response_format") == {
                "type": "json_object"
            }
            assert "children" in (
                (kwargs.get("parameters") or {}).get("system_prompt") or ""
            )
            return {
                "content": (
                    '{"title":"AI 工作流","children":["问题定义",'
                    '{"title":"执行","children":["分解任务","验收结果"]}]}'
                ),
                "usage": None,
                "latency_ms": 7,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "prompt_template": "请输出文章大纲：{content}",
            "parameters": {
                "system_prompt": "请根据文章内容组织层级",
                "response_format": "text",
            },
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())

    asyncio.run(
        service.process_ai_content(
            article_id=article_id,
            category_id=None,
            content_type="outline",
        )
    )

    persisted = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert persisted.outline_status == "completed"
    assert (
        persisted.outline
        == '{"title": "AI 工作流", "children": [{"title": "问题定义", "children": []}, {"title": "执行", "children": [{"title": "分解任务", "children": []}, {"title": "验收结果", "children": []}]}]}'
    )
    assert persisted.error_message is None


def test_process_ai_content_outline_accepts_top_level_array_payload(
    db_session,
    monkeypatch,
):
    article = Article(
        id=str(uuid.uuid4()),
        title="Outline Array Article",
        slug="outline-array-article",
        content_md="这是一篇关于知识整理的文章。",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    analysis = AIAnalysis(
        article_id=article.id,
        outline_status="pending",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()
    article_id = article.id

    service = ArticleAIPipelineService()

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert content == article.content_md
            return {
                "content": (
                    '[{"title":"核心观点","children":["要点A"]},'
                    '{"title":"结论与启示","children":["行动建议"]}]'
                ),
                "usage": None,
                "latency_ms": 5,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "prompt_template": "请输出文章大纲：{content}",
            "parameters": {
                "system_prompt": "请根据文章内容组织层级",
            },
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())

    asyncio.run(
        service.process_ai_content(
            article_id=article_id,
            category_id=None,
            content_type="outline",
        )
    )

    persisted = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert persisted.outline_status == "completed"
    assert (
        persisted.outline
        == '{"title": "", "children": [{"title": "核心观点", "children": [{"title": "要点A", "children": []}]}, {"title": "结论与启示", "children": [{"title": "行动建议", "children": []}]}]}'
    )
    assert persisted.error_message is None


def test_process_article_classification_uses_structured_category_id(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Classification Article",
        slug="classification-article",
        content_md="这是一篇关于 AI 产品与浏览器插件的文章。",
        created_at=now_str(),
        updated_at=now_str(),
    )
    category_a = Category(
        id=str(uuid.uuid4()),
        name="产品",
        description="产品设计",
        sort_order=1,
        created_at=now_str(),
    )
    category_b = Category(
        id=str(uuid.uuid4()),
        name="工具",
        description="效率工具",
        sort_order=2,
        created_at=now_str(),
    )
    db_session.add_all([article, category_a, category_b])
    db_session.commit()
    db_session.refresh(article)
    article_id = article.id
    category_b_id = category_b.id

    service = ArticleAIPipelineService()
    enqueued = []

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert content == article.content_md
            assert (kwargs.get("parameters") or {}).get("response_format", {}).get(
                "type"
            ) == "json_schema"
            assert "category_id" in (
                (kwargs.get("parameters") or {}).get("system_prompt") or ""
            )
            return {
                "content": f'{{"category_id":"{category_b_id}"}}',
                "usage": None,
                "latency_ms": 10,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "prompt_template": "请分类：{content}",
            "parameters": {
                "system_prompt": "请根据主题做最匹配分类判断",
                "response_format": "text",
            },
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())
    monkeypatch.setattr(
        service,
        "_enqueue_task",
        lambda db, **kwargs: enqueued.append(kwargs),
    )

    asyncio.run(
        service.process_article_classification(
            article_id,
            None,
            post_process_options={
                "tagging": True,
                "summary": True,
                "outline": True,
                "quotes": True,
                "translation": False,
            },
        )
    )

    persisted_article = db_session.get(Article, article_id)
    persisted_analysis = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert persisted_article.category_id == category_b_id
    assert persisted_analysis.classification_status == "completed"
    assert [(item["task_type"], item["content_type"]) for item in enqueued] == [
        ("process_article_tagging", "tagging"),
        ("process_ai_content", "summary"),
        ("process_ai_content", "outline"),
        ("process_ai_content", "quotes"),
    ]


def test_process_article_classification_failure_raises_after_followups(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Classification Failure Article",
        slug="classification-failure-article",
        content_md="这是一篇关于工具产品的文章。",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    article_id = article.id

    service = ArticleAIPipelineService()
    enqueued = []

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            raise RuntimeError("provider rejected response format")

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "prompt_template": "请分类：{content}",
            "parameters": {"system_prompt": "请分类"},
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())
    monkeypatch.setattr(
        service,
        "_enqueue_task",
        lambda db, **kwargs: enqueued.append(kwargs),
    )

    with pytest.raises(TaskExternalError, match="provider rejected response format"):
        asyncio.run(service.process_article_classification(article_id, None))

    persisted_analysis = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    usage_log = (
        db_session.query(AIUsageLog)
        .filter(AIUsageLog.article_id == article_id)
        .filter(AIUsageLog.content_type == "classification")
        .one()
    )
    assert persisted_analysis.classification_status == "failed"
    assert persisted_analysis.error_message == "provider rejected response format"
    assert usage_log.status == "failed"
    assert [item["task_type"] for item in enqueued] == [
        "process_article_tagging",
        "process_ai_content",
    ]


def test_process_article_tagging_uses_structured_tag_list(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Tagging Article",
        slug="tagging-article",
        content_md="这是一篇关于 AI 产品、浏览器插件与知识管理的文章。",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    article_id = article.id

    service = ArticleAIPipelineService()

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert content == article.content_md
            assert (kwargs.get("parameters") or {}).get("response_format", {}).get(
                "type"
            ) == "json_schema"
            assert "tags" in (
                (kwargs.get("parameters") or {}).get("system_prompt") or ""
            )
            return {
                "content": '{"tags":["AI 产品","浏览器插件","知识管理","AI 产品"]}',
                "usage": None,
                "latency_ms": 8,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "prompt_template": "请打标签：{content}",
            "parameters": {
                "system_prompt": "请提炼高价值标签",
                "response_format": "text",
            },
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())

    asyncio.run(service.process_article_tagging(article_id, None))

    persisted_article = db_session.get(Article, article_id)
    persisted_analysis = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert sorted(tag.name for tag in persisted_article.tags) == sorted(
        [
        "AI 产品",
        "浏览器插件",
        "知识管理",
        ]
    )
    assert persisted_analysis.tagging_status == "completed"


def test_process_article_tagging_failure_marks_task_failed(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Tagging Failure Article",
        slug="tagging-failure-article",
        content_md="这是一篇关于 AI 产品与知识管理的文章。",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    article_id = article.id

    service = ArticleAIPipelineService()

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            raise RuntimeError("provider rejected response format")

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "prompt_template": "请打标签：{content}",
            "parameters": {"system_prompt": "请提炼标签"},
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())

    with pytest.raises(TaskExternalError, match="provider rejected response format"):
        asyncio.run(service.process_article_tagging(article_id, None))

    persisted_analysis = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    usage_log = (
        db_session.query(AIUsageLog)
        .filter(AIUsageLog.article_id == article_id)
        .filter(AIUsageLog.content_type == "tagging")
        .one()
    )
    assert persisted_analysis.tagging_status == "failed"
    assert persisted_analysis.error_message == "provider rejected response format"
    assert usage_log.status == "failed"


def test_process_ai_content_creates_summary_version_snapshot(db_session, monkeypatch):
    article = Article(
        title="Version Snapshot Article",
        slug="version-snapshot-article",
        content_md="测试摘要正文",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    analysis = AIAnalysis(
        article_id=article.id,
        summary_status="pending",
        updated_at=now_str(),
    )
    db_session.add(analysis)
    db_session.commit()

    service = ArticleAIPipelineService(current_task_id="task-summary-version")

    class FakeClient:
        async def generate_summary(self, content, **kwargs):
            assert content == "测试摘要正文"
            return {
                "content": "新的摘要版本",
                "usage": None,
                "latency_ms": 5,
                "request_payload": {},
                "response_payload": {},
            }

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": "model-1",
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "prompt_template": "请总结：{content}",
            "parameters": {},
        },
    )
    monkeypatch.setattr(service, "create_ai_client", lambda config: FakeClient())
    monkeypatch.setattr(
        service,
        "_enqueue_task",
        lambda db, **kwargs: None,
    )
    monkeypatch.setattr(
        article_ai_pipeline_module.ArticleEmbeddingService,
        "has_available_remote_config",
        lambda self, db: False,
    )

    asyncio.run(service.process_ai_content(article.id, None, "summary"))

    persisted_analysis = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article.id).one()
    )
    versions = (
        db_session.query(AIAnalysisVersion)
        .filter(AIAnalysisVersion.article_id == article.id)
        .filter(AIAnalysisVersion.content_type == "summary")
        .all()
    )
    assert persisted_analysis.summary == "新的摘要版本"
    assert persisted_analysis.summary_status == "completed"
    assert len(versions) == 1
    assert versions[0].content_text == "新的摘要版本"
    assert versions[0].source_task_id == "task-summary-version"
    assert persisted_analysis.current_summary_version_id == versions[0].id


def test_process_ai_content_uses_invocation_service_and_persists_session(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Session Summary Article",
        slug="session-summary-article",
        content_md="This is a summary article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.add(
        AIAnalysis(
            article_id=article.id,
            summary_status="pending",
            updated_at=now_str(),
        )
    )
    db_session.commit()

    service = ArticleAIPipelineService(current_task_id="task-summary-session")

    async def fake_generation(**kwargs):
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

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "api_type": "chat_completions",
            "prompt_template": "请总结：{content}",
            "parameters": None,
        },
    )
    monkeypatch.setattr(
        service.ai_invocation_service,
        "invoke_generation",
        fake_generation,
    )
    monkeypatch.setattr(
        article_ai_pipeline_module.ArticleEmbeddingService,
        "has_available_remote_config",
        lambda self, db: False,
    )

    asyncio.run(service.process_ai_content(article.id, None, "summary"))

    usage = db_session.query(AIUsageLog).filter(AIUsageLog.article_id == article.id).one()
    session = (
        db_session.query(AICallSession)
        .filter(AICallSession.usage_log_id == usage.id)
        .one()
    )
    assert session.api_type == "chat_completions"
    assert json.loads(session.output_snapshot)["content"] == "新的摘要版本"


def test_process_ai_content_reraises_generation_failures_after_logging(
    db_session,
    monkeypatch,
):
    article_id = str(uuid.uuid4())
    article = Article(
        id=article_id,
        title="Failed Summary Article",
        slug="failed-summary-article",
        content_md="This is a failing summary article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.add(
        AIAnalysis(
            article_id=article.id,
            summary_status="pending",
            updated_at=now_str(),
        )
    )
    db_session.commit()

    service = ArticleAIPipelineService(current_task_id="task-summary-failure")

    async def fake_generation(**kwargs):
        raise RuntimeError("Error code: 400 - {'detail': 'Input must be a list'}")

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://example.com",
            "api_key": "test-key",
            "model_name": "test-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "api_type": "responses",
            "prompt_template": "请总结：{content}",
            "parameters": None,
        },
    )
    monkeypatch.setattr(
        service.ai_invocation_service,
        "invoke_generation",
        fake_generation,
    )
    monkeypatch.setattr(
        article_ai_pipeline_module.ArticleEmbeddingService,
        "has_available_remote_config",
        lambda self, db: False,
    )

    with pytest.raises(RuntimeError, match="Input must be a list"):
        asyncio.run(service.process_ai_content(article_id, None, "summary"))

    usage = db_session.query(AIUsageLog).filter(AIUsageLog.article_id == article_id).one()
    persisted_analysis = (
        db_session.query(AIAnalysis).filter(AIAnalysis.article_id == article_id).one()
    )
    assert usage.status == "failed"
    assert persisted_analysis.summary_status == "failed"
    assert "Input must be a list" in (persisted_analysis.error_message or "")


def test_process_ai_content_preserves_responses_api_type_for_explicit_model_config(
    db_session,
    monkeypatch,
):
    article = Article(
        title="Responses Session Article",
        slug="responses-session-article",
        content_md="This is a responses article.",
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(article)
    db_session.commit()
    db_session.add(
        AIAnalysis(
            article_id=article.id,
            summary_status="pending",
            updated_at=now_str(),
        )
    )
    model_config = ModelAPIConfig(
        name="Responses Model",
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        model_name="gpt-5.4",
        api_type="responses",
        is_enabled=True,
        created_at=now_str(),
        updated_at=now_str(),
    )
    db_session.add(model_config)
    db_session.commit()

    service = ArticleAIPipelineService(current_task_id="task-responses-session")
    captured = {}

    async def fake_generation(**kwargs):
        captured["api_type"] = kwargs["api_type"]
        return {
            "content": "新的摘要版本",
            "usage": None,
            "latency_ms": 5,
            "request_payload": {"model": "gpt-5.4", "input": "prompt"},
            "response_payload": {"id": "resp-1"},
            "session_info": {
                "api_type": "responses",
                "continuation_mode": "provider",
                "provider_response_id": "resp-1",
                "input_snapshot": {"user_prompt": "原始提示词"},
                "output_snapshot": {"content": "新的摘要版本"},
            },
        }

    monkeypatch.setattr(article_ai_pipeline_module, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        service,
        "get_ai_config",
        lambda *args, **kwargs: {
            "base_url": "https://default.example.com",
            "api_key": "default-key",
            "model_name": "default-model",
            "model_api_config_id": None,
            "price_input_per_1k": None,
            "price_output_per_1k": None,
            "currency": None,
            "api_type": "chat_completions",
            "prompt_template": "请总结：{content}",
            "parameters": None,
        },
    )
    monkeypatch.setattr(
        service,
        "create_ai_client",
        lambda config: captured.setdefault("client_config", dict(config)) or SimpleNamespace(),
    )
    monkeypatch.setattr(
        service.ai_invocation_service,
        "invoke_generation",
        fake_generation,
    )
    monkeypatch.setattr(
        article_ai_pipeline_module.ArticleEmbeddingService,
        "has_available_remote_config",
        lambda self, db: False,
    )

    asyncio.run(
        service.process_ai_content(
            article.id,
            None,
            "summary",
            model_config_id=model_config.id,
        )
    )

    usage = db_session.query(AIUsageLog).filter(AIUsageLog.article_id == article.id).one()
    session = (
        db_session.query(AICallSession)
        .filter(AICallSession.usage_log_id == usage.id)
        .one()
    )
    assert captured["client_config"]["api_type"] == "responses"
    assert captured["api_type"] == "responses"
    assert session.api_type == "responses"
    assert session.continuation_mode == "provider"
    assert session.provider_response_id == "resp-1"
