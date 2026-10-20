"""Shared fixtures for the `core` tests: synthetic landmark tracks and embeddings.

Imported by every `test_core_*.py`; holds no tests itself."""

import math

import numpy as np

# Documentation ranges, not this household's. RFC 5737 TEST-NET-1 and the
# RFC 6598 CGNAT block the tailnet uses. The real LAN prefix is configuration
# in /etc/nova-face-auth.env and never a constant in this repo.
TEST_LAN = "192.0.2.0/24"
TAILNET = "100.64.0.0/10"

# An asymmetric five-point face in pixels, in RetinaFace order. Asymmetric on
# purpose: a symmetric shape would hide reflection bugs, because its mirror is
# reachable by a proper rotation.
BASE_SHAPE = np.array(
    [
        [-30.0, -20.0],  # left eye
        [30.0, -20.0],   # right eye
        [2.0, 6.0],      # nose tip
        [-22.0, 30.0],   # left mouth corner
        [24.0, 29.0],    # right mouth corner
    ]
)


def similarity_matrix(angle: float, scale: float) -> np.ndarray:
    return scale * np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])


def rigid_track(frames: int = 25, *, noise: float = 0.2, seed: int = 7) -> np.ndarray:
    """A photograph being held, tilted and waved in front of the lens.

    Every frame is the same shape under scale, rotation and translation, plus
    sub-pixel sensor noise. Nothing about it is non-rigid.
    """

    rng = np.random.default_rng(seed)
    track = []
    for index in range(frames):
        angle = 0.35 * math.sin(index / 3.0)
        scale = 1.0 + 0.25 * math.sin(index / 5.0)
        offset = np.array([40.0 * math.sin(index / 4.0), 25.0 * math.cos(index / 6.0)])
        moved = BASE_SHAPE @ similarity_matrix(angle, scale).T + offset
        track.append(moved + rng.normal(0.0, noise, moved.shape))
    return np.stack(track)


def live_track(frames: int = 25, *, seed: int = 11) -> np.ndarray:
    """The same motion, plus a blink and a moving mouth that no rigid fit removes."""

    rng = np.random.default_rng(seed)
    track = []
    for index in range(frames):
        shape = BASE_SHAPE.copy()
        blink = 5.0 * max(0.0, math.sin(index / 2.0))
        shape[0, 1] += blink
        shape[1, 1] += blink * 0.92
        shape[3, 0] += 2.4 * math.sin(index / 1.7)
        shape[4, 0] -= 2.2 * math.sin(index / 1.9)
        shape[2, 1] += 0.8 * math.cos(index / 2.3)
        angle = 0.30 * math.sin(index / 3.0)
        scale = 1.0 + 0.20 * math.sin(index / 5.0)
        offset = np.array([35.0 * math.sin(index / 4.0), 20.0 * math.cos(index / 6.0)])
        moved = shape @ similarity_matrix(angle, scale).T + offset
        track.append(moved + rng.normal(0.0, 0.15, moved.shape))
    return np.stack(track)


def unit_vectors(dimension: int = 512) -> np.ndarray:
    """A deterministic orthonormal basis to build embeddings with known angles."""

    rng = np.random.default_rng(3)
    basis, _ = np.linalg.qr(rng.normal(size=(dimension, dimension)))
    return basis.T


BASIS = unit_vectors()


def embedding_at(angle: float, axis: int = 1) -> np.ndarray:
    """A unit vector whose cosine with BASIS[0] is exactly cos(angle)."""

    return math.cos(angle) * BASIS[0] + math.sin(angle) * BASIS[axis]
