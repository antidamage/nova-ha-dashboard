"""Gates: the nonce, network binding, armed state, lockout, and identity.

All of this decides before a model is touched. The ordering lives in
`core.preflight_reason`, where it is asserted by a test rather than inferred
from the shape of an `if` chain.
"""

from __future__ import annotations

import hmac

import core
from fastapi import Request

from .config import (
    ALLOWED_CIDRS,
    AUTHENTIK_IDENTITY_HEADERS,
    LOCKOUT_GLOBAL_FAILURES,
    LOCKOUT_WINDOW_SECONDS,
    LOG,
    PROXY_SECRET,
    PROXY_SECRET_HEADER,
    RELEASE_MAX_PER_HOUR,
    TRUST_FORWARDED_FOR,
)
from .errors import Refusal
from .store import store

# The paths whose callers must be inside the bound networks and whose access
# the armed state governs. /healthz, /detect, /embed and /identify are the
# recognition half — camera-events and the kiosk use them and they release
# nothing — so they carry the key requirement but not the login gates.
GATED_PATHS = ("/challenge", "/frame", "/verify", "/assert", "/enrol")


def client_ip(request: Request) -> str | None:
    """Caddy's forwarded client, falling back to the direct peer.

    Caddy terminates TLS and is the only thing in front of this service, so its
    forwarded client is authoritative. `FACE_TRUST_FORWARDED_FOR=0` is for a
    topology where the service is directly reachable and the header would be
    attacker-supplied; there it is ignored outright rather than merely
    preferred less.
    """

    peer = request.client.host if request.client else None
    return core.client_address(
        request.headers.get("x-forwarded-for"), peer, trust_forwarded=TRUST_FORWARDED_FOR
    )


def lockout_state_reason(now: float) -> str | None:
    """`disarmed`, `locked_out`, or None.

    The global scope is the one that can be judged before a model runs — the
    subject is not known until the clip has been through identification, and a
    refused clip usually has no subject at all. The per-subject counter is
    folded in afterwards by `note_failure`, which disarms the service when a
    subject trips its own limit, so the effect of the per-subject rule is
    visible to this gate on the next request.
    """

    return core.lockout_reason(
        store().lockout("global"), now,
        max_failures=LOCKOUT_GLOBAL_FAILURES, window_seconds=LOCKOUT_WINDOW_SECONDS,
    )


def gate_request(request: Request, now: float) -> str | None:
    """The network and armed/lockout gates, without the nonce.

    Run from the middleware so an off-network or locked-out caller is refused
    before Starlette parses an 8 MiB multipart body, let alone before a model
    sees a frame.
    """

    address = client_ip(request)
    reason = core.preflight_reason(
        nonce_ok=True,
        network_ok=core.network_allowed(address, ALLOWED_CIDRS),
        lockout=lockout_state_reason(now),
        rate_ok=True,
    )
    if reason == "network_denied":
        LOG.warning("network gate refused %s for %s", address, request.url.path)
    return reason


def require_authentik_identity(request: Request) -> str:
    """The identity the dashboard's authentik-gated proxy asserts, and proof
    that it was the proxy that asserted it.

    Two separate checks, because they answer two separate questions.

    The API key answers "may this caller talk to the service at all", and every
    satellite, camera-events, every script and everyone in the `docker` group
    can answer it. Caddy's `handle_path /face/*` forwards arbitrary headers, so
    a key holder sending `X-authentik-username: anyone` would otherwise clear a
    lockout with no authentik session in the picture. These routes are the
    credential-issuing and lockout-clearing ones; that is not a gap the spec's
    root-on-the-host concession covers.

    `NOVA_FACE_PROXY_SECRET` answers the second question — "did this come
    through the dashboard's server-side proxy, which sits behind authentik
    forward-auth" — and only that proxy holds it. An identity header arriving
    without it is refused rather than believed: a request that reaches here
    with only the shared key is, by construction, a request whose identity
    nobody vouched for.

    A missing `NOVA_FACE_PROXY_SECRET` refuses these routes outright. There is
    no unprovisioned mode in which the header alone starts working again —
    that would be the failure this check exists to prevent, arriving by way of
    an empty variable.
    """

    supplied = request.headers.get(PROXY_SECRET_HEADER, "")
    if not PROXY_SECRET or not hmac.compare_digest(supplied, PROXY_SECRET):
        LOG.warning(
            "identity-bearing request to %s without proxy provenance from %s",
            request.url.path, client_ip(request),
        )
        raise Refusal(403, "authentik_session_required")
    for header in AUTHENTIK_IDENTITY_HEADERS:
        value = request.headers.get(header, "").strip()
        if value:
            return value
    raise Refusal(403, "authentik_session_required")


def require_dashboard_proxy(request: Request) -> str | None:
    """Proof the request came through the dashboard's proxy. Identity optional.

    For enrolment and the subject routes, decided 2026-09-03. Adeline: "I don't
    care about spoofing. this is a convenience thing. assume that nobody with
    malicious intent will have access to my house."

    The enrolment UI already sits behind the /config forward-auth gate, so
    reaching it at all means passing authentik. Requiring the identity header
    on the XHR as well meant the outpost answered an unauthenticated fetch with
    a 302 to the IdP, and a cross-origin redirect on an XHR is an opaque CORS
    error in the browser rather than "log in again" -- which is exactly how
    live enrolment failed.

    The proxy secret is still required, so this is not open: the request must
    still have come through the dashboard's server-side proxy, and the shared
    API key alone does not satisfy it. What is dropped is the second, redundant
    proof of *who* was logged in. The identity is still returned when present,
    so the audit row keeps it.

    `/arm` keeps `require_authentik_identity`: clearing a lockout is the one
    face route that grants rather than records.
    """

    supplied = request.headers.get(PROXY_SECRET_HEADER, "")
    if not PROXY_SECRET or not hmac.compare_digest(supplied, PROXY_SECRET):
        LOG.warning(
            "request to %s without dashboard proxy provenance from %s",
            request.url.path, client_ip(request),
        )
        raise Refusal(403, "authentik_session_required")
    for header in AUTHENTIK_IDENTITY_HEADERS:
        value = request.headers.get(header, "").strip()
        if value:
            return value
    return None


def require_subject_id(subject_id: str) -> str:
    """Validate a subject id at the boundary. Reject, never sanitise.

    It becomes a SQLite primary key and a thumbnail filename, and a silently
    rewritten id is worse than a refused one: it becomes a second subject
    nobody asked for, with its own gallery, matching nothing.
    """

    if not core.valid_subject_id(subject_id):
        raise Refusal(422, "invalid_subject")
    return subject_id


def require_release_capacity(now: float) -> None:
    """The release-rate cap, checked before signing and enforced as an attack
    signal rather than as backpressure: exceeding it disarms."""

    if core.release_rate_exceeded(store().recent_releases(now), now, max_per_hour=RELEASE_MAX_PER_HOUR):
        store().set_armed(False, actor="rate_limit")
        raise Refusal(core.GATE_STATUS["rate_limited"], "rate_limited")
