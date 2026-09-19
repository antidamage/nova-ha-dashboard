"""The privacy gate: no frame containing a person leaves the machine.

Adeline, 2026-09-20. The orientation question goes to DeepSeek, which means a
picture of the room goes with it. A frame with someone in it never does.

Two detectors, because either alone has an obvious hole: YuNet finds faces,
and the HOG pedestrian detector catches a body whose face is turned away.
Both run on all four rotations, because the camera is bolted to a panel that
may itself be mounted sideways, so a standing person can appear lying down.

The gate is deliberately biased toward suppressing. A false positive costs one
skipped API call, which the next 60 s tick retries; a false negative sends a
picture of someone out of the house. See specs/kiosk-display-rotation.md.
"""

from __future__ import annotations

import cv2
import numpy as np

from .config import BODY_WEIGHT, FACE_MODEL, FACE_SCORE, LOG, PEOPLE_GATE

# Undo a room turned c degrees clockwise within the frame, so that a person
# standing upright in the world appears upright to a detector.
UPRIGHT_ROTATIONS = {
    0: None,
    90: cv2.ROTATE_90_COUNTERCLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_CLOCKWISE,
}

_faces = None
_bodies = None


def _face_detector():
    global _faces
    if _faces is None and FACE_MODEL.is_file():
        try:
            _faces = cv2.FaceDetectorYN.create(str(FACE_MODEL), "", (320, 320), FACE_SCORE, 0.3, 5000)
        except Exception as error:
            LOG.warning("face detector unavailable: %s", error)
            _faces = False
    return _faces or None


def _body_detector():
    global _bodies
    if _bodies is None:
        try:
            _bodies = cv2.HOGDescriptor()
            _bodies.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        except Exception as error:  # OpenCV 5 dropped HOGDescriptor
            LOG.info("body detector unavailable: %s", error)
            _bodies = False
    return _bodies or None


def _views(frame: np.ndarray):
    for turn in UPRIGHT_ROTATIONS.values():
        yield frame if turn is None else cv2.rotate(frame, turn)


def person_in(frame: np.ndarray) -> bool:
    """True when anyone might be in the frame, or when we cannot tell."""
    if not PEOPLE_GATE:
        return False
    face = _face_detector()
    body = _body_detector()
    if face is None and body is None:
        # No detector means no way to clear the frame, so nothing is sent.
        LOG.warning("no person detector available; treating frame as occupied")
        return True
    for view in _views(frame):
        height, width = view.shape[:2]
        if face is not None:
            try:
                face.setInputSize((width, height))
                _, found = face.detect(view)
                if found is not None and len(found):
                    return True
            except Exception as error:
                LOG.warning("face detection failed: %s", error)
                return True
        if body is not None:
            try:
                rects, weights = body.detectMultiScale(view, winStride=(8, 8))
                if len(rects) and float(max(weights)) >= BODY_WEIGHT:
                    LOG.debug("body detector fired at %.2f", float(max(weights)))
                    return True
            except Exception as error:
                LOG.warning("body detection failed: %s", error)
                return True
    return False
