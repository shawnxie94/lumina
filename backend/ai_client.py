from openai import OpenAI
import json
from typing import Optional, Dict, Any


class ConfigurableAIClient:
    def __init__(self, base_url: str, api_key: str, model_name: str):
        if not api_key:
            raise ValueError("API key is required")
        if not base_url:
            raise ValueError("Base URL is required")

        self.base_url = base_url
        self.api_key = api_key
        self.model_name = model_name
        self.client = OpenAI(base_url=base_url, api_key=api_key)

    def generate_summary(
        self,
        content: str,
        prompt: Optional[str] = None,
        max_tokens: int = 500,
        temperature: float = 0.7,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> str:
        if not prompt:
            prompt = (
                f"请为以下文章生成一个简洁的摘要（100-200字）：\n\n{content[:4000]}"
            )

        if parameters is None:
            parameters = {}

        request_params = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": parameters.get("max_tokens", max_tokens),
            "temperature": parameters.get("temperature", temperature),
        }

        if "top_p" in parameters:
            request_params["top_p"] = parameters["top_p"]

        try:
            response = self.client.chat.completions.create(**request_params)
            return response.choices[0].message.content
        except Exception as e:
            print(f"AI生成失败: {e}")
            raise
