"""HTTP calls out: the face service and the dashboard.

Moved verbatim from `ops/nocturnium-kiosk-witness.py`; see that entry point.
"""

from __future__ import annotations

import json
import os
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .camera import capture_clip, resolve_camera
from .config import (
    DASHBOARD_URL,
    FACE_KEY,
    FACE_URL,
    HTTP_TIMEOUT,
    LOG,
    WITNESS_CAMERAS,
    WITNESS_KEY,
)

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
    chosen = resolve_camera()
    if chosen is None:
        LOG.warning("no usable camera found; preference list is %r", WITNESS_CAMERAS)
        return None
    device, rotate, name = chosen
    LOG.info("capturing from %s (%s), rotate %d deg", device, name, rotate)

    handle, raw = tempfile.mkstemp(prefix="kiosk-witness-", suffix=".mp4")
    os.close(handle)
    clip = Path(raw)
    try:
        if not capture_clip(clip, device, rotate):
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
