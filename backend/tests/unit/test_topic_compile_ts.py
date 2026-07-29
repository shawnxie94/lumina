from app.domain.timestamp_utils import is_newer_timestamp, parse_iso_timestamp
from app.domain.topic_service import TopicService


def test_parse_ts_timezone_and_naive():
    a = parse_iso_timestamp("2026-07-29T07:00:38.561877+00:00")
    b = parse_iso_timestamp("2026-07-29T14:40:00+08:00")
    c = parse_iso_timestamp("2026-07-29T07:00:38.561877Z")
    assert a is not None and b is not None and c is not None
    # 14:40 +08 == 06:40 UTC, earlier than 07:00 UTC
    assert b < a
    assert a == c


def test_is_newer_ts_does_not_false_skip_local_offset():
    assert (
        is_newer_timestamp(
            "2026-07-29T14:40:00+08:00",
            "2026-07-29T07:00:38.561877+00:00",
        )
        is False
    )
    assert (
        is_newer_timestamp(
            "2026-07-29T07:00:38.561877+00:00",
            "2026-07-29T14:40:00+08:00",
        )
        is True
    )


def test_topic_service_wrappers_delegate():
    svc = TopicService()
    assert svc._is_newer_ts(
        "2026-07-29T14:40:00+08:00",
        "2026-07-29T07:00:38.561877+00:00",
    ) is False
