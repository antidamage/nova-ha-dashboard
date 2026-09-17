"""Camera capture and ORB feature matching.

Moved verbatim from `ops/kiosk/nova-kiosk-orient.py`; see that entry point.
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

from .config import (
    CAMERA_MATCH,
    FORBIDDEN_NAMES,
    LOG,
    MIN_INLIERS,
    MIN_INLIER_RATIO,
    REFERENCE,
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


def grab_gray() -> np.ndarray | None:
    """One frame, in memory, as grayscale. None when the camera is unavailable."""
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
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    finally:
        cap.release()


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


def load_reference():
    data = np.load(REFERENCE)
    return data["points"], data["descriptors"]


def read_once(reference) -> dict:
    gray = grab_gray()
    if gray is None:
        return {"confident": False, "reason": "camera"}
    try:
        return measure(gray, *reference)
    finally:
        del gray
