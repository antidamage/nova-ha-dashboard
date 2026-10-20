"""`ClipAnalysis`: per-clip detection, and the frame/embedding views the gates read.

Orientation correction lives in orientation.py; the liveness, anti-spoof and
identification verdicts over an analysis live in judging.py.
"""

from __future__ import annotations

import numpy as np
from core import detection_reason, framing_reason, l2_normalise

import core

from .config import BOX_MIN_PX, DET_SCORE_MIN, LIVENESS_MIN_FRAMES, MODELS
from .errors import Refusal
from .orientation import rotate, turns_from_landmarks, upright


class ClipAnalysis:
    @classmethod
    def from_stream(cls, held: core.HeldStream) -> "ClipAnalysis":
        """The frames /frame gathered for a nonce, as an analysis /assert can judge.

        Detections only — the stills were never kept — so `antispoof()` and
        `track()` are unavailable, which is why a streamed profile has both
        gates off.
        """

        analysis = cls.__new__(cls)
        analysis.detections = [(None, detection) for detection in held.good]
        analysis.rejections = list(held.rejections)
        analysis.quarter_turns = 0
        return analysis

    def __init__(self, frames: list[np.ndarray]) -> None:
        self.detections = []
        self.rejections: list[str] = []
        frames, self.quarter_turns = self._upright(frames)
        for frame in frames:
            faces = MODELS.detect(frame, with_embedding=True)
            best = max(faces, key=lambda item: item.score) if faces else None
            reason = detection_reason(
                len(faces),
                best.score if best else None,
                best.short_side if best else None,
                det_score_min=DET_SCORE_MIN, box_min_px=BOX_MIN_PX,
            )
            if reason == "multiple_faces":
                # No "pick the biggest" rule. The biggest face is not
                # necessarily the one asking to be let in, and one of the
                # others may be the person being walked past the camera.
                raise Refusal(422, "multiple_faces")
            if not reason and best is not None:
                # Framing is checked here, with the frame in hand, because the
                # anti-spoof crop widens this box by up to 4x. A face touching a
                # frame edge has no pixels out there to widen into, and the crop
                # would reflect the border — asking the model to judge texture
                # that was invented rather than captured.
                reason = framing_reason(best.bbox, frame.shape[1], frame.shape[0])
            if reason:
                self.rejections.append(reason)
                continue
            self.detections.append((frame, best))

    _upright = staticmethod(upright)
    _turns_from_landmarks = staticmethod(turns_from_landmarks)
    _rotate = staticmethod(rotate)

    @property
    def usable(self) -> int:
        return len(self.detections)

    def require_frames(self, min_frames: int | None = None) -> None:
        if self.usable >= (LIVENESS_MIN_FRAMES if min_frames is None else min_frames):
            return
        # Name what actually went wrong when the frames agree on a cause; a
        # bare "too_few_frames" for a subject standing too far away is a
        # refusal the person cannot act on.
        if self.rejections:
            dominant = max(set(self.rejections), key=self.rejections.count)
            if self.rejections.count(dominant) >= len(self.rejections) * 0.6:
                raise Refusal(422, dominant, usableFrames=self.usable)
        raise Refusal(422, "too_few_frames", usableFrames=self.usable)

    def track(self) -> np.ndarray:
        return np.stack([detection.landmarks for _, detection in self.detections])

    def antispoof(self) -> float:
        scores = [MODELS.antispoof_score(frame, detection.bbox) for frame, detection in self.detections]
        return float(np.mean(scores))

    def embeddings(self) -> list[np.ndarray]:
        return [
            l2_normalise(detection.embedding)
            for _, detection in self.detections
            if detection.embedding is not None
        ]

    def mean_embedding(self) -> np.ndarray:
        vectors = self.embeddings()
        if not vectors:
            raise Refusal(422, "no_face")
        return core.centroid(vectors)

    def best_detection(self):
        return max(self.detections, key=lambda item: item[1].score)
