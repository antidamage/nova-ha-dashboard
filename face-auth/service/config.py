"""Environment-derived configuration, read once at import time.

Every threshold and secret here is named, defaulted, and overridable from
`/etc/nova-face-auth.env` — never re-read later, so a test can pin a value
without touching process state. See `specs/face-auth.md` for the defaults'
provenance and the calibration procedure.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import cv2

import core
from models import FaceModels

logging.basicConfig(level=os.environ.get("NOVA_FACE_AUTH_LOG_LEVEL", "INFO"))
LOG = logging.getLogger("nova-face-auth")

VERSION = "1"
DATA_ROOT = Path(os.environ.get("NOVA_FACE_AUTH_DATA", "/data"))
THUMBNAIL_ROOT = DATA_ROOT / "thumbnails"
DB_PATH = DATA_ROOT / "faces.sqlite3"

# No default key and no unauthenticated mode. A missing secret is a refusal to
# boot, not a permissive fallback — the unit's ExecStartPre asserts the env file
# exists for the same reason.
API_KEY = os.environ.get("NOVA_FACE_KEY", "").strip()


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


# Thresholds: named, defaulted from the spec, env-overridable, read once here.
# Calibration is an ops action against /etc/nova-face-auth.env, never a code
# change — see "Calibration" in specs/face-auth.md.
DET_SCORE_MIN = _float("FACE_DET_SCORE_MIN", core.DET_SCORE_MIN)
BOX_MIN_PX = _int("FACE_BOX_MIN_PX", core.BOX_MIN_PX)
MATCH_COSINE = _float("FACE_MATCH_COSINE", core.MATCH_COSINE)
MATCH_MARGIN = _float("FACE_MATCH_MARGIN", core.MATCH_MARGIN)
MIN_AGREEING_FRAMES = _int("FACE_MIN_AGREEING_FRAMES", core.MIN_AGREEING_FRAMES)
LIVENESS_RESIDUAL_MIN = _float("FACE_LIVENESS_RESIDUAL_MIN", core.LIVENESS_RESIDUAL_MIN)
LIVENESS_RESIDUAL_MAX = _float("FACE_LIVENESS_RESIDUAL_MAX", core.LIVENESS_RESIDUAL_MAX)
LIVENESS_MIN_FRAMES = _int("FACE_LIVENESS_MIN_FRAMES", core.LIVENESS_MIN_FRAMES)
ANTISPOOF_MIN = _float("FACE_ANTISPOOF_MIN", core.ANTISPOOF_MIN)
CLIP_MIN_SECONDS = _float("FACE_CLIP_MIN_SECONDS", core.CLIP_MIN_SECONDS)
CLIP_MAX_SECONDS = _float("FACE_CLIP_MAX_SECONDS", core.CLIP_MAX_SECONDS)
CLIP_MIN_FPS = _float("FACE_CLIP_MIN_FPS", core.CLIP_MIN_FPS)
CLIP_MAX_BYTES = _int("FACE_CLIP_MAX_BYTES", core.CLIP_MAX_BYTES)
NONCE_TTL_SECONDS = _int("FACE_NONCE_TTL_SECONDS", 20)
SESSION_TTL_SECONDS = _int("FACE_SESSION_TTL_SECONDS", 60)
ENROL_CENTROID_MAX = _float("FACE_ENROL_CENTROID_MAX", core.ENROL_CENTROID_MAX)
ENROL_MIN_CLIPS = _int("FACE_ENROL_MIN_CLIPS", core.ENROL_MIN_CLIPS)

# Controls. Same discipline: named, defaulted, read once, overridden in
# /etc/nova-face-auth.env.
#
# The allowed-CIDR default is the tailnet CGNAT range alone. The household LAN
# prefix is deliberately absent from this repository — it is public, and the
# spec's secrets rule forbids a host address in shipped code or a default. An
# unprovisioned host therefore allows the tailnet and nothing else, and a
# malformed list allows nothing at all.
ALLOWED_CIDRS = core.parse_cidrs(os.environ.get("FACE_ALLOWED_CIDRS", core.ALLOWED_CIDRS_DEFAULT))
TRUST_FORWARDED_FOR = os.environ.get("FACE_TRUST_FORWARDED_FOR", "1").strip() not in {"0", "false", "no"}
LOCKOUT_FAILURES = _int("FACE_LOCKOUT_FAILURES", core.LOCKOUT_FAILURES)
LOCKOUT_GLOBAL_FAILURES = _int("FACE_LOCKOUT_GLOBAL_FAILURES", core.LOCKOUT_GLOBAL_FAILURES)
LOCKOUT_WINDOW_SECONDS = _int("FACE_LOCKOUT_WINDOW_SECONDS", core.LOCKOUT_WINDOW_SECONDS)
RELEASE_MAX_PER_HOUR = _int("FACE_RELEASE_MAX_PER_HOUR", core.RELEASE_MAX_PER_HOUR)
VETO_LINK_TTL_SECONDS = _int("FACE_VETO_LINK_TTL_SECONDS", core.VETO_LINK_TTL_SECONDS)

# Secrets and household identifiers, every one of them out of band. No
# defaults: a missing value is a refusal, never a fallback.
HOST_SECRET = os.environ.get("NOVA_FACE_HOST_SECRET", "").strip()
WEBAUTHN_RP_ID = os.environ.get("WEBAUTHN_RP_ID", "").strip()
WEBAUTHN_ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "").strip()
AUTHENTIK_BASE_URL = os.environ.get("AUTHENTIK_BASE_URL", "").strip()
AUTHENTIK_TOKEN = os.environ.get("AUTHENTIK_TOKEN", "").strip()
# Where the Discord module listens for the veto hook, and the public origin the
# fallback link is built on. Both are configuration for the same reason.
VETO_HOOK_URL = os.environ.get("NOVA_FACE_VETO_HOOK_URL", "").strip()
# The shared key the veto module checks on its ingress route. Without it every
# hook is refused 401, which the client treats as UNKNOWN -- so releases went
# through with the veto silently undelivered, which is the one state the design
# calls worse than having no veto at all.
VETO_HOOK_KEY = os.environ.get("NOVA_FACE_VETO_KEY", "").strip()
PUBLIC_BASE_URL = os.environ.get("NOVA_FACE_PUBLIC_URL", "").strip()

# The header the dashboard's authentik-gated proxy asserts an identity in, and
# the separate secret that says the assertion came from the proxy at all.
#
# The API key cannot vouch for this. Every satellite, camera-events, every
# script and everyone in the `docker` group holds that key, and Caddy's
# `handle_path /face/*` forwards whatever headers a caller sends — so a key
# holder could otherwise clear a lockout with nothing but
# `-H "X-authentik-username: anyone"`. The spec concedes root on the host; it
# does not concede that.
#
# `NOVA_FACE_PROXY_SECRET` is a *different* secret held only by the dashboard's
# server-side proxy, which sits behind authentik forward-auth and only ever
# populates the identity headers from Caddy's `copy_headers`. One credential
# may not vouch for two different things, so this is checked in addition to
# the API key on every identity-bearing route, and identity headers arriving
# without it are refused rather than believed.
AUTHENTIK_IDENTITY_HEADERS = ("x-authentik-username", "x-nova-authentik-user")
PROXY_SECRET_HEADER = "x-nova-face-proxy"
PROXY_SECRET = os.environ.get("NOVA_FACE_PROXY_SECRET", "").strip()

# The subject-id allowlist itself is `core.valid_subject_id`, where it is
# tested: letters, digits, underscore and hyphen, first character alphanumeric,
# 64 characters. No dot, therefore no `..`; no separator, therefore no
# traversal.

# A hard ceiling on decode work regardless of what the container claims about
# duration; a malformed file can otherwise advertise a short clip and stream
# frames forever.
MAX_DECODE_FRAMES = 600

MODELS = FaceModels()

# Streamed (`quick`) stills held per nonce until /assert takes them. In memory
# on purpose: one uvicorn worker, and a restart that drops a half-streamed
# attempt only costs that attempt.
FRAMES = core.FrameHold(ttl_seconds=NONCE_TTL_SECONDS)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def iso_time(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


# Quarter turns, counted the way `quarter_turns_to_upright` counts them: n is
# how far the image is rotated clockwise, corrected by turning it back. Shared
# so a probe rotation and a landmark correction compose by addition mod 4.
QUARTER_TURN = {
    1: cv2.ROTATE_90_COUNTERCLOCKWISE,
    2: cv2.ROTATE_180,
    3: cv2.ROTATE_90_CLOCKWISE,
}
