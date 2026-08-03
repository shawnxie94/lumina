from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from .config import BridgeConfig, DEFAULT_BRIDGE_ROOT, DEFAULT_HOME, Profile, Project
from .errors import CliError, DependencyError
from .http import HttpClient
from .bridge_service import BridgeServiceManager


REPO_OWNER = os.environ.get("LUMINA_REPO_OWNER", "shawnxie94")
REPO_NAME = os.environ.get("LUMINA_REPO_NAME", "lumina")
REPO_REF = os.environ.get("LUMINA_REPO_REF", "main")
INSTALL_SCRIPT_URL = (
    f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{REPO_REF}/scripts/install-topic-bridge.sh"
)


class BridgeRuntime:
    def __init__(self, profile: Profile, project: Project | None = None) -> None:
        self.profile = profile
        self.project = project
        self.root = Path(profile.bridge.root or DEFAULT_BRIDGE_ROOT).expanduser()
        self.bin = self.root / "bin" / "lumina-bridge"
        self.env_file = self.root / ".env"
        self.pid_file = self.root / ".bridge" / "bridge.pid"
        self.log_file = self.root / ".bridge" / "bridge.log"

    def installed(self) -> bool:
        return self.bin.exists() and self.env_file.exists()

    def client(self) -> HttpClient:
        bridge = self.profile.bridge
        return HttpClient(
            base_url=f"http://{bridge.host}:{bridge.port}",
            token=bridge.token,
            timeout_sec=20,
            bearer=True,
            token_header="X-Bridge-Token",
        )

    def health(self) -> dict[str, Any]:
        try:
            resp = self.client().get("/health")
            data = resp.data if isinstance(resp.data, dict) else {"raw": resp.data}
            data["online"] = True
            return data
        except Exception as exc:  # noqa: BLE001
            return {"online": False, "ok": False, "error": str(exc)}

    def status(self) -> dict[str, Any]:
        base = {
            "installed": self.installed(),
            "root": str(self.root),
            "bin": str(self.bin),
            "url": f"http://{self.profile.bridge.host}:{self.profile.bridge.port}",
            "log": str(self.log_file),
            "pid_file": str(self.pid_file),
        }
        if not self.installed():
            return {**base, "online": False, "status": "not_installed", "service": self.service_status()}
        health = self.health()
        online = bool(health.get("online"))
        service = self.service_status()
        if service.get("installed") and (service.get("loaded") or service.get("active")):
            mode = "service"
        elif online:
            mode = "nohup"
        else:
            mode = "stopped"
        detail: dict[str, Any] = {
            **base,
            "online": online,
            "status": "online" if online else "offline",
            "mode": mode,
            "health": health,
            "service": service,
        }
        if online:
            try:
                resp = self.client().get("/status")
                if isinstance(resp.data, dict):
                    detail["payload"] = resp.data
            except Exception as exc:  # noqa: BLE001
                detail["status_error"] = str(exc)
        return detail

    def setup(self) -> dict[str, Any]:
        try:
            resp = self.client().get("/setup")
            return resp.data if isinstance(resp.data, dict) else {"raw": resp.data}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc), "online": False}

    def service(self) -> BridgeServiceManager:
        return BridgeServiceManager(
            self.root,
            host=self.profile.bridge.host,
            port=self.profile.bridge.port,
        )

    def service_status(self) -> dict[str, Any]:
        return self.service().status()

    def _free_bridge_port(self) -> None:
        """Best-effort stop of any bridge listener before mode switches."""
        try:
            self._run_manager(["stop"])
        except Exception:  # noqa: BLE001
            pass
        # If health still online, try killing pid file process.
        try:
            if self.pid_file.exists():
                pid = int(self.pid_file.read_text(encoding="utf-8").strip() or "0")
                if pid > 0:
                    os.kill(pid, 15)
        except Exception:  # noqa: BLE001
            pass
        deadline = time.time() + 2.0
        while time.time() < deadline:
            if not self.health().get("online"):
                break
            time.sleep(0.1)

    def logs(self, lines: int = 100) -> str:
        if not self.log_file.exists():
            return f"(no log file: {self.log_file})"
        content = self.log_file.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(content[-max(1, lines) :])

    def install(
        self,
        *,
        force: bool = False,
        yes: bool = False,
        start: bool = True,
        init_project: bool = True,
        source_script: Path | None = None,
    ) -> dict[str, Any]:
        script = self._resolve_install_script(source_script)
        args = [
            "bash",
            str(script),
            "--home",
            str(self.root),
            "--host",
            self.profile.bridge.host,
            "--port",
            str(self.profile.bridge.port),
            "--lumina-url",
            self.profile.lumina.base_url,
            "--internal-token",
            self.profile.lumina.token or "",
            "--bridge-token",
            self.profile.bridge.token or "",
            "--llm-wiki-url",
            str((self.profile and self.project and None) or self._provider_api_url()),
            "--project-path",
            self.project.path if self.project else str(Path.home() / ".lumina" / "knowledge" / "Lumina-Knowledge"),
            "--project-name",
            self.project.name if self.project else "Lumina-Knowledge",
        ]
        if yes:
            args.append("--yes")
        if force:
            args.append("--force")
        if not start:
            args.append("--no-start")
        if not init_project:
            args.append("--no-init-project")

        proc = subprocess.run(args, capture_output=True, text=True)
        if proc.returncode != 0:
            raise DependencyError(
                "bridge install failed",
                hint=(proc.stderr or proc.stdout or "see install script output")[-1000:],
            )
        start_result = None
        if start:
            # Installer may have started bare nohup; promote to supervised service by default.
            try:
                start_result = self.start(use_service=True)
            except CliError:
                # Keep package install success even if service promotion fails; surface status.
                start_result = {
                    "ok": False,
                    "error": "service start failed after install",
                    "status": self.status(),
                    "service": self.service_status(),
                }
        return {
            "ok": True,
            "root": str(self.root),
            "stdout": proc.stdout[-2000:],
            "started": start_result,
            "status": self.status(),
            "service": self.service_status(),
        }

    def start(self, *, use_service: bool = True) -> dict[str, Any]:
        """Start Bridge.

        Default path installs/uses OS supervision (LaunchAgent / systemd --user).
        Pass use_service=False for one-shot nohup only.
        """
        self._require_installed()
        self._sync_env()
        svc = self.service()

        if use_service and svc.backend() != "unsupported":
            # Ensure bare nohup / previous listener is not holding the port.
            self._free_bridge_port()
            if not svc.installed():
                result = svc.install(start=True)
            else:
                result = svc.start()
            online = self._wait_online()
            status = self.status()
            if not online:
                raise CliError(
                    "bridge service start failed",
                    hint=f"See log: {self.log_file}",
                    error_code="bridge_start_failed",
                )
            return {
                "ok": True,
                "mode": "service",
                "result": result,
                "status": status,
                "service": svc.status(),
            }

        # Explicit nohup path, or unsupported platform fallback.
        if not use_service and svc.installed():
            # User asked for nohup; disable supervised unit so KeepAlive does not fight us.
            try:
                svc.stop()
            except Exception:  # noqa: BLE001
                pass
            self._free_bridge_port()

        if use_service and svc.backend() == "unsupported":
            # Still try nohup, but report fallback.
            result = self._run_manager(["start"])
            status = self.status()
            if not status.get("online"):
                raise CliError(
                    "bridge start failed",
                    hint=f"See log: {self.log_file}",
                    error_code="bridge_start_failed",
                )
            return {
                "ok": True,
                "mode": "nohup",
                "fallback": "service_unsupported",
                "result": result,
                "status": status,
                "service": svc.status(),
            }

        result = self._run_manager(["start"])
        status = self.status()
        if not status.get("online"):
            raise CliError(
                "bridge start failed",
                hint=f"See log: {self.log_file}",
                error_code="bridge_start_failed",
            )
        return {
            "ok": True,
            "mode": "nohup",
            "result": result,
            "status": status,
            "service": svc.status(),
        }

    def stop(self, *, use_service: bool = True, disable_service: bool = False) -> dict[str, Any]:
        """Stop Bridge.

        Default: unload/stop supervised service if present, then clear nohup pid.
        disable_service=True also removes the OS unit (no auto-start later).
        use_service=False only targets nohup/pid process.
        """
        if not self.installed():
            return {"ok": True, "status": "not_installed"}

        svc = self.service()
        service_result = None
        if disable_service:
            service_result = svc.uninstall()
        elif use_service and svc.installed():
            # Unload/stop supervised unit so KeepAlive does not revive process.
            service_result = svc.stop()

        result = None
        try:
            result = self._run_manager(["stop"])
        except Exception as exc:  # noqa: BLE001
            result = {"ok": False, "error": str(exc)}

        return {
            "ok": True,
            "mode": "service" if (service_result is not None and not disable_service) else ("disabled" if disable_service else "nohup"),
            "result": result,
            "service_result": service_result,
            "status": self.status(),
            "service": svc.status(),
        }

    def restart(self, *, use_service: bool = True) -> dict[str, Any]:
        self._require_installed()
        self._sync_env()
        if use_service:
            # stop keeps unit installed; start ensures service mode
            self.stop(use_service=True, disable_service=False)
            return self.start(use_service=True)
        self.stop(use_service=False, disable_service=False)
        return self.start(use_service=False)

    def install_service(self, *, start: bool = True) -> dict[str, Any]:
        self._require_installed()
        self._sync_env()
        # Stop bare nohup instance first to free the port for supervised process.
        try:
            self._run_manager(["stop"])
        except Exception:  # noqa: BLE001
            pass
        result = self.service().install(start=start)
        if start and not self._wait_online():
            raise CliError(
                "bridge service installed but health check failed",
                hint=f"See log: {self.log_file}; try `lumina bridge logs`",
                error_code="bridge_service_start_failed",
            )
        return {
            "ok": True,
            **result,
            "bridge": self.status(),
        }

    def uninstall_service(self) -> dict[str, Any]:
        svc = self.service()
        result = svc.uninstall()
        # Also stop any leftover nohup process.
        if self.installed():
            try:
                self._run_manager(["stop"])
            except Exception:  # noqa: BLE001
                pass
        return {"ok": True, **result, "bridge": self.status()}

    def _wait_online(self, timeout_sec: float = 10.0) -> bool:
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            if self.health().get("online"):
                return True
            time.sleep(0.25)
        return bool(self.health().get("online"))

    def serve(self) -> int:
        """Foreground serve using package under install root or repo checkout."""
        self._require_installed()
        self._sync_env()
        env = os.environ.copy()
        env["PYTHONPATH"] = str(self.root) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        # Load .env into process
        for line in self.env_file.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.strip().startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            env[key.strip()] = val.strip()
        proc = subprocess.run([os.environ.get("PYTHON_BIN", "python3"), "-u", "-m", "topic_bridge"], cwd=str(self.root), env=env)
        return proc.returncode

    def sync(
        self,
        *,
        mode: str | None = None,
        article_id: str | None = None,
        dry_run: bool = False,
        rebuild: bool = False,
        local_only: bool = False,
    ) -> dict[str, Any]:
        if not self.health().get("online"):
            if self.profile.bridge.autostart:
                self.start()
            else:
                raise CliError("bridge offline", hint="Run `lumina bridge start` or `lumina up`")
        body: dict[str, Any] = {}
        if mode:
            body["mode"] = mode
        if article_id:
            body["article_id"] = article_id
        if dry_run:
            body["dry_run"] = True
        if rebuild:
            body["rebuild"] = True
            body["mode"] = body.get("mode") or "full"
        if local_only:
            body["local_only"] = True
        resp = self.client().post("/sync", json_body=body or {})
        data = resp.data if isinstance(resp.data, dict) else {"raw": resp.data}
        return data

    def audit(self) -> dict[str, Any]:
        if not self.health().get("online"):
            if self.profile.bridge.autostart:
                self.start()
            else:
                raise CliError("bridge offline", hint="Run `lumina bridge start` or `lumina up`")
        resp = self.client().get("/audit")
        return resp.data if isinstance(resp.data, dict) else {"raw": resp.data}

    def init_project(self, project_path: str | None = None) -> dict[str, Any]:
        if self.health().get("online"):
            resp = self.client().post("/setup/init-project", json_body={"project_path": project_path} if project_path else {})
            return resp.data if isinstance(resp.data, dict) else {"raw": resp.data}
        self._require_installed()
        result = self._run_manager(["init-project"])
        return {"ok": True, "result": result}

    def doctor(self) -> dict[str, Any]:
        checks: list[dict[str, Any]] = []
        installed = self.installed()
        checks.append({"name": "bridge_installed", "ok": installed, "detail": str(self.root)})
        if not installed:
            return {
                "ok": False,
                "checks": checks,
                "hint": "Run `lumina bridge install --yes`",
            }
        online = bool(self.health().get("online"))
        checks.append({"name": "bridge_online", "ok": online, "detail": f"http://{self.profile.bridge.host}:{self.profile.bridge.port}"})
        svc = self.service_status()
        service_ok = True
        if svc.get("supported") and svc.get("installed"):
            service_ok = bool(svc.get("loaded") or svc.get("active") or online)
        checks.append({"name": "bridge_service", "ok": service_ok, "detail": svc})
        setup = self.setup() if online else {}
        if online and isinstance(setup, dict):
            llm = setup.get("llm_wiki") or {}
            project = setup.get("project") or {}
            checks.append({"name": "provider_online", "ok": bool(llm.get("ok") or llm.get("online")), "detail": llm})
            checks.append({"name": "project_ready", "ok": bool(project.get("ok") or project.get("exists")), "detail": project})
        return {
            "ok": all(c.get("ok") for c in checks),
            "checks": checks,
            "setup": setup,
            "log": str(self.log_file),
        }

    def _require_installed(self) -> None:
        if not self.installed():
            raise DependencyError(
                "bridge is not installed",
                hint="Run `lumina bridge install --yes`",
            )

    def _run_manager(self, args: list[str]) -> str:
        proc = subprocess.run([str(self.bin), *args], capture_output=True, text=True)
        out = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        if proc.returncode != 0:
            raise CliError(
                f"lumina-bridge {' '.join(args)} failed",
                hint=out[-1000:] or f"see {self.log_file}",
            )
        return out.strip()

    def _provider_api_url(self) -> str:
        # default llm_wiki health endpoint host
        return "http://127.0.0.1:19828"

    def _sync_env(self) -> None:
        """Keep installed bridge .env aligned with active profile/project."""
        if not self.env_file.exists():
            return
        values = {
            "BRIDGE_HOST": self.profile.bridge.host,
            "BRIDGE_PORT": str(self.profile.bridge.port),
            "BRIDGE_TOKEN": self.profile.bridge.token or "",
            "LUMINA_BASE_URL": self.profile.lumina.base_url,
            "LUMINA_INTERNAL_TOKEN": self.profile.lumina.token or "",
        }
        if self.project:
            values["LLM_WIKI_PROJECT_PATH"] = str(Path(self.project.path).expanduser())
            values["LLM_WIKI_PROJECT_NAME"] = self.project.name
            # preserve existing wiki url if present; default otherwise
        existing: dict[str, str] = {}
        for line in self.env_file.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.strip().startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            existing[k.strip()] = v
        existing.update(values)
        if "LLM_WIKI_API_URL" not in existing:
            existing["LLM_WIKI_API_URL"] = self._provider_api_url()
        if "RAW_SUBDIR" not in existing:
            existing["RAW_SUBDIR"] = "raw/sources/lumina"
        if "STATE_PATH" not in existing:
            existing["STATE_PATH"] = ".bridge/state.json"
        body = "\n".join(f"{k}={existing[k]}" for k in sorted(existing.keys())) + "\n"
        self.env_file.write_text(body, encoding="utf-8")

    def _resolve_install_script(self, source_script: Path | None) -> Path:
        if source_script and source_script.exists():
            return source_script
        # Prefer monorepo local script
        here = Path(__file__).resolve()
        candidates = [
            here.parents[2] / "scripts" / "install-topic-bridge.sh",
            here.parents[3] / "scripts" / "install-topic-bridge.sh" if len(here.parents) > 3 else None,
            Path.cwd() / "scripts" / "install-topic-bridge.sh",
            DEFAULT_HOME / "bin" / "install-topic-bridge.sh",
        ]
        for item in candidates:
            if item and item.exists():
                return item
        # Download remote installer
        cache = DEFAULT_HOME / "cache"
        cache.mkdir(parents=True, exist_ok=True)
        target = cache / "install-topic-bridge.sh"
        try:
            with urlopen(INSTALL_SCRIPT_URL, timeout=30) as resp:
                target.write_bytes(resp.read())
            target.chmod(0o755)
            return target
        except Exception as exc:  # noqa: BLE001
            raise DependencyError(
                "unable to locate bridge installer",
                hint=f"Provide local scripts/install-topic-bridge.sh or network access ({exc})",
            ) from exc
