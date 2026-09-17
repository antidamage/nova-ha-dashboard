#!/usr/bin/env python3
"""Rotate the kiosk desktop to match the panel's physical orientation.

The built-in webcam is fixed to the panel, so the room's rotation in its
picture is the panel's rotation in the world. Each reading matches ORB
features against a stored upright reference (keypoints and descriptors only,
never pixels) and rotates the desktop with kscreen-doctor.

Frames live in memory for one reading and are never written, logged or shown.
The browser is used only as a navigation signal over CDP; nothing is captured
through it.

    nova-kiosk-orient.py            run the daemon
    nova-kiosk-orient.py reference  store the upright reference (--force to replace)
    nova-kiosk-orient.py read       one reading, printed, nothing applied

See nova-ha-dashboard/specs/kiosk-display-rotation.md.
"""
from __future__ import annotations

import logging
import sys

# The body lives in the sibling package; this file stays the deployed entry
# point and the systemd unit's ExecStart target. Python puts this directory on
# sys.path, so the package imports without installation.
from nova_kiosk_orient.config import (
    BURST_INTERVAL,
    BURST_SECONDS,
    CAMERA_MATCH,
    CDP,
    FORBIDDEN_NAMES,
    KSCREEN_CODE,
    LOG,
    MIN_INLIERS,
    MIN_INLIER_RATIO,
    OUTPUT,
    POLL_SECONDS,
    REFERENCE,
    ROTATION_FOR_CARDINAL,
    SQUARE_DEGREES,
    STATE,
    STATE_DIR,
    WARMUP_FRAMES,
    backend_url,
    env_float,
)
from nova_kiosk_orient.runtime import (
    BROWSER,
    Browser,
    _NoBrowser,
    apply,
    camera_rules,
    current_output,
    daemon,
    evaluate,
    kscreen,
    last_cardinal,
    self_check,
    take_reference,
    write_state,
)
from nova_kiosk_orient.vision import (
    _clahe,
    _orb,
    features,
    grab_gray,
    load_reference,
    measure,
    read_once,
    resolve_camera,
)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "reference":
        sys.exit(take_reference("--force" in sys.argv))
    if command == "read":
        sys.exit(self_check())
    sys.exit(daemon())
