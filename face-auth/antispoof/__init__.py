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

from .ensemble import AntiSpoofEnsemble
from .geometry import LOG, MODEL_NAMES, architectures, crop_for_scale, parse_model_name

__all__ = ["AntiSpoofEnsemble", "LOG", "MODEL_NAMES", "architectures", "crop_for_scale", "parse_model_name"]
