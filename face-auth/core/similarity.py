"""Umeyama/Procrustes similarity fit and the landmark-motion liveness residual."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .constants import (
    LANDMARK_NAMES,
    LEFT_EYE,
    LIVENESS_MIN_FRAMES,
    LIVENESS_RESIDUAL_MAX,
    LIVENESS_RESIDUAL_MIN,
    RIGHT_EYE,
)


@dataclass(frozen=True)
class Similarity:
    """Scale, rotation and translation. No shear, and never a reflection."""

    scale: float
    rotation: np.ndarray
    translation: np.ndarray

    def apply(self, points: np.ndarray) -> np.ndarray:
        points = np.asarray(points, dtype=np.float64)
        return self.scale * (points @ self.rotation.T) + self.translation


def fit_similarity(source: np.ndarray, target: np.ndarray) -> Similarity:
    """Least-squares similarity transform taking `source` onto `target`.

    Umeyama 1991. The reflection guard is the whole point of writing this by
    hand: a plain SVD solution is free to pick a mirrored rotation, and a
    mirrored face fits its own mirror image *perfectly*. Left unguarded, the
    residual — the entire liveness signal — is driven to zero by exactly the
    kind of geometric trick a spoof produces. Correcting the sign of the last
    singular direction when ``det(U)·det(Vᵀ) < 0`` keeps the solution inside
    the proper rotations, so a flipped track has to pay for being flipped.
    """

    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    if source.shape != target.shape or source.ndim != 2:
        raise ValueError("source and target must be matching (n, d) point sets")
    count, dimensions = source.shape
    if count < dimensions + 1:
        raise ValueError("need at least d+1 points to fit a similarity transform")

    source_mean = source.mean(axis=0)
    target_mean = target.mean(axis=0)
    source_centred = source - source_mean
    target_centred = target - target_mean

    covariance = (target_centred.T @ source_centred) / count
    u, singular_values, vt = np.linalg.svd(covariance)

    correction = np.eye(dimensions)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        correction[-1, -1] = -1.0

    rotation = u @ correction @ vt
    variance = float((source_centred**2).sum() / count)
    if variance < 1e-12:
        raise ValueError("degenerate source point set has no scale")
    scale = float((singular_values * np.diag(correction)).sum() / variance)
    translation = target_mean - scale * (rotation @ source_mean)
    return Similarity(scale=scale, rotation=rotation, translation=translation)


def inter_ocular_distance(shape: np.ndarray) -> float:
    """Eye-to-eye distance, the unit every residual is expressed in.

    Dividing by this is what makes the liveness number mean the same thing at
    arm's length and across the room.
    """

    shape = np.asarray(shape, dtype=np.float64)
    distance = float(np.linalg.norm(shape[RIGHT_EYE] - shape[LEFT_EYE]))
    if not np.isfinite(distance) or distance < 1e-9:
        raise ValueError("landmark set has no measurable inter-ocular distance")
    return distance


def canonical_shape(shape: np.ndarray) -> np.ndarray:
    """Put one frame in eye-normalised coordinates: eyes at (±0.5, 0).

    A closed form rather than a fit, and that matters. The reference shape is a
    coordinate-wise median, and a coordinate-wise median is not equivariant
    under rotation — median(R·X) ≠ R·median(X) — so taking the median in the
    raw image frame leaks the camera's orientation into the residual. Mapping
    every frame into a frame the global similarity cannot reach first makes the
    reference, and therefore the residual, exactly invariant.
    """

    shape = np.asarray(shape, dtype=np.float64)
    axis = shape[RIGHT_EYE] - shape[LEFT_EYE]
    unit = inter_ocular_distance(shape)
    cos_angle, sin_angle = axis[0] / unit, axis[1] / unit
    rotation = np.array([[cos_angle, sin_angle], [-sin_angle, cos_angle]])
    centred = shape - (shape[LEFT_EYE] + shape[RIGHT_EYE]) / 2.0
    return (centred @ rotation.T) / unit


def reference_shape(track: np.ndarray) -> np.ndarray:
    """Per-landmark median shape of a clip, with global motion removed first.

    A raw median across frames that still contain head motion is a smear of
    poses, not a shape. Each frame is canonicalised, then the median is taken
    there; the result has its eyes at (±0.5, 0) by construction, so its
    inter-ocular distance is 1 and the residual comes out already normalised.
    """

    track = np.asarray(track, dtype=np.float64)
    return np.median(np.stack([canonical_shape(frame) for frame in track]), axis=0)


@dataclass(frozen=True)
class ResidualReport:
    residual: float
    per_landmark: dict[str, float]
    frames: int

    def as_dict(self) -> dict[str, object]:
        return {
            "residual": round(self.residual, 6),
            "perLandmark": {name: round(value, 6) for name, value in self.per_landmark.items()},
            "frames": self.frames,
        }


def landmark_residual(track: np.ndarray) -> ResidualReport:
    """Motion left in a landmark track after rigid motion is removed.

    A photograph — held still, tilted, waved — is rigid under similarity
    motion, so once scale, rotation and translation are fitted away almost
    nothing remains. A live face keeps blinking, speaking and turning slightly
    out of plane, and those do not fit. The aggregate is an RMS over frames and
    landmarks, normalised by the reference shape's inter-ocular distance; the
    per-landmark breakdown goes to the log because a clip whose residual is
    carried entirely by the mouth is worth a look.

    This does not catch a video replay on a screen, which is non-rigid in
    exactly the same way the original face was. See the spec — the nonce and
    the texture model exist because of that, and this number must never be
    presented as if it stood alone.
    """

    track = np.asarray(track, dtype=np.float64)
    if track.ndim != 3 or track.shape[1] < 3:
        raise ValueError("track must be (frames, landmarks, 2) with at least 3 landmarks")
    if track.shape[0] < 2:
        raise ValueError("a residual needs at least two frames")

    reference = reference_shape(track)
    unit = inter_ocular_distance(reference)
    errors = np.empty((track.shape[0], track.shape[1]), dtype=np.float64)
    for index, frame in enumerate(track):
        fitted = fit_similarity(frame, reference).apply(frame)
        errors[index] = np.linalg.norm(fitted - reference, axis=1)

    aggregate = float(np.sqrt((errors**2).mean())) / unit
    per_landmark = {
        LANDMARK_NAMES[index] if index < len(LANDMARK_NAMES) else f"point{index}":
            float(np.sqrt((errors[:, index] ** 2).mean())) / unit
        for index in range(track.shape[1])
    }
    return ResidualReport(residual=aggregate, per_landmark=per_landmark, frames=int(track.shape[0]))


@dataclass(frozen=True)
class LivenessDecision:
    ok: bool
    reason: str | None
    status: int
    residual: float | None
    per_landmark: dict[str, float] = field(default_factory=dict)
    frames: int = 0


def liveness_decision(
    track: np.ndarray,
    *,
    residual_min: float = LIVENESS_RESIDUAL_MIN,
    residual_max: float = LIVENESS_RESIDUAL_MAX,
    min_frames: int = LIVENESS_MIN_FRAMES,
) -> LivenessDecision:
    """Gate a landmark track on the residual, with a ceiling as well as a floor.

    Above the ceiling the track is incoherent — motion blur, a tracking
    failure, two faces swapping. That is not "very alive", it is untrustworthy,
    and it refuses rather than passes.
    """

    track = np.asarray(track, dtype=np.float64)
    if track.ndim != 3 or track.shape[0] < min_frames:
        return LivenessDecision(
            ok=False, reason="too_few_frames", status=422, residual=None,
            frames=int(track.shape[0]) if track.ndim == 3 else 0,
        )
    report = landmark_residual(track)
    if report.residual < residual_min:
        return LivenessDecision(False, "liveness_rigid", 401, report.residual, report.per_landmark, report.frames)
    if report.residual > residual_max:
        return LivenessDecision(False, "liveness_unstable", 422, report.residual, report.per_landmark, report.frames)
    return LivenessDecision(True, None, 200, report.residual, report.per_landmark, report.frames)
