"""AntiSpoofEnsemble: two MiniFASNets voting on a live score.

Split out of `antispoof/__init__.py`; moved verbatim.
"""
from __future__ import annotations

import logging
import os
import time
from collections import OrderedDict
from pathlib import Path

import numpy as np

from .geometry import LOG, architectures, crop_for_scale, parse_model_name


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
