"""Model-name parsing, crop geometry and the on-demand architecture table.

Split out of `antispoof/__init__.py`; moved verbatim.
"""
from __future__ import annotations

import logging

import numpy as np

LOG = logging.getLogger("nova-face-auth.antispoof")


def architectures() -> dict[str, type]:
    """Upstream's four networks, resolved on demand."""

    from .minifasnet import MiniFASNetV1, MiniFASNetV1SE, MiniFASNetV2, MiniFASNetV2SE

    return {
        "MiniFASNetV1": MiniFASNetV1,
        "MiniFASNetV2": MiniFASNetV2,
        "MiniFASNetV1SE": MiniFASNetV1SE,
        "MiniFASNetV2SE": MiniFASNetV2SE,
    }


# Architecture names, without importing torch to learn them.
MODEL_NAMES = ("MiniFASNetV1", "MiniFASNetV2", "MiniFASNetV1SE", "MiniFASNetV2SE")

def parse_model_name(name: str) -> tuple[float, int, int, str]:
    """Upstream encodes crop scale, input size and architecture in the file name.

    "2.7_80x80_MiniFASNetV2.pth" and "4_0_0_80x80_MiniFASNetV1SE.pth". The
    parse is upstream's — first token is the scale, the token before the
    architecture is HxW — and it is reproduced rather than tidied because the
    weights ship under those names and a tidier scheme would decouple a file
    from the geometry it was trained at without saying so.
    """

    if not name.endswith(".pth"):
        raise ValueError(f"unrecognised anti-spoof weight name: {name}")
    tokens = name[: -len(".pth")].split("_")
    if len(tokens) < 3 or "x" not in tokens[-2]:
        raise ValueError(f"unrecognised anti-spoof weight name: {name}")
    height, width = (int(part) for part in tokens[-2].split("x"))
    kind = tokens[-1]
    if kind not in MODEL_NAMES:
        raise ValueError(f"unknown anti-spoof architecture in {name}")
    return float(tokens[0]), height, width, kind


def crop_for_scale(image: np.ndarray, bbox: tuple[int, int, int, int], scale: float, width: int, height: int) -> np.ndarray:
    """Widen the face box by `scale`, keeping the face centred, then resize.

    The two networks are trained at different scales — one sees a tight face,
    one sees the surrounding context — which is where most of the print/replay
    signal lives, so this must not be replaced with a plain resize.

    **Deliberately diverges from upstream's `CropImage` in one way: it reflects
    the border instead of clamping and shifting the window.** Upstream, when the
    widened box runs off the frame, first reduces `scale` to whatever fits and
    then slides the window back inside. Both steps corrupt the geometry the
    network was trained on:

    - the clamp collapses the ensemble's two views into one (measured: a 1280x720
      frame with a 371x543 face clamped both 2.7 and 4.0 to 1.324, so the two
      models received byte-identical crops), and
    - the slide moves the face off-centre in the patch, which is what a browser
      capture with the face near an edge always triggers.

    Measured across framings on 2026-09-03 (mean class-1 over the ensemble),
    the same person and the same session:

        framing                faceH/frameH   upstream   reflect-padded
        landscape 1280x720         0.75         0.9998       0.9895
        portrait  720x1280         0.27         0.5994       0.9670

    Portrait is the case that matters: nothing was wrong with that capture, it
    simply put the face near an edge, and upstream's slide decentred it enough
    to halve the score. Reflection keeps the face centred at the true scale in
    every framing, at a small cost on the already-easy landscape case.

    A face that extends beyond the frame is a different problem — there is no
    pixel data to reflect and fabricating it would invent evidence — and is
    refused before this is reached. See `core.framing_reason`.
    """

    import cv2

    x, y, box_width, box_height = bbox
    new_width, new_height = box_width * scale, box_height * scale
    centre_x, centre_y = x + box_width / 2, y + box_height / 2
    left, top = int(round(centre_x - new_width / 2)), int(round(centre_y - new_height / 2))
    right, bottom = int(round(centre_x + new_width / 2)), int(round(centre_y + new_height / 2))

    source_height, source_width = image.shape[:2]
    pad_left, pad_top = max(0, -left), max(0, -top)
    pad_right, pad_bottom = max(0, right - source_width), max(0, bottom - source_height)
    if pad_left or pad_top or pad_right or pad_bottom:
        image = cv2.copyMakeBorder(
            image, pad_top, pad_bottom, pad_left, pad_right, cv2.BORDER_REFLECT_101
        )
        left, right = left + pad_left, right + pad_left
        top, bottom = top + pad_top, bottom + pad_top

    patch = image[top:bottom, left:right]
    if patch.size == 0:
        raise ValueError("empty anti-spoof crop")
    return cv2.resize(patch, (width, height))
