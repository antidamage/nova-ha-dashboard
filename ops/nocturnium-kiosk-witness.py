#!/usr/bin/env python3
"""Kiosk witness — who is standing at the wall panel.

Runs on the kiosk host as a systemd unit. When somebody touches the panel it
captures a short clip from the built-in webcam, asks the face service who it
is, and posts the answer to the dashboard. Control changes are then attributed
to that person for as long as the session lasts.

`specs/kiosk-attribution.md` owns the design. Three things about it matter more
than the code:

  * **Sessions, not a debounce.** The FIRST touch of a visit costs a capture,
    an upload and a GPU inference. Every touch within IDENTITY_TTL costs a bare
    ping instead. Someone changing five things over a minute is identified
    once, not three times.

  * **Consent scope.** `/identify` answers `null` for a face it does not know,
    never a nearest neighbour, so an unenrolled person is recorded as
    unidentified. There is no path here to identifying anyone who has not
    enrolled, and none should be added.

  * **It records; it does not refuse.** Nothing here can affect the kiosk or a
    control. Every failure is logged and dropped, because a house whose lights
    stop working when a camera daemon crashes is worse than one with an
    unattributed log line.

Not in this repo, and not to be added: any host address, any key, any household
name. Everything host-specific is environment.
"""

from __future__ import annotations

# The body lives in the sibling package; this file stays the deployed entry
# point and the systemd unit's ExecStart target. Python puts this directory on
# sys.path, so the package imports without installation.
from nocturnium_kiosk_witness.activity import Activity
from nocturnium_kiosk_witness.camera import (
    _camera_name,
    camera_preferences,
    capture_clip,
    orient_override,
    resolve_camera,
)
from nocturnium_kiosk_witness.client import identify, post_json, post_multipart
from nocturnium_kiosk_witness.config import (
    CLIP_SECONDS,
    DASHBOARD_URL,
    FACE_KEY,
    FACE_URL,
    FORBIDDEN_DEVICES,
    FORBIDDEN_NAMES,
    HTTP_TIMEOUT,
    IDENTIFY_RETRIES,
    IDENTITY_TTL,
    LOG,
    ORIENT_STATE,
    POLL_HZ,
    RETRY_MIN_SECONDS,
    WITNESS_CAMERAS,
    WITNESS_FRAMERATE,
    WITNESS_INPUT_FORMAT,
    WITNESS_KEY,
    WITNESS_VIDEO_SIZE,
    env_float,
    env_int,
    env_str,
)
from nocturnium_kiosk_witness.loop import Session, main, run

if __name__ == "__main__":
    raise SystemExit(main())
