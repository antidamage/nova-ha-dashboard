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

import json
import logging
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
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

VIDEO_DEVICE = env_str("WITNESS_VIDEO_DEVICE", "/dev/video0")
# A capture card is not a face camera. On this host /dev/video4 is the MS2109
# grabber carrying the outdoor camera: pointing the witness at it would record
# whoever walks past the front of the house, unattended, forever. Refusing to
# start is the only safe response to that misconfiguration — a comment is not.
FORBIDDEN_DEVICES = {
    entry.strip()
    for entry in env_str("WITNESS_FORBIDDEN_DEVICES", "/dev/video4").split(",")
    if entry.strip()
}

CLIP_SECONDS = env_float("WITNESS_CLIP_SECONDS", 1.2)
# Quarter turns CLOCKWISE to apply at capture, for a camera that is not mounted
# upright. This panel's webcam sits on its side, so the room arrives rotated and
# a face in it is rotated with it.
#
# Corrected here rather than left to the service: this camera's mounting is a
# fixed, known fact, and a pixel rotation at capture costs nothing, whereas
# making the service work it out costs extra detection passes on every clip.
# The service's fallback still exists for callers whose orientation is unknown.
WITNESS_ROTATE = env_int("WITNESS_ROTATE_DEGREES", 0) % 360

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


# --------------------------------------------------------------------------
# Activity detection
# --------------------------------------------------------------------------
#
# Read directly from evdev rather than asking the desktop.
#
# The kiosk session on this host is WAYLAND (verified live, 2026-09-03:
# `loginctl show-session -p Type` reports `wayland`). XScreenSaver's idle
# extension and `xprintidle` are both X11-only and would silently never fire —
# a daemon watching an empty room and a daemon that cannot see input look
# exactly the same from outside. evdev is below the display server, so it works
# on Wayland, X11 and a bare console alike, and does not depend on a desktop
# D-Bus API surviving an upgrade.
#
# Reading an event device does NOT steal events from the compositor: each
# open file description gets its own buffer, so several readers each see every
# event. This is a passive observer.
#
# It needs the `input` group, which the unit grants with SupplementaryGroups
# rather than by changing the login account.


class Activity:
    """Has anyone touched the panel since the last poll?"""

    # Handlers that mean "a human input device". The audio jacks on this host
    # also present event nodes, and they would otherwise register as touches.
    HUMAN_HANDLERS = ("mouse", "kbd", "js")

    def __init__(self) -> None:
        self._files: list = []
        for path in self._device_paths():
            try:
                self._files.append(open(path, "rb", buffering=0))
            except OSError as error:
                LOG.debug("skipping %s: %s", path, error)
        if not self._files:
            raise RuntimeError(
                "no readable input devices. The service needs the `input` group "
                "(SupplementaryGroups=input in the unit) — /dev/input/event* is "
                "root:input 0660."
            )
        for handle in self._files:
            os.set_blocking(handle.fileno(), False)
        LOG.info("watching %d input device(s) for panel activity", len(self._files))

    @staticmethod
    def _device_paths() -> list[str]:
        """Event nodes belonging to human input devices, from /proc."""
        paths: list[str] = []
        try:
            lines = Path("/proc/bus/input/devices").read_text(encoding="utf-8").splitlines()
        except OSError as error:
            LOG.warning("could not enumerate input devices: %s", error)
            return paths

        # Blocks are separated by a blank line; only the Handlers row matters.
        handlers = ""
        for line in lines + [""]:
            if line.startswith("H: Handlers="):
                handlers = line.split("=", 1)[1]
                continue
            if line.strip():
                continue
            if handlers and any(marker in handlers for marker in Activity.HUMAN_HANDLERS):
                for token in handlers.split():
                    if token.startswith("event"):
                        paths.append(f"/dev/input/{token}")
            handlers = ""
        return paths

    def poll(self) -> bool:
        """True when at least one event arrived since the last call.

        Events are read and discarded — the content does not matter, only that
        a person did something.
        """
        touched = False
        for handle in self._files:
            while True:
                try:
                    chunk = handle.read(4096)
                except (BlockingIOError, InterruptedError):
                    break
                except OSError as error:
                    LOG.debug("read error on %s: %s", handle.name, error)
                    break
                if not chunk:
                    break
                touched = True
                if len(chunk) < 4096:
                    break
        return touched

    def drain(self) -> None:
        """Discard anything buffered, so the first poll is not a false touch."""
        self.poll()


