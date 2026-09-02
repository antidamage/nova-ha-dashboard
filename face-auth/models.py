"""Model loading for the face service: detection, embedding, anti-spoofing.

Kept out of `core.py` on purpose — `core.py` is the file the design is tested
through, and it stays free of anything that needs a GPU, a weight file or a
network. This module is the other half: it owns the onnxruntime session, the
provider fallback, and the anti-spoof ensemble, and it hands `core.py` plain
numpy arrays.

Nothing here reads a threshold. The service reads the environment once and
passes values down.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

LOG = logging.getLogger("nova-face-auth.models")

# CUDA first, CPU second, and the fallback is load-bearing rather than
# decorative. This box also runs the LLM and TTS; the documented eviction order
# evicts TTS first, and the face service must never become a thing that has to
# die for a voice turn. CPU inference on a 25-frame clip is seconds rather than
# milliseconds, which is acceptable for an interactive login and not acceptable
# silently — hence `provider` on /healthz.
PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]


@dataclass(frozen=True)
class Detection:
    bbox: tuple[float, float, float, float]
    score: float
    landmarks: np.ndarray  # (5, 2), RetinaFace order
    embedding: np.ndarray | None = None

    @property
    def short_side(self) -> float:
        return min(self.bbox[2] - self.bbox[0], self.bbox[3] - self.bbox[1])

    def as_dict(self) -> dict[str, Any]:
        return {
            "bbox": [round(float(value), 2) for value in self.bbox],
            "score": round(float(self.score), 4),
            "landmarks": [[round(float(x), 2), round(float(y), 2)] for x, y in self.landmarks],
        }


class FaceModels:
    """Lazily loaded insightface pipeline plus the anti-spoof ensemble.

    Detection and recognition load lazily so an import cannot cost a GPU
    context. Anti-spoofing loads eagerly at startup and is allowed to raise:
    the container exiting is the correct outcome when the spoof gate is
    unavailable. Never fail open.
    """

    def __init__(
        self,
        *,
        pack: str | None = None,
        model_root: str | None = None,
        antispoof_dir: str | None = None,
        det_size: int = 640,
    ) -> None:
        self.pack = pack or os.environ.get("FACE_MODEL_PACK", "buffalo_l")
        self.model_root = Path(model_root or os.environ.get("FACE_MODEL_ROOT", "/models"))
        self.antispoof_dir = Path(antispoof_dir or os.environ.get("FACE_ANTISPOOF_DIR", "/models/antispoof"))
        self.det_size = det_size
        self._analysis: Any = None
        self._antispoof: Any = None
        self.provider: str = "unloaded"
        self.antispoof_names: list[str] = []

    # -- loading ----------------------------------------------------------

    def load_antispoof(self) -> None:
        """Eager, and deliberately not caught by the caller."""

        from antispoof import AntiSpoofEnsemble

        device = "cuda" if self._torch_cuda_available() else "cpu"
        self._antispoof = AntiSpoofEnsemble(self.antispoof_dir, device=device)
        self.antispoof_names = list(self._antispoof.names)
        LOG.info("anti-spoof ensemble loaded on %s: %s", device, ", ".join(self.antispoof_names))

    @staticmethod
    def _torch_cuda_available() -> bool:
        try:
            import torch

            return bool(torch.cuda.is_available())
        except Exception:  # pragma: no cover - torch absent is a CPU box
            return False

    @property
    def analysis(self) -> Any:
        if self._analysis is None:
            from insightface.app import FaceAnalysis

            app = FaceAnalysis(
                name=self.pack,
                root=str(self.model_root),
                providers=PROVIDERS,
                allowed_modules=["detection", "recognition"],
            )
            app.prepare(ctx_id=0, det_size=(self.det_size, self.det_size))
            self._analysis = app
            session = app.models["detection"].session
            self.provider = session.get_providers()[0]
            LOG.info("face models ready on %s", self.provider)
        return self._analysis

    def warm_up(self) -> None:
        """One inference on a blank frame so the first real login is not the
        one that pays for cuDNN autotuning."""

        blank = np.zeros((self.det_size, self.det_size, 3), dtype=np.uint8)
        self.analysis.get(blank)

    @property
    def loaded(self) -> bool:
        return self._analysis is not None and self._antispoof is not None

    # -- inference --------------------------------------------------------

    def detect(self, frame: np.ndarray, *, with_embedding: bool = False) -> list[Detection]:
        """All faces in one BGR frame. The caller decides what several means."""

        results = []
        for face in self.analysis.get(frame):
            embedding = None
            if with_embedding and getattr(face, "normed_embedding", None) is not None:
                embedding = np.asarray(face.normed_embedding, dtype=np.float64)
            results.append(
                Detection(
                    bbox=tuple(float(value) for value in face.bbox),
                    score=float(face.det_score),
                    landmarks=np.asarray(face.kps, dtype=np.float64),
                    embedding=embedding,
                )
            )
        return results

    def antispoof_score(self, frame: np.ndarray, bbox: tuple[float, float, float, float]) -> float:
        if self._antispoof is None:
            raise RuntimeError("anti-spoof ensemble is not loaded")
        x1, y1, x2, y2 = (int(round(value)) for value in bbox)
        box = (x1, y1, max(1, x2 - x1), max(1, y2 - y1))
        return self._antispoof.score(frame, box)

    def health(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "models": {
                "det": f"{self.pack}/det_10g" if self._analysis else None,
                "rec": f"{self.pack}/w600k_r50" if self._analysis else None,
                "antispoof": self.antispoof_names or None,
            },
        }
