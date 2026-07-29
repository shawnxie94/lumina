from __future__ import annotations

import os
import platform
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from .errors import CliError, DependencyError


SERVICE_LABEL = "com.lumina.bridge"
SYSTEMD_UNIT = "lumina-bridge.service"
LAUNCH_AGENTS_DIR = Path.home() / "Library" / "LaunchAgents"
SYSTEMD_USER_DIR = Path.home() / ".config" / "systemd" / "user"


class BridgeServiceManager:
    """OS-level supervision for Bridge (LaunchAgent / systemd --user)."""

    def __init__(self, root: Path, *, host: str, port: int) -> None:
        self.root = Path(root).expanduser()
        self.host = host
        self.port = int(port)
        self.python_bin = self._detect_python()
        self.wrapper = self.root / "bin" / "lumina-bridge-foreground"
        self.log_file = self.root / ".bridge" / "bridge.log"
        self.env_file = self.root / ".env"
        self.system = platform.system().lower()

    def _detect_python(self) -> str:
        env_bin = os.environ.get("PYTHON_BIN")
        if env_bin and Path(env_bin).exists():
            return env_bin
        for candidate in (shutil.which("python3"), shutil.which("python"), "/usr/bin/python3"):
            if candidate and Path(candidate).exists():
                return candidate
        return "python3"

    def backend(self) -> str:
        if self.system == "darwin":
            return "launchd"
        if self.system == "linux":
            return "systemd-user"
        return "unsupported"

    def unit_path(self) -> Path:
        if self.backend() == "launchd":
            return LAUNCH_AGENTS_DIR / f"{SERVICE_LABEL}.plist"
        if self.backend() == "systemd-user":
            return SYSTEMD_USER_DIR / SYSTEMD_UNIT
        raise CliError(
            f"bridge service not supported on {platform.system()}",
            hint="Use `lumina bridge start --no-service` on this platform",
            error_code="bridge_service_unsupported",
        )

    def installed(self) -> bool:
        try:
            return self.unit_path().exists()
        except CliError:
            return False

    def ensure_wrapper(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "bin").mkdir(parents=True, exist_ok=True)
        (self.root / ".bridge").mkdir(parents=True, exist_ok=True)
        content = f"""#!/usr/bin/env bash
set -euo pipefail
ROOT="{self.root}"
ENV_FILE="$ROOT/.env"
PYTHON_BIN="${{PYTHON_BIN:-{self.python_bin}}}"
export PYTHONUNBUFFERED=1
export PYTHONPATH="$ROOT${{PYTHONPATH:+:$PYTHONPATH}}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
cd "$ROOT"
exec "$PYTHON_BIN" -u -m topic_bridge
"""
        self.wrapper.write_text(content, encoding="utf-8")
        self.wrapper.chmod(0o755)
        return self.wrapper

    def render_launch_agent(self) -> str:
        wrapper = str(self.ensure_wrapper())
        log = str(self.log_file)
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{wrapper}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>{self.root}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>2</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"""

    def render_systemd_unit(self) -> str:
        wrapper = str(self.ensure_wrapper())
        log = str(self.log_file)
        env = str(self.env_file)
        return f"""[Unit]
Description=Lumina Topic Bridge
After=default.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory={self.root}
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH={self.root}
EnvironmentFile=-{env}
ExecStart={wrapper}
Restart=always
RestartSec=2
KillMode=process
StandardOutput=append:{log}
StandardError=append:{log}

