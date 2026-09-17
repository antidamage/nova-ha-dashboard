"""Environment-derived configuration for the kiosk orientation daemon.

Moved verbatim from `ops/kiosk/nova-kiosk-orient.py`; see that entry point.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

LOG = logging.getLogger("kiosk-orient")


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


CAMERA_MATCH = os.environ.get("ORIENT_CAMERA", "USB2.0 HD")
FORBIDDEN_NAMES = ("macrosilicon", "2109", "lifecam")
POLL_SECONDS = env_float("ORIENT_POLL_SECONDS", 60.0)
SQUARE_DEGREES = env_float("ORIENT_SQUARE_DEGREES", 15.0)
BURST_INTERVAL = 1.0
BURST_SECONDS = 5.0
WARMUP_FRAMES = 8
MIN_INLIERS = 25
MIN_INLIER_RATIO = 0.25
CDP = os.environ.get("ORIENT_CDP", "http://127.0.0.1:9223")
OUTPUT = os.environ.get("ORIENT_OUTPUT", "")  # empty = the connected panel output

STATE_DIR = Path(os.environ.get("ORIENT_STATE_DIR", "/var/lib/nova-kiosk-orient"))
REFERENCE = STATE_DIR / "reference.npz"
STATE = STATE_DIR / "state.json"

# Room turned clockwise in the frame by c degrees -> kscreen rotation.
ROTATION_FOR_CARDINAL = {0: "normal", 90: "left", 180: "inverted", 270: "right"}
KSCREEN_CODE = {1: "normal", 2: "left", 4: "inverted", 8: "right"}


def backend_url() -> str:
    try:
        for line in Path("~/.config/nova-kiosk/backend.env").expanduser().read_text().splitlines():
            if line.strip().startswith("NOVA_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return "http://127.0.0.1/"
