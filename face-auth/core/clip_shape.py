"""Clip-shape and per-frame detection/framing refusals."""

from __future__ import annotations

import numpy as np

from .constants import BOX_MIN_PX, CLIP_MAX_SECONDS, CLIP_MIN_FPS, CLIP_MIN_SECONDS, DET_SCORE_MIN, FACE_MAX_FRAME_FRACTION, SAMPLE_FRAMES


def clip_bounds_reason(
    duration_seconds: float,
    fps: float,
    *,
    min_seconds: float = CLIP_MIN_SECONDS,
    max_seconds: float = CLIP_MAX_SECONDS,
    min_fps: float = CLIP_MIN_FPS,
) -> str | None:
    """Refusal reason for a decoded clip's shape, or None if it is usable.

    The fps floor is not a quality preference. Non-rigid facial motion sampled
    at 10 fps aliases into apparent rigidity, which would let a low-frame-rate
    capture of a real face fail liveness and — worse — narrows the gap the
    residual threshold sits in.
    """

    if not (np.isfinite(duration_seconds) and np.isfinite(fps)) or duration_seconds <= 0 or fps <= 0:
        return "clip_undecodable"
    if duration_seconds < min_seconds:
        return "clip_too_short"
    if duration_seconds > max_seconds:
        return "clip_too_long"
    if fps < min_fps:
        return "clip_low_fps"
    return None


def even_frame_indices(total_frames: int, count: int = SAMPLE_FRAMES) -> list[int]:
    """Evenly spaced frame indices, deduplicated, for sampling a short clip."""

    if total_frames <= 0 or count <= 0:
        return []
    if total_frames <= count:
        return list(range(total_frames))
    positions = np.linspace(0, total_frames - 1, count)
    return sorted({int(round(value)) for value in positions})


def detection_reason(
    faces: int,
    det_score: float | None,
    box_short_side: float | None,
    *,
    det_score_min: float = DET_SCORE_MIN,
    box_min_px: int = BOX_MIN_PX,
) -> str | None:
    """Per-frame detection refusal, or None.

    Several faces is a refusal with no "pick the biggest" fallback. The biggest
    face is not necessarily the one asking to be let in, and one of the others
    may be the person being walked past the camera.
    """

    if faces <= 0:
        return "no_face"
    if faces > 1:
        return "multiple_faces"
    if det_score is None or det_score < det_score_min:
        return "low_detection"
    if box_short_side is None or box_short_side < box_min_px:
        return "face_too_small"
    return None


def framing_reason(
    bbox: tuple[float, float, float, float],
    frame_width: int,
    frame_height: int,
    *,
    max_frame_fraction: float = FACE_MAX_FRAME_FRACTION,
    edge_tolerance_px: float = 2.0,
) -> str | None:
    """Refuse a face the anti-spoof stage cannot honestly assess, or None.

    Two cases, both about there being no pixels rather than about the person.

    **Clipped.** A box touching or crossing a frame edge means part of the face
    was never captured. The anti-spoof crop widens the box by up to 4x, so a
    clipped face is reconstructed from reflected border — inventing the very
    texture the model is asked to judge. Measured on a deliberately cropped
    ultrawide clip whose face was 1.19x the frame height: reflecting scored
    0.13-0.46 where the same face framed normally scored 0.9998. Refusing is
    the honest answer, and "centre your face" is something the person can act
    on, unlike "not a live face".

    **Too close.** Past `max_frame_fraction` there is almost no context left,
    and context is where print and replay artefacts live — a screen bezel, a
    paper edge, a hand. This is a softer bound than clipping and exists so the
    person is told to move back rather than silently scored on a face fill.
    """

    x1, y1, x2, y2 = bbox
    if (
        x1 <= edge_tolerance_px
        or y1 <= edge_tolerance_px
        or x2 >= frame_width - edge_tolerance_px
        or y2 >= frame_height - edge_tolerance_px
    ):
        return "face_clipped"
    if frame_height > 0 and (y2 - y1) / frame_height > max_frame_fraction:
        return "face_too_close"
    return None