[Install]
WantedBy=default.target
"""

    def write_unit(self) -> Path:
        path = self.unit_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        if self.backend() == "launchd":
            path.write_text(self.render_launch_agent(), encoding="utf-8")
            plutil = shutil.which("plutil")
            if plutil:
                proc = subprocess.run([plutil, "-lint", str(path)], capture_output=True, text=True)
                if proc.returncode != 0:
                    raise CliError(
                        "invalid LaunchAgent plist",
                        hint=(proc.stderr or proc.stdout or "").strip() or str(path),
                        error_code="bridge_service_plist_invalid",
                    )
        elif self.backend() == "systemd-user":
            path.write_text(self.render_systemd_unit(), encoding="utf-8")
        return path

    def _uid(self) -> int:
        return os.getuid()

    def _domain(self) -> str:
        return f"gui/{self._uid()}"

    def _service_target(self) -> str:
        return f"{self._domain()}/{SERVICE_LABEL}"

    def _run(self, args: list[str], *, check: bool = False) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, capture_output=True, text=True, check=check)

    def is_loaded(self) -> bool:
        if not self.installed():
            return False
        if self.backend() == "launchd":
            proc = self._run(["launchctl", "print", self._service_target()])
            return proc.returncode == 0
        if self.backend() == "systemd-user":
            if not shutil.which("systemctl"):
                return False
            proc = self._run(["systemctl", "--user", "is-enabled", SYSTEMD_UNIT])
            active = self._run(["systemctl", "--user", "is-active", SYSTEMD_UNIT])
            return proc.returncode == 0 or (active.stdout or "").strip() in {"active", "activating"}
        return False

    def active(self) -> bool:
        if self.backend() == "launchd":
            proc = self._run(["launchctl", "print", self._service_target()])
            if proc.returncode != 0:
                return False
            text = proc.stdout or ""
            if "state = running" in text:
                return True
            if "pid =" in text and "pid = 0" not in text:
                return True
            return False
        if self.backend() == "systemd-user":
            if not shutil.which("systemctl"):
                return False
            proc = self._run(["systemctl", "--user", "is-active", SYSTEMD_UNIT])
            return (proc.stdout or "").strip() == "active"
        return False

    def status(self) -> dict[str, Any]:
        backend = self.backend()
        info: dict[str, Any] = {
            "backend": backend,
            "supported": backend in {"launchd", "systemd-user"},
            "installed": False,
            "loaded": False,
            "active": False,
            "unit_path": None,
            "label": SERVICE_LABEL if backend == "launchd" else SYSTEMD_UNIT,
            "wrapper": str(self.wrapper),
        }
        if backend == "unsupported":
            info["detail"] = f"unsupported platform: {platform.system()}"
            return info
        path = self.unit_path()
        info["unit_path"] = str(path)
        info["installed"] = path.exists()
        if info["installed"]:
            info["loaded"] = self.is_loaded()
            info["active"] = self.active()
        if backend == "systemd-user":
            info["notes"] = [
                "Uses systemd --user unit (session scope).",
                "For boot without login, consider: loginctl enable-linger $USER",
            ]
        elif backend == "launchd":
            info["notes"] = [
                "Uses per-user LaunchAgent with KeepAlive.",
                "Starts at login and restarts on crash.",
            ]
        return info

    def _launchctl_unload(self) -> None:
        path = self.unit_path()
        self._run(["launchctl", "bootout", self._service_target()])
        self._run(["launchctl", "unload", "-w", str(path)])
        time.sleep(0.2)

    def _launchctl_load(self) -> subprocess.CompletedProcess[str]:
        path = self.unit_path()
        self._launchctl_unload()
        # `load -w` is more reliable than bootstrap on some macOS sessions.
        proc = self._run(["launchctl", "load", "-w", str(path)])
        if proc.returncode == 0 or self.is_loaded() or self.active():
            return proc
        time.sleep(0.4)
        proc2 = self._run(["launchctl", "bootstrap", self._domain(), str(path)])
        if proc2.returncode == 0 or self.is_loaded() or self.active():
            return proc2
        time.sleep(0.4)
        return self._run(["launchctl", "load", "-w", str(path)])

    def _launchctl_ensure_running(self) -> None:
        self._run(["launchctl", "enable", self._service_target()])
        if self.active():
            self._run(["launchctl", "kickstart", "-k", self._service_target()])
            return
        kick = self._run(["launchctl", "kickstart", "-k", self._service_target()])
        deadline = time.time() + 3.0
        while time.time() < deadline:
            if self.active():
                return
            time.sleep(0.2)
        load = self._launchctl_load()
        deadline = time.time() + 3.0
        while time.time() < deadline:
            if self.active():
                return
            time.sleep(0.2)
        if self.active():
            return
        hint = (kick.stderr or kick.stdout or load.stderr or load.stdout or "").strip()
        raise CliError(
            "failed to start LaunchAgent",
            hint=hint,
            error_code="bridge_service_start_failed",
        )

    def install(self, *, start: bool = True) -> dict[str, Any]:
        if self.backend() == "unsupported":
            raise CliError(
                f"bridge service not supported on {platform.system()}",
                error_code="bridge_service_unsupported",
            )
        if not self.env_file.exists():
            raise CliError(
                "bridge not installed",
                hint="Run `lumina bridge install --yes` first",
                error_code="bridge_not_installed",
            )
        self.ensure_wrapper()
        path = self.write_unit()
        if self.backend() == "launchd":
            if start:
                load = self._launchctl_load()
                if not (self.is_loaded() or self.active()):
                    raise CliError(
                        "failed to load LaunchAgent",
                        hint=(load.stderr or load.stdout or "").strip(),
                        error_code="bridge_service_load_failed",
                    )
                self._launchctl_ensure_running()
            else:
                self._launchctl_unload()
        elif self.backend() == "systemd-user":
            if not shutil.which("systemctl"):
                raise DependencyError(
                    "systemctl not found",
                    hint="Install systemd user services support, or use `lumina bridge start --no-service`",
                )
            reload = self._run(["systemctl", "--user", "daemon-reload"])
            if reload.returncode != 0:
                raise CliError(
                    "systemctl daemon-reload failed",
                    hint=(reload.stderr or reload.stdout or "").strip(),
                    error_code="bridge_service_load_failed",
                )
            enable = self._run(["systemctl", "--user", "enable", SYSTEMD_UNIT])
            if enable.returncode != 0:
                raise CliError(
                    "systemctl enable failed",
                    hint=(enable.stderr or enable.stdout or "").strip(),
                    error_code="bridge_service_load_failed",
                )
            if start:
                start_proc = self._run(["systemctl", "--user", "restart", SYSTEMD_UNIT])
                if start_proc.returncode != 0:
                    raise CliError(
                        "systemctl start failed",
                        hint=(start_proc.stderr or start_proc.stdout or "").strip(),
                        error_code="bridge_service_start_failed",
                    )
        return {"ok": True, "action": "install-service", "status": self.status(), "unit_path": str(path)}

    def uninstall(self) -> dict[str, Any]:
        if self.backend() == "unsupported":
            return {"ok": True, "action": "uninstall-service", "status": self.status()}
        path = self.unit_path()
        if self.backend() == "launchd":
            self._launchctl_unload()
            self._run(["launchctl", "disable", self._service_target()])
        elif self.backend() == "systemd-user" and shutil.which("systemctl"):
            self._run(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT])
            self._run(["systemctl", "--user", "daemon-reload"])
        if path.exists():
            path.unlink()
        return {"ok": True, "action": "uninstall-service", "status": self.status(), "removed": str(path)}

    def start(self) -> dict[str, Any]:
        if not self.installed():
            raise CliError(
                "bridge service not installed",
                hint="Run `lumina bridge start` (default installs service)",
                error_code="bridge_service_not_installed",
            )
        if self.backend() == "launchd":
            if not self.is_loaded():
                load = self._launchctl_load()
                if not (self.is_loaded() or self.active()):
                    raise CliError(
                        "failed to load LaunchAgent",
                        hint=(load.stderr or load.stdout or "").strip(),
                        error_code="bridge_service_load_failed",
                    )
            self._launchctl_ensure_running()
        elif self.backend() == "systemd-user":
            proc = self._run(["systemctl", "--user", "start", SYSTEMD_UNIT])
            if proc.returncode != 0:
                raise CliError(
                    "systemctl start failed",
                    hint=(proc.stderr or proc.stdout or "").strip(),
                    error_code="bridge_service_start_failed",
                )
        return {"ok": True, "action": "service-start", "status": self.status()}

    def stop(self) -> dict[str, Any]:
        if not self.installed():
            return {"ok": True, "action": "service-stop", "status": self.status(), "detail": "not_installed"}
        if self.backend() == "launchd":
            self._launchctl_unload()
        elif self.backend() == "systemd-user":
            self._run(["systemctl", "--user", "stop", SYSTEMD_UNIT])
        return {"ok": True, "action": "service-stop", "status": self.status()}

    def restart(self) -> dict[str, Any]:
        if self.installed() and self.backend() == "launchd":
            self.stop()
            return self.start()
        if self.installed() and self.backend() == "systemd-user":
            proc = self._run(["systemctl", "--user", "restart", SYSTEMD_UNIT])
            if proc.returncode != 0:
                raise CliError(
                    "systemctl restart failed",
                    hint=(proc.stderr or proc.stdout or "").strip(),
                    error_code="bridge_service_start_failed",
                )
            return {"ok": True, "action": "service-restart", "status": self.status()}
        self.stop()
        return self.start()

    def wait_until(self, predicate, *, timeout_sec: float = 8.0, interval: float = 0.25) -> bool:
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            if predicate():
                return True
            time.sleep(interval)
        return bool(predicate())