# --------------------------------------------------------------------------
# Capture and identify
# --------------------------------------------------------------------------


def capture_clip(destination: Path) -> bool:
    """Record a short clip. Returns False rather than raising on any failure."""
    # ffmpeg's transpose: 1 is 90 clockwise, 2 is 90 counter-clockwise.
    rotate = {
        90: ["-vf", "transpose=1"],
        180: ["-vf", "transpose=1,transpose=1"],
        270: ["-vf", "transpose=2"],
    }.get(WITNESS_ROTATE, [])
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
        VIDEO_DEVICE,
        "-t",
        f"{CLIP_SECONDS:.2f}",
        *rotate,
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


def post_multipart(url: str, headers: dict[str, str], field: str, path: Path) -> dict | None:
    boundary = f"----nova{uuid.uuid4().hex}"
    payload = bytearray()
    payload += f"--{boundary}\r\n".encode()
    payload += f'Content-Disposition: form-data; name="{field}"; filename="clip.mp4"\r\n'.encode()
    payload += b"Content-Type: video/mp4\r\n\r\n"
    payload += path.read_bytes()
    payload += f"\r\n--{boundary}--\r\n".encode()

    request = urllib.request.Request(url, data=bytes(payload), method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        LOG.warning("%s -> HTTP %s: %s", url, error.code, error.read().decode("utf-8", "replace")[:200])
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        LOG.warning("%s -> %s", url, error)
    return None


def identify() -> dict | None:
    """Capture one clip and ask the face service who it is.

    The clip is deleted in a `finally`. An exception mid-upload must not leave a
    video of somebody's face on this host's disk, and nothing is watching this
    directory.
    """
    handle, raw = tempfile.mkstemp(prefix="kiosk-witness-", suffix=".mp4")
    os.close(handle)
    clip = Path(raw)
    try:
        if not capture_clip(clip):
            return None
        return post_multipart(
            f"{FACE_URL}/identify",
            {"X-Nova-Face-Key": FACE_KEY},
            "clip",
            clip,
        )
    finally:
        try:
            clip.unlink()
        except OSError:
            LOG.warning("could not delete %s", clip)


def post_json(path: str, body: dict) -> bool:
    request = urllib.request.Request(
        f"{DASHBOARD_URL}{path}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
    )
    request.add_header("Content-Type", "application/json")
    request.add_header("X-Nova-Witness-Key", WITNESS_KEY)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            response.read()
            return True
    except urllib.error.HTTPError as error:
        LOG.warning("%s -> HTTP %s", path, error.code)
    except (urllib.error.URLError, TimeoutError) as error:
        LOG.warning("%s -> %s", path, error)
    return False


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
    if VIDEO_DEVICE in FORBIDDEN_DEVICES:
        sys.exit(
            f"{VIDEO_DEVICE} is on the forbidden list. That device is the outdoor "
            "camera's capture card, not the panel's webcam; pointing the witness at "
            "it would record whoever walks past the house. Refusing to start."
        )

    activity = Activity()
    activity.drain()
    LOG.info(
        "capturing from %s (%s %s @%sfps); identity ttl %.0fs, clip %.1fs, rotate %d deg",
        VIDEO_DEVICE,
        WITNESS_INPUT_FORMAT or "auto",
        WITNESS_VIDEO_SIZE or "auto",
        WITNESS_FRAMERATE or "auto",
        IDENTITY_TTL,
        CLIP_SECONDS,
        WITNESS_ROTATE,
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


if __name__ == "__main__":
    raise SystemExit(main())
