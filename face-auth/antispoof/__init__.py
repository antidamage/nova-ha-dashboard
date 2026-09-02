"""Silent-Face anti-spoofing: vendored architecture plus Nova's predictor.

`minifasnet.py` is upstream's model definition, copied verbatim under
Apache-2.0 — see its header. This module owns everything Nova adds on top: the
model-name parsing that decides the crop scale and convolution kernel, the crop
geometry, and the ensemble that turns two networks into one live score.

Weights live in the image, never in the repo.

torch and cv2 are imported inside the functions that use them rather than at
module scope. They are container-only dependencies — the base image carries a
multi-gigabyte CUDA stack — and importing them here made `unittest discover`
fail on a workstation before it reached a single test. Loading still raises the
moment the ensemble is constructed, so the "never fail open" property is
unchanged: the service cannot start without working weights, it merely no
longer needs a GPU stack present to import a name.
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

import numpy as np


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
    """Upstream's CropImage geometry: widen the face box by `scale`, then clamp.

    The two networks are trained at different scales — one sees a tight face,
    one sees the surrounding context — which is where most of the print/replay
    signal lives, so this must not be replaced with a plain resize.
    """

    import cv2

    source_height, source_width = image.shape[:2]
    x, y, box_width, box_height = bbox
    scale = min((source_height - 1) / box_height, (source_width - 1) / box_width, scale)
    new_width, new_height = box_width * scale, box_height * scale
    centre_x, centre_y = x + box_width / 2, y + box_height / 2
    left, top = centre_x - new_width / 2, centre_y - new_height / 2
    right, bottom = centre_x + new_width / 2, centre_y + new_height / 2
    if left < 0:
        right, left = right - left, 0
    if top < 0:
        bottom, top = bottom - top, 0
    if right > source_width - 1:
        left, right = left - (right - source_width + 1), source_width - 1
    if bottom > source_height - 1:
        top, bottom = top - (bottom - source_height + 1), source_height - 1
    patch = image[int(top): int(bottom) + 1, int(left): int(right) + 1]
    return cv2.resize(patch, (width, height))


class AntiSpoofEnsemble:
    """Two MiniFASNets voting on whether the camera is looking at a real face.

    Loading raises. A missing or corrupt weight file must stop the service from
    starting rather than degrade to a pass — a face service that cannot tell a
    photograph from a person is worse than no face service, because it looks
    like one.
    """

    def __init__(self, weights_dir: Path, device: str = "cpu") -> None:
        import torch

        models = architectures()
        self.device = torch.device(device)
        self.entries: list[tuple[float, int, int, "torch.nn.Module"]] = []
        self.names: list[str] = []
        paths = sorted(Path(weights_dir).glob("*.pth"))
        if not paths:
            raise RuntimeError(f"no anti-spoof weights in {weights_dir}; refusing to start")
        for path in paths:
            scale, height, width, kind = parse_model_name(path.name)
            model = models[kind](conv6_kernel=(height // 16, width // 16)).to(self.device)
            state = torch.load(path, map_location=self.device)
            if next(iter(state)).startswith("module."):
                state = OrderedDict((key[7:], value) for key, value in state.items())
            model.load_state_dict(state)
            model.eval()
            self.entries.append((scale, width, height, model))
            self.names.append(path.name)

    def score(self, image: np.ndarray, bbox: tuple[int, int, int, int]) -> float:
        """Mean live probability across the ensemble, in [0, 1].

        Class 1 is "real" in upstream's three-class head. Inputs are BGR uint8
        scaled to [0,1] with no further normalisation, matching upstream's
        transform — getting this wrong shifts the score distribution and
        quietly invalidates any calibration done against it.
        """

        import torch
        import torch.nn.functional as F

        totals = []
        with torch.no_grad():
            for scale, width, height, model in self.entries:
                patch = crop_for_scale(image, bbox, scale, width, height)
                tensor = torch.from_numpy(patch.transpose(2, 0, 1)).float().div_(255.0)
                logits = model(tensor.unsqueeze(0).to(self.device))
                totals.append(float(F.softmax(logits, dim=1)[0, 1]))
        return float(np.mean(totals))
