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

This is a facade package: the body lives in the sibling modules below, split
by concern (`specs/agent-token-footprint.md` §4). Everything importable from
here as `core.X` before the split remains importable the same way.
"""

from __future__ import annotations

from .capture_profiles import (
    CAPTURE_PROFILES,
    CaptureProfile,
    DEFAULT_CAPTURE_PROFILE,
    FrameHold,
    HeldStream,
    capture_profile,
)
from .clip_shape import clip_bounds_reason, detection_reason, even_frame_indices, framing_reason
from .constants import (
    ALLOWED_CIDRS_DEFAULT,
    ANTISPOOF_MIN,
    BOX_MIN_PX,
    CLIP_MAX_BYTES,
    CLIP_MAX_SECONDS,
    CLIP_MIN_FPS,
    CLIP_MIN_SECONDS,
    DET_SCORE_MIN,
    ENROL_CENTROID_MAX,
    ENROL_MIN_CLIPS,
    FACE_MAX_FRAME_FRACTION,
    FRAME_STREAM_MAX_FRAMES,
    LANDMARK_NAMES,
    LEFT_EYE,
    LEFT_MOUTH,
    LIVENESS_MIN_FRAMES,
    LIVENESS_RESIDUAL_MAX,
    LIVENESS_RESIDUAL_MIN,
    LOCKOUT_FAILURES,
    LOCKOUT_GLOBAL_FAILURES,
    LOCKOUT_WINDOW_SECONDS,
    MATCH_COSINE,
    MATCH_MARGIN,
    MIN_AGREEING_FRAMES,
    NOSE,
    QUICK_IDLE_TIMEOUT_SECONDS,
    RELEASE_MAX_PER_HOUR,
    RELEASE_WINDOW_SECONDS,
    RIGHT_EYE,
    RIGHT_MOUTH,
    SAMPLE_FRAMES,
    STREAM_GOOD_FRAMES,
    VETO_LINK_TTL_SECONDS,
)
from .enrolment import ConsistencyReport, enrolment_consistency
from .gate_ordering import (
    GATE_STATUS,
    SUBJECT_ID_PATTERN,
    preflight_reason,
    quarter_turns_to_upright,
    roll_degrees,
    valid_subject_id,
)
from .lockout import LockoutState, lockout_reason, register_failure, release_rate_exceeded
from .matching import FrameAggregate, Match, aggregate_frames, cosine_match, gallery_scores
from .network import client_address, network_allowed, parse_cidrs
from .similarity import (
    LivenessDecision,
    ResidualReport,
    Similarity,
    canonical_shape,
    fit_similarity,
    inter_ocular_distance,
    landmark_residual,
    liveness_decision,
    reference_shape,
)
from .vectors import centroid, cosine, l2_normalise

__all__ = [
    "ALLOWED_CIDRS_DEFAULT",
    "ANTISPOOF_MIN",
    "BOX_MIN_PX",
    "CAPTURE_PROFILES",
    "CLIP_MAX_BYTES",
    "CLIP_MAX_SECONDS",
    "CLIP_MIN_FPS",
    "CLIP_MIN_SECONDS",
    "CaptureProfile",
    "ConsistencyReport",
    "DEFAULT_CAPTURE_PROFILE",
    "DET_SCORE_MIN",
    "ENROL_CENTROID_MAX",
    "ENROL_MIN_CLIPS",
    "FACE_MAX_FRAME_FRACTION",
    "FRAME_STREAM_MAX_FRAMES",
    "FrameAggregate",
    "FrameHold",
    "GATE_STATUS",
    "HeldStream",
    "LANDMARK_NAMES",
    "LEFT_EYE",
    "LEFT_MOUTH",
    "LIVENESS_MIN_FRAMES",
    "LIVENESS_RESIDUAL_MAX",
    "LIVENESS_RESIDUAL_MIN",
    "LOCKOUT_FAILURES",
    "LOCKOUT_GLOBAL_FAILURES",
    "LOCKOUT_WINDOW_SECONDS",
    "LivenessDecision",
    "LockoutState",
    "MATCH_COSINE",
    "MATCH_MARGIN",
    "MIN_AGREEING_FRAMES",
    "Match",
    "NOSE",
    "QUICK_IDLE_TIMEOUT_SECONDS",
    "RELEASE_MAX_PER_HOUR",
    "RELEASE_WINDOW_SECONDS",
    "RIGHT_EYE",
    "RIGHT_MOUTH",
    "ResidualReport",
    "SAMPLE_FRAMES",
    "STREAM_GOOD_FRAMES",
    "SUBJECT_ID_PATTERN",
    "Similarity",
    "VETO_LINK_TTL_SECONDS",
    "aggregate_frames",
    "canonical_shape",
    "capture_profile",
    "centroid",
    "client_address",
    "clip_bounds_reason",
    "cosine",
    "cosine_match",
    "detection_reason",
    "enrolment_consistency",
    "even_frame_indices",
    "fit_similarity",
    "framing_reason",
    "gallery_scores",
    "inter_ocular_distance",
    "landmark_residual",
    "liveness_decision",
    "lockout_reason",
    "network_allowed",
    "parse_cidrs",
    "preflight_reason",
    "quarter_turns_to_upright",
    "reference_shape",
    "register_failure",
    "release_rate_exceeded",
    "roll_degrees",
    "valid_subject_id",
]
