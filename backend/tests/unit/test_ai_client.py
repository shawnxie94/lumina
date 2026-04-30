from ai_client import ConfigurableAIClient


def test_build_responses_request_uses_list_input_items():
    client = ConfigurableAIClient(
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        model_name="gpt-5.4",
        api_type="responses",
    )

    request = client._build_responses_request(
        prompt="请提炼要点",
        system_prompt="你是助手",
        parameters={},
        max_tokens=500,
        temperature=0.7,
    )

    assert request["input"] == [
        {
            "role": "user",
            "content": "请提炼要点",
        }
    ]
    assert request["instructions"] == "你是助手"


def test_build_responses_request_normalizes_json_schema_format():
    client = ConfigurableAIClient(
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        model_name="gpt-5.4",
        api_type="responses",
    )

    request = client._build_responses_request(
        prompt="请选择分类",
        system_prompt=None,
        parameters={
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "article_classification_result",
                    "schema": {
                        "type": "object",
                        "properties": {"category_id": {"type": "string"}},
                        "required": ["category_id"],
                        "additionalProperties": False,
                    },
                    "strict": True,
                },
            }
        },
        max_tokens=500,
        temperature=0,
    )

    assert request["text"]["format"] == {
        "type": "json_schema",
        "name": "article_classification_result",
        "schema": {
            "type": "object",
            "properties": {"category_id": {"type": "string"}},
            "required": ["category_id"],
            "additionalProperties": False,
        },
        "strict": True,
    }


def test_extract_response_text_supports_plain_string_response():
    client = ConfigurableAIClient(
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        model_name="gpt-5.4",
        api_type="responses",
    )

    assert client._extract_response_text("测试成功") == "测试成功"


def test_extract_response_text_supports_responses_event_stream_done_text():
    client = ConfigurableAIClient(
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        model_name="gpt-5.4",
        api_type="responses",
    )
    payload = (
        'event: response.created\n'
        'data: {"type":"response.created"}\n\n'
        'event: response.output_text.delta\n'
        'data: {"type":"response.output_text.delta","delta":"文"}\n\n'
        'event: response.output_text.delta\n'
        'data: {"type":"response.output_text.delta","delta":"本"}\n\n'
        'event: response.output_text.done\n'
        'data: {"type":"response.output_text.done","text":"最终结果"}\n\n'
    )

    assert client._extract_response_text(payload) == "最终结果"


def test_generate_summary_persists_responses_event_stream_response_id():
    client = ConfigurableAIClient(
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        model_name="gpt-5.4",
        api_type="responses",
    )

    class FakeResponsesAPI:
        async def create(self, **kwargs):
            return (
                'event: response.created\n'
                'data: {"type":"response.created","response":{"id":"resp_stream_1","model":"gpt-5.4","status":"in_progress"}}\n\n'
                'event: response.output_text.done\n'
                'data: {"type":"response.output_text.done","text":"最终结果"}\n\n'
                'event: response.completed\n'
                'data: {"type":"response.completed","response":{"id":"resp_stream_1","status":"completed"}}\n\n'
            )

    class FakeClient:
        responses = FakeResponsesAPI()

    client.client = FakeClient()

    import asyncio

    result = asyncio.run(
        client.generate_summary(
            "示例内容",
            prompt="请提炼要点：{content}",
            parameters={"system_prompt": "你是助手"},
        )
    )

    assert result["content"] == "最终结果"
    assert result["response_payload"]["id"] == "resp_stream_1"
    assert result["finish_reason"] == "completed"
