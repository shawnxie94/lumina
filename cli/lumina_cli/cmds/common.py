from __future__ import annotations

from typing import Any, Callable

from ..context import CliContext
from ..output import emit


Handler = Callable[[CliContext, Any], Any]


def run_and_emit(ctx: CliContext, data: Any, *, ok: bool = True) -> int:
    if not ctx.quiet or ctx.output == "json":
        emit(data, output=ctx.output, ok=ok)
    return 0 if ok else 1
