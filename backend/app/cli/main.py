from __future__ import annotations

import argparse
from typing import Any

from app.cli.common import (
    CLIArgumentParser,
    build_context,
    load_json_input,
    merge_payload,
    parse_optional_bool,
    print_error,
    print_success,
    trim_to_none,
)
from app.cli.errors import CLIError


def build_parser() -> CLIArgumentParser:
    parser = CLIArgumentParser(prog="lumina-cli", description="Lumina Agent-friendly CLI")
    parser.add_argument("--mode", choices=["local", "remote"], help="执行模式")
    parser.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        help="输出稳定 JSON",
    )
    parser.add_argument("--base-url", help="远程 Lumina 后端基地址")
    parser.add_argument("--database-url", help="覆盖本地 DATABASE_URL")
    parser.add_argument("--admin-token", help="远程管理员 token")
    parser.add_argument("--password", help="远程管理员密码")
    parser.add_argument("--timeout", type=float, default=30.0, help="远程请求超时秒数")

    command_parsers = parser.add_subparsers(dest="command_group", required=True)

    article = command_parsers.add_parser("article", help="文章相关命令")
    article_commands = article.add_subparsers(dest="article_command", required=True)

    article_list = article_commands.add_parser("list", help="筛选文章列表")
    article_list.set_defaults(handler="article_list", command_name="article.list")
    add_article_list_filters(article_list)

    article_get = article_commands.add_parser("get", help="获取文章详情")
    article_get.set_defaults(handler="article_get", command_name="article.get")
    article_get.add_argument("article_slug", help="文章 slug")

    article_create = article_commands.add_parser("create", help="创建文章")
    article_create.set_defaults(handler="article_create", command_name="article.create")
    add_write_input_argument(article_create)
    article_create.add_argument("--title")
    article_create.add_argument("--content-md")
    article_create.add_argument("--content-html")
    article_create.add_argument("--source-url")
    article_create.add_argument("--top-image")
    article_create.add_argument("--author")
    article_create.add_argument("--published-at")
    article_create.add_argument("--source-domain")
    article_create.add_argument("--category-id")
    article_create.add_argument("--skip-ai-processing", type=parse_optional_bool)

    article_report_url = article_commands.add_parser("report-url", help="通过 URL 采集文章")
    article_report_url.set_defaults(
        handler="article_report_url",
        command_name="article.report-url",
    )
    add_write_input_argument(article_report_url)
    article_report_url.add_argument("--url")
    article_report_url.add_argument("--category-id")
    article_report_url.add_argument("--is-visible", type=parse_optional_bool)
    article_report_url.add_argument("--skip-ai-processing", type=parse_optional_bool)

    article_update = article_commands.add_parser("update", help="更新文章")
    article_update.set_defaults(handler="article_update", command_name="article.update")
    add_write_input_argument(article_update)
    article_update.add_argument("article_slug", help="文章 slug")
    article_update.add_argument("--title")
    article_update.add_argument("--author")
    article_update.add_argument("--published-at")
    article_update.add_argument("--top-image")
    article_update.add_argument("--content-md")
    article_update.add_argument("--content-trans")
    article_update.add_argument("--is-visible", type=parse_optional_bool)
    article_update.add_argument("--category-id")

    article_delete = article_commands.add_parser("delete", help="删除文章")
    article_delete.set_defaults(handler="article_delete", command_name="article.delete")
    article_delete.add_argument("article_slug", help="文章 slug")

    article_export = article_commands.add_parser("export", help="导出文章 Markdown")
    article_export.set_defaults(handler="article_export", command_name="article.export")
    add_article_export_filters(article_export)

    article_retry = article_commands.add_parser("retry", help="重试文章 AI 处理")
    article_retry.set_defaults(handler="article_retry", command_name="article.retry")
    article_retry.add_argument("article_slug", help="文章 slug")
    article_retry.add_argument("--model-config-id")
    article_retry.add_argument("--prompt-config-id")

    article_retry_translation = article_commands.add_parser(
        "retry-translation",
        help="重试文章翻译",
    )
    article_retry_translation.set_defaults(
        handler="article_retry_translation",
        command_name="article.retry-translation",
    )
    article_retry_translation.add_argument("article_slug", help="文章 slug")
    article_retry_translation.add_argument("--model-config-id")
    article_retry_translation.add_argument("--prompt-config-id")

    article_generate = article_commands.add_parser("generate", help="生成 AI 内容")
    article_generate.set_defaults(
        handler="article_generate",
        command_name="article.generate",
    )
    article_generate.add_argument("article_slug", help="文章 slug")
    article_generate.add_argument(
        "content_type",
        choices=["summary", "key_points", "outline", "quotes"],
    )
    article_generate.add_argument("--model-config-id")
    article_generate.add_argument("--prompt-config-id")

    category = command_parsers.add_parser("category", help="分类相关命令")
    category_commands = category.add_subparsers(dest="category_command", required=True)
    category_list = category_commands.add_parser("list", help="分类列表")
    category_list.set_defaults(handler="category_list", command_name="category.list")

    task = command_parsers.add_parser("task", help="任务相关命令")
    task_commands = task.add_subparsers(dest="task_command", required=True)

    task_list = task_commands.add_parser("list", help="任务列表")
    task_list.set_defaults(handler="task_list", command_name="task.list")
    task_list.add_argument("--page", type=int, default=1)
    task_list.add_argument("--size", type=int, default=20)
    task_list.add_argument("--status")
    task_list.add_argument("--task-type")
    task_list.add_argument("--content-type")
    task_list.add_argument("--article-id")
    task_list.add_argument("--article-title")

    task_get = task_commands.add_parser("get", help="任务详情")
    task_get.set_defaults(handler="task_get", command_name="task.get")
    task_get.add_argument("task_id")

    task_timeline = task_commands.add_parser("timeline", help="任务时间线")
    task_timeline.set_defaults(handler="task_timeline", command_name="task.timeline")
    task_timeline.add_argument("task_id")

    task_retry = task_commands.add_parser("retry", help="重试任务")
    task_retry.set_defaults(handler="task_retry", command_name="task.retry")
    add_write_input_argument(task_retry)
    task_retry.add_argument("--task-id", dest="task_ids", action="append", default=[])
    task_retry.add_argument("--model-config-id")
    task_retry.add_argument("--prompt-config-id")

    task_cancel = task_commands.add_parser("cancel", help="取消任务")
    task_cancel.set_defaults(handler="task_cancel", command_name="task.cancel")
    add_write_input_argument(task_cancel)
    task_cancel.add_argument("--task-id", dest="task_ids", action="append", default=[])

    system = command_parsers.add_parser("system", help="系统检查")
    system_commands = system.add_subparsers(dest="system_command", required=True)
    doctor = system_commands.add_parser("doctor", help="检查系统状态")
    doctor.set_defaults(handler="system_doctor", command_name="system.doctor")

    db = command_parsers.add_parser("db", help="数据库命令")
    db_commands = db.add_subparsers(dest="db_command", required=True)
    migrate = db_commands.add_parser("migrate", help="执行数据库迁移")
    migrate.set_defaults(handler="db_migrate", command_name="db.migrate")

    return parser


