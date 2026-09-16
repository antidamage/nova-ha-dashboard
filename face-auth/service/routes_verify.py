"""`/frame` and `/verify`, and the shared `verify_clip` face-decision core."""

from __future__ import annotations

import time
from typing import Any

import core
from core import gallery_scores
from fastapi import File, Form, HTTPException, Request, UploadFile

from .app import app
from .config import FRAMES, iso_time
from .decode import decode_clip, decode_image, read_bounded
from .errors import Refusal
from .gates import client_ip
from .pipeline import ClipAnalysis, identify_frames, run_liveness
from .store import store


def verify_clip(
    payload: bytes,
    nonce: str,
    endpoint: str,
    *,
    client_ip: str | None = None,
    profile: core.CaptureProfile | None = None,
) -> dict[str, Any]:
    """The shared face half of /verify and /assert.

    `profile` decides which gates run and where the frames come from — a clip
    for `standard`, a single still for `image`, and for `quick` the stills
    /frame already judged and held against this nonce (`payload` is empty).
    It is recorded on the
    `attempts` row on every path, because with the model gates off on two of the
    three profiles the row is the only remaining record of what was actually
    enforced, and a row that does not name its profile cannot be read as
    calibration data at all.

    Writes an `attempts` row on every path — success and refusal alike — before
    the response leaves, and folds every refusal into the lockout counters.

    A refusal that is not the caller's fault is still counted. That is
    deliberate: the counters exist to notice a campaign, and an attacker whose
    clips are being rejected for "no face" is exactly the campaign they are
    meant to notice. The cost is that a badly-lit household member can lock the
    service; the spec's calibration procedure sets the limit above what that
    costs in practice, and re-arming is a password + TOTP action rather than an
    outage.
    """

    started = time.time()
    profile = profile or core.CAPTURE_PROFILES[core.DEFAULT_CAPTURE_PROFILE]
    signals: dict[str, Any] = {"profile": profile.name}
    reason: str | None = None
    try:
        if not store().consume_challenge(nonce):
            raise Refusal(401, "nonce_invalid")
        if profile.frame_stream:
            # Taken before judging, so a refused attempt cannot leave its
            # embeddings behind for anything else to find.
            held = FRAMES.take(nonce) or core.HeldStream(started=started)
            analysis = ClipAnalysis.from_stream(held)
        else:
            frames = [decode_image(payload)] if profile.single_image else decode_clip(payload, profile)[0]
            analysis = ClipAnalysis(frames)
        analysis.require_frames(profile.min_frames)
        signals["usableFrames"] = analysis.usable
        residual, antispoof = run_liveness(analysis, profile)
        # A skipped gate logs as null, never as a score. A row reading
        # "antispoof: 0.0" would be indistinguishable from a model that ran and
        # returned nothing, and the two mean opposite things.
        signals.update({
            "residual": None if residual is None else round(residual, 6),
            "antispoof": None if antispoof is None else round(antispoof, 4),
        })
        gallery = store().gallery()
        votes, aggregate = identify_frames(analysis, gallery, profile.min_agreeing)
        ordered = gallery_scores(analysis.mean_embedding(), gallery)
        signals["topScore"] = round(ordered[0][1], 4) if ordered else None
        signals["runnerUp"] = round(ordered[1][1], 4) if len(ordered) > 1 else None
        if aggregate is None:
            named = sum(1 for vote in votes if vote is not None)
            # Ambiguity and thin agreement are different failures and are logged
            # as such, even though both are a 401 to the caller.
            raise Refusal(401, "too_few_agreeing" if named else "ambiguous", **signals)
        signals.update({
            "subject": aggregate.subject,
            "agreeingFrames": aggregate.agreeing,
            "topScore": round(aggregate.top_score, 4),
            "runnerUp": round(aggregate.runner_up, 4),
        })
        token, expires = store().mint_session(aggregate.subject, nonce)
        return {
            "subject": aggregate.subject,
            "faceSession": token,
            "expiresAt": iso_time(expires),
            "signals": {
                "residual": signals["residual"], "antispoof": signals["antispoof"],
                "agreeingFrames": aggregate.agreeing, "usableFrames": analysis.usable,
                "topScore": signals["topScore"], "runnerUp": signals["runnerUp"],
            },
        }
    except HTTPException as error:
        detail = error.detail if isinstance(error.detail, dict) else {}
        reason = detail.get("reason", "error")
        signals.update({key: value for key, value in detail.items() if key != "reason"})
        raise
    finally:
        if reason:
            # `nonce_invalid` counts too: a caller replaying nonces is not
            # having a bad day with the lighting.
            store().note_failure(signals.get("subject"), started)
        store().record_attempt(
            endpoint, nonce, "refused" if reason else "accepted", reason, signals,
            int((time.time() - started) * 1000), client_ip=client_ip,
        )


