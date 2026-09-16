"""Pipeline mixin: visual-similarity and identity matching for cats, vehicles and the owner.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from core import Box
from .constants import LOG, POLICY
from .store import STORE


class PipelineIdentityMixin:
    @staticmethod
    def visual_similarity(left_path: Path, right_path: Path) -> float:
        left, right = cv2.imread(str(left_path)), cv2.imread(str(right_path))
        if left is None or right is None:
            return 0.0
        left_hsv, right_hsv = cv2.cvtColor(left, cv2.COLOR_BGR2HSV), cv2.cvtColor(right, cv2.COLOR_BGR2HSV)
        left_hist = cv2.calcHist([left_hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        right_hist = cv2.calcHist([right_hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        cv2.normalize(left_hist, left_hist)
        cv2.normalize(right_hist, right_hist)
        histogram = max(0.0, float(cv2.compareHist(left_hist, right_hist, cv2.HISTCMP_CORREL)))
        orb = cv2.ORB_create(nfeatures=700)
        left_keypoints, left_descriptors = orb.detectAndCompute(cv2.cvtColor(left, cv2.COLOR_BGR2GRAY), None)
        right_keypoints, right_descriptors = orb.detectAndCompute(cv2.cvtColor(right, cv2.COLOR_BGR2GRAY), None)
        feature = 0.0
        if left_descriptors is not None and right_descriptors is not None and left_keypoints and right_keypoints:
            matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(left_descriptors, right_descriptors, k=2)
            good = [pair[0] for pair in matches if len(pair) == 2 and pair[0].distance < 0.72 * pair[1].distance]
            feature = min(1.0, len(good) / max(12.0, min(len(left_keypoints), len(right_keypoints)) * 0.18))
        return round(histogram * 0.62 + feature * 0.38, 4)

    def reference_identity(self, kind: str, frame_paths: list[Path]) -> tuple[str, float] | None:
        with STORE.lock:
            rows = STORE.connection.execute("SELECT name,path FROM subject_references WHERE kind=?", (kind,)).fetchall()
        scores: dict[str, float] = {}
        for row in rows:
            reference_path = Path(row["path"])
            scores[row["name"]] = max(scores.get(row["name"], 0.0), *(self.visual_similarity(frame, reference_path) for frame in frame_paths))
        ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        if not ordered:
            return None
        name, score = ordered[0]
        runner_up = ordered[1][1] if len(ordered) > 1 else 0.0
        threshold = 0.88 if kind == "cat" else 0.82
        return (name, score) if score >= threshold and score - runner_up >= 0.08 else None

    def identity_embedding(self, image: Any, cache_key: str | None = None) -> np.ndarray | None:
        if cache_key and cache_key in self.identity_cache:
            return self.identity_cache[cache_key]
        try:
            import torch
            from transformers import AutoImageProcessor, AutoModel
            if self.identity_model is None or self.identity_processor is None:
                model_name = os.environ.get("NOVA_CAMERA_EVENTS_IDENTITY_MODEL", "facebook/dinov2-small")
                LOG.info("loading local visual identity embedding model %s", model_name)
                self.identity_processor = AutoImageProcessor.from_pretrained(model_name)
                self.identity_model = AutoModel.from_pretrained(model_name).eval()
            inputs = self.identity_processor(images=image, return_tensors="pt")
            with torch.no_grad():
                vector = self.identity_model(**inputs).last_hidden_state[:, 0].float().cpu().numpy()[0]
            vector /= max(float(np.linalg.norm(vector)), 1e-9)
            if cache_key:
                self.identity_cache[cache_key] = vector
            return vector
        except Exception as error:
            LOG.warning("person identity embedding unavailable: %s", error)
            return None

    def owner_identity(self, evidence: list[dict[str, Any]]) -> tuple[str, float] | None:
        from PIL import Image
        with STORE.lock:
            rows = STORE.connection.execute(
                "SELECT name,path FROM subject_references WHERE kind='person' AND role='owner'"
            ).fetchall()
        if not rows:
            return None
        references: dict[str, list[np.ndarray]] = {}
        for row in rows:
            path = Path(row["path"])
            if not path.is_file():
                continue
            vector = self.identity_embedding(Image.open(path).convert("RGB"), str(path))
            if vector is not None:
                references.setdefault(row["name"], []).append(vector)

        event_vectors: list[np.ndarray] = []
        for item in evidence:
            subjects = [subject for subject in item.get("subjects", []) if subject.get("class") == "person"]
            path = Path(item.get("frame", ""))
            if not subjects or not path.is_file():
                continue
            subject = max(subjects, key=lambda value: float(value.get("confidence", 0)))
            image = Image.open(path).convert("RGB")
            x1, y1, x2, y2 = subject["box"]
            width, height = image.size
            margin_x, margin_y = (x2 - x1) * 0.12, (y2 - y1) * 0.08
            crop = image.crop((max(0, (x1 - margin_x) * width), max(0, (y1 - margin_y) * height), min(width, (x2 + margin_x) * width), min(height, (y2 + margin_y) * height)))
            vector = self.identity_embedding(crop)
            if vector is not None:
                event_vectors.append(vector)
        threshold = float(POLICY.get("thresholds", {}).get("ownerSimilarity", 0.82))
        minimum = int(POLICY.get("thresholds", {}).get("ownerMinimumFrames", 2))
        candidates: list[tuple[str, float, int]] = []
        for name, vectors in references.items():
            scores = [max(float(np.dot(event, reference)) for reference in vectors) for event in event_vectors]
            passing = [score for score in scores if score >= threshold]
            if len(passing) >= minimum:
                candidates.append((name, sum(passing) / len(passing), len(passing)))
        candidates.sort(key=lambda item: (item[2], item[1]), reverse=True)
        if not candidates:
            return None
        name, score, _ = candidates[0]
        runner_up = candidates[1][1] if len(candidates) > 1 else 0.0
        return (name, score) if score - runner_up >= 0.04 else None

    def vehicle_identity(self, evidence: list[dict[str, Any]]) -> tuple[str, float, bool] | None:
        """Match detected vehicle crops against new and legacy vehicle references."""

        from PIL import Image
        with STORE.lock:
            rows = STORE.connection.execute(
                "SELECT kind,name,path FROM subject_references WHERE kind IN ('vehicle','ute')"
            ).fetchall()
        if not rows:
            return None
        references: dict[str, list[np.ndarray]] = {}
        legacy_names: set[str] = set()
        for row in rows:
            path = Path(row["path"])
            if not path.is_file():
                continue
            with Image.open(path) as opened:
                vector = self.identity_embedding(opened.convert("RGB"), str(path))
            if vector is not None:
                references.setdefault(row["name"], []).append(vector)
                if row["kind"] == "ute":
                    legacy_names.add(row["name"])

        vehicle_classes = {"car", "truck", "bus", "motorcycle"}
        event_vectors: list[np.ndarray] = []
        for item in evidence:
            subjects = [subject for subject in item.get("subjects", []) if subject.get("class") in vehicle_classes]
            path = Path(item.get("frame", ""))
            if not subjects or not path.is_file():
                continue
            subject = max(subjects, key=lambda value: float(value.get("confidence", 0)))
            with Image.open(path) as opened:
                image = opened.convert("RGB")
                expanded = Box(*subject["box"]).expanded(0.1)
                x1, y1, x2, y2 = expanded.x1, expanded.y1, expanded.x2, expanded.y2
                width, height = image.size
                crop = image.crop((x1 * width, y1 * height, x2 * width, y2 * height))
                vector = self.identity_embedding(crop)
            if vector is not None:
                event_vectors.append(vector)
        if not event_vectors:
            return None

        thresholds = POLICY.get("thresholds", {})
        threshold = float(thresholds.get("vehicleSimilarity", 0.76))
        minimum = int(thresholds.get("vehicleMinimumFrames", 2))
        candidates: list[tuple[str, float, int]] = []
        for name, vectors in references.items():
            scores = [max(float(np.dot(event, reference)) for reference in vectors) for event in event_vectors]
            passing = [score for score in scores if score >= threshold]
            if len(passing) >= minimum:
                candidates.append((name, sum(passing) / len(passing), len(passing)))
        candidates.sort(key=lambda item: (item[2], item[1]), reverse=True)
        if not candidates:
            return None
        name, score, _ = candidates[0]
        runner_up = candidates[1][1] if len(candidates) > 1 else 0.0
        return (name, score, name in legacy_names) if score - runner_up >= 0.04 else None

