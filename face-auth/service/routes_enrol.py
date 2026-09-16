"""`/enrol/{subject}` — the same liveness gate as authentication, no thumbnail."""

from __future__ import annotations

from typing import Any

from core import enrolment_consistency
from fastapi import File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from .app import app
from .config import ENROL_CENTROID_MAX, ENROL_MIN_CLIPS, MATCH_COSINE, utc_now
from .decode import decode_clip, read_bounded
from .errors import Refusal
from .gates import require_dashboard_proxy, require_subject_id
from .pipeline import ClipAnalysis, run_liveness
from .store import store


@app.post("/enrol/{subject}")
async def enrol(request: Request, subject: str, clip: UploadFile = File(...), nonce: str | None = Form(None)) -> dict[str, Any]:
    """Same liveness gate as authentication.

    An enrolment path that skips liveness is a path to enrolling a photograph,
    and the gallery it builds then authenticates one.

    Raw frames are not retained: an embedding plus one thumbnail. A 512-d
    ArcFace vector is not reversible to a photograph, and a directory of face
    crops is a different liability with no feature behind it.
    """

    # Registering a face is a credential-issuing action and gets the strongest
    # gate available: password + TOTP, from the tailnet origin.
    require_dashboard_proxy(request)
    require_subject_id(subject)
    payload = await read_bounded(request, clip)
    if nonce is not None and not store().consume_challenge(nonce):
        raise Refusal(401, "nonce_invalid")
    row = store().ensure_subject(subject)
    accepted_before = store().embeddings(subject)

    def progress(accepted: bool, consistency: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
        count = len(accepted_before) + (1 if accepted else 0)
        return {
            "accepted": accepted, "clipsSoFar": count, "needed": ENROL_MIN_CLIPS,
            "remaining": max(0, ENROL_MIN_CLIPS - count), "consistency": consistency,
            **({"reason": reason} if reason else {}),
        }

    try:
        frames = decode_clip(payload)[0]
        analysis = ClipAnalysis(frames)
        analysis.require_frames()
        run_liveness(analysis)
        candidate = analysis.mean_embedding()
    except HTTPException as error:
        detail = error.detail if isinstance(error.detail, dict) else {}
        return JSONResponse(progress(False, {}, detail.get("reason", "error")), status_code=error.status_code)

    report = enrolment_consistency(
        accepted_before + [candidate],
        others=store().gallery(exclude=subject, ready_only=False),
        centroid_max=ENROL_CENTROID_MAX, match_cosine=MATCH_COSINE,
    )
    if not report.ok:
        # The offending index is named. When it is not the candidate the
        # existing gallery is the problem, and re-recording will not fix it.
        return JSONResponse(
            {**progress(False, report.as_dict(), report.reason), "offendingIndex": report.index},
            status_code=422,
        )

    frame, detection = analysis.best_detection()
    store().add_embedding(subject, candidate, detection.score, detection.short_side, {
        "detScore": round(float(detection.score), 4),
        "boxShortSide": round(float(detection.short_side), 1),
        "frames": analysis.usable,
        "at": utc_now(),
    })
    return progress(True, report.as_dict())


# No thumbnail is written. Adeline, 2026-09-03: "I don't want to store the video
# and thumbnail at all for a user."
#
# What a subject leaves on disk is now the embeddings and the capture metadata,
# and nothing that is an image of anybody. A 512-d ArcFace vector is not
# invertible to a photograph; a 256px face crop is a photograph. The gallery UI
# lists people by name instead.
#
# The clip itself was never retained: decode_clip writes a temp file and removes
# it in a `finally` on every path, including exceptions.
