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

import logging
import os
import time
from collections import OrderedDict
from pathlib import Path

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


class AntiSpoofEnsemble:
    """Two MiniFASNets voting on whether the camera is looking at a real face.

    Loading raises. A missing or corrupt weight file must stop the service from
    starting rather than degrade to a pass — a face service that cannot tell a
    photograph from a person is worse than no face service, because it looks
    like one.
    """

    def __init__(self, weights_dir: Path, device: str = "cpu") -> None:
        import torch

        # Diagnostics only, opt-in, off unless the env var names a directory.
        debug = os.environ.get("FACE_ANTISPOOF_DEBUG_DIR", "").strip()
        self.debug_dir = Path(debug) if debug else None

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

        Class 1 is "real" in upstream's three-class head.

        **Inputs are BGR floats on [0, 255] — NOT divided by 255.** This looks
        wrong and is not. These weights' BatchNorm running statistics were
        collected at the [0,255] scale, so scaling the input to [0,1] makes it
        two orders of magnitude smaller than the running means the first BN
        subtracts. The layer then emits its constant term and the input stops
        mattering: every image, real or fake, lands on the same output.

        Measured on iridium 2026-09-03 against upstream's own labelled samples,
        mean class-1 across the ensemble:

            input        image_T1 (real)   image_F1 (fake)   image_F2 (fake)
            /255              0.016             0.016             0.015
            raw [0,255]       1.000             0.181             0.001

        The /255 row is the bug this replaced: a live face and a print attack
        scored identically, so the gate refused everything and read as "your
        face is not live". The raw row separates cleanly and the 0.85 threshold
        sits in the gap. Confirmed independently by hooking the layers: with
        /255, `conv1` returned 0.8209 for uniform noise and 0.8278 for zeros —
        a 0.7% difference between maximally different inputs.

        Do not "tidy" this into a ToTensor-style transform.
        """

        import torch
        import torch.nn.functional as F

        totals = []
        with torch.no_grad():
            for scale, width, height, model in self.entries:
                patch = crop_for_scale(image, bbox, scale, width, height)
                tensor = torch.from_numpy(np.ascontiguousarray(patch.transpose(2, 0, 1))).float()
                logits = model(tensor.unsqueeze(0).to(self.device))
                probabilities = F.softmax(logits, dim=1)[0]
                totals.append(float(probabilities[1]))
                if self.debug_dir is not None:
                    self._dump(patch, scale, probabilities)
        return float(np.mean(totals))

    def _dump(self, patch: np.ndarray, scale: float, probabilities) -> None:
        """Write the exact patch the network saw, plus its class vector.

        Turned on with FACE_ANTISPOOF_DEBUG_DIR. This exists because reasoning
        about the crop from the code was not enough to settle why a live face
        scored 0.015: the crop geometry, the colour order and the class index
        each looked correct in isolation, and the only way to tell which of
        them was actually wrong was to look at the image the model was fed.
        Off by default -- these are face crops, and keeping them is the
        liability the enrolment path deliberately avoids.
        """

        import cv2

        try:
            self.debug_dir.mkdir(parents=True, exist_ok=True)
            stamp = f"{int(time.time() * 1000)}_{scale:g}"
            cv2.imwrite(str(self.debug_dir / f"{stamp}.png"), patch)
            (self.debug_dir / f"{stamp}.txt").write_text(
                " ".join(f"{float(value):.6f}" for value in probabilities) + "\n",
                encoding="utf-8",
            )
        except Exception as error:  # diagnostics must never break a request
            LOG.warning("anti-spoof debug dump failed: %s", error)
