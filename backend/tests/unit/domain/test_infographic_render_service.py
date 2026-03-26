from __future__ import annotations

import pytest

from app.domain.infographic_render_service import InfographicRenderService
from task_errors import TaskDataError


def test_sanitize_html_fragment_accepts_allowed_markup():
    service = InfographicRenderService()

    html = """
<section style="display: flex; gap: 16px; padding: 24px; box-sizing: border-box; width: 1080px; height: 1440px; font-family: 'Helvetica Neue', Arial, sans-serif">
  <div style="background-color: #fff; border-radius: 24px; padding: 20px">
    <h1 style="font-size: 48px; font-weight: 700">核心结论</h1>
    <p style="font-size: 18px; line-height: 1.6">信息密度高且适合静态渲染。</p>
    <table style="width: 100%; border-collapse: collapse; table-layout: fixed">
      <tbody>
        <tr>
          <td style="vertical-align: top; white-space: normal; word-break: break-word">左列</td>
          <td style="vertical-align: top; overflow-wrap: anywhere">右列</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>
"""

    sanitized = service.sanitize_html_fragment(html)

    assert "<section" in sanitized
    assert "display: flex" in sanitized
    assert "box-sizing: border-box" in sanitized
    assert "height: 1440px" in sanitized
    assert "font-family" in sanitized
    assert "border-collapse: collapse" in sanitized
    assert "核心结论" in sanitized


def test_sanitize_html_fragment_rejects_script_tag():
    service = InfographicRenderService()

    with pytest.raises(TaskDataError, match="script"):
        service.sanitize_html_fragment("<script>alert(1)</script>")


def test_sanitize_html_fragment_rejects_event_handler_and_external_style():
    service = InfographicRenderService()

    with pytest.raises(TaskDataError, match="事件属性"):
        service.sanitize_html_fragment('<div onclick="alert(1)">bad</div>')

    with pytest.raises(TaskDataError, match="不安全"):
        service.sanitize_html_fragment(
            '<div style="background: url(https://example.com/bg.png)">bad</div>'
        )


def test_sanitize_html_fragment_rejects_fixed_height_layout_overflow():
    service = InfographicRenderService()

    html = """
<div style="width: 1080px; height: 1440px; box-sizing: border-box; padding: 56px; background: #fff">
  <header style="height: 220px; margin-bottom: 28px">头部</header>
  <main style="height: 1060px; margin-bottom: 28px">主体</main>
  <footer style="height: 84px">底部</footer>
</div>
"""

    with pytest.raises(TaskDataError, match="固定高度布局超出画布"):
        service.sanitize_html_fragment(html)
