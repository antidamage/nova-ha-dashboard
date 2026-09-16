"""Per-frame gallery matching and cross-frame vote aggregation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import MATCH_COSINE, MATCH_MARGIN, MIN_AGREEING_FRAMES
from .vectors import l2_normalise


@dataclass(frozen=True)
class Match:
    subject: str
    score: float
    runner_up: float


def gallery_scores(probe: np.ndarray, gallery: dict[str, list[np.ndarray]]) -> list[tuple[str, float]]:
    """Best cosine per subject, descending. Logged whether or not it matched."""

    probe = l2_normalise(probe)
    scores = [
        (subject, max(float(np.dot(probe, l2_normalise(vector))) for vector in vectors))
        for subject, vectors in gallery.items()
        if vectors
    ]
    return sorted(scores, key=lambda item: item[1], reverse=True)


def cosine_match(
    probe: np.ndarray,
    gallery: dict[str, list[np.ndarray]],
    *,
    threshold: float = MATCH_COSINE,
    margin: float = MATCH_MARGIN,
) -> Match | None:
    """Top subject, or None.

    None covers three cases that all mean the same thing operationally: an
    empty gallery, a top score under the threshold, and a runner-up inside the
    margin. The last is the one that matters — an ambiguous face is a refusal,
    never a coin toss between two household members. `gallery_scores` is there
    for the caller that wants the numbers for the audit row.
    """

    ordered = gallery_scores(probe, gallery)
    if not ordered:
        return None
    subject, score = ordered[0]
    runner_up = ordered[1][1] if len(ordered) > 1 else 0.0
    if score < threshold or score - runner_up < margin:
        return None
    return Match(subject=subject, score=score, runner_up=runner_up)


@dataclass(frozen=True)
class FrameAggregate:
    subject: str
    agreeing: int
    usable: int
    top_score: float
    runner_up: float


def aggregate_frames(
    votes: list[Match | None],
    *,
    min_agreeing: int = MIN_AGREEING_FRAMES,
) -> FrameAggregate | None:
    """Fold per-frame matches into one decision, or refuse.

    A majority of the sampled frames must name the same subject, so a single
    well-timed frame cannot carry a login. Frames that refused stay in the
    denominator — they are evidence against, not missing data.
    """

    usable = len(votes)
    tally: dict[str, list[Match]] = {}
    for vote in votes:
        if vote is not None:
            tally.setdefault(vote.subject, []).append(vote)
    if not tally:
        return None
    subject, matches = max(tally.items(), key=lambda item: len(item[1]))
    if len(matches) < min_agreeing:
        return None
    # Two subjects with the same count is no decision. It matters most where the
    # vote is 1 of 2 (`quick`): frames naming two different people must not be
    # settled by which one happened to be sampled first.
    if sum(1 for items in tally.values() if len(items) == len(matches)) > 1:
        return None
    return FrameAggregate(
        subject=subject,
        agreeing=len(matches),
        usable=usable,
        top_score=max(item.score for item in matches),
        runner_up=max(item.runner_up for item in matches),
    )
