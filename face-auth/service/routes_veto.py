"""`/veto` — the HMAC-signed, single-use fallback link. Revocation only."""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any

from authenticator.authentik import AuthentikClient, AuthentikError
from fastapi import Request

from .app import app
from .config import AUTHENTIK_BASE_URL, AUTHENTIK_TOKEN, HOST_SECRET, LOG
from .errors import Refusal
from .store import store


@app.get("/veto")
def veto(request: Request, a: str = "", v: str = "", e: str = "", sig: str = "") -> dict[str, Any]:
    """The HMAC-signed, single-use fallback link. Revocation only.

    Safe to leave ungated because it can only revoke: a leaked link disables
    face login or kills a session. It cannot enable one, cannot enrol, and
    cannot clear a lockout. There is no third action, and adding one that
    grants anything would break the control rather than extend it.
    """

    if a not in {"revoke", "disarm"}:
        raise Refusal(400, "unknown_action")
    if not HOST_SECRET:
        raise Refusal(503, "service_unavailable")
    expected = hmac.new(
        HOST_SECRET.encode(), f"a={a}&v={v}&e={e}".encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected):
        LOG.warning("veto link rejected: signature mismatch")
        raise Refusal(403, "forbidden")
    now = time.time()
    if not e.isdigit() or float(e) < now:
        raise Refusal(403, "veto_expired")
    row = store().consume_veto(v, a, "fallback_link", now)
    if row is None:
        raise Refusal(403, "veto_expired")
    if a == "disarm":
        store().set_armed(False, actor="veto_link")
        return {"action": a, "applied": True}
    username = row["authentik_username"]
    if not username:
        return {"action": a, "applied": False}
    try:
        client = AuthentikClient(base_url=AUTHENTIK_BASE_URL, token=AUTHENTIK_TOKEN)
        session_id = row["authentik_session_id"]
        applied = bool(
            client.terminate_session(session_id) if session_id else client.terminate_all_sessions(username)
        )
    except AuthentikError as error:
        LOG.warning("veto could not reach authentik: %s", error)
        raise Refusal(503, "service_unavailable")
    return {"action": a, "applied": applied}
