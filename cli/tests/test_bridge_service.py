from __future__ import annotations

import platform
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lumina_cli.bridge_service import BridgeServiceManager, SERVICE_LABEL, SYSTEMD_UNIT


class BridgeServiceTests(unittest.TestCase):
    def test_render_units(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".env").write_text("BRIDGE_HOST=127.0.0.1\nBRIDGE_PORT=8787\n", encoding="utf-8")
            mgr = BridgeServiceManager(root, host="127.0.0.1", port=8787)
            wrapper = mgr.ensure_wrapper()
            self.assertTrue(wrapper.exists())
            self.assertIn("topic_bridge", wrapper.read_text(encoding="utf-8"))

            plist = mgr.render_launch_agent()
            self.assertIn(SERVICE_LABEL, plist)
            self.assertIn("KeepAlive", plist)
            self.assertIn(str(wrapper), plist)

            unit = mgr.render_systemd_unit()
            self.assertIn(SYSTEMD_UNIT.replace('.service',''), unit)  # soft
            self.assertIn("Restart=always", unit)
            self.assertIn(str(wrapper), unit)

    def test_backend_detection(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".env").write_text("x=1\n", encoding="utf-8")
            mgr = BridgeServiceManager(root, host="127.0.0.1", port=8787)
            system = platform.system().lower()
            if system == "darwin":
                self.assertEqual(mgr.backend(), "launchd")
            elif system == "linux":
                self.assertEqual(mgr.backend(), "systemd-user")
            else:
                self.assertEqual(mgr.backend(), "unsupported")


if __name__ == "__main__":
    unittest.main()
