"""Nova face authentication service.

A stateless verifier of clips submitted to it. The service never opens a
capture device — the kiosk browser and the satellites do that and post the
result — which keeps camera plumbing off the GPU host and means a browser, a
satellite and a script are all clients on equal terms.

Face is a release condition on a key. It is never a bearer credential: nothing
downstream accepts "the face service said it was X" as proof. `/verify` mints a
short-lived face session for the recognition-only callers; `/assert` mints one
and spends it inside the same request on a WebAuthn assertion, which the
browser then submits to the identity provider. The browser drives the flow, as
it would for a hardware key — this service is not a WebAuthn client, and
`/auth/face` from the previous pass is retired.

Four gates run before any model does: the nonce, the network binding, the armed
state, and the lockout and release-rate counters. That ordering is the control
— a locked-out or off-network caller costs no GPU and takes no queue position
behind a voice turn.

Enrolment is of consenting members of one household. There is no path to
identifying somebody who has not enrolled: `/identify` returns null for an
unknown face, never a nearest neighbour.

This is a facade package: the body lives in the sibling modules below, split
by concern (`specs/agent-token-footprint.md` §4). `uvicorn service:app` still
resolves — `app` is this package's top-level attribute — and every name
importable as `service.X` before the split remains importable the same way.
"""

from __future__ import annotations

from .app import app, lifespan, refusal_handler, require_key
from .authentik_sessions import QUICK_SWEEP_INTERVAL_SECONDS, list_session_ids, quick_session_sweeper, sweep_quick_sessions
from .config import (
    ALLOWED_CIDRS,
    ANTISPOOF_MIN,
    API_KEY,
    AUTHENTIK_BASE_URL,
    AUTHENTIK_IDENTITY_HEADERS,
    AUTHENTIK_TOKEN,
    BOX_MIN_PX,
    CLIP_MAX_BYTES,
    CLIP_MAX_SECONDS,
    CLIP_MIN_FPS,
    CLIP_MIN_SECONDS,
    DATA_ROOT,
    DB_PATH,
    DET_SCORE_MIN,
    ENROL_CENTROID_MAX,
    ENROL_MIN_CLIPS,
    FRAMES,
    HOST_SECRET,
    LIVENESS_MIN_FRAMES,
    LIVENESS_RESIDUAL_MAX,
    LIVENESS_RESIDUAL_MIN,
    LOCKOUT_FAILURES,
    LOCKOUT_GLOBAL_FAILURES,
    LOCKOUT_WINDOW_SECONDS,
    LOG,
    MATCH_COSINE,
    MATCH_MARGIN,
    MAX_DECODE_FRAMES,
    MIN_AGREEING_FRAMES,
    MODELS,
    NONCE_TTL_SECONDS,
    PROXY_SECRET,
    PROXY_SECRET_HEADER,
    PUBLIC_BASE_URL,
    QUARTER_TURN,
    RELEASE_MAX_PER_HOUR,
    SESSION_TTL_SECONDS,
    THUMBNAIL_ROOT,
    TRUST_FORWARDED_FOR,
    VERSION,
    VETO_HOOK_KEY,
    VETO_HOOK_URL,
    VETO_LINK_TTL_SECONDS,
    WEBAUTHN_ORIGIN,
    WEBAUTHN_RP_ID,
    iso_time,
    utc_now,
)
from .decode import decode_clip, decode_image, read_bounded
from .errors import Refusal
from .gates import (
    GATED_PATHS,
    client_ip,
    gate_request,
    lockout_state_reason,
    require_authentik_identity,
    require_dashboard_proxy,
    require_release_capacity,
    require_subject_id,
)
from .oracle import Oracle, UNKNOWN, UNMAPPED, VETO, VetoClient, require_oracle
from .pipeline import ClipAnalysis, run_liveness, identify_frames
from .routes_assert import assert_credential
from .routes_enrol import enrol
from .routes_health import challenge, healthz
from .routes_recognition import detect, embed, identify
from .routes_session import activity, arm, disarm, revoke_session
from .routes_subjects import delete_subject, subjects
from .routes_veto import veto
from .routes_verify import read_capture, resolve_profile, stream_frame, verify, verify_clip
from .store import Store, store

# `STORE` and `ORACLE` are not re-exported here as plain names: both are
# mutable singletons `lifespan` (in `.app`) assigns after startup, so a static
# `from .store import STORE` / `from .oracle import ORACLE` would freeze this
# facade's copy at import time, before either is set. Read the live value via
# `store()` / `require_oracle()`, or `service.store.STORE` / `service.oracle.ORACLE`.
