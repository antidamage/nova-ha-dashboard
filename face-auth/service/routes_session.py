"""`/arm`, `/disarm`, `/activity`, `/sessions/revoke`.

The asymmetry that runs through this file: every path that reduces access
(`/disarm`, `/sessions/revoke`) is cheap to reach; the one path that increases
it (`/arm`) needs a password + TOTP session behind authentik. A compromised
Discord account can disable face login but never grant it.
"""

from __future__ import annotations

import time
from typing import Any

import core
from authenticator.authentik import AuthentikClient, AuthentikError
from fastapi import Request

from .app import app
from .config import AUTHENTIK_BASE_URL, AUTHENTIK_TOKEN, LOG
from .errors import Refusal
from .gates import require_authentik_identity
from .store import store


@app.post("/arm")
def arm(request: Request) -> dict[str, Any]:
    """Clear the lockout and re-arm face release. Password + TOTP only.

    The API key is explicitly **not** sufficient here: every LAN service that
    talks to this oracle holds it. The dashboard's authentik-gated proxy route
    asserts the authenticated identity in a header, and this endpoint refuses
    without one.

    There is no face path to this endpoint, no Discord action that reaches it,
    and no link that arms anything. That asymmetry — a compromised Discord
    account can disable face login but never grant it — is the property that
    makes it safe to put a control on a service Nova does not operate, and any
    future "convenience" re-arm is the exact thing it exists to refuse.
    """

    store().set_armed(True, actor=f"authentik:{require_authentik_identity(request)}")
    return {"armed": True}


@app.post("/disarm")
async def disarm(request: Request) -> dict[str, Any]:
    """Switch face release off. Ungated, deliberately, and it is the pair to
    `/arm` rather than a parameter of it.

    The asymmetry is the whole control: **every path that reduces access is
    cheap to reach, every path that increases it is expensive.** `/arm` grants,
    so it sits behind authentik forward-auth and needs a password + TOTP
    session. `/disarm` only takes access away, so it needs nothing but the
    service key the Discord module already holds — it has to work in the
    seconds after a DM lands on a phone, and a revocation that first demands a
    login is a revocation that arrives too late.

    That is also what makes it safe to hang a security control off a
    third-party service Nova does not operate: a compromised Discord account
    can reach this endpoint and can reach `/sessions/revoke`, and neither of
    them can let anybody in.

    `vetoToken` and `reason` are recorded for the audit trail and are **not**
    required to be valid. A veto that fails closed on a malformed token is a
    veto that does not fire, and a veto that does not fire is the failure mode
    this design cannot afford. Collapsing the two endpoints into one taking a
    boolean would put the grant behind the same nothing.
    """

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - a malformed body must not block a veto
        body = {}
    token = str(body.get("vetoToken") or "")[:64]
    reason = str(body.get("reason") or "unspecified")[:200]
    store().set_armed(False, actor=f"veto:{token or 'no-token'}:{reason}")
    return {"armed": False}


@app.post("/activity")
async def activity(request: Request) -> dict[str, Any]:
    """Heartbeat for quick-profile sessions.

    Identity-bearing and therefore gated the same way `/arm` is: the API key
    alone is not enough, because every satellite and every script holds it, and
    a caller who can assert `X-authentik-username: adeline` with only the shared
    key could keep a session alive indefinitely without holding one. The proxy
    secret is what makes the username mean anything.

    Extending is all it can do. There is no shape of this request that signs
    anybody in, and a person with no open quick session gets `touched: 0`.
    """

    username = require_authentik_identity(request)
    touched = store().touch_quick_sessions(username, time.time())
    return {"touched": touched, "idleTimeoutSeconds": core.QUICK_IDLE_TIMEOUT_SECONDS}


@app.post("/sessions/revoke")
async def revoke_session(request: Request) -> dict[str, Any]:
    """Terminate one authentik session. Ungated for the same reason as
    `/disarm`: it can only log somebody out.

    Leaves the armed state alone — Revoke and Disarm are two buttons because
    they are two decisions. Press both if both are wanted.
    """

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    session_id = str(body.get("sessionId") or "").strip()
    token = str(body.get("vetoToken") or "")[:64]
    reason = str(body.get("reason") or "unspecified")[:200]
    if not session_id:
        raise Refusal(422, "session_id_required")
    LOG.warning("session revoke requested: session=%s veto=%s reason=%s", session_id, token or "-", reason)
    try:
        applied = AuthentikClient(base_url=AUTHENTIK_BASE_URL, token=AUTHENTIK_TOKEN).terminate_session(session_id)
    except AuthentikError as error:
        LOG.error("session revoke could not reach authentik: %s", error)
        raise Refusal(503, "service_unavailable")
    return {"revoked": session_id, "applied": bool(applied)}
