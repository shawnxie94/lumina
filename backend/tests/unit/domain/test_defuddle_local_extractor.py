import json

import pytest

from app.domain import defuddle_local_extractor as module
from app.domain.defuddle_local_extractor import (
    DefuddleLocalExtractionError,
    describe_defuddle_local_status,
    extract_with_defuddle_local,
    is_defuddle_local_available,
)


SAMPLE_HTML = """<!doctype html>
<html>
<head>
  <title>Page Title</title>
  <meta property="og:title" content="OG Title" />
  <meta name="author" content="Ada Lovelace" />
</head>
<body>
  <nav>Home About</nav>
  <article>
    <h1>OG Title</h1>
    <p>""" + ("word " * 40) + """</p>
    <p>Second paragraph keeps the article long enough for Defuddle.</p>
  </article>
  <aside>Related posts</aside>
</body>
</html>
"""


def _clear_caches() -> None:
    for name in ("_resolve_node_bin", "_expected_engine_version"):
        fn = getattr(module, name, None)
        cache_clear = getattr(fn, "cache_clear", None)
        if callable(cache_clear):
            cache_clear()


def test_is_defuddle_local_available_requires_package(monkeypatch, tmp_path):
    """Missing node_modules/defuddle must report unavailable (no silent regex path)."""
    monkeypatch.setattr(module, "BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(module, "_resolve_node_bin", lambda: "/usr/bin/node")
    script = tmp_path / "scripts" / "defuddle_extract.mjs"
    script.parent.mkdir(parents=True)
    script.write_text("// stub\n", encoding="utf-8")
    monkeypatch.setattr(module, "DEFAULT_SCRIPT_PATH", script)
    _clear_caches()
    assert is_defuddle_local_available() is False
    status = describe_defuddle_local_status()
    assert status["package_exists"] is False


def test_is_defuddle_local_available_when_node_script_and_package_exist():
    # Real backend workspace should have been npm-ci'd in docker/dev.
    if not (module.BACKEND_ROOT / "node_modules" / "defuddle").is_dir():
        pytest.skip("backend node_modules/defuddle not installed")
    assert is_defuddle_local_available() is True
    status = describe_defuddle_local_status()
    assert status["available"] is True
    assert status["package_exists"] is True


def test_extract_with_defuddle_local_smoke():
    if not is_defuddle_local_available():
        pytest.skip("node/defuddle package unavailable")

    result = extract_with_defuddle_local(
        html=SAMPLE_HTML,
        url="https://example.com/post",
    )
    assert "word" in result.content_html.lower() or "paragraph" in result.content_html.lower()
    assert result.title
    assert result.engine_version


def test_extract_with_defuddle_local_raises_on_empty_html():
    if not is_defuddle_local_available():
        pytest.skip("node/defuddle package unavailable")
    with pytest.raises(DefuddleLocalExtractionError):
        extract_with_defuddle_local(html="   ", url="https://example.com/x")


def test_extract_with_defuddle_local_uses_custom_node(monkeypatch, tmp_path):
    script_cjs = tmp_path / "fake.cjs"
    script_cjs.write_text(
        "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8'));"
        "process.stdout.write(JSON.stringify({"
        "title:'T',content_html:'<p>hello world content enough</p>',author:'A',"
        "published:'',image:'',description:'',word_count:4,parse_time_ms:1,"
        "engine_version:'test'}));\n",
        encoding="utf-8",
    )
    # Provide a fake package dir so availability/preflight passes.
    pkg = tmp_path / "node_modules" / "defuddle"
    pkg.mkdir(parents=True)
    (pkg / "package.json").write_text(
        json.dumps({"name": "defuddle", "version": "0.19.1"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "BACKEND_ROOT", tmp_path)
    monkeypatch.setenv("LUMINA_DEFUDDLE_SCRIPT", str(script_cjs))
    _clear_caches()

    result = extract_with_defuddle_local(html="<html></html>", url="https://example.com")
    assert result.title == "T"
    assert "hello world" in result.content_html
    _clear_caches()
