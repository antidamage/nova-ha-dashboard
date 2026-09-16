"""The FastAPI app: lifespan, middleware, and route registration.

Route handlers live in the sibling `routes_*` modules. Each imports `app` from
this module and decorates it directly — the same registration FastAPI would
see from one file — so this module imports them at the bottom, after `app`
exists, purely for the import's side effect. That mirrors the original file's
top-to-bottom route order exactly.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import time
from contextlib import asynccontextmanager

import core
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .authentik_sessions import quick_session_sweeper
from .config import ALLOWED_CIDRS, API_KEY, HOST_SECRET, LOG, VERSION, WEBAUTHN_ORIGIN, WEBAUTHN_RP_ID, MODELS
from .gates import GATED_PATHS, gate_request
from .oracle import Oracle
from . import oracle as oracle_module
from .store import Store, store
from . import store as store_module


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not API_KEY:
        raise RuntimeError("NOVA_FACE_KEY is not set; refusing to start without authentication")
    store_module.STORE = Store()
    if HOST_SECRET and WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN:
        oracle_module.ORACLE = Oracle()
    else:
        # The recognition half still serves. The credential half refuses with a
        # 503 rather than inventing a way to let somebody in — see
        # require_oracle.
        LOG.warning("credential half disabled: host secret or relying party not configured")
    if not ALLOWED_CIDRS:
        LOG.warning("FACE_ALLOWED_CIDRS is empty or unparseable; every gated route will refuse")
    # Deliberately uncaught. Anti-spoof weights that will not load mean the
    # service cannot tell a photograph from a person, and a service that cannot
    # do that must not serve. Never fail open.
    MODELS.load_antispoof()
    removed = store().purge_thumbnails()
    if removed:
        LOG.info("removed %d stored face crop(s); thumbnails are no longer retained", removed)
    MODELS.warm_up()

    # The idle sweep. 60 s cadence against a 900 s timeout: the granularity is
    # a minute, which is the right resolution for "has this person walked away"
    # and costs one authentik list call per user with an open row.
    sweep_task = asyncio.create_task(quick_session_sweeper())
    try:
        yield
    finally:
        sweep_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweep_task


app = FastAPI(title="Nova face auth", version=VERSION, lifespan=lifespan)


@app.middleware("http")
async def require_key(request: Request, call_next):
    """First, before anything touches the request body, on every route.

    `/healthz` included — an unauthenticated health endpoint on this service
    would advertise how many people are enrolled and which provider is live.
    """

    supplied = request.headers.get("x-nova-face-key", "")
    if not API_KEY or not hmac.compare_digest(supplied, API_KEY):
        return JSONResponse({"reason": "forbidden"}, status_code=403)
    # Then the network binding and the armed state, still before the body is
    # parsed. One middleware rather than two so the order is the order written
    # here: Starlette runs the most recently added middleware outermost, so a
    # second decorator would have run *before* the key check rather than after
    # it. A refused caller must not cost an 8 MiB multipart parse, a GPU queue
    # slot, or a position behind a voice turn.
    #
    # `/veto` is exempt from the gates because revocation has to work when
    # nothing else does — that is the situation it exists for — and it carries
    # an HMAC over its whole query string plus single use instead.
    path = request.url.path
    if store_module.STORE is not None and any(path.startswith(prefix) for prefix in GATED_PATHS):
        reason = gate_request(request, time.time())
        if reason:
            return JSONResponse({"reason": reason}, status_code=core.GATE_STATUS[reason])
    return await call_next(request)


@app.exception_handler(HTTPException)
async def refusal_handler(request: Request, error: HTTPException):
    detail = error.detail if isinstance(error.detail, dict) else {"reason": str(error.detail)}
    return JSONResponse(detail, status_code=error.status_code)


# Route registration, in the original file's top-to-bottom order. Each module
# decorates `app` on import; nothing here calls into them directly.
from . import routes_health  # noqa: E402,F401
from . import routes_recognition  # noqa: E402,F401
from . import routes_verify  # noqa: E402,F401
from . import routes_assert  # noqa: E402,F401
from . import routes_session  # noqa: E402,F401
from . import routes_veto  # noqa: E402,F401
from . import routes_enrol  # noqa: E402,F401
from . import routes_subjects  # noqa: E402,F401
