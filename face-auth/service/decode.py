"""Upload and decode: bounded reads, clip sampling, and still decoding."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
from core import clip_bounds_reason, even_frame_indices
from fastapi import HTTPException, Request, UploadFile

import core

from .config import CLIP_MAX_BYTES, CLIP_MAX_SECONDS, CLIP_MIN_FPS, CLIP_MIN_SECONDS, DATA_ROOT, MAX_DECODE_FRAMES
from .errors import Refusal


async def read_bounded(request: Request, upload: UploadFile) -> bytes:
    """Read an upload with two independent bounds.

    `Content-Length` is checked first so an oversized body is refused before it
    is read at all — but the header is attacker-controlled, so the streamed
    read is capped at the same bound regardless of what it claimed.
    """

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > CLIP_MAX_BYTES:
        raise HTTPException(status_code=413, detail={"reason": "clip_too_large"})
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > CLIP_MAX_BYTES:
            raise HTTPException(status_code=413, detail={"reason": "clip_too_large"})
        chunks.append(chunk)
    if not total:
        raise Refusal(422, "clip_undecodable")
    return b"".join(chunks)


def decode_clip(payload: bytes, profile: core.CaptureProfile | None = None) -> tuple[list[np.ndarray], float, float]:
    """Decode a submitted clip to sampled BGR frames.

    `profile` supplies the length bounds; None means the service's configured
    FACE_CLIP_* values. `quick` never arrives here — it streams stills to
    /frame instead of posting a clip.

    The temp file is removed in a `finally` that runs on every exception path.
    An exception mid-decode must not leave a video of somebody's face on disk;
    that is the whole reason raw frames are never retained anywhere else
    either.
    """

    handle, temp_path = tempfile.mkstemp(suffix=".clip", dir=str(DATA_ROOT))
    os.close(handle)
    path = Path(temp_path)
    capture = None
    try:
        path.write_bytes(payload)
        capture = cv2.VideoCapture(str(path))
        if not capture.isOpened():
            raise Refusal(422, "clip_undecodable")
        frames: list[np.ndarray] = []
        last_position_ms = 0.0
        while len(frames) < MAX_DECODE_FRAMES:
            ok, frame = capture.read()
            if not ok:
                break
            position = capture.get(cv2.CAP_PROP_POS_MSEC)
            if position and position > 0:
                last_position_ms = position
            frames.append(frame)
        if len(frames) < 2:
            raise Refusal(422, "clip_undecodable")
        # MediaRecorder's webm routinely reports fps 0 and no frame count, so
        # the container's own numbers are a hint, not the source of truth.
        reported_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        duration = last_position_ms / 1000.0
        if duration <= 0 and reported_fps > 0:
            duration = len(frames) / reported_fps
        fps = reported_fps if reported_fps > 0 else (len(frames) / duration if duration > 0 else 0.0)
        min_seconds = CLIP_MIN_SECONDS if profile is None or profile.clip_min_seconds is None else profile.clip_min_seconds
        max_seconds = CLIP_MAX_SECONDS if profile is None or profile.clip_max_seconds is None else profile.clip_max_seconds
        reason = clip_bounds_reason(
            duration, fps,
            min_seconds=min_seconds, max_seconds=max_seconds, min_fps=CLIP_MIN_FPS,
        )
        if reason:
            raise Refusal(422, reason, duration=round(duration, 3), fps=round(fps, 2))
        sampled = [frames[index] for index in even_frame_indices(len(frames), core.SAMPLE_FRAMES)]
        return sampled, duration, fps
    finally:
        if capture is not None:
            capture.release()
        path.unlink(missing_ok=True)


def decode_image(payload: bytes) -> np.ndarray:
    frame = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise Refusal(422, "clip_undecodable")
    return frame