def resolve_profile(name: str | None) -> core.CaptureProfile:
    """Turn a submitted profile name into a profile, or refuse.

    Unknown names are refused rather than downgraded to `standard`. A surface
    that asked for a profile this build does not have has expectations that do
    not match what would run, and quietly substituting one is how a caller ends
    up believing it relaxed a gate that stayed on.
    """

    try:
        return core.capture_profile(name)
    except ValueError:
        raise Refusal(422, "unknown_profile") from None


async def read_capture(
    request: Request, profile: core.CaptureProfile, clip: UploadFile | None, image: UploadFile | None
) -> bytes:
    """The submitted capture, checked against what the profile expects.

    A profile and a payload that disagree are refused rather than reconciled:
    `image` with a clip attached is a caller that thinks it is on a different
    path than it is. A streamed profile carries no upload at all — its frames
    went to /frame.
    """

    if profile.frame_stream:
        if clip is not None or image is not None:
            raise Refusal(422, "unexpected_upload")
        return b""
    upload = image if profile.single_image else clip
    if upload is None:
        raise Refusal(422, "clip_undecodable")
    return await read_bounded(request, upload)


@app.post("/frame")
async def stream_frame(
    request: Request,
    image: UploadFile = File(...),
    nonce: str = Form(...),
) -> dict[str, Any]:
    """One still of a streamed (`quick`) capture.

    Judged with the detection rules every profile uses; a good one's detection
    is held against the nonce, a bad one's reason is noted. Nothing is decided
    here — /assert spends the nonce and judges what was held. So a skipped
    still writes no `attempts` row and does not count toward the lockout; the
    final /assert does both.

    Once enough good frames are held, later stills are answered without being
    analysed: "take the first two".
    """

    if not store().challenge_is_live(nonce):
        raise Refusal(401, "nonce_invalid")
    held = FRAMES.get(nonce, time.time())
    if not FRAMES.complete(held):
        if FRAMES.exhausted(held):
            raise Refusal(422, "frame_limit", goodFrames=len(held.good))
        payload = await read_bounded(request, image)
        try:
            analysis = ClipAnalysis([decode_image(payload)])
        except HTTPException as error:
            # A still nobody can use is a still to skip, not an end to the
            # attempt: `multiple_faces` (someone walked behind) and an
            # undecodable frame both raise rather than landing in `rejections`,
            # and a client that stopped on either would give up on a capture
            # that the next frame would have satisfied.
            detail = error.detail if isinstance(error.detail, dict) else {}
            reason = str(detail.get("reason", "clip_undecodable"))
            FRAMES.record(held, [], [reason])
        else:
            FRAMES.record(held, [detection for _, detection in analysis.detections], analysis.rejections)
            reason = analysis.rejections[0] if analysis.rejections else None
    else:
        reason = None
    return {
        "goodFrames": len(held.good),
        "needed": FRAMES.good_needed,
        "complete": FRAMES.complete(held),
        "reason": reason,
    }


@app.post("/verify")
async def verify(
    request: Request,
    clip: UploadFile | None = File(None),
    image: UploadFile | None = File(None),
    nonce: str = Form(...),
    profile: str | None = Form(None),
) -> dict[str, Any]:
    resolved = resolve_profile(profile)
    payload = await read_capture(request, resolved, clip, image)
    return verify_clip(payload, nonce, "/verify", client_ip=client_ip(request), profile=resolved)
