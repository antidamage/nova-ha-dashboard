"""Enrolment consistency: appearance clustering and cross-subject conflicts."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import ENROL_CENTROID_MAX, MATCH_COSINE
from .matching import gallery_scores
from .vectors import l2_normalise


@dataclass(frozen=True)
class ConsistencyReport:
    ok: bool
    index: int | None
    reason: str | None
    centroid_distance: float | None
    nearest_other_subject: str | None
    nearest_other_score: float | None

    def as_dict(self) -> dict[str, object]:
        return {
            "centroidDistance": None if self.centroid_distance is None else round(self.centroid_distance, 4),
            "nearestOtherSubject": None if self.nearest_other_score is None else round(self.nearest_other_score, 4),
            "nearestOtherSubjectId": self.nearest_other_subject,
        }


def enrolment_consistency(
    embeddings: list[np.ndarray],
    *,
    others: dict[str, list[np.ndarray]] | None = None,
    centroid_max: float = ENROL_CENTROID_MAX,
    match_cosine: float = MATCH_COSINE,
) -> ConsistencyReport:
    """Check a subject's accepted embeddings, newest last, against two rules.

    Every member must sit within `centroid_max` cosine distance of the NEAREST
    member accepted before it, and no member may sit within
    `match_cosine` of a *different* existing subject — two overlapping
    galleries mean neither person can be matched unambiguously afterwards, and
    the failure surfaces long after enrolment if it is not caught here.

    The offending index is named so the caller can say which clip, rather than
    condemning the whole set. The service passes accepted-plus-candidate and
    rejects the clip when the reported index is the last one.
    """

    others = others or {}
    if not embeddings:
        raise ValueError("nothing to check")
    normalised = [l2_normalise(item) for item in embeddings]

    for index, vector in enumerate(normalised):
        conflicts = gallery_scores(vector, others)
        if conflicts and conflicts[0][1] >= match_cosine:
            return ConsistencyReport(
                ok=False, index=index, reason="conflicts_with_subject",
                centroid_distance=None,
                nearest_other_subject=conflicts[0][0], nearest_other_score=conflicts[0][1],
            )
        if index == 0:
            continue
        # Distance to the NEAREST clip already accepted, not to their centroid.
        #
        # A centroid assumes one appearance. Adeline wears a wig sometimes and
        # glasses sometimes, and either changes the embedding: glasses more than
        # the wig, because ArcFace aligns on the eyes and crops to roughly
        # eyebrows-to-chin, so the frames sit across the most heavily weighted
        # region while most hair falls outside the crop. Enrolling the second
        # appearance is the whole fix for that -- matching is max-per-subject
        # (`gallery_scores`), so a wig-on attempt only has to match the wig-on
        # clips. A centroid rule makes that impossible: the second appearance is
        # far from the mean of the first by construction, and gets refused as
        # "inconsistent" before it can ever be stored.
        #
        # Nearest-member lets a subject hold several appearance clusters while
        # still refusing a clip that resembles nothing they have enrolled. The
        # rule that actually protects identity is the `conflicts_with_subject`
        # check above, which is unchanged: no clip may look like a DIFFERENT
        # enrolled person.
        distance = min(1.0 - float(np.dot(vector, other)) for other in normalised[:index])
        if distance > centroid_max:
            return ConsistencyReport(
                ok=False, index=index, reason="inconsistent", centroid_distance=distance,
                nearest_other_subject=conflicts[0][0] if conflicts else None,
                nearest_other_score=conflicts[0][1] if conflicts else None,
            )

    last = normalised[-1]
    conflicts = gallery_scores(last, others)
    distance = (
        0.0 if len(normalised) == 1
        else min(1.0 - float(np.dot(last, other)) for other in normalised[:-1])
    )
    return ConsistencyReport(
        ok=True, index=None, reason=None, centroid_distance=distance,
        nearest_other_subject=conflicts[0][0] if conflicts else None,
        nearest_other_score=conflicts[0][1] if conflicts else None,
    )
