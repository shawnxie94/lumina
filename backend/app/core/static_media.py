from __future__ import annotations

import mimetypes
from os import PathLike

from starlette.datastructures import Headers
from starlette.responses import FileResponse, Response
from starlette.staticfiles import NotModifiedResponse, StaticFiles
from starlette.types import Scope

MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable"

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/avif", ".avif")


class CachedStaticFiles(StaticFiles):
    def file_response(
        self,
        full_path: PathLike,
        stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        method = scope["method"]
        request_headers = Headers(scope=scope)
        response = FileResponse(
            full_path,
            status_code=status_code,
            stat_result=stat_result,
            method=method,
        )
        self._apply_cache_headers(response)
        if self.is_not_modified(response.headers, request_headers):
            not_modified = NotModifiedResponse(response.headers)
            self._apply_cache_headers(not_modified)
            return not_modified
        return response

    @staticmethod
    def _apply_cache_headers(response: Response) -> None:
        response.headers["Cache-Control"] = MEDIA_CACHE_CONTROL
        response.headers["X-Content-Type-Options"] = "nosniff"
