import importlib
import warnings


def test_models_module_does_not_emit_declarative_base_deprecation_warning():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")

        import models

        importlib.reload(models)

    messages = [str(item.message) for item in caught]
    offending = [message for message in messages if "declarative_base()" in message]
    assert offending == []
