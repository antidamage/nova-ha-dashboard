"""Pipeline: per-clip orientation, detection and liveness/antispoof judging.

`ClipAnalysis` is one cohesive unit — its orientation-correction staticmethods
close over each other and over the same detection loop `__init__` runs, and
splitting them into separate modules would either duplicate that loop or force
several of them to become public exports that exist only for each other to
call (`specs/agent-token-footprint.md` §2 criteria 2 and 3).
"""

from __future__ import annotations

import cv2
import numpy as np
from core import (
    aggregate_frames,
    cosine_match,
    detection_reason,
    framing_reason,
    l2_normalise,
    liveness_decision,
    quarter_turns_to_upright,
    roll_degrees,
)

import core

from .config import (
    ANTISPOOF_MIN,
    BOX_MIN_PX,
    DET_SCORE_MIN,
    LIVENESS_MIN_FRAMES,
    LIVENESS_RESIDUAL_MAX,
    LIVENESS_RESIDUAL_MIN,
    LOG,
    MATCH_COSINE,
    MATCH_MARGIN,
    MIN_AGREEING_FRAMES,
    MODELS,
    QUARTER_TURN,
)
from .errors import Refusal


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

    @staticmethod
    def _upright(frames: list[np.ndarray]) -> tuple[list[np.ndarray], int]:
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
            turns = ClipAnalysis._turns_from_landmarks(frame)
            if turns is None:
                continue
            if turns:
                LOG.info("clip arrived rotated; correcting by %d quarter turn(s)", turns)
            return ClipAnalysis._rotate(frames, turns), turns

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
                turns = ClipAnalysis._turns_from_landmarks(cv2.rotate(probes[0], QUARTER_TURN[pre]))
                if turns is None:
                    continue
                total = (pre + turns) % 4
                LOG.info(
                    "no face at the incoming orientation; detected after %d quarter turn(s), "
                    "correcting the clip by %d",
                    pre,
                    total,
                )
                return ClipAnalysis._rotate(frames, total), total
        return frames, 0

    @staticmethod
    def _turns_from_landmarks(frame: np.ndarray) -> int | None:
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

    @staticmethod
    def _rotate(frames: list[np.ndarray], turns: int) -> list[np.ndarray]:
        turns %= 4
        if turns == 0:
            return frames
        return [cv2.rotate(item, QUARTER_TURN[turns]) for item in frames]

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


def run_liveness(analysis: ClipAnalysis, profile: core.CaptureProfile | None = None) -> tuple[float | None, float | None]:
    """Both signals enforce, and both are returned so both get logged.

    The residual does not stand alone: a video replay on a screen is not
    geometrically rigid and passes it. The nonce and the texture model exist
    because of that.

    A profile can switch either signal off, and then that signal is not measured
    at all rather than measured and ignored — running a model whose verdict is
    discarded costs GPU time on the path that exists to be fast, and a logged
    score nothing enforced would read in `attempts` as though a gate had passed.
    `None` in the returned pair means "not run", which is what the caller logs.
    """

    profile = profile or core.CAPTURE_PROFILES[core.DEFAULT_CAPTURE_PROFILE]
    if not profile.liveness and not profile.antispoof:
        LOG.info("liveness and antispoof SKIPPED for profile=%s", profile.name)
        return None, None

    residual: float | None = None
    if profile.liveness:
        decision = liveness_decision(
            analysis.track(),
            residual_min=LIVENESS_RESIDUAL_MIN,
            residual_max=LIVENESS_RESIDUAL_MAX,
            min_frames=LIVENESS_MIN_FRAMES,
        )
        if not decision.ok:
            # Log the refusal too, not just the pass. The first live enrolment
            # produced a run of 401s whose only visible evidence was the residual
            # line -- which is emitted AFTER this branch, so every refusal here was
            # silent and indistinguishable from the anti-spoof refusal below.
            LOG.info(
                "liveness REFUSED reason=%s residual=%s frames=%d",
                decision.reason, decision.residual, analysis.usable,
            )
            raise Refusal(decision.status, decision.reason or "too_few_frames", residual=decision.residual)
        LOG.info("liveness residual %.5f by landmark %s", decision.residual, decision.per_landmark)
        residual = float(decision.residual or 0.0)

    antispoof: float | None = None
    if profile.antispoof:
        antispoof = analysis.antispoof()
        # Always log the score, pass or fail. The spec's whole calibration story is
        # "record the actual score of every signal on every attempt so thresholds
        # can be tuned from real logs rather than guessed twice" -- and this is the
        # signal whose threshold is explicitly a guess. Logging it only on success
        # would hide exactly the data the guess needs.
        LOG.info("antispoof score %.4f (min %.4f) -> %s",
                 antispoof, ANTISPOOF_MIN, "pass" if antispoof >= ANTISPOOF_MIN else "REFUSE")
        if antispoof < ANTISPOOF_MIN:
            raise Refusal(401, "antispoof", residual=residual, antispoof=round(antispoof, 4))

    return residual, antispoof


def identify_frames(analysis: ClipAnalysis, gallery: dict[str, list[np.ndarray]], min_agreeing: int | None = None):
    votes = [
        cosine_match(embedding, gallery, threshold=MATCH_COSINE, margin=MATCH_MARGIN)
        for embedding in analysis.embeddings()
    ]
    return votes, aggregate_frames(
        votes, min_agreeing=MIN_AGREEING_FRAMES if min_agreeing is None else min_agreeing
    )
