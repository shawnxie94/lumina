import importlib
import warnings


def test_schema_modules_do_not_emit_model_namespace_warnings():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")

        import app.schemas.ai as ai_schema
        import app.schemas.article as article_schema
        import app.schemas.review as review_schema

        importlib.reload(ai_schema)
        importlib.reload(article_schema)
        importlib.reload(review_schema)

    messages = [str(item.message) for item in caught]
    offending = [message for message in messages if 'protected namespace "model_"' in message]
    assert offending == []
