"""`/detect`, `/embed`, `/identify` — the recognition-only half.

No liveness, no nonce, no token, and no path from here to a release: these
exist for a background analysis pass, and an unknown face returns null, never
a nearest neighbour.
"""

from __future__ import annotations

from typing import Any

from core import detection_reason, gallery_scores, l2_normalise
from fastapi import File, Request, UploadFile

from .app import app
from .config import BOX_MIN_PX, DET_SCORE_MIN, MODELS
from .decode import decode_clip, decode_image, read_bounded
from .errors import Refusal
from .pipeline import ClipAnalysis, identify_frames
from .store import store


@app.post("/detect")
async def detect(request: Request, image: UploadFile = File(...)) -> list[dict[str, Any]]:
    frame = decode_image(await read_bounded(request, image))
    return [item.as_dict() for item in MODELS.detect(frame)]


@app.post("/embed")
async def embed(request: Request, image: UploadFile = File(...)) -> dict[str, Any]:
    frame = decode_image(await read_bounded(request, image))
    faces = MODELS.detect(frame, with_embedding=True)
    best = max(faces, key=lambda item: item.score) if faces else None
    reason = detection_reason(
        len(faces), best.score if best else None, best.short_side if best else None,
        det_score_min=DET_SCORE_MIN, box_min_px=BOX_MIN_PX,
    )
    if reason:
        raise Refusal(422, reason)
    return {
        "embedding": [round(float(value), 6) for value in l2_normalise(best.embedding)],
        "bbox": [round(float(value), 2) for value in best.bbox],
        "score": round(float(best.score), 4),
    }


@app.post("/identify")
async def identify(request: Request, clip: UploadFile | None = File(None), image: UploadFile | None = File(None)) -> dict[str, Any]:
    """Recognition only: no liveness, no nonce, no token.

    Deliberately so — this is the endpoint a background analysis pass can use
    for "is the owner in the room", and it is never sufficient to let anybody
    in. An unknown face returns null, never a nearest neighbour.
    """

    upload = clip or image
    if upload is None:
        raise Refusal(422, "clip_undecodable")
    payload = await read_bounded(request, upload)
    frames = decode_clip(payload)[0] if clip is not None else [decode_image(payload)]
    analysis = ClipAnalysis(frames)
    if not analysis.detections:
        raise Refusal(422, analysis.rejections[0] if analysis.rejections else "no_face")
    gallery = store().gallery()
    votes, aggregate = identify_frames(analysis, gallery)
    ordered = gallery_scores(analysis.mean_embedding(), gallery)
    return {
        "subject": aggregate.subject if aggregate else None,
        "score": round(aggregate.top_score, 4) if aggregate else (round(ordered[0][1], 4) if ordered else None),
        "runnerUp": round(ordered[1][1], 4) if len(ordered) > 1 else None,
        "frames": {"usable": analysis.usable, "agreeing": aggregate.agreeing if aggregate else 0, "sampled": len(frames)},
    }
