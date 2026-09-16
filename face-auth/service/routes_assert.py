"""`/assert` — the endpoint the ceremony turns on: face in, WebAuthn assertion out."""

from __future__ import annotations

import time
from typing import Any

from fastapi import File, Form, Request, UploadFile

from .app import app
from .authentik_sessions import list_session_ids
from .config import SESSION_TTL_SECONDS
from .errors import Refusal
from .gates import client_ip, require_release_capacity
from .oracle import UNKNOWN, UNMAPPED, VETO, require_oracle
from .routes_verify import resolve_profile, read_capture, verify_clip
from .store import store


@app.post("/assert")
async def assert_credential(
    request: Request,
    clip: UploadFile | None = File(None),
    image: UploadFile | None = File(None),
    nonce: str = Form(...),
    challenge: str = Form(...),
    profile: str | None = Form(None),
) -> dict[str, Any]:
    """The endpoint the ceremony turns on: face in, WebAuthn assertion out.

    `/verify` plus signing, in one call. The face session is minted and spent
    inside this request and is never handed to a caller — a token that reached
    a client would be a bearer credential, which is the one thing face must
    never become. `challenge` is the base64url WebAuthn challenge exactly as
    the identity provider issued it; this service does not check where it came
    from, and the spec's threat model says plainly that it cannot.

    Order of events, and each one is load-bearing:

    1. The network and armed gates have already refused off-network and
       locked-out callers in the middleware, before this body was parsed.
    2. `verify_clip` spends the nonce atomically, then runs the models, and
       writes an `attempts` row whatever happens.
    3. The subject must map to a Discord account, or there is no signature: an
       unvetoable release is not a release.
    4. The release-rate cap is checked, and trips the armed state if exceeded.
    5. The credential is released for exactly one signature.
    6. The veto DM goes out before the assertion is returned to the browser.
    """

    resolved = resolve_profile(profile)
    payload = await read_capture(request, resolved, clip, image)
    address = client_ip(request)
    oracle = require_oracle()
    now = time.time()

    result = verify_clip(payload, nonce, "/assert", client_ip=address, profile=resolved)
    subject = result["subject"]

    # Resolve the veto channel *before* signing. A subject with no mapped
    # account gets no DM and no signature; a Discord outage is a different
    # thing entirely and must not become a household lockout, so an
    # unreachable module is "unknown", not "unmapped".
    mapping = VETO.resolve(subject)
    if mapping is UNMAPPED:
        store().record_attempt(
            "/assert", nonce, "refused", "no_veto_channel", {"subject": subject}, 0, client_ip=address
        )
        raise Refusal(403, "no_veto_channel")

    require_release_capacity(now)

    # Spend the face session in this service's own table first, so a token can
    # never be presented twice even in the window before its TTL expires, and
    # only then wrap the credential under it for exactly one use.
    face_session = result["faceSession"]
    if store().consume_session(face_session) is None:
        raise Refusal(401, "face_session_invalid")
    if not oracle.store.mint_release(subject, oracle.config, face_session, ttl_seconds=SESSION_TTL_SECONDS, now=now):
        raise Refusal(403, "no_credential")
    try:
        assertion = oracle.store.sign_assertion(
            subject_id=subject, challenge=challenge, config=oracle.config,
            release_token=face_session, now=now,
        )
    except PermissionError as error:
        raise Refusal(401, "face_session_invalid" if str(error) == "face_session_invalid" else "no_credential")

    store().record_release(subject, now)

    # A relaxed capture buys a session that ends when the person stops using it.
    # Opened here rather than after the flow completes because this is the last
    # point that knows which profile released the credential; the sweep resolves
    # the authentik session id afterwards, once authentik has actually made one.
    if resolved.idle_timeout_seconds is not None:
        quick_username = None if mapping is UNKNOWN else mapping.get("authentikUsername")
        store().open_quick_session(
            subject, quick_username, resolved.name, resolved.idle_timeout_seconds, now,
            prior_session_ids=list_session_ids(quick_username),
        )

    delivered = VETO.session_opened(
        subject=subject,
        username=None if mapping is UNKNOWN else mapping.get("authentikUsername"),
        client_ip=address,
        surface=request.headers.get("x-nova-surface", "browser"),
        veto_id=store().create_veto(subject, None if mapping is UNKNOWN else mapping.get("authentikUsername"), None, now),
    )
    store().record_attempt(
        "/assert", nonce, "released", None,
        {**result.get("signals", {}), "subject": subject, "vetoDelivered": delivered},
        int((time.time() - now) * 1000), client_ip=address,
    )
    return assertion
