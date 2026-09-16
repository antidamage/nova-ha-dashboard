"""Vector helpers: normalisation, cosine similarity, centroid."""

from __future__ import annotations

import numpy as np


def l2_normalise(vector: np.ndarray) -> np.ndarray:
    """Unit-length copy. ArcFace comparisons are cosine, so this is required."""

    values = np.asarray(vector, dtype=np.float64).reshape(-1)
    norm = float(np.linalg.norm(values))
    if not np.isfinite(norm) or norm < 1e-12:
        raise ValueError("cannot normalise a zero or non-finite embedding")
    return values / norm


def cosine(left: np.ndarray, right: np.ndarray) -> float:
    """Cosine similarity, normalising defensively rather than trusting callers."""

    return float(np.dot(l2_normalise(left), l2_normalise(right)))


def centroid(embeddings: list[np.ndarray]) -> np.ndarray:
    """Mean of unit vectors, renormalised — the running enrolment centre."""

    if not embeddings:
        raise ValueError("centroid of an empty gallery is undefined")
    stacked = np.stack([l2_normalise(item) for item in embeddings])
    return l2_normalise(stacked.mean(axis=0))
