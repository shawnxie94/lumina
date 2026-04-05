import worker


def test_wait_for_required_tables_returns_immediately_when_ready():
    calls: list[int] = []

    def get_table_names() -> set[str]:
        calls.append(1)
        return {"ai_tasks", "articles"}

    worker.wait_for_required_tables(
        get_table_names=get_table_names,
        required_tables=("ai_tasks",),
        poll_interval=0.1,
        sleep=lambda _seconds: (_ for _ in ()).throw(AssertionError("should not sleep")),
    )

    assert len(calls) == 1


def test_wait_for_required_tables_retries_until_required_table_exists():
    responses = iter(
        [
            set(),
            {"articles"},
            {"ai_tasks", "articles"},
        ]
    )
    sleeps: list[float] = []

    worker.wait_for_required_tables(
        get_table_names=lambda: next(responses),
        required_tables=("ai_tasks",),
        poll_interval=0.25,
        sleep=lambda seconds: sleeps.append(seconds),
    )

    assert sleeps == [0.25, 0.25]


def test_wait_for_required_tables_waits_for_review_tables_by_default():
    responses = iter(
        [
            {"ai_tasks"},
            {
                "ai_tasks",
                "review_templates",
                "review_template_categories",
                "review_issues",
                "review_issue_articles",
            },
        ]
    )
    sleeps: list[float] = []

    worker.wait_for_required_tables(
        get_table_names=lambda: next(responses),
        poll_interval=0.5,
        sleep=lambda seconds: sleeps.append(seconds),
    )

    assert sleeps == [0.5]
