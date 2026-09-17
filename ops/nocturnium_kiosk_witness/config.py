"""Environment-derived configuration for the kiosk witness.

Moved verbatim from `ops/nocturnium-kiosk-witness.py`; see that entry point.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

LOG = logging.getLogger("kiosk-witness")


def env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


FACE_URL = env_str("NOVA_FACE_URL", "https://nova.tuatara-dory.ts.net/face").rstrip("/")
DASHBOARD_URL = env_str("NOVA_DASHBOARD_URL", "http://127.0.0.1").rstrip("/")
FACE_KEY = env_str("NOVA_FACE_KEY")
WITNESS_KEY = env_str("NOVA_WITNESS_KEY")

# Which camera, in preference order, and how far each one is out of upright.
#
# `name=degrees`, comma separated, most preferred first. The name is matched as
# a case-insensitive substring of the kernel's card name
# (`/sys/class/video4linux/videoN/name`), so it survives the device numbers
# moving about — which they do, every time something is plugged in.
#
# The panel has a Microsoft LifeCam on it, which is mounted upright, and a
# built-in webcam lying on its side. Prefer the LifeCam; fall back to the
# built-in only when the LifeCam is absent, and rotate ONLY the built-in.
#
# Resolved per capture rather than once at startup, so unplugging the LifeCam
# falls back on the next touch instead of at the next restart.
WITNESS_CAMERAS = env_str("WITNESS_CAMERAS", "LifeCam=0,USB2.0 HD=0")

# The built-in camera turns with the panel, so its rotation is not fixed.
# nova-kiosk-orient measures the panel's orientation and records the correction
# for that camera here; when present it replaces the WITNESS_CAMERAS degrees.
# See specs/kiosk-display-rotation.md.
ORIENT_STATE = Path(env_str("WITNESS_ORIENT_STATE", "/var/lib/nova-kiosk-orient/state.json"))

# Names that are never a face camera, whatever the preference list says.
#
# The MS2109 grabber carries the OUTDOOR camera. Selecting it would record
# whoever walks past the front of the house, unattended, forever. Matched by
# NAME as well as by device path, because the path moves.
FORBIDDEN_DEVICES = {
    entry.strip()
    for entry in env_str("WITNESS_FORBIDDEN_DEVICES", "/dev/video4,/dev/video5").split(",")
    if entry.strip()
}
FORBIDDEN_NAMES = [
    entry.strip().lower()
    for entry in env_str("WITNESS_FORBIDDEN_NAMES", "macrosilicon,2109").split(",")
    if entry.strip()
]

CLIP_SECONDS = env_float("WITNESS_CLIP_SECONDS", 1.2)

# Capture format and rate.
#
# NOT cosmetic, and not a default worth trusting: this webcam offers 1280x720 in
# both YUYV and MJPG, and v4l2 picks YUYV, which it can only deliver at 10 fps.
# The service refuses any clip under FACE_CLIP_MIN_FPS (20) with `clip_low_fps`,
# so every witness capture was being thrown away before a face was ever looked
# for. MJPG does the same resolution at 30.
#
# Asking for the format explicitly is the whole fix. Left empty, ffmpeg
# negotiates and negotiates badly.
WITNESS_INPUT_FORMAT = env_str("WITNESS_INPUT_FORMAT", "mjpeg")
WITNESS_FRAMERATE = env_str("WITNESS_FRAMERATE", "30")
WITNESS_VIDEO_SIZE = env_str("WITNESS_VIDEO_SIZE", "1280x720")
IDENTITY_TTL = env_float("KIOSK_IDENTITY_TTL_SECONDS", 30.0)
IDENTIFY_RETRIES = env_int("WITNESS_IDENTIFY_RETRIES", 2)
RETRY_MIN_SECONDS = env_float("WITNESS_RETRY_MIN_SECONDS", 5.0)
POLL_HZ = env_float("WITNESS_POLL_HZ", 1.0)
HTTP_TIMEOUT = env_float("WITNESS_HTTP_TIMEOUT", 20.0)
