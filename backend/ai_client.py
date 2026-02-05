from openai import AsyncOpenAI
import json
import time
from typing import Optional, Dict, Any


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

    # Remove common markdown/HTML elements that might skew the ratio
    import re

    clean_text = re.sub(r"```[\s\S]*?```", "", text)  # Remove code blocks
    clean_text = re.sub(r"`[^`]+`", "", clean_text)  # Remove inline code
    clean_text = re.sub(r"https?://\S+", "", clean_text)  # Remove URLs
    clean_text = re.sub(r"!\[.*?\]\(.*?\)", "", clean_text)  # Remove images
    clean_text = re.sub(r"\[.*?\]\(.*?\)", "", clean_text)  # Remove links
    clean_text = re.sub(r"[#*_\-\[\](){}|>]", "", clean_text)  # Remove markdown symbols
    clean_text = re.sub(r"\s+", " ", clean_text).strip()  # Normalize whitespace

    if not clean_text:
        return False

    # Count ASCII letters (a-z, A-Z) vs non-ASCII characters
    ascii_letters = sum(1 for c in clean_text if c.isascii() and c.isalpha())
    non_ascii_letters = sum(1 for c in clean_text if not c.isascii() and c.isalpha())

    total_letters = ascii_letters + non_ascii_letters
    if total_letters == 0:
        return False

    ascii_ratio = ascii_letters / total_letters
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
            return {
                "content": response.choices[0].message.content,
                "usage": getattr(response, "usage", None),
                "model": getattr(response, "model", self.model_name),
                "latency_ms": latency_ms,
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
            print(
                f"翻译响应 - 结果长度: {len(result) if result else 0}, 前100字符: {result[:100] if result else 'None'}"
            )
            return {
                "content": result,
                "usage": getattr(response, "usage", None),
                "model": getattr(response, "model", self.model_name),
                "latency_ms": latency_ms,
            }
        except Exception as e:
            print(f"翻译失败: {e}")
            raise
