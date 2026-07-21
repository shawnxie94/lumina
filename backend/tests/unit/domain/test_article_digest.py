import pytest

from app.domain.article_digest import (
    empty_digest_lines,
    join_digest_lines,
    parse_digest_prefill_result,
    build_prefill_material,
)


def test_parse_digest_prefill_accepts_valid_lines():
    raw = {
        "line1": "这篇文章讲的是分布式锁选型",
        "line2": "作者最核心的观点是优先用租约而不是永久锁",
        "line3": "作者用了故障案例与时序对比来证明",
        "line4": "我认为最有价值的是租约超时策略",
        "line5": "我不完全认同的是对数据库锁的绝对否定",
        "line6": "我准备采取的一个行动是在项目中补锁续约监控",
    }
    lines = parse_digest_prefill_result(raw)
    assert lines["line1"].startswith("这篇文章讲的是")
    assert lines["line3"].endswith("来证明")
    assert "租约超时策略" in lines["line4"]


def test_parse_digest_prefill_accepts_full_six_lines():
    raw = {
        "line1": "这篇文章讲的是主题A",
        "line2": "作者最核心的观点是观点B",
        "line3": "作者用了数据C 来证明",
        "line4": "我认为最有价值的是作者的架构图",
        "line5": "我不完全认同的是过度简化",
        "line6": "我准备采取的一个行动是写 ADR",
    }
    lines = parse_digest_prefill_result(raw)
    assert "架构图" in lines["line4"]
    assert "ADR" in lines["line6"]


def test_parse_digest_prefill_rejects_empty_slot():
    raw = empty_digest_lines()
    raw["line1"] = "这篇文章讲的是主题A"
    raw["line2"] = "作者最核心的观点是观点B"
    raw["line3"] = "作者用了数据C 来证明"
    with pytest.raises(ValueError, match="不能为空槽"):
        parse_digest_prefill_result(raw)


def test_build_prefill_material_priority():
    material, flags = build_prefill_material(
        summary="摘要",
        outline='{"title":"t","children":[]}',
        content_md="正文很长",
    )
    assert flags["has_outline"] is True
    assert flags["has_summary"] is True
    assert "【大纲 JSON】" in material
    assert "【摘要】" in material
    assert "【正文摘录】" not in material

    material2, flags2 = build_prefill_material(
        summary=None,
        outline=None,
        content_md="只有正文",
    )
    assert flags2["content_fallback"] is True
    assert "【正文摘录】" in material2


def test_join_digest_lines_uses_blank_paragraphs():
    lines = empty_digest_lines()
    lines["line1"] = "这篇文章讲的是主题A"
    lines["line2"] = "作者最核心的观点是观点B"
    lines["line3"] = "作者用了数据C 来证明"
    lines["line4"] = "我认为最有价值的是X"
    lines["line5"] = "我不完全认同的是Y"
    lines["line6"] = "我准备采取的一个行动是Z"
    joined = join_digest_lines(lines)
    assert "\n\n" in joined
    assert joined.count("\n\n") >= 5