def add_write_input_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input", help="从 JSON 文件或 stdin(-) 读取输入")


def add_article_list_filters(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--size", type=int, default=20)
    parser.add_argument("--category-id")
    parser.add_argument("--search")
    parser.add_argument("--source-domain")
    parser.add_argument("--author")
    parser.add_argument("--is-visible", type=parse_optional_bool)
    parser.add_argument("--published-at-start")
    parser.add_argument("--published-at-end")
    parser.add_argument("--created-at-start")
    parser.add_argument("--created-at-end")
    parser.add_argument("--sort-by", default="created_at_desc")


def add_article_export_filters(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--article-slug",
        dest="article_slugs",
        action="append",
        default=None,
        help="可重复传入多个 slug",
    )
    parser.add_argument("--category-id")
    parser.add_argument("--search")
    parser.add_argument("--source-domain")
    parser.add_argument("--author")
    parser.add_argument("--is-visible", type=parse_optional_bool)
    parser.add_argument("--published-at-start")
    parser.add_argument("--published-at-end")
    parser.add_argument("--created-at-start")
    parser.add_argument("--created-at-end")
    parser.add_argument("--public-base-url")


def build_write_payload(args: argparse.Namespace) -> dict[str, Any]:
    base = load_json_input(getattr(args, "input", None))
    handler = getattr(args, "handler")
    if handler == "article_create":
        updates = {
            "title": trim_to_none(args.title),
            "content_md": args.content_md,
            "content_html": args.content_html,
            "source_url": trim_to_none(args.source_url),
            "top_image": trim_to_none(args.top_image),
            "author": trim_to_none(args.author),
            "published_at": trim_to_none(args.published_at),
            "source_domain": trim_to_none(args.source_domain),
            "category_id": trim_to_none(args.category_id),
            "skip_ai_processing": args.skip_ai_processing,
        }
    elif handler == "article_report_url":
        updates = {
            "url": trim_to_none(args.url),
            "category_id": trim_to_none(args.category_id),
            "is_visible": args.is_visible,
            "skip_ai_processing": args.skip_ai_processing,
        }
    elif handler == "article_update":
        updates = {
            "title": args.title,
            "author": args.author,
            "published_at": args.published_at,
            "top_image": args.top_image,
            "content_md": args.content_md,
            "content_trans": args.content_trans,
            "is_visible": args.is_visible,
            "category_id": args.category_id,
        }
    elif handler == "task_retry":
        updates = {
            "task_ids": args.task_ids or None,
            "model_config_id": trim_to_none(args.model_config_id),
            "prompt_config_id": trim_to_none(args.prompt_config_id),
        }
    elif handler == "task_cancel":
        updates = {
            "task_ids": args.task_ids or None,
        }
    else:
        updates = {}
    return merge_payload(base, updates)


def create_adapter(ctx):
    if ctx.mode == "local":
        from app.cli.local_adapter import LocalAdapter

        return LocalAdapter(ctx)
    from app.cli.remote_adapter import RemoteAdapter

    return RemoteAdapter(ctx)


def dispatch(adapter, args) -> Any:
    handler = getattr(adapter, args.handler)
    if args.handler in {"article_create", "article_report_url", "article_update", "task_retry", "task_cancel"}:
        payload = build_write_payload(args)
        return handler(args, payload)
    return handler(args)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    ctx = None
    adapter = None
    try:
        args = parser.parse_args(argv)
        ctx = build_context(args)
        adapter = create_adapter(ctx)
        result = dispatch(adapter, args)
        print_success(ctx, result)
        return 0
    except CLIError as exc:
        print_error(ctx, exc)
        return exc.exit_code
    finally:
        if adapter is not None:
            adapter.close()


if __name__ == "__main__":
    raise SystemExit(main())
