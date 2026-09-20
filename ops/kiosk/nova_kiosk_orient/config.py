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
# How far the view may drift from the retained frame before we treat the panel
# as having been turned and go and ask DeepSeek which way it now faces.
SQUARE_DEGREES = env_float("ORIENT_SQUARE_DEGREES", 15.0)
# DeepSeek is also asked on a standing interval, whatever the local match says,
# so a quietly drifted or blind matcher gets corrected. Any change-triggered
# call resets the clock.
VLM_INTERVAL_SECONDS = env_float("ORIENT_VLM_INTERVAL_SECONDS", 3600.0)
# A dark room is where this went wrong: the 06:07 reading that put the panel
# upside down was taken with the lights off, and matching noise against noise
# is what made it *confident*. So an unlit frame is not judged at all unless a
# person asked for it. Measured 2026-09-20 in daylight: mean 83.4 and 79.7.
# Every reading logs its brightness, so this can be tuned from real nights.
DARK_MEAN = env_float("ORIENT_DARK_MEAN", 25.0)
SETTLE_INTERVAL = 1.0
SETTLE_SECONDS = 5.0
WARMUP_FRAMES = 8
MIN_INLIERS = 25
MIN_INLIER_RATIO = 0.25
CDP = os.environ.get("ORIENT_CDP", "http://127.0.0.1:9223")
OUTPUT = os.environ.get("ORIENT_OUTPUT", "")  # empty = the connected panel output

STATE_DIR = Path(os.environ.get("ORIENT_STATE_DIR", "/var/lib/nova-kiosk-orient"))
STATE = STATE_DIR / "state.json"
# The one retained frame: the picture that produced the last confirmed
# rotation, and its ORB features. Both are replaced together, so no older
# frame ever survives. See specs/kiosk-display-rotation.md.
LAST_IMAGE = STATE_DIR / "last.jpg"
LAST_FEATURES = STATE_DIR / "last.npz"
# Superseded 2026-09-20 by the rolling retained frame above. Still named so a
# stale file from the pinned-reference design can be cleared on upgrade.
REFERENCE = STATE_DIR / "reference.npz"

# DeepSeek decides absolute orientation; the local match only detects change.
DEEPSEEK_URL = os.environ.get("ORIENT_DEEPSEEK_URL", "https://api.deepseek.com/v1/chat/completions")
DEEPSEEK_MODEL = os.environ.get("ORIENT_DEEPSEEK_MODEL", "deepseek-v4-flash-vision-exp")
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_TIMEOUT = env_float("ORIENT_DEEPSEEK_TIMEOUT", 30.0)
# deepseek-flash is a reasoning model: it spends completion tokens on
# `reasoning_content` before it writes a word of `content`. Measured
# 2026-09-20, a 16-token budget came back with an empty answer and
# `finish_reason: length` every time. The reply we want is one word; the
# budget is for the thinking in front of it.
DEEPSEEK_MAX_TOKENS = int(env_float("ORIENT_DEEPSEEK_MAX_TOKENS", 900))
DEEPSEEK_ATTEMPTS = 3
DEEPSEEK_RETRY_SLEEP = 2.0

# No frame containing a person is ever sent off the machine (Adeline,
# 2026-09-20). YuNet finds faces; the HOG pedestrian detector catches a body
# with its face turned away. Both run on all four rotations, because the
# camera itself may be mounted sideways.
FACE_MODEL = STATE_DIR / "yunet.onnx"
FACE_SCORE = env_float("ORIENT_FACE_SCORE", 0.6)
# The HOG pedestrian detector reports every candidate it scored above zero, and
# on furniture that is a steady trickle of nonsense. Measured 2026-09-20: an
# empty living room peaked at 0.43, while a person really in this camera's
# frame scored 0.76 and their face 0.69. A gate that fires on 0.12 never stops
# firing, and a gate that never clears silently disables the vision model.
BODY_WEIGHT = env_float("ORIENT_BODY_WEIGHT", 0.6)
PEOPLE_GATE = os.environ.get("ORIENT_PEOPLE_GATE", "1") not in ("0", "false", "no")

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
