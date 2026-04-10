from app.domain.comment_utils import build_user_github_url


def test_build_user_github_url_prefers_explicit_github_username():
    assert (
        build_user_github_url(
            provider="github",
            user_id="123456",
            github_username="octocat",
            user_name="The Octocat",
        )
        == "https://github.com/octocat"
    )


def test_build_user_github_url_falls_back_to_slug_like_user_name():
    assert (
        build_user_github_url(
            provider="github",
            user_id="123456",
            github_username=None,
            user_name="octocat",
        )
        == "https://github.com/octocat"
    )


def test_build_user_github_url_avoids_using_numeric_oauth_subject_directly():
    assert (
        build_user_github_url(
            provider="github",
            user_id="123456",
            github_username=None,
            user_name="The Octocat",
        )
        is None
    )
