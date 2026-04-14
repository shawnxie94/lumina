import json
import time
import re
from typing import Optional, Dict, Any

from openai import AsyncOpenAI


MATH_PATTERN = re.compile(
    r"\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]+(?<!\\)\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]",
    re.MULTILINE,
)
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
URL_PATTERN = re.compile(r"https?://\S+")
FENCED_CODE_PATTERN = re.compile(r"```[\s\S]*?```")
INLINE_CODE_PATTERN = re.compile(r"`[^`]+`")
MARKDOWN_IMAGE_PATTERN = re.compile(r"!\[.*?\]\(.*?\)")
MARKDOWN_LINK_PATTERN = re.compile(r"\[.*?\]\(.*?\)")
MARKDOWN_SYMBOL_PATTERN = re.compile(r"[#*_\-\[\](){}|>]")
WHITESPACE_PATTERN = re.compile(r"\s+")
HAN_CHAR_PATTERN = re.compile(r"[\u4e00-\u9fff]")


def is_english_content(text: str, threshold: float = 0.7) -> bool:
    """
    Detect if content is primarily English using ASCII ratio heuristic.

    Args:
        text: The text content to analyze
        threshold: Ratio of ASCII characters required to consider as English (default 0.7)

    Returns:
        True if content appears to be English, False otherwise
    """
    if not text:
        return False

    clean_text = text
    clean_text = FENCED_CODE_PATTERN.sub("", clean_text)
    clean_text = INLINE_CODE_PATTERN.sub("", clean_text)
    clean_text = URL_PATTERN.sub("", clean_text)
    clean_text = MARKDOWN_IMAGE_PATTERN.sub("", clean_text)
    clean_text = MARKDOWN_LINK_PATTERN.sub("", clean_text)
    clean_text = MATH_PATTERN.sub("", clean_text)
    clean_text = HTML_TAG_PATTERN.sub(" ", clean_text)
    clean_text = MARKDOWN_SYMBOL_PATTERN.sub("", clean_text)
    clean_text = WHITESPACE_PATTERN.sub(" ", clean_text).strip()

    if not clean_text:
        return False

    # Count ASCII letters (a-z, A-Z) vs non-ASCII characters
    ascii_letters = sum(1 for c in clean_text if c.isascii() and c.isalpha())
    non_ascii_letters = sum(1 for c in clean_text if not c.isascii() and c.isalpha())

    total_letters = ascii_letters + non_ascii_letters
    if total_letters == 0:
        return False
    if total_letters < 40:
        return False

    ascii_ratio = ascii_letters / total_letters
    han_chars = len(HAN_CHAR_PATTERN.findall(clean_text))
    han_ratio = han_chars / total_letters
    if han_ratio >= 0.2:
        return False
    return ascii_ratio >= threshold


class ConfigurableAIClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model_name: str,
        api_type: str = "chat_completions",
    ):
        if not api_key:
            raise ValueError("API key is required")
        if not base_url:
            raise ValueError("Base URL is required")

        self.base_url = base_url
        self.api_key = api_key
        self.model_name = model_name
        self.api_type = (api_type or "chat_completions").strip() or "chat_completions"
        self.client = AsyncOpenAI(base_url=base_url, api_key=api_key)

    def _serialize_usage(self, usage: Any) -> Optional[Dict[str, Any]]:
        if usage is None:
            return None
        if hasattr(usage, "model_dump"):
            return usage.model_dump()
        if hasattr(usage, "dict"):
            return usage.dict()
        if isinstance(usage, dict):
            return usage
        return {
            "prompt_tokens": getattr(usage, "prompt_tokens", None),
            "completion_tokens": getattr(usage, "completion_tokens", None),
            "total_tokens": getattr(usage, "total_tokens", None),
        }

    def _extract_event_stream_metadata(self, response_text: str) -> Dict[str, Any]:
        metadata: Dict[str, Any] = {}
        if "event:" not in response_text or "data:" not in response_text:
            return metadata
        for chunk in response_text.split("\n\n"):
            chunk = chunk.strip()
            if not chunk:
                continue
            event_name: Optional[str] = None
            data_lines: list[str] = []
            for line in chunk.splitlines():
                if line.startswith("event:"):
                    event_name = line[len("event:") :].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[len("data:") :].strip())
            if not event_name or not data_lines:
                continue
            try:
                payload = json.loads("\n".join(data_lines).strip())
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            if event_name not in {"response.created", "response.completed"}:
                continue
            response_payload = payload.get("response")
            candidate = response_payload if isinstance(response_payload, dict) else payload
            if not metadata.get("id") and candidate.get("id"):
                metadata["id"] = candidate.get("id")
            if not metadata.get("model") and candidate.get("model"):
                metadata["model"] = candidate.get("model")
            if candidate.get("status"):
                metadata["status"] = candidate.get("status")
        return metadata

    async def generate_summary(
        self,
        content: str,
        prompt: Optional[str] = None,
        max_tokens: int = 500,
        temperature: float = 0.7,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not prompt:
            prompt = f"请为以下文章生成一个简洁的摘要（100-200字）：\n\n{content}"
        else:
            # If prompt contains {content} placeholder, replace it
            # Otherwise, append content to end
            if "{content}" in prompt:
                prompt = prompt.replace("{content}", content)
            else:
                prompt = f"{prompt}\n\n{content}"

        if parameters is None:
            parameters = {}

        system_prompt = parameters.get("system_prompt")
        try:
            start_time = time.monotonic()
            if self.api_type == "responses":
                request_params = self._build_responses_request(
                    prompt=prompt,
                    system_prompt=system_prompt,
                    parameters=parameters,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
                response = await self.client.responses.create(**request_params)
                latency_ms = int((time.monotonic() - start_time) * 1000)
                usage_data = self._serialize_usage(getattr(response, "usage", None))
                content = self._extract_response_text(response)
                response_meta = (
                    self._extract_event_stream_metadata(response)
                    if isinstance(response, str)
                    else {}
                )
                return {
                    "content": content,
                    "usage": getattr(response, "usage", None),
                    "model": getattr(response, "model", None)
                    or response_meta.get("model")
                    or self.model_name,
                    "finish_reason": getattr(response, "status", None)
                    or response_meta.get("status"),
                    "latency_ms": latency_ms,
                    "request_payload": request_params,
                    "response_payload": {
                        "id": getattr(response, "id", None) or response_meta.get("id"),
                        "content": content,
                        "model": getattr(response, "model", None)
                        or response_meta.get("model")
                        or self.model_name,
                        "usage": usage_data,
                        "finish_reason": getattr(response, "status", None)
                        or response_meta.get("status"),
                    },
                }

            request_params = self._build_chat_request(
                prompt=prompt,
                system_prompt=system_prompt,
                parameters=parameters,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            response = await self.client.chat.completions.create(**request_params)
            latency_ms = int((time.monotonic() - start_time) * 1000)
            usage_data = self._serialize_usage(getattr(response, "usage", None))
            return {
                "content": response.choices[0].message.content,
                "usage": getattr(response, "usage", None),
                "model": getattr(response, "model", self.model_name),
                "finish_reason": getattr(response.choices[0], "finish_reason", None),
                "latency_ms": latency_ms,
                "request_payload": request_params,
                "response_payload": {
                    "id": getattr(response, "id", None),
                    "content": response.choices[0].message.content,
                    "model": getattr(response, "model", self.model_name),
                    "usage": usage_data,
                    "finish_reason": getattr(response.choices[0], "finish_reason", None),
                },
            }
        except Exception as e:
            print(f"AI生成失败: {e}")
            raise

    async def translate_to_chinese(
        self,
        content: str,
        prompt: Optional[str] = None,
        max_tokens: int = 16000,
        temperature: float = 0.3,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Translate English content to Chinese.

        Args:
            content: The English markdown content to translate
            prompt: Custom prompt template (use {content} placeholder)
            max_tokens: Maximum tokens for the response
            temperature: Lower temperature for more accurate translation
            parameters: Additional parameters for the API call

        Returns:
            Translated Chinese content in markdown format
        """
        default_prompt = """请将以下英文文章翻译成中文。要求：
1. 保持原文的markdown格式（标题、列表、代码块、链接等）
2. 翻译要准确、流畅、符合中文表达习惯
3. 专业术语可以保留英文原文，并在首次出现时用括号标注中文翻译
4. 代码块内的代码不要翻译，只翻译代码注释
5. 直接输出翻译结果，不要添加任何解释或前言

原文：

{content}"""

        if not prompt:
            final_prompt = default_prompt.replace("{content}", content)
        else:
            # If prompt contains {content} placeholder, replace it
            # Otherwise, append content to end
            if "{content}" in prompt:
                final_prompt = prompt.replace("{content}", content)
            else:
                final_prompt = f"{prompt}\n\n{content}"

        if parameters is None:
            parameters = {}

        system_prompt = parameters.get("system_prompt")
        try:
            print(
                f"翻译请求 - 模型: {self.model_name}, prompt长度: {len(final_prompt)}"
            )
            start_time = time.monotonic()
            if self.api_type == "responses":
                request_params = self._build_responses_request(
                    prompt=final_prompt,
                    system_prompt=system_prompt,
                    parameters=parameters,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
                response = await self.client.responses.create(**request_params)
                latency_ms = int((time.monotonic() - start_time) * 1000)
                result = self._extract_response_text(response)
                usage_data = self._serialize_usage(getattr(response, "usage", None))
                response_meta = (
                    self._extract_event_stream_metadata(response)
                    if isinstance(response, str)
                    else {}
                )
                return {
                    "content": result,
                    "usage": getattr(response, "usage", None),
                    "model": getattr(response, "model", None)
                    or response_meta.get("model")
                    or self.model_name,
                    "finish_reason": getattr(response, "status", None)
                    or response_meta.get("status"),
                    "latency_ms": latency_ms,
                    "request_payload": request_params,
                    "response_payload": {
                        "id": getattr(response, "id", None) or response_meta.get("id"),
                        "content": result,
                        "model": getattr(response, "model", None)
                        or response_meta.get("model")
                        or self.model_name,
                        "usage": usage_data,
                        "finish_reason": getattr(response, "status", None)
                        or response_meta.get("status"),
                    },
                }

            request_params = self._build_chat_request(
                prompt=final_prompt,
                system_prompt=system_prompt,
                parameters=parameters,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            response = await self.client.chat.completions.create(**request_params)
            latency_ms = int((time.monotonic() - start_time) * 1000)
            result = response.choices[0].message.content
            usage_data = self._serialize_usage(getattr(response, "usage", None))
            print(
                f"翻译响应 - 结果长度: {len(result) if result else 0}, 前100字符: {result[:100] if result else 'None'}"
            )
            return {
                "content": result,
                "usage": getattr(response, "usage", None),
                "model": getattr(response, "model", self.model_name),
                "finish_reason": getattr(response.choices[0], "finish_reason", None),
                "latency_ms": latency_ms,
                "request_payload": request_params,
                "response_payload": {
                    "content": result,
                    "model": getattr(response, "model", self.model_name),
                    "usage": usage_data,
                    "finish_reason": getattr(response.choices[0], "finish_reason", None),
                },
            }
        except Exception as e:
            print(f"翻译失败: {e}")
            raise

    def _build_chat_request(
        self,
        *,
        prompt: str,
        system_prompt: str | None,
        parameters: Dict[str, Any],
        max_tokens: int,
        temperature: float,
    ) -> Dict[str, Any]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        request_params: Dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": parameters.get("max_tokens", max_tokens),
            "temperature": parameters.get("temperature", temperature),
        }
        if "top_p" in parameters:
            request_params["top_p"] = parameters["top_p"]
        response_format = parameters.get("response_format")
        if isinstance(response_format, str):
            request_params["response_format"] = {"type": response_format}
        elif isinstance(response_format, dict):
            request_params["response_format"] = response_format
        return request_params

    def _build_responses_request(
        self,
        *,
        prompt: str,
        system_prompt: str | None,
        parameters: Dict[str, Any],
        max_tokens: int,
        temperature: float,
    ) -> Dict[str, Any]:
        request_params: Dict[str, Any] = {
            "model": self.model_name,
            "input": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            "instructions": system_prompt,
            "max_output_tokens": parameters.get("max_tokens", max_tokens),
            "temperature": parameters.get("temperature", temperature),
        }
        if "top_p" in parameters:
            request_params["top_p"] = parameters["top_p"]
        text_payload = self._build_responses_text_payload(parameters.get("response_format"))
        if text_payload is not None:
            request_params["text"] = text_payload
        return request_params

    def _build_responses_text_payload(
        self, response_format: Dict[str, Any] | str | None
    ) -> Dict[str, Any] | None:
        if not response_format:
            return None
        if isinstance(response_format, str):
            if response_format == "text":
                return None
            return {"format": {"type": response_format}}
        if isinstance(response_format, dict):
            return {"format": response_format}
        return None

    def _extract_response_text(self, response: Any) -> str:
        if isinstance(response, str):
            event_stream_text = self._extract_event_stream_text(response)
            if event_stream_text is not None:
                return event_stream_text
            return response
        output_text = getattr(response, "output_text", None)
        if output_text:
            return output_text
        output = getattr(response, "output", None) or []
        parts: list[str] = []
        for item in output:
            content_items = getattr(item, "content", None)
            if isinstance(item, dict):
                content_items = item.get("content")
            for content in content_items or []:
                if isinstance(content, dict):
                    if content.get("type") == "output_text":
                        parts.append(str(content.get("text") or ""))
                elif getattr(content, "type", None) == "output_text":
                    parts.append(str(getattr(content, "text", "") or ""))
        return "".join(parts)

    def _extract_event_stream_text(self, response_text: str) -> str | None:
        if "event:" not in response_text or "data:" not in response_text:
            return None
        done_text: str | None = None
        delta_parts: list[str] = []
        for chunk in response_text.split("\n\n"):
            chunk = chunk.strip()
            if not chunk:
                continue
            event_name: str | None = None
            data_lines: list[str] = []
            for line in chunk.splitlines():
                if line.startswith("event:"):
                    event_name = line[len("event:") :].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[len("data:") :].strip())
            if not event_name or not data_lines:
                continue
            data_str = "\n".join(data_lines).strip()
            if not data_str:
                continue
            try:
                payload = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            if event_name == "response.output_text.done":
                done_text = str(payload.get("text") or payload.get("data") or "")
            elif event_name == "response.output_text.delta":
                delta = payload.get("delta")
                if delta:
                    delta_parts.append(str(delta))
        if done_text is not None:
            return done_text
        if delta_parts:
            return "".join(delta_parts)
        return None

    async def generate_embedding(
        self,
        content: str,
        model_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not content:
            raise ValueError("embedding内容不能为空")
        request_model = model_name or self.model_name
        try:
            start_time = time.monotonic()
            response = await self.client.embeddings.create(
                model=request_model,
                input=content,
            )
            latency_ms = int((time.monotonic() - start_time) * 1000)
            data = response.data[0].embedding if response.data else []
            usage_data = self._serialize_usage(getattr(response, "usage", None))
            return {
                "embedding": data,
                "usage": getattr(response, "usage", None),
                "model": getattr(response, "model", request_model),
                "latency_ms": latency_ms,
                "request_payload": {"model": request_model},
                "response_payload": {
                    "model": getattr(response, "model", request_model),
                    "usage": usage_data,
                },
            }
        except Exception as e:
            print(f"Embedding生成失败: {e}")
            raise
