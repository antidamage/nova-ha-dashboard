"""Spec-default thresholds and control constants for face-auth's pure logic.

Every value here is repeated as a keyword default elsewhere in this package,
and the service reads the environment and overrides them at that layer. This
module never reads the environment itself, so a test can pin a threshold
without touching process state.

Landmark order throughout is RetinaFace's five points, in RetinaFace's order:
0 left eye, 1 right eye, 2 nose tip, 3 left mouth corner, 4 right mouth corner.
"""

from __future__ import annotations

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
