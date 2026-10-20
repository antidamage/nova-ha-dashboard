"""Clip orientation: turn a sideways capture upright before anything judges it.

Used by `ClipAnalysis.__init__` (clip_analysis.py) once per clip.
"""

from __future__ import annotations

import cv2
import numpy as np
from core import quarter_turns_to_upright, roll_degrees

from .config import DET_SCORE_MIN, LOG, MODELS, QUARTER_TURN


def upright(frames: list[np.ndarray]) -> tuple[list[np.ndarray], int]:
    """Rotate a sideways capture upright before anything judges it.

    Phones record portrait by writing landscape frames plus a rotation
    flag, and that flag does not survive a `MediaRecorder` re-encode or
    `cv2.VideoCapture`, which ignores it. The frames arrive on their side.

    Nothing downstream notices on its own: measured 2026-09-03, a
    90-degree-rotated capture still detected at 0.791 and produced 25
    usable frames, so the pipeline went on to score anti-spoof against a
    sideways face. The eye landmarks are the only orientation cue that
    survives, which is what makes this checkable at all — the bounding box
    carries no rotation and the metadata is exactly what was lost.

    Orientation is decided ONCE, from the first frame with a confident
    detection, and applied to the whole clip. Per-frame decisions would let
    the geometry change mid-clip, and the liveness residual compares frames
    to each other — a rotation appearing halfway through would read as
    motion that never happened.
    """

    probes = frames[: min(len(frames), 5)]
    for frame in probes:
        turns = turns_from_landmarks(frame)
        if turns is None:
            continue
        if turns:
            LOG.info("clip arrived rotated; correcting by %d quarter turn(s)", turns)
        return rotate(frames, turns), turns

    # Nothing was detected at the incoming orientation.
    #
    # The landmark check above can only correct a rotation it can SEE, and
    # it sees nothing until a face is detected. That is fine for a phone,
    # which is off by a quarter turn at most and still detects. It is not
    # fine for a camera mounted on its side: rotation then decides whether
    # there is a detection AT ALL, and the clip is refused `no_face` for a
    # face that is plainly in the frame.
    #
    # So probe the other three cardinal orientations before giving up. One
    # frame each, and only on this path — a clip that detected normally
    # costs nothing extra, and the worst case is three extra detections on a
    # clip that was going to be refused anyway.
    if probes:
        for pre in (1, 2, 3):
            turns = turns_from_landmarks(cv2.rotate(probes[0], QUARTER_TURN[pre]))
            if turns is None:
                continue
            total = (pre + turns) % 4
            LOG.info(
                "no face at the incoming orientation; detected after %d quarter turn(s), "
                "correcting the clip by %d",
                pre,
                total,
            )
            return rotate(frames, total), total
    return frames, 0


def turns_from_landmarks(frame: np.ndarray) -> int | None:
    """Quarter turns to upright from one frame, or None if no confident face.

    The eye landmarks are the only orientation cue that survives a
    re-encode; the bounding box carries no rotation.
    """
    faces = MODELS.detect(frame)
    if not faces:
        return None
    best = max(faces, key=lambda item: item.score)
    if best.score < DET_SCORE_MIN:
        return None
    return quarter_turns_to_upright(roll_degrees(best.landmarks))


def rotate(frames: list[np.ndarray], turns: int) -> list[np.ndarray]:
    turns %= 4
    if turns == 0:
        return frames
    return [cv2.rotate(item, QUARTER_TURN[turns]) for item in frames]
