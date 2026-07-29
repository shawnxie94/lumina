from __future__ import annotations

import json
import uuid
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from . import __version__
from .wiki_scan import list_wiki_topic_keys
from .bootstrap import (
    doctor_report,
    ensure_project,
    install_guidance,
    local_setup_report,
    start_llm_wiki,
)
from .config import BridgeConfig, load_config
from .state import BridgeState, utc_now_iso
from .sync import (
    check_llm_wiki,
    get_writeback_job,
    inspect_llm_wiki_compile,
    project_status,
    run_sync,
    schedule_auto_writeback,
    writeback_topics_from_wiki,
)


class BridgeHandler(BaseHTTPRequestHandler):
    config: BridgeConfig

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        print(f"[bridge] {self.address_string()} {format % args}")

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _authorized(self) -> bool:
        token = self.config.bridge_token
        if not token:
            return True
        header = self.headers.get("Authorization") or ""
        if header == f"Bearer {token}":
            return True
        if (self.headers.get("X-Bridge-Token") or "") == token:
            return True
        return False

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self._authorized():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        path = urlparse(self.path).path
        if path == "/health":
            self._send(
                200,
                {
                    "ok": True,
                    "version": __version__,
                    "checked_at": utc_now_iso(),
                },
            )
            return
        if path == "/wiki/topics":
            keys = list_wiki_topic_keys(self.config.wiki_dir)
            self._send(
                200,
                {
                    "ok": True,
                    "keys": keys,
                    "count": len(keys),
                    "kinds": ["entity", "concept"],
                    "wiki_dir": str(self.config.wiki_dir),
                },
            )
            return
        if path == "/status":
            state = BridgeState.load(self.config.state_path)
            llm = check_llm_wiki(self.config)
            project = project_status(self.config)
            setup = local_setup_report(self.config)
            self._send(
                200,
                {
                    "ok": True,
                    "bridge": {
                        "ok": True,
                        "status": "online",
                        "version": __version__,
                        "detail": None,
                        "checked_at": utc_now_iso(),
                    },
                    "llm_wiki": {
                        **llm,
                        "install": setup["llm_wiki"].get("install"),
                    },
                    "project": project,
                    "setup": {
                        "actions": setup.get("actions") or [],
                        "commands": setup.get("commands") or {},
                        "notes": setup.get("notes") or [],
                    },
                    "cursor": {
                        "last_article_sync_at": state.last_article_sync_at,
                        "last_writeback_at": state.last_writeback_at,
                    },
                    "doctor": {
                        "ok": bool((setup.get("bridge") or {}).get("ok", True))
                        and bool(project.get("ok") or project.get("exists"))
                        and bool(llm.get("ok") or ((llm.get("install") or {}).get("installed"))),
                        "endpoint": "/doctor",
                        "cli": "lumina doctor",
                    },
                },
            )
            return
        if path == "/setup":
            report = local_setup_report(self.config)
            report["bridge"]["version"] = __version__
            self._send(200, report)
            return
        if path == "/writeback":
            self._send(
                200,
                {
                    "ok": True,
                    "job": get_writeback_job(),
                    "compile_status": inspect_llm_wiki_compile(self.config),
                },
            )
            return
        if path == "/doctor":
            report = doctor_report(self.config)
            if isinstance(report.get("health"), dict) and isinstance(report["health"].get("bridge"), dict):
                report["health"]["bridge"]["version"] = __version__
            self._send(200, report)
            return
        self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        path = urlparse(self.path).path
        payload = self._read_json()
        if path == "/sync":
            try:
                mode = str(payload.get("mode") or "").strip().lower() or None
                rebuild = bool(payload.get("rebuild") or mode == "full" and payload.get("reset") is True)
                # explicit rebuild flag preferred; `mode=full` alone means full export without wipe
                if "rebuild" in payload:
                    rebuild = bool(payload.get("rebuild"))
                article_id = payload.get("article_id")
                dry_run = bool(payload.get("dry_run"))
                result = run_sync(
                    self.config,
                    mode=mode,
                    rebuild=rebuild,
                    article_id=str(article_id) if article_id else None,
                    dry_run=dry_run,
                )
                self._send(200, result)
            except Exception as exc:
                traceback.print_exc()
                self._send(
                    500,
                    {
                        "accepted": False,
                        "status": "failed",
                        "error": str(exc),
                    },
                )
            return
        if path == "/setup/init-project":
            try:
                result = ensure_project(self.config, payload.get("project_path"))
                self._send(200, result)
            except Exception as exc:
                traceback.print_exc()
                self._send(500, {"ok": False, "error": str(exc)})
            return
        if path == "/setup/start-llm-wiki":
            try:
                result = start_llm_wiki(self.config)
                status = 200 if result.get("ok") or result.get("already_running") else 500
                self._send(status, result)
            except Exception as exc:
                traceback.print_exc()
                self._send(500, {"ok": False, "error": str(exc)})
            return
        if path == "/writeback":
            try:
                force = bool(payload.get("force"))
                wait = bool(payload.get("wait"))
                if wait:
                    # schedule waiter then return current job snapshot
                    run_id = f"writeback_{uuid.uuid4().hex[:12]}"
                    scheduled = schedule_auto_writeback(self.config, run_id=run_id)
                    self._send(200, {"accepted": True, "mode": "wait", **scheduled})
                    return
                result = writeback_topics_from_wiki(self.config)
                if force and result.get("status") == "awaiting_compile":
                    run_id = f"writeback_{uuid.uuid4().hex[:12]}"
                    scheduled = schedule_auto_writeback(self.config, run_id=run_id)
                    result = {**result, "auto_writeback": scheduled}
                self._send(200, result)
            except Exception as exc:
                traceback.print_exc()
                self._send(500, {"accepted": False, "status": "failed", "error": str(exc)})
            return
        if path == "/setup/install-guidance":
            try:
                result = install_guidance(self.config)
                self._send(200, result)
            except Exception as exc:
                traceback.print_exc()
                self._send(500, {"ok": False, "error": str(exc)})
            return
        self._send(404, {"ok": False, "error": "not_found"})


def main(argv: list[str] | None = None) -> int:
    config = load_config()
    BridgeHandler.config = config
    server = ThreadingHTTPServer((config.host, config.port), BridgeHandler)
    print(
        f"[bridge] listening on http://{config.host}:{config.port} "
        f"project={config.project_path}"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] shutting down")
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
