#!/usr/bin/env python3
"""Rotate the kiosk desktop to match the panel's physical orientation.

The built-in webcam is fixed to the panel, so the room's rotation in its
picture is the panel's rotation in the world. The panel is an ASUS Zen AiO
desktop with no accelerometer and no IIO bus, so the camera is the only
orientation sensor there is.

Two jobs, deliberately split (2026-09-20). An ORB match against the one
retained frame answers *has the view moved?*, which local feature matching is
good at. DeepSeek answers *which way is this frame facing?*, which nothing
local does reliably — measured on this camera, YuNet scored the wrong rotation
higher than the right one, and the room yields too few Hough lines for a
structural tilt. DeepSeek is also asked hourly regardless of the local match.

One frame is kept, at /var/lib/nova-kiosk-orient/last.jpg, replaced whenever a
new orientation is confirmed so no older frame survives. No frame containing a
person is ever sent off the machine. The browser is used only as a navigation
signal over CDP; nothing is captured through it.

    nova-kiosk-orient.py            run the daemon
    nova-kiosk-orient.py seed       establish the retained frame from DeepSeek now
    nova-kiosk-orient.py check      one full pass, printed, nothing applied

See nova-ha-dashboard/specs/kiosk-display-rotation.md.
"""
from __future__ import annotations

import logging
import sys

# The body lives in the sibling package; this file stays the deployed entry
# point and the systemd unit's ExecStart target. Python puts this directory on
# sys.path, so the package imports without installation.
from nova_kiosk_orient.config import (
    CAMERA_MATCH,
    CDP,
    FORBIDDEN_NAMES,
    KSCREEN_CODE,
    LOG,
    LAST_FEATURES,
    LAST_IMAGE,
    MIN_INLIERS,
    MIN_INLIER_RATIO,
    OUTPUT,
    POLL_SECONDS,
    ROTATION_FOR_CARDINAL,
    SETTLE_INTERVAL,
    SETTLE_SECONDS,
    SQUARE_DEGREES,
    STATE,
    STATE_DIR,
    VLM_INTERVAL_SECONDS,
    WARMUP_FRAMES,
    backend_url,
    env_float,
)
from nova_kiosk_orient.loop import (
    check,
    daemon,
    evaluate,
    local_cardinal,
    seed,
    settle,
    turn_from_retained,
)
from nova_kiosk_orient.orientation import ask_cardinal
from nova_kiosk_orient.people import person_in
from nova_kiosk_orient.runtime import (
    BROWSER,
    Browser,
    _NoBrowser,
    apply,
    camera_rules,
    current_output,
    kscreen,
    last_cardinal,
    retained_cardinal,
    vlm_asked_at,
    write_state,
)
from nova_kiosk_orient.vision import (
    _clahe,
    _orb,
    features,
    grab_frame,
    grab_gray,
    load_retained,
    measure,
    read_once,
    resolve_camera,
    save_retained,
)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "seed":
        sys.exit(seed())
    if command == "check":
        sys.exit(check())
    sys.exit(daemon())
