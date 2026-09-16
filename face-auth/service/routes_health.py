"""`/healthz` and `/challenge`."""

from __future__ import annotations

from typing import Any

from .app import app
from .config import ALLOWED_CIDRS, MODELS, VERSION, iso_time
from . import oracle as oracle_module
from .store import store


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    with store().lock:
        subjects = store().connection.execute("SELECT COUNT(*) FROM subjects").fetchone()[0]
    health = MODELS.health()
    return {
        "ok": MODELS.loaded,
        "subjects": int(subjects),
        "version": VERSION,
        # The armed state is health: a disarmed service answers every login
        # with a refusal, and a dashboard that cannot see that is a dashboard
        # that reports a lockout as a broken camera.
        "armed": store().armed(),
        "credentialHalf": oracle_module.ORACLE is not None,
        "networkBound": bool(ALLOWED_CIDRS),
        **health,
    }


@app.post("/challenge")
def challenge() -> dict[str, Any]:
    nonce, expires = store().issue_challenge()
    return {"nonce": nonce, "expiresAt": iso_time(expires)}
