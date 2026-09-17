"""Camera selection and clip capture.

Moved verbatim from `ops/nocturnium-kiosk-witness.py`; see that entry point.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from .config import (
    CLIP_SECONDS,
    FORBIDDEN_DEVICES,
    FORBIDDEN_NAMES,
    LOG,
    ORIENT_STATE,
    WITNESS_CAMERAS,
    WITNESS_FRAMERATE,
    WITNESS_INPUT_FORMAT,
    WITNESS_VIDEO_SIZE,
)

# --------------------------------------------------------------------------
# Capture and identify
# --------------------------------------------------------------------------


def _camera_name(node: str) -> str:
    try:
        return Path(f"/sys/class/video4linux/{node}/name").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def camera_preferences() -> list[tuple[str, int]]:
    """`[(name substring, degrees)]`, most preferred first."""
    out: list[tuple[str, int]] = []
    for entry in WITNESS_CAMERAS.split(","):
        entry = entry.strip()
        if not entry:
            continue
        name, _, degrees = entry.partition("=")
        try:
            turn = int(degrees) % 360 if degrees.strip() else 0
        except ValueError:
            turn = 0
        if name.strip():
            out.append((name.strip().lower(), turn))
    return out


def resolve_camera() -> tuple[str, int, str] | None:
    """Pick the device to capture from: `(path, rotation, card name)`.

    Walks the preference list in order and takes the LOWEST-numbered node whose
    card name matches — a single camera presents several nodes and only the
    first is the image; the rest are metadata, and on the built-in one of them
    is an infrared sensor with its own name.
    """
    try:
        nodes = sorted(
            (n for n in os.listdir("/sys/class/video4linux") if n.startswith("video")),
            key=lambda n: int(n[5:] or 0),
        )
    except OSError as error:
        LOG.warning("could not enumerate cameras: %s", error)
        return None

    known = [(n, f"/dev/{n}", _camera_name(n)) for n in nodes]
    for wanted, rotation in camera_preferences():
        for node, path, name in known:
            if wanted not in name.lower():
                continue
            if path in FORBIDDEN_DEVICES or any(bad in name.lower() for bad in FORBIDDEN_NAMES):
                LOG.warning("refusing %s (%s): on the forbidden list", path, name)
                continue
            return path, orient_override(name, rotation), name
    return None


def orient_override(name: str, rotation: int) -> int:
    """The measured correction for the camera that turns with the panel, else `rotation`."""
    try:
        state = json.loads(ORIENT_STATE.read_text(encoding="utf-8"))
        if str(state.get("camera", "")).lower() in name.lower() and state.get("camera"):
            return int(state["cameraCorrection"]) % 360
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return rotation


def capture_clip(destination: Path, device: str, rotate: int) -> bool:
    """Record a short clip. Returns False rather than raising on any failure."""
    # ffmpeg's transpose: 1 is 90 clockwise, 2 is 90 counter-clockwise.
    rotation = {
        90: ["-vf", "transpose=1"],
        180: ["-vf", "transpose=1,transpose=1"],
        270: ["-vf", "transpose=2"],
    }.get(rotate, [])
    source: list[str] = ["-f", "v4l2"]
    if WITNESS_INPUT_FORMAT:
        source += ["-input_format", WITNESS_INPUT_FORMAT]
    if WITNESS_FRAMERATE:
        source += ["-framerate", WITNESS_FRAMERATE]
    if WITNESS_VIDEO_SIZE:
        source += ["-video_size", WITNESS_VIDEO_SIZE]
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *source,
        "-i",
        device,
        "-t",
        f"{CLIP_SECONDS:.2f}",
        *rotation,
        "-an",
        str(destination),
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=CLIP_SECONDS + 15)
    except (OSError, subprocess.TimeoutExpired) as error:
        LOG.warning("capture failed: %s", error)
        return False
    if result.returncode != 0:
        LOG.warning("ffmpeg exited %s: %s", result.returncode, result.stderr.decode("utf-8", "replace")[:300])
        return False
    return destination.is_file() and destination.stat().st_size > 0
