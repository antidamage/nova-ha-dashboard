"""Verdicts over a `ClipAnalysis`: liveness and anti-spoof, then identification."""

from __future__ import annotations

import numpy as np
from core import aggregate_frames, cosine_match, liveness_decision

import core

from .clip_analysis import ClipAnalysis
from .config import (
    ANTISPOOF_MIN,
    LIVENESS_MIN_FRAMES,
    LIVENESS_RESIDUAL_MAX,
    LIVENESS_RESIDUAL_MIN,
    LOG,
    MATCH_COSINE,
    MATCH_MARGIN,
    MIN_AGREEING_FRAMES,
)
from .errors import Refusal


def run_liveness(analysis: ClipAnalysis, profile: core.CaptureProfile | None = None) -> tuple[float | None, float | None]:
    """Both signals enforce, and both are returned so both get logged.

    The residual does not stand alone: a video replay on a screen is not
    geometrically rigid and passes it. The nonce and the texture model exist
    because of that.

    A profile can switch either signal off, and then that signal is not measured
    at all rather than measured and ignored — running a model whose verdict is
    discarded costs GPU time on the path that exists to be fast, and a logged
    score nothing enforced would read in `attempts` as though a gate had passed.
    `None` in the returned pair means "not run", which is what the caller logs.
    """

    profile = profile or core.CAPTURE_PROFILES[core.DEFAULT_CAPTURE_PROFILE]
    if not profile.liveness and not profile.antispoof:
        LOG.info("liveness and antispoof SKIPPED for profile=%s", profile.name)
        return None, None

    residual: float | None = None
    if profile.liveness:
        decision = liveness_decision(
            analysis.track(),
            residual_min=LIVENESS_RESIDUAL_MIN,
            residual_max=LIVENESS_RESIDUAL_MAX,
            min_frames=LIVENESS_MIN_FRAMES,
        )
        if not decision.ok:
            # Log the refusal too, not just the pass. The first live enrolment
            # produced a run of 401s whose only visible evidence was the residual
            # line -- which is emitted AFTER this branch, so every refusal here was
            # silent and indistinguishable from the anti-spoof refusal below.
            LOG.info(
                "liveness REFUSED reason=%s residual=%s frames=%d",
                decision.reason, decision.residual, analysis.usable,
            )
            raise Refusal(decision.status, decision.reason or "too_few_frames", residual=decision.residual)
        LOG.info("liveness residual %.5f by landmark %s", decision.residual, decision.per_landmark)
        residual = float(decision.residual or 0.0)

    antispoof: float | None = None
    if profile.antispoof:
        antispoof = analysis.antispoof()
        # Always log the score, pass or fail. The spec's whole calibration story is
        # "record the actual score of every signal on every attempt so thresholds
        # can be tuned from real logs rather than guessed twice" -- and this is the
        # signal whose threshold is explicitly a guess. Logging it only on success
        # would hide exactly the data the guess needs.
        LOG.info("antispoof score %.4f (min %.4f) -> %s",
                 antispoof, ANTISPOOF_MIN, "pass" if antispoof >= ANTISPOOF_MIN else "REFUSE")
        if antispoof < ANTISPOOF_MIN:
            raise Refusal(401, "antispoof", residual=residual, antispoof=round(antispoof, 4))

    return residual, antispoof


def identify_frames(analysis: ClipAnalysis, gallery: dict[str, list[np.ndarray]], min_agreeing: int | None = None):
    votes = [
        cosine_match(embedding, gallery, threshold=MATCH_COSINE, margin=MATCH_MARGIN)
        for embedding in analysis.embeddings()
    ]
    return votes, aggregate_frames(
        votes, min_agreeing=MIN_AGREEING_FRAMES if min_agreeing is None else min_agreeing
    )
