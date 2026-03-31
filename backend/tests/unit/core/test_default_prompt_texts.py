from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_structured_default_prompts_focus_on_content_strategy_not_output_format():
    versions_dir = Path(__file__).resolve().parents[3] / "alembic" / "versions"
    default_prompt_module = _load_module(
        versions_dir / "20260211_0003_seed_default_prompts.py"
    )

    prompts_by_type = {
        item["type"]: item for item in default_prompt_module.DEFAULT_PROMPT_CONFIGS
    }

    classification_prompt = prompts_by_type["classification"]["prompt"]
    classification_system = prompts_by_type["classification"]["system_prompt"]
    assert "仅输出分类 ID" not in classification_prompt
    assert "只输出分类 ID" not in classification_system

    outline_prompt = prompts_by_type["outline"]["prompt"]
    outline_system = prompts_by_type["outline"]["system_prompt"]
    assert "输出结构（只替换内容）" not in outline_prompt
    assert "输出必须为合法 JSON" not in outline_system

    validation_prompt = prompts_by_type["content_validation"]["prompt"]
    validation_system = prompts_by_type["content_validation"]["system_prompt"]
    assert "仅输出 JSON" not in validation_prompt
    assert "JSON 结构" not in validation_prompt
    assert "只输出 JSON" not in validation_system


def test_tagging_default_prompt_focuses_on_tag_quality_not_json_array_format():
    versions_dir = Path(__file__).resolve().parents[3] / "alembic" / "versions"
    tagging_module = _load_module(versions_dir / "20260319_0008_article_tags.py")

    seed_function_consts = tagging_module._seed_default_tagging_prompt.__code__.co_consts
    joined_text = "\n".join(
        item for item in seed_function_consts if isinstance(item, str)
    )

    assert "仅输出 JSON 数组" not in joined_text
    assert "只输出 JSON 数组" not in joined_text
