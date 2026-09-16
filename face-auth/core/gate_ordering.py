"""Gate status codes, subject-id validation, ordering, and roll correction."""

from __future__ import annotations

import re

import numpy as np

from .constants import LEFT_EYE, RIGHT_EYE

GATE_STATUS = {
    "nonce_invalid": 401,
    "network_denied": 403,
    "disarmed": 403,
    "locked_out": 429,
    "rate_limited": 429,
}


SUBJECT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def valid_subject_id(subject_id: str | None) -> bool:
    """Is this usable as a primary key and as a filename component?

    Letters, digits, underscore and hyphen; first character alphanumeric; 64
    characters. No dot, so `..` cannot be spelled; no separator, so no path can
    be escaped; no whitespace or NUL, so nothing can be smuggled past a log
    line. Subject ids are our own identifiers, not user prose, and the caller
    rejects rather than sanitising — a silently rewritten id becomes a second
    subject nobody asked for, with its own gallery, matching nothing.
    """

    return bool(subject_id) and SUBJECT_ID_PATTERN.match(subject_id) is not None


def preflight_reason(
    *,
    nonce_ok: bool,
    network_ok: bool,
    lockout: str | None,
    rate_ok: bool,
) -> str | None:
    """The first gate that refuses, in the order the spec fixes.

    nonce → network → armed → lockout → release rate. The order is the
    security property: all of it is decided before a model is touched, so a
    locked-out or off-network caller costs no GPU and takes no queue position
    behind a voice turn. This function exists so that ordering is asserted in a
    test rather than inferred from the shape of an `if` chain in the service.
    """

    if not nonce_ok:
        return "nonce_invalid"
    if not network_ok:
        return "network_denied"
    if lockout is not None:
        return lockout
    if not rate_ok:
        return "rate_limited"
    return None


def roll_degrees(landmarks: np.ndarray) -> float:
    """Face roll from the eye line, in degrees, positive clockwise on screen.

    The two eye points are the only orientation cue that survives an arbitrary
    capture: the bounding box does not carry rotation, and image metadata is
    exactly what gets lost. `arctan2` over the eye vector is well conditioned
    for any orientation, which a slope would not be near vertical.
    """

    points = np.asarray(landmarks, dtype=np.float64)
    if points.shape[0] <= max(LEFT_EYE, RIGHT_EYE):
        raise ValueError("need both eye landmarks to measure roll")
    delta = points[RIGHT_EYE] - points[LEFT_EYE]
    return float(np.degrees(np.arctan2(delta[1], delta[0])))


def quarter_turns_to_upright(roll: float, *, tolerance_degrees: float = 25.0) -> int:
    """Counter-clockwise quarter turns that bring a rolled face upright: 0-3.

    Phones record portrait video by writing landscape frames plus a rotation
    flag, and that flag is routinely lost — by a re-encode, by a browser
    `MediaRecorder`, or by `cv2.VideoCapture`, which ignores it. The frames then
    arrive with the face on its side.

    Measured on iridium 2026-09-03: a 90-degree-rotated capture still detected
    (score 0.791) and produced 25 usable frames, so nothing upstream noticed —
    it simply went on to judge a sideways face. Counter-rotating the same frame
    gave roll -0.1 degrees and score 0.899.

    Only near-quarter-turn rolls are corrected. A head tilted 20 degrees is a
    person tilting their head, and rotating the frame for that would fight the
    liveness residual, which is deliberately invariant to exactly this.
    """

    # Snap against the SIGNED nearest multiple, then reduce. Reducing first and
    # comparing against `turns * 90` breaks for negative rolls: -90 reduces to
    # 3, and |-90 - 270| is 360, so a correctly rotated frame looked like a
    # tilted head and was left on its side.
    nearest = round(roll / 90.0) * 90.0
    if abs(roll - nearest) > tolerance_degrees:
        return 0
    return int(nearest / 90.0) % 4
