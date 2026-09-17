"""The session model and the polling loop.

Moved verbatim from `ops/nocturnium-kiosk-witness.py`; see that entry point.
"""

from __future__ import annotations

import logging
import os
import sys
import time
import uuid

from .activity import Activity
from .camera import camera_preferences, resolve_camera
from .client import identify, post_json
from .config import (
    CLIP_SECONDS,
    FACE_KEY,
    IDENTIFY_RETRIES,
    IDENTITY_TTL,
    LOG,
    POLL_HZ,
    RETRY_MIN_SECONDS,
    WITNESS_CAMERAS,
    WITNESS_FRAMERATE,
    WITNESS_INPUT_FORMAT,
    WITNESS_KEY,
    WITNESS_VIDEO_SIZE,
)

# --------------------------------------------------------------------------
# The loop
# --------------------------------------------------------------------------


class Session:
    def __init__(self) -> None:
        self.session_id = uuid.uuid4().hex
        self.last_touch = time.monotonic()
        self.identified = False
        self.attempts = 0
        self.last_attempt = 0.0

    def alive(self, now: float) -> bool:
        return now - self.last_touch <= IDENTITY_TTL

    def may_retry(self, now: float) -> bool:
        """A failed opening capture gets a couple more chances, then stops.

        Without the retry, somebody who happened to look away as they first
        touched the panel brands the whole visit unknown. With unlimited
        retries, an empty room with a flickering light burns the GPU forever.
        """
        if self.identified or self.attempts > IDENTIFY_RETRIES:
            return False
        return now - self.last_attempt >= RETRY_MIN_SECONDS


def run() -> int:
    if not FACE_KEY:
        sys.exit("NOVA_FACE_KEY is required; refusing to start without it")
    if not WITNESS_KEY:
        sys.exit("NOVA_WITNESS_KEY is required; refusing to start without it")
    if not camera_preferences():
        sys.exit("WITNESS_CAMERAS is empty; there is no camera to prefer. Refusing to start.")

    activity = Activity()
    activity.drain()
    chosen = resolve_camera()
    LOG.info(
        "camera preference %r -> %s; %s %s @%sfps; identity ttl %.0fs, clip %.1fs",
        WITNESS_CAMERAS,
        f"{chosen[0]} ({chosen[2]}) rotate {chosen[1]} deg" if chosen else "NONE FOUND",
        WITNESS_INPUT_FORMAT or "auto",
        WITNESS_VIDEO_SIZE or "auto",
        WITNESS_FRAMERATE or "auto",
        IDENTITY_TTL,
        CLIP_SECONDS,
    )

    interval = 1.0 / POLL_HZ if POLL_HZ > 0 else 1.0
    session: Session | None = None

    while True:
        time.sleep(interval)
        if not activity.poll():
            continue

        now = time.monotonic()
        if session is not None and not session.alive(now):
            session = None

        if session is None:
            session = Session()
            session.attempts += 1
            session.last_attempt = now
            result = identify()
            subject = (result or {}).get("subject")
            session.identified = bool(subject)
            post_json(
                "/api/kiosk/witness",
                {
                    "sessionId": session.session_id,
                    "subject": subject,
                    "score": (result or {}).get("score"),
                    "runnerUp": (result or {}).get("runnerUp"),
                },
            )
            LOG.info(
                "session %s opened, %s",
                session.session_id[:8],
                f"identified {subject}" if subject else "unidentified",
            )
            session.last_touch = time.monotonic()
            continue

        session.last_touch = now
        if session.may_retry(now):
            session.attempts += 1
            session.last_attempt = now
            result = identify()
            subject = (result or {}).get("subject")
            if subject:
                session.identified = True
                post_json(
                    "/api/kiosk/witness",
                    {
                        "sessionId": session.session_id,
                        "subject": subject,
                        "score": (result or {}).get("score"),
                        "runnerUp": (result or {}).get("runnerUp"),
                    },
                )
                LOG.info("session %s identified %s on retry", session.session_id[:8], subject)
                session.last_touch = time.monotonic()
                continue

        # The cheap path, and the whole point of the session model: no camera,
        # no upload, no GPU.
        post_json("/api/kiosk/witness/touch", {"sessionId": session.session_id})


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("WITNESS_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    try:
        return run()
    except KeyboardInterrupt:
        return 0
