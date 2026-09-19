"""Camera capture and ORB feature matching.

Moved verbatim from `ops/kiosk/nova-kiosk-orient.py`; see that entry point.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import cv2
import numpy as np

from .config import (
    CAMERA_MATCH,
    FORBIDDEN_NAMES,
    LAST_FEATURES,
    LAST_IMAGE,
    LOG,
    MIN_INLIERS,
    MIN_INLIER_RATIO,
    STATE_DIR,
    WARMUP_FRAMES,
)

# --------------------------------------------------------------------------
# Capture and analysis
# --------------------------------------------------------------------------


def resolve_camera() -> str | None:
    base = Path("/sys/class/video4linux")
    try:
        nodes = sorted((n.name for n in base.iterdir() if n.name.startswith("video")), key=lambda n: int(n[5:] or 0))
    except OSError:
        return None
    for node in nodes:
        try:
            name = (base / node / "name").read_text().strip()
        except OSError:
            continue
        lower = name.lower()
        # The IR node carries its own name ("USB2.0 IR"), so the substring
        # match on "USB2.0 HD" already skips it.
        if CAMERA_MATCH.lower() in lower and not any(bad in lower for bad in FORBIDDEN_NAMES):
            return f"/dev/{node}"
    return None


def grab_frame() -> np.ndarray | None:
    """One colour frame, in memory. None when the camera is unavailable."""
    device = resolve_camera()
    if not device:
        LOG.warning("built-in camera (%s) not found", CAMERA_MATCH)
        return None
    cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
    try:
        if not cap.isOpened():
            LOG.info("camera %s busy or unreadable", device)
            return None
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        frame = None
        for _ in range(WARMUP_FRAMES + 1):
            ok, frame = cap.read()
            if not ok:
                return None
        return frame
    finally:
        cap.release()


def grab_gray() -> np.ndarray | None:
    frame = grab_frame()
    return None if frame is None else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


_orb = cv2.ORB_create(nfeatures=1500)
_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))


def features(gray: np.ndarray):
    keypoints, descriptors = _orb.detectAndCompute(_clahe.apply(gray), None)
    points = np.float32([k.pt for k in keypoints]) if keypoints else np.zeros((0, 2), np.float32)
    return points, descriptors


def measure(gray: np.ndarray, ref_points: np.ndarray, ref_desc: np.ndarray) -> dict:
    """`{confident, angle, cardinal, deviation, inliers}`; angle is the room's clockwise turn."""
    points, desc = features(gray)
    result = {"confident": False, "angle": None, "cardinal": None, "deviation": None, "inliers": 0}
    if desc is None or len(points) < MIN_INLIERS:
        return result
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(ref_desc, desc, k=2)
    good = [m for m, *rest in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * rest[0].distance]
    if len(good) < MIN_INLIERS:
        return result
    src = ref_points[[m.queryIdx for m in good]]
    dst = points[[m.trainIdx for m in good]]
    matrix, mask = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=6.0)
    if matrix is None:
        return result
    inliers = int(mask.sum())
    angle = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0])) % 360
    cardinal = int(round(angle / 90.0)) % 4 * 90
    deviation = abs((angle - cardinal + 180) % 360 - 180)
    result.update(
        inliers=inliers,
        angle=round(angle, 1),
        cardinal=cardinal,
        deviation=round(deviation, 1),
        confident=inliers >= MIN_INLIERS and inliers / len(good) >= MIN_INLIER_RATIO,
    )
    return result


# --------------------------------------------------------------------------
# The one retained frame
# --------------------------------------------------------------------------


def load_retained():
    """`(points, descriptors)` of the last frame we acted on, or None."""
    try:
        data = np.load(LAST_FEATURES)
    except (OSError, ValueError):
        return None
    return data["points"], data["descriptors"]


def save_retained(frame: np.ndarray) -> bool:
    """Replace the retained frame and its features. No older frame survives."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    points, desc = features(gray)
    if desc is None or len(points) < MIN_INLIERS:
        LOG.info("retained frame not replaced: only %d features", len(points))
        return False
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    image_tmp = LAST_IMAGE.with_suffix(".tmp.jpg")
    feature_tmp = LAST_FEATURES.with_suffix(".tmp.npz")
    cv2.imwrite(str(image_tmp), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    np.savez(feature_tmp, points=points, descriptors=desc)
    os.replace(image_tmp, LAST_IMAGE)
    os.replace(feature_tmp, LAST_FEATURES)
    os.chmod(LAST_IMAGE, 0o600)
    return True


def read_once(retained) -> dict:
    """A reading of how far the view has moved since the retained frame."""
    frame = grab_frame()
    if frame is None:
        return {"confident": False, "reason": "camera", "frame": None}
    reading = {"confident": False, "reason": "no-retained", "frame": frame}
    if retained is not None:
        reading = measure(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), *retained)
        reading["frame"] = frame
    return reading
