from app.domain.article_ai_pipeline_service import ArticleAIPipelineService


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
