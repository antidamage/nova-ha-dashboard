"""Pure face-authentication maths and decisions.

numpy is the only third-party import, deliberately. Nothing here loads a model,
touches a GPU, opens a file, reads the environment or knows what FastAPI is, so
the whole design — the liveness test, the match refusals, the enrolment rules,
the network binding and the lockout machine — is testable without the inference
container. (`ipaddress` and `dataclasses` are stdlib and equally pure; the
network gate is arithmetic on addresses, not a socket.)

Every threshold arrives as a keyword argument carrying the default from
`specs/face-auth.md`. The service reads the environment and passes the values
down; this module never reads it, so a test can pin a threshold without
touching process state.

Landmark order throughout is RetinaFace's five points, in RetinaFace's order:
0 left eye, 1 right eye, 2 nose tip, 3 left mouth corner, 4 right mouth corner.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field

import numpy as np

LEFT_EYE, RIGHT_EYE, NOSE, LEFT_MOUTH, RIGHT_MOUTH = 0, 1, 2, 3, 4
LANDMARK_NAMES = ("leftEye", "rightEye", "nose", "leftMouth", "rightMouth")

# Spec defaults. Repeated as keyword defaults below; named here so the service's
# environment block and the tests can refer to the same constants.
DET_SCORE_MIN = 0.70
# Above this fraction of frame height a face leaves too little context for the
# anti-spoof model, whose print/replay evidence is largely in the surroundings.
# 0.92 not 0.75: the measured good captures sat at 0.75-0.76 and scored 0.999,
# so this is a backstop against a face that fills the frame, not a framing
# preference.
FACE_MAX_FRAME_FRACTION = 0.92
BOX_MIN_PX = 96
MATCH_COSINE = 0.42
MATCH_MARGIN = 0.06
MIN_AGREEING_FRAMES = 12
LIVENESS_RESIDUAL_MIN = 0.012
LIVENESS_RESIDUAL_MAX = 0.080
LIVENESS_MIN_FRAMES = 15
ANTISPOOF_MIN = 0.85
CLIP_MIN_SECONDS = 0.8
CLIP_MAX_SECONDS = 2.5
CLIP_MIN_FPS = 20.0
CLIP_MAX_BYTES = 8 * 1024 * 1024
# Max cosine distance from the nearest already-accepted clip. 0.45, raised from
# 0.30 on 2026-09-03 with measurements in hand.
#
# Adeline's five clips — one session, one appearance — already spanned 0.076 to
# 0.368 from their own centre, with pairs 0.849 apart. A limit of 0.30 was
# therefore marginal for a SINGLE appearance and would have refused a second one
# (wig on, glasses off) outright.
#
# 0.45 still separates the cases that matter. Two different people's ArcFace
# vectors are near-orthogonal — cosine around 0, so distance near 1.0 — an order
# of magnitude past this. What this rule catches is a clip that resembles nothing
# the subject has enrolled; what protects identity is `conflicts_with_subject`,
# which is unchanged and refuses any clip resembling a DIFFERENT enrolled person.
ENROL_CENTROID_MAX = 0.45
ENROL_MIN_CLIPS = 5
SAMPLE_FRAMES = 25

# --- Capture profiles -------------------------------------------------------
#
# Which gates run is a property of the SURFACE that asked for the sign-in, not
# of the service. `specs/login-surface.md` § Capture profiles is the authority;
# the short answer is that a 1 s clip cannot carry the non-rigid motion the
# residual measures, and a floor low enough to pass a genuine 1 s capture is low
# enough to pass a photograph. So the short paths switch the gate OFF rather
# than tune it to a number that only looks like a gate.
#
# Adeline, 2026-09-09, asked for anti-spoof off on those paths too. It is
# frame-level and would have survived a shorter clip on the merits; `image`
# could not carry it in any case.
#
# What this costs is stated in the spec and repeated here because it is the kind
# of thing a reader of this table needs to know: on `quick` and `image` a
# printed photograph of an enrolled person is a working sign-in. What bounds it
# is the session — see `QUICK_IDLE_TIMEOUT_SECONDS` — not the capture.
#
# Recognition is identical on every profile. MATCH_COSINE, MATCH_MARGIN and
# MIN_AGREEING_FRAMES are not profile-dependent and must not become so: the
# question "is this the enrolled person" does not get easier on a short clip.

# Idle, not absolute. A person working continuously is not thrown out mid-task;
# an unattended session does not outlive the person who walked away.
QUICK_IDLE_TIMEOUT_SECONDS = 900

# A streamed capture stops at this many good frames; later stills are not
# analysed. At most FRAME_STREAM_MAX_FRAMES stills are analysed per nonce — the
# browser gives up after 5 s, so this only bounds a client that does not.
STREAM_GOOD_FRAMES = 2
FRAME_STREAM_MAX_FRAMES = 60


@dataclass(frozen=True)
class CaptureProfile:
    """One row of the profile table.

    `clip_min_seconds`/`clip_max_seconds` of None mean "use the service's
    configured bounds", which is how `standard` picks up the FACE_CLIP_*
    environment overrides without restating them.
    """

    name: str
    liveness: bool
    antispoof: bool
    single_image: bool = False
    # Stills posted one at a time to /frame, held against the nonce as
    # embeddings, and judged by /assert with no upload of its own. There is no
    # clip, so the clip bounds never apply. The frames themselves are not kept,
    # which is why a streamed profile can never run liveness or anti-spoof —
    # both need pixels or a landmark track across a clip.
    frame_stream: bool = False
    clip_min_seconds: float | None = None
    clip_max_seconds: float | None = None
    idle_timeout_seconds: int | None = None
    # None means "the service's configured value". Only `image` overrides these,
    # and only because one frame is all it has: a single still cannot clear a
    # 15-frame floor or win a 12-of-25 vote, and those two numbers are the whole
    # reason a still would otherwise be refused rather than judged.
    min_frames: int | None = None
    min_agreeing: int | None = None


CAPTURE_PROFILES: dict[str, CaptureProfile] = {
    "standard": CaptureProfile(name="standard", liveness=True, antispoof=True),
    # Two good stills, then stop (Adeline, 2026-09-11). Replaced a 1 s clip that
    # a low-frame-rate webcam could not deliver: it was refused clip_too_short /
    # clip_low_fps before a face was ever looked at. Either good frame may carry
    # the match.
    "quick": CaptureProfile(
        name="quick", liveness=False, antispoof=False, frame_stream=True,
        idle_timeout_seconds=QUICK_IDLE_TIMEOUT_SECONDS,
        min_frames=STREAM_GOOD_FRAMES, min_agreeing=1,
    ),
    "image": CaptureProfile(
        name="image", liveness=False, antispoof=False, single_image=True,
        idle_timeout_seconds=QUICK_IDLE_TIMEOUT_SECONDS,
        min_frames=1, min_agreeing=1,
    ),
}

DEFAULT_CAPTURE_PROFILE = "standard"


def capture_profile(name: str | None) -> CaptureProfile:
    """Resolve a submitted profile name, refusing anything unknown.

    An unknown name is not silently downgraded to `standard`: a caller asking
    for a profile this service does not have is a caller whose expectations do
    not match what would actually run, and guessing on its behalf is how a
    surface ends up believing it relaxed a gate that stayed on, or the reverse.
    """

    resolved = (name or DEFAULT_CAPTURE_PROFILE).strip().lower()
    profile = CAPTURE_PROFILES.get(resolved)
    if profile is None:
        raise ValueError(f"unknown capture profile: {resolved!r}")
    return profile


@dataclass
class HeldStream:
    """What /frame has gathered for one nonce: good detections and skip reasons."""

    started: float
    good: list = field(default_factory=list)
    rejections: list[str] = field(default_factory=list)
    analysed: int = 0


class FrameHold:
    """Per-nonce buffer for streamed stills, in memory only.

    Holds detections (box, landmarks, embedding), never pixels. Entries are
    dropped when /assert takes them, or by the sweep once they are older than
    `ttl_seconds` — the nonce they belong to has expired by then, so nothing can
    ever claim them.

    Not thread-safe on its own; the service calls it from the event loop only.
    """

    def __init__(
        self,
        *,
        good_needed: int = STREAM_GOOD_FRAMES,
        max_frames: int = FRAME_STREAM_MAX_FRAMES,
        ttl_seconds: float = 20.0,
    ) -> None:
        self.good_needed = good_needed
        self.max_frames = max_frames
        self.ttl_seconds = ttl_seconds
        self._held: dict[str, HeldStream] = {}

    def _sweep(self, now: float) -> None:
        stale = [nonce for nonce, held in self._held.items() if now - held.started > self.ttl_seconds]
        for nonce in stale:
            del self._held[nonce]

    def get(self, nonce: str, now: float) -> HeldStream:
        self._sweep(now)
        held = self._held.get(nonce)
        if held is None:
            held = self._held[nonce] = HeldStream(started=now)
        return held

    def complete(self, held: HeldStream) -> bool:
        return len(held.good) >= self.good_needed

    def exhausted(self, held: HeldStream) -> bool:
        return held.analysed >= self.max_frames

    def record(self, held: HeldStream, good: list, rejections: list[str]) -> None:
        """Fold one analysed still in. Only the first `good_needed` good frames are kept."""

        held.analysed += 1
        held.rejections.extend(rejections)
        room = self.good_needed - len(held.good)
        if room > 0:
            held.good.extend(good[:room])

    def take(self, nonce: str) -> HeldStream | None:
        return self._held.pop(nonce, None)

# Control defaults, from the "Control thresholds" table in specs/face-auth.md.
LOCKOUT_FAILURES = 5
LOCKOUT_GLOBAL_FAILURES = 12
LOCKOUT_WINDOW_SECONDS = 900
RELEASE_MAX_PER_HOUR = 6
RELEASE_WINDOW_SECONDS = 3600
VETO_LINK_TTL_SECONDS = 900

# The tailnet CGNAT range only. The household LAN prefix is deliberately *not*
# a default: this repo is public and the spec's secrets rule forbids a host
# address or subnet in shipped code. It is supplied by `FACE_ALLOWED_CIDRS` in
# /etc/nova-face-auth.env, and an unconfigured host therefore allows only the
# tailnet rather than allowing everything.
ALLOWED_CIDRS_DEFAULT = "100.64.0.0/10"


# ---------------------------------------------------------------------------
# Vector helpers
# ---------------------------------------------------------------------------


def l2_normalise(vector: np.ndarray) -> np.ndarray:
    """Unit-length copy. ArcFace comparisons are cosine, so this is required."""

    values = np.asarray(vector, dtype=np.float64).reshape(-1)
    norm = float(np.linalg.norm(values))
    if not np.isfinite(norm) or norm < 1e-12:
        raise ValueError("cannot normalise a zero or non-finite embedding")
    return values / norm


def cosine(left: np.ndarray, right: np.ndarray) -> float:
    """Cosine similarity, normalising defensively rather than trusting callers."""

    return float(np.dot(l2_normalise(left), l2_normalise(right)))


def centroid(embeddings: list[np.ndarray]) -> np.ndarray:
    """Mean of unit vectors, renormalised — the running enrolment centre."""

    if not embeddings:
        raise ValueError("centroid of an empty gallery is undefined")
    stacked = np.stack([l2_normalise(item) for item in embeddings])
    return l2_normalise(stacked.mean(axis=0))


# ---------------------------------------------------------------------------
# Similarity (Umeyama/Procrustes) fit
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Match:
    subject: str
    score: float
    runner_up: float


def gallery_scores(probe: np.ndarray, gallery: dict[str, list[np.ndarray]]) -> list[tuple[str, float]]:
    """Best cosine per subject, descending. Logged whether or not it matched."""

    probe = l2_normalise(probe)
    scores = [
        (subject, max(float(np.dot(probe, l2_normalise(vector))) for vector in vectors))
        for subject, vectors in gallery.items()
        if vectors
    ]
    return sorted(scores, key=lambda item: item[1], reverse=True)


def cosine_match(
    probe: np.ndarray,
    gallery: dict[str, list[np.ndarray]],
    *,
    threshold: float = MATCH_COSINE,
    margin: float = MATCH_MARGIN,
) -> Match | None:
    """Top subject, or None.

    None covers three cases that all mean the same thing operationally: an
    empty gallery, a top score under the threshold, and a runner-up inside the
    margin. The last is the one that matters — an ambiguous face is a refusal,
    never a coin toss between two household members. `gallery_scores` is there
    for the caller that wants the numbers for the audit row.
    """

    ordered = gallery_scores(probe, gallery)
    if not ordered:
        return None
    subject, score = ordered[0]
    runner_up = ordered[1][1] if len(ordered) > 1 else 0.0
    if score < threshold or score - runner_up < margin:
        return None
    return Match(subject=subject, score=score, runner_up=runner_up)


@dataclass(frozen=True)
class FrameAggregate:
    subject: str
    agreeing: int
    usable: int
    top_score: float
    runner_up: float


def aggregate_frames(
    votes: list[Match | None],
    *,
    min_agreeing: int = MIN_AGREEING_FRAMES,
) -> FrameAggregate | None:
    """Fold per-frame matches into one decision, or refuse.

    A majority of the sampled frames must name the same subject, so a single
    well-timed frame cannot carry a login. Frames that refused stay in the
    denominator — they are evidence against, not missing data.
    """

    usable = len(votes)
    tally: dict[str, list[Match]] = {}
    for vote in votes:
        if vote is not None:
            tally.setdefault(vote.subject, []).append(vote)
    if not tally:
        return None
    subject, matches = max(tally.items(), key=lambda item: len(item[1]))
    if len(matches) < min_agreeing:
        return None
    # Two subjects with the same count is no decision. It matters most where the
    # vote is 1 of 2 (`quick`): frames naming two different people must not be
    # settled by which one happened to be sampled first.
    if sum(1 for items in tally.values() if len(items) == len(matches)) > 1:
        return None
    return FrameAggregate(
        subject=subject,
        agreeing=len(matches),
        usable=usable,
        top_score=max(item.score for item in matches),
        runner_up=max(item.runner_up for item in matches),
    )


# ---------------------------------------------------------------------------
# Enrolment
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConsistencyReport:
    ok: bool
    index: int | None
    reason: str | None
    centroid_distance: float | None
    nearest_other_subject: str | None
    nearest_other_score: float | None

    def as_dict(self) -> dict[str, object]:
        return {
            "centroidDistance": None if self.centroid_distance is None else round(self.centroid_distance, 4),
            "nearestOtherSubject": None if self.nearest_other_score is None else round(self.nearest_other_score, 4),
            "nearestOtherSubjectId": self.nearest_other_subject,
        }


def enrolment_consistency(
    embeddings: list[np.ndarray],
    *,
    others: dict[str, list[np.ndarray]] | None = None,
    centroid_max: float = ENROL_CENTROID_MAX,
    match_cosine: float = MATCH_COSINE,
) -> ConsistencyReport:
    """Check a subject's accepted embeddings, newest last, against two rules.

    Every member must sit within `centroid_max` cosine distance of the NEAREST
    member accepted before it, and no member may sit within
    `match_cosine` of a *different* existing subject — two overlapping
    galleries mean neither person can be matched unambiguously afterwards, and
    the failure surfaces long after enrolment if it is not caught here.

    The offending index is named so the caller can say which clip, rather than
    condemning the whole set. The service passes accepted-plus-candidate and
    rejects the clip when the reported index is the last one.
    """

    others = others or {}
    if not embeddings:
        raise ValueError("nothing to check")
    normalised = [l2_normalise(item) for item in embeddings]

    for index, vector in enumerate(normalised):
        conflicts = gallery_scores(vector, others)
        if conflicts and conflicts[0][1] >= match_cosine:
            return ConsistencyReport(
                ok=False, index=index, reason="conflicts_with_subject",
                centroid_distance=None,
                nearest_other_subject=conflicts[0][0], nearest_other_score=conflicts[0][1],
            )
        if index == 0:
            continue
        # Distance to the NEAREST clip already accepted, not to their centroid.
        #
        # A centroid assumes one appearance. Adeline wears a wig sometimes and
        # glasses sometimes, and either changes the embedding: glasses more than
        # the wig, because ArcFace aligns on the eyes and crops to roughly
        # eyebrows-to-chin, so the frames sit across the most heavily weighted
        # region while most hair falls outside the crop. Enrolling the second
        # appearance is the whole fix for that -- matching is max-per-subject
        # (`gallery_scores`), so a wig-on attempt only has to match the wig-on
        # clips. A centroid rule makes that impossible: the second appearance is
        # far from the mean of the first by construction, and gets refused as
        # "inconsistent" before it can ever be stored.
        #
        # Nearest-member lets a subject hold several appearance clusters while
        # still refusing a clip that resembles nothing they have enrolled. The
        # rule that actually protects identity is the `conflicts_with_subject`
        # check above, which is unchanged: no clip may look like a DIFFERENT
        # enrolled person.
        distance = min(1.0 - float(np.dot(vector, other)) for other in normalised[:index])
        if distance > centroid_max:
            return ConsistencyReport(
                ok=False, index=index, reason="inconsistent", centroid_distance=distance,
                nearest_other_subject=conflicts[0][0] if conflicts else None,
                nearest_other_score=conflicts[0][1] if conflicts else None,
            )

    last = normalised[-1]
    conflicts = gallery_scores(last, others)
    distance = (
        0.0 if len(normalised) == 1
        else min(1.0 - float(np.dot(last, other)) for other in normalised[:-1])
    )
    return ConsistencyReport(
        ok=True, index=None, reason=None, centroid_distance=distance,
        nearest_other_subject=conflicts[0][0] if conflicts else None,
        nearest_other_score=conflicts[0][1] if conflicts else None,
    )


# ---------------------------------------------------------------------------
# Clip shape
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Network binding
# ---------------------------------------------------------------------------


def parse_cidrs(specification: str | None) -> list[ipaddress._BaseNetwork]:
    """Parse a comma-separated CIDR list, dropping nothing silently.

    A single unparseable entry makes the whole list empty rather than a
    shorter list that still allows something. Half-understanding an allow-list
    is how a typo turns into an open door; refusing the list outright turns the
    same typo into a locked door, which is the failure this design wants.
    """

    if not specification:
        return []
    networks: list[ipaddress._BaseNetwork] = []
    for entry in specification.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            return []
    return networks


def client_address(
    forwarded_for: str | None,
    peer: str | None,
    *,
    trust_forwarded: bool = True,
) -> str | None:
    """The address the network gate judges: Caddy's forwarded client, then peer.

    Caddy terminates TLS and is the only thing in front of the service, so the
    left-most `X-Forwarded-For` entry is the real client. `trust_forwarded` is
    the switch for a topology where the service is directly reachable and the
    header would be attacker-supplied — there it must be ignored entirely, not
    merely preferred less.
    """

    if trust_forwarded and forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return first
    peer = (peer or "").strip()
    return peer or None


def network_allowed(address: str | None, networks: list[ipaddress._BaseNetwork]) -> bool:
    """Default-deny membership test.

    Every "no" case collapses to the same answer on purpose: no address, an
    address that will not parse, and an empty or unparseable CIDR list all
    refuse. There is no branch here that ends in "allow because we could not
    tell".
    """

    if not networks or not address:
        return False
    candidate = address.strip()
    if candidate.startswith("[") and "]" in candidate:  # [::1]:port
        candidate = candidate[1:candidate.index("]")]
    try:
        parsed = ipaddress.ip_address(candidate)
    except ValueError:
        # A bare "host:port" from a peer tuple, but never an IPv6 guess — an
        # ambiguous address is refused rather than half-parsed.
        if candidate.count(":") == 1:
            try:
                parsed = ipaddress.ip_address(candidate.split(":")[0])
            except ValueError:
                return False
        else:
            return False
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped is not None:
        parsed = parsed.ipv4_mapped
    return any(parsed in network for network in networks)


# ---------------------------------------------------------------------------
# Lockout and release-rate accounting
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LockoutState:
    """One row of the `lockouts` table, as a value.

    `armed` is the durable switch. It lives under the `global` scope in SQLite
    rather than in process memory, because restarting a container is the
    cheapest thing an attacker on the LAN can cause and a restart must not
    clear a lockout.
    """

    failures: int = 0
    window_start: float = 0.0
    armed: bool = True

    def as_dict(self) -> dict[str, object]:
        return {"failures": self.failures, "windowStart": self.window_start, "armed": self.armed}


def register_failure(
    state: LockoutState,
    now: float,
    *,
    max_failures: int = LOCKOUT_FAILURES,
    window_seconds: int = LOCKOUT_WINDOW_SECONDS,
) -> LockoutState:
    """Fold one refusal into a scope's counter and trip `armed` at the limit.

    The window is a fixed span from the first failure in it, not a sliding
    decay — an attacker cannot hold the counter open cheaply, and yesterday's
    failures cannot lock out today's login. Reaching `max_failures` sets
    `armed = False`, and nothing in this module ever sets it back: re-arming is
    a password + TOTP action, and it must not be reachable by presenting a face.
    """

    if state.window_start <= 0 or now - state.window_start >= window_seconds:
        failures, window_start = 1, now
    else:
        failures, window_start = state.failures + 1, state.window_start
    armed = state.armed and failures < max_failures
    return LockoutState(failures=failures, window_start=window_start, armed=armed)


def lockout_reason(
    state: LockoutState,
    now: float,
    *,
    max_failures: int = LOCKOUT_FAILURES,
    window_seconds: int = LOCKOUT_WINDOW_SECONDS,
) -> str | None:
    """`disarmed`, `locked_out`, or None. Never clears anything.

    Disarm is checked first because it is the durable state a human or a
    Discord veto set, and it outranks a counter that may have aged out.
    """

    if not state.armed:
        return "disarmed"
    if state.window_start > 0 and now - state.window_start < window_seconds and state.failures >= max_failures:
        return "locked_out"
    return None


def release_rate_exceeded(
    releases: list[float],
    now: float,
    *,
    max_per_hour: int = RELEASE_MAX_PER_HOUR,
    window_seconds: int = RELEASE_WINDOW_SECONDS,
) -> bool:
    """Would one more successful release exceed the cap in the rolling window?

    Successful releases are capped as well as failures because a spoof that
    works once can otherwise be replayed for fresh sessions indefinitely.
    Exceeding this is an attack signal, not backpressure: the caller disarms on
    it rather than asking the client to slow down.
    """

    if max_per_hour <= 0:
        return True
    recent = [stamp for stamp in releases if now - stamp < window_seconds]
    return len(recent) + 1 > max_per_hour


# ---------------------------------------------------------------------------
# Gate ordering
# ---------------------------------------------------------------------------

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
