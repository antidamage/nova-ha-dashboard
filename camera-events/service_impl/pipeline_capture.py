"""Pipeline mixin: fast-pass capture, detection and retention loops.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import cv2
import numpy as np
import requests

from .constants import (
    AUTH_HEADERS,
    BIRD_CLASS,
    COCO_INTEREST,
    DATA_ROOT,
    DETECTOR_DEVICE,
    DETECTOR_MODEL,
    EVENT_ROOT,
    LOG,
    MIN_FREE_BYTES,
    POLL_SECONDS,
    RETENTION_BYTES,
    RETENTION_DAYS,
    SAMPLE_FPS,
    SOURCE_URL,
    STALL_SECONDS,
    SUBJECT_NAMES,
)
from .helpers import frame_quality, iso_time, parse_time
from .store import STORE


class PipelineCaptureMixin:
    def load_detector(self) -> Any:
        if self.detector is None:
            from ultralytics import YOLO
            LOG.info("loading detector %s", DETECTOR_MODEL)
            self.detector = YOLO(DETECTOR_MODEL)
        return self.detector

    @staticmethod
    def playlist() -> list[dict[str, Any]]:
        response = requests.get(SOURCE_URL, timeout=12, headers=AUTH_HEADERS)
        response.raise_for_status()
        segments: list[dict[str, Any]] = []
        at: float | None = None
        duration = 2.0
        for line in response.text.splitlines():
            line = line.strip()
            if line.startswith("#EXT-X-PROGRAM-DATE-TIME:"):
                at = parse_time(line.split(":", 1)[1])
            elif line.startswith("#EXTINF:"):
                duration = float(line.split(":", 1)[1].split(",", 1)[0])
            elif line and not line.startswith("#") and at is not None:
                segments.append({"at": at, "duration": duration, "url": urljoin(SOURCE_URL, line)})
                at += duration
        return segments

    def detections(self, frame: np.ndarray) -> list[dict[str, Any]]:
        detector = self.load_detector()
        height, width = frame.shape[:2]
        result = detector.predict(frame, imgsz=1280, conf=0.22, classes=sorted(COCO_INTEREST | {BIRD_CLASS}), device=DETECTOR_DEVICE, verbose=False)[0]
        out: list[dict[str, Any]] = []
        if result.boxes is None:
            return out
        for coordinates, confidence, class_id in zip(result.boxes.xyxyn.cpu().tolist(), result.boxes.conf.cpu().tolist(), result.boxes.cls.cpu().tolist()):
            cid = int(class_id)
            out.append({
                "classId": cid,
                "class": "bird" if cid == BIRD_CLASS else SUBJECT_NAMES.get(cid, f"class_{cid}"),
                "confidence": round(float(confidence), 4),
                "box": [round(float(value), 5) for value in coordinates],
                "pixels": [int(coordinates[0] * width), int(coordinates[1] * height), int(coordinates[2] * width), int(coordinates[3] * height)],
            })
        return out

    def evidence_frame(self, event_id: str, frame: np.ndarray, timestamp: float) -> str:
        directory = EVENT_ROOT / event_id / "frames"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{int(timestamp * 1000)}.jpg"
        cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return str(path)

    def process_segment(self, segment: dict[str, Any]) -> bool:
        capture = cv2.VideoCapture(segment["url"])
        if not capture.isOpened():
            LOG.warning("segment expired before analysis: %s", segment["url"])
            return False
        native_fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
        stride = max(1, round(native_fps / max(0.25, SAMPLE_FPS)))
        index = 0
        while not self.stop.is_set():
            ok, frame = capture.read()
            if not ok:
                break
            if index % stride == 0:
                with self.last_frame_lock:
                    self.last_frame = frame.copy()
                good, _, _ = frame_quality(frame)
                if good:
                    self.observe(frame, segment["at"] + index / native_fps, self.detections(frame))
            index += 1
        capture.release()
        return True

    def run(self) -> None:
        LOG.info("pipeline consuming %s", SOURCE_URL)
        while not self.stop.is_set():
            try:
                settings = STORE.get_setting("analysis") or {}
                if not settings.get("enabled", True):
                    self.stop.wait(POLL_SECONDS)
                    continue
                self.catalog = self.playlist()
                cursor = parse_time(self.last_processed_at) if self.last_processed_at else 0.0
                pending = [item for item in self.catalog if item["at"] > cursor + 0.01]
                for segment in pending:
                    if self.stop.is_set():
                        break
                    self.process_segment(segment)
                    self.last_processed_at = iso_time(segment["at"])
                    self.analysed_through = segment["at"] + segment["duration"]
                    self.last_progress_wall = time.monotonic()
                    STORE.set_state("last_processed_at", self.last_processed_at)
                    self.finalize_if_ready(self.analysed_through)
                if self.catalog:
                    newest = self.catalog[-1]["at"] + self.catalog[-1]["duration"]
                    self.backlog_seconds = max(0.0, newest - (parse_time(self.last_processed_at) if self.last_processed_at else newest))
                    self.finalize_if_ready(self.analysed_through)
                if self.active is not None and time.monotonic() - self.last_progress_wall >= STALL_SECONDS:
                    LOG.warning("recorder stalled; closing event %s at the analysed position", self.active["id"])
                    self.finalize_if_ready(self.analysed_through, stalled=True)
                self.detector_error = None
            except Exception as error:  # keep the recorder-independent service alive
                self.detector_error = str(error)
                LOG.exception("fast-pass iteration failed")
            self.stop.wait(POLL_SECONDS)

    def retention(self) -> None:
        while not self.stop.wait(3600):
            try:
                cutoff = time.time() - RETENTION_DAYS * 86400
                with STORE.lock:
                    rows = STORE.connection.execute("SELECT * FROM events WHERE starred=0 ORDER BY started_at ASC").fetchall()
                total = sum((Path(row["clip"]).stat().st_size if row["clip"] and Path(row["clip"]).exists() else 0) for row in rows)
                free = shutil.disk_usage(DATA_ROOT).free
                for row in rows:
                    expired = parse_time(row["started_at"]) < cutoff
                    oversized = total > RETENTION_BYTES
                    reserve = free < MIN_FREE_BYTES
                    if not (expired or oversized or reserve):
                        continue
                    size = Path(row["clip"]).stat().st_size if row["clip"] and Path(row["clip"]).exists() else 0
                    STORE.delete(row["id"])
                    total -= size
                    free += size
            except Exception:
                LOG.exception("retention sweep failed")
