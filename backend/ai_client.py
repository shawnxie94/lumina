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
    def __init__(self, base_url: str, api_key: str, model_name: str):
        if not api_key:
            raise ValueError("API key is required")
        if not base_url:
            raise ValueError("Base URL is required")

        self.base_url = base_url
        self.api_key = api_key
        self.model_name = model_name
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
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        request_params = {
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

        try:
            start_time = time.monotonic()
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
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": final_prompt})

        request_params = {
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

        try:
            print(
                f"翻译请求 - 模型: {self.model_name}, prompt长度: {len(final_prompt)}"
            )
            start_time = time.monotonic()
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
