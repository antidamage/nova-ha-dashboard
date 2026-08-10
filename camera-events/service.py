"""Nova daytime camera event service.

The service consumes the existing rolling HLS feed. It deliberately does not
own capture: Nocturnium remains the sole recorder, while this process samples
completed segments, creates compact event clips and runs queued local models.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import cv2
import numpy as np
import requests
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from core import Box, point_in_polygon, priority_for, prompt_road_crossing, vehicle_proximity


logging.basicConfig(level=os.environ.get("NOVA_CAMERA_EVENTS_LOG_LEVEL", "INFO"))
LOG = logging.getLogger("nova-camera-events")

DATA_ROOT = Path(os.environ.get("NOVA_CAMERA_EVENTS_DATA", "/data"))
EVENT_ROOT = DATA_ROOT / "events"
REFERENCE_ROOT = DATA_ROOT / "references"
DB_PATH = DATA_ROOT / "events.sqlite3"
SOURCE_URL = os.environ.get(
    "NOVA_CAMERA_EVENTS_SOURCE",
    "http://nocturnium.local:8080/camera/outside/index.m3u8",
)
CAMERA_ID = os.environ.get("NOVA_CAMERA_EVENTS_CAMERA_ID", "outside")
DETECTOR_MODEL = os.environ.get("NOVA_CAMERA_EVENTS_DETECTOR", "yolo11n.pt")
POLL_SECONDS = float(os.environ.get("NOVA_CAMERA_EVENTS_POLL_SECONDS", "4"))
SAMPLE_FPS = float(os.environ.get("NOVA_CAMERA_EVENTS_SAMPLE_FPS", "2"))
DETECTOR_DEVICE = os.environ.get("NOVA_CAMERA_EVENTS_DETECTOR_DEVICE", "cuda:0")
DETAIL_ENABLED = os.environ.get("NOVA_CAMERA_EVENTS_DETAIL", "true").lower() in {"1", "true", "yes", "on"}
MOONDREAM_MODEL = os.environ.get("NOVA_CAMERA_EVENTS_MOONDREAM", "vikhyatk/moondream2")
RETENTION_DAYS = 14
RETENTION_BYTES = 50 * 1024**3
MIN_FREE_BYTES = 20 * 1024**3

COCO_INTEREST = {0, 1, 2, 3, 5, 7, 15, 16, 17, 18, 19, 20, 21, 22, 23}
BIRD_CLASS = 14
SUBJECT_NAMES = {
    0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck",
    15: "cat", 16: "dog", 17: "horse", 18: "sheep", 19: "cow", 20: "elephant",
    21: "bear", 22: "zebra", 23: "giraffe",
}

DEFAULT_ZONES = [
    {"id": "far_footpath", "label": "Opposite footpath", "kind": "activity", "points": [[0.08, 0.055], [0.95, 0.055], [0.94, 0.145], [0.07, 0.145]]},
    {"id": "road", "label": "Road", "kind": "activity", "points": [[0.02, 0.13], [0.98, 0.13], [0.89, 0.43], [0.13, 0.48]]},
    {"id": "near_kerb", "label": "Near curb and ute", "kind": "vehicle", "points": [[0.02, 0.32], [0.92, 0.32], [0.82, 0.58], [0.05, 0.58]]},
    {"id": "front_path", "label": "Front path", "kind": "activity", "points": [[0.05, 0.48], [0.78, 0.45], [0.98, 0.73], [0.78, 1.0], [0.05, 1.0]]},
    {"id": "gate_entry", "label": "Gate and entrance", "kind": "activity", "points": [[0.36, 0.43], [0.63, 0.42], [0.66, 0.68], [0.35, 0.68]]},
    {"id": "rear_laneway", "label": "Laneway", "kind": "activity", "points": [[0.56, 0.43], [0.91, 0.36], [1.0, 0.83], [0.75, 1.0], [0.60, 0.72]]},
    {"id": "tree_exclusion", "label": "Tree movement", "kind": "exclude", "points": [[0, 0], [0.31, 0], [0.27, 0.37], [0.0, 0.58]]},
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def iso_time(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


class EventPatch(BaseModel):
    reviewed: bool | None = None
    starred: bool | None = None
    correctedLabels: list[str] | None = None
    correctedIdentity: str | None = None


class SettingsBody(BaseModel):
    enabled: bool = True
    alertsEnabled: bool = False
    zones: list[dict[str, Any]]


class Store:
    def __init__(self) -> None:
        DATA_ROOT.mkdir(parents=True, exist_ok=True)
        EVENT_ROOT.mkdir(parents=True, exist_ok=True)
        REFERENCE_ROOT.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
              id TEXT PRIMARY KEY, camera_id TEXT NOT NULL, started_at TEXT NOT NULL,
              ended_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              status TEXT NOT NULL, priority TEXT NOT NULL, title TEXT NOT NULL,
              summary TEXT NOT NULL, zones_json TEXT NOT NULL, subjects_json TEXT NOT NULL,
              labels_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
              detector_model TEXT NOT NULL, detail_model TEXT,
              thumbnail TEXT, clip TEXT, reviewed INTEGER NOT NULL DEFAULT 0,
              starred INTEGER NOT NULL DEFAULT 0, corrected_labels_json TEXT,
              corrected_identity TEXT, alert_state TEXT NOT NULL DEFAULT 'none',
              detail_error TEXT
            );
            CREATE INDEX IF NOT EXISTS events_started ON events(started_at DESC);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS subject_references (
              id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
              path TEXT NOT NULL, created_at TEXT NOT NULL
            );
            """
        )
        self.connection.commit()
        if self.get_setting("analysis") is None:
            self.set_setting("analysis", {"enabled": True, "alertsEnabled": False, "zones": DEFAULT_ZONES})

    def get_setting(self, key: str) -> Any:
        with self.lock:
            row = self.connection.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set_setting(self, key: str, value: Any) -> None:
        with self.lock:
            self.connection.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )
            self.connection.commit()

    def state(self, key: str) -> str | None:
        with self.lock:
            row = self.connection.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_state(self, key: str, value: str) -> None:
        with self.lock:
            self.connection.execute(
                "INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
            self.connection.commit()

    @staticmethod
    def event(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        for column in ("zones_json", "subjects_json", "labels_json", "evidence_json", "corrected_labels_json"):
            target = {
                "zones_json": "zones", "subjects_json": "subjects", "labels_json": "labels",
                "evidence_json": "evidence", "corrected_labels_json": "correctedLabels",
            }[column]
            value[target] = json.loads(value.pop(column)) if value[column] else None
        for source, target in (
            ("camera_id", "cameraId"), ("started_at", "startedAt"), ("ended_at", "endedAt"),
            ("created_at", "createdAt"), ("updated_at", "updatedAt"), ("detector_model", "detectorModel"),
            ("detail_model", "detailModel"), ("corrected_identity", "correctedIdentity"),
            ("alert_state", "alertState"), ("detail_error", "detailError"),
        ):
            value[target] = value.pop(source)
        value["reviewed"] = bool(value["reviewed"])
        value["starred"] = bool(value["starred"])
        value["thumbnailUrl"] = f"/api/camera/{value['cameraId']}/events/{value['id']}/thumbnail" if value["thumbnail"] else None
        value["clipUrl"] = f"/api/camera/{value['cameraId']}/events/{value['id']}/clip" if value["clip"] else None
        value.pop("thumbnail", None)
        value.pop("clip", None)
        return value

    def create(self, event: dict[str, Any]) -> None:
        with self.lock:
            self.connection.execute(
                """INSERT INTO events(
                  id,camera_id,started_at,ended_at,created_at,updated_at,status,priority,title,summary,
                  zones_json,subjects_json,labels_json,evidence_json,detector_model,thumbnail,clip
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    event["id"], CAMERA_ID, event["startedAt"], None, utc_now(), utc_now(), "collecting",
                    event["priority"], event["title"], event["summary"], json.dumps(event["zones"]),
                    json.dumps(event["subjects"]), json.dumps(event["labels"]), json.dumps(event["evidence"]),
                    DETECTOR_MODEL, event.get("thumbnail"), None,
                ),
            )
            self.connection.commit()

    def update_collection(self, event: dict[str, Any]) -> None:
        with self.lock:
            self.connection.execute(
                """UPDATE events SET updated_at=?,priority=?,title=?,summary=?,zones_json=?,subjects_json=?,
                   labels_json=?,evidence_json=?,thumbnail=? WHERE id=?""",
                (
                    utc_now(), event["priority"], event["title"], event["summary"], json.dumps(event["zones"]),
                    json.dumps(event["subjects"]), json.dumps(event["labels"]), json.dumps(event["evidence"]),
                    event.get("thumbnail"), event["id"],
                ),
            )
            self.connection.commit()

    def finalize(self, event_id: str, ended_at: str, clip: str | None) -> None:
        with self.lock:
            self.connection.execute(
                "UPDATE events SET ended_at=?,updated_at=?,status='queued',clip=? WHERE id=?",
                (ended_at, utc_now(), clip, event_id),
            )
            self.connection.commit()

    def get(self, event_id: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.connection.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        return self.event(row) if row else None

    def raw(self, event_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.connection.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()

    def list(self, *, limit: int, priority: str | None, zone: str | None, subject: str | None, reviewed: bool | None, starred: bool | None) -> list[dict[str, Any]]:
        clauses, values = ["camera_id=?"], [CAMERA_ID]
        if priority:
            clauses.append("priority=?"); values.append(priority)
        if reviewed is not None:
            clauses.append("reviewed=?"); values.append(int(reviewed))
        if starred is not None:
            clauses.append("starred=?"); values.append(int(starred))
        if zone:
            clauses.append("zones_json LIKE ?"); values.append(f'%"{zone}"%')
        if subject:
            clauses.append("subjects_json LIKE ?"); values.append(f'%"class": "{subject}"%')
        values.append(limit)
        with self.lock:
            rows = self.connection.execute(
                f"SELECT * FROM events WHERE {' AND '.join(clauses)} ORDER BY started_at DESC LIMIT ?", values
            ).fetchall()
        return [self.event(row) for row in rows]

    def patch(self, event_id: str, patch: EventPatch) -> dict[str, Any] | None:
        assignments, values = ["updated_at=?"], [utc_now()]
        for field, column in ((patch.reviewed, "reviewed"), (patch.starred, "starred")):
            if field is not None:
                assignments.append(f"{column}=?"); values.append(int(field))
        if patch.correctedLabels is not None:
            assignments.append("corrected_labels_json=?"); values.append(json.dumps(patch.correctedLabels))
        if patch.correctedIdentity is not None:
            assignments.append("corrected_identity=?"); values.append(patch.correctedIdentity)
        values.append(event_id)
        with self.lock:
            self.connection.execute(f"UPDATE events SET {','.join(assignments)} WHERE id=?", values)
            self.connection.commit()
        return self.get(event_id)

    def delete(self, event_id: str) -> bool:
        row = self.raw(event_id)
        if not row:
            return False
        for column in ("thumbnail", "clip"):
            if row[column]:
                Path(row[column]).unlink(missing_ok=True)
        shutil.rmtree(EVENT_ROOT / event_id, ignore_errors=True)
        with self.lock:
            self.connection.execute("DELETE FROM events WHERE id=?", (event_id,))
            self.connection.commit()
        return True


STORE = Store()


def zone_for(box: Box, zones: list[dict[str, Any]]) -> str | None:
    for zone in zones:
        if zone.get("kind") == "exclude" and point_in_polygon(box.foot, zone.get("points", [])):
            return None
    candidates = [zone for zone in zones if zone.get("kind") != "exclude" and point_in_polygon(box.foot, zone.get("points", []))]
    return candidates[-1]["id"] if candidates else "unmapped"


def frame_quality(frame: np.ndarray) -> tuple[bool, float, float]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    median = float(np.median(gray))
    contrast = float(np.percentile(gray, 95) - np.percentile(gray, 5))
    return median >= 24 and contrast >= 22, median, contrast


class Pipeline:
    def __init__(self) -> None:
        self.stop = threading.Event()
        self.detector: Any = None
        self.detector_error: str | None = None
        self.detail_model: Any = None
        self.detail_error: str | None = None
        self.last_frame: np.ndarray | None = None
        self.last_frame_lock = threading.Lock()
        self.last_processed_at: str | None = STORE.state("last_processed_at")
        self.backlog_seconds = 0.0
        self.active: dict[str, Any] | None = None
        self.catalog: list[dict[str, Any]] = []
        self.vehicle_proximity_since: float | None = None

    def load_detector(self) -> Any:
        if self.detector is None:
            from ultralytics import YOLO
            LOG.info("loading detector %s", DETECTOR_MODEL)
            self.detector = YOLO(DETECTOR_MODEL)
        return self.detector

    @staticmethod
    def playlist() -> list[dict[str, Any]]:
        response = requests.get(SOURCE_URL, timeout=12)
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

    def observe(self, frame: np.ndarray, timestamp: float, detections: list[dict[str, Any]]) -> None:
        settings = STORE.get_setting("analysis") or {}
        zones = settings.get("zones", DEFAULT_ZONES)
        resolved: list[dict[str, Any]] = []
        birds = 0
        vehicles: list[tuple[dict[str, Any], Box]] = []
        people: list[tuple[dict[str, Any], Box]] = []
        animals: list[tuple[dict[str, Any], Box]] = []
        for detection in detections:
            box = Box(*detection["box"])
            if detection["class"] == "bird":
                birds += 1
                continue
            zone = zone_for(box, zones)
            if zone is None:
                continue
            detection = {**detection, "zone": zone}
            resolved.append(detection)
            if detection["class"] in {"car", "truck", "bus", "motorcycle"}:
                vehicles.append((detection, box))
            elif detection["class"] == "person":
                people.append((detection, box))
            elif detection["class"] not in {"bicycle"}:
                animals.append((detection, box))

        meaningful = [item for item in resolved if item["class"] not in {"car", "truck", "bus", "motorcycle"}]
        vehicle_near = any(vehicle_proximity(person_box, vehicle_box) for _, person_box in people for _, vehicle_box in vehicles)
        near_animal = any(
            hypot(cat_box.centre[0] - dog_box.centre[0], cat_box.centre[1] - dog_box.centre[1]) < 0.16
            for cat, cat_box in animals if cat["class"] == "cat"
            for dog, dog_box in animals if dog["class"] == "dog"
        )
        if vehicle_near:
            self.vehicle_proximity_since = self.vehicle_proximity_since or timestamp
        else:
            self.vehicle_proximity_since = None
        confirmed_vehicle_near = self.vehicle_proximity_since is not None and timestamp - self.vehicle_proximity_since >= 2.0
        if not meaningful and not confirmed_vehicle_near:
            return

        labels = {item["class"] for item in resolved}
        if confirmed_vehicle_near:
            labels.add("vehicle_proximity")
        if near_animal:
            labels.add("animal_close_proximity")
        zone_ids = {item["zone"] for item in resolved}

        if self.active is None:
            event_id = uuid.uuid4().hex
            event_dir = EVENT_ROOT / event_id
            event_dir.mkdir(parents=True, exist_ok=True)
            thumbnail = event_dir / "thumbnail.jpg"
            cv2.imwrite(str(thumbnail), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            self.active = {
                "id": event_id, "start": timestamp, "last": timestamp,
                "startedAt": iso_time(timestamp), "zones": sorted(zone_ids), "labels": sorted(labels),
                "subjects": [], "evidence": [], "thumbnail": str(thumbnail), "lastEvidence": 0.0,
                "roadObservations": [],
            }
            self._refresh_active(resolved, frame, timestamp)
            STORE.create(self.active)
            LOG.info("event %s started: %s", event_id, sorted(labels))
        else:
            self.active["last"] = timestamp
            self.active["zones"] = sorted(set(self.active["zones"]) | zone_ids)
            self.active["labels"] = sorted(set(self.active["labels"]) | labels)
            self._refresh_active(resolved, frame, timestamp)
            STORE.update_collection(self.active)

    def _refresh_active(self, detections: list[dict[str, Any]], frame: np.ndarray, timestamp: float) -> None:
        assert self.active is not None
        subjects: dict[str, dict[str, Any]] = {item["class"]: item for item in self.active["subjects"]}
        for detection in detections:
            current = subjects.get(detection["class"])
            if current is None or detection["confidence"] > current["confidence"]:
                subjects[detection["class"]] = {
                    "class": detection["class"], "confidence": detection["confidence"],
                    "zone": detection["zone"], "box": detection["box"],
                }
            if detection["class"] == "person" and detection["zone"] == "road":
                box = Box(*detection["box"])
                self.active["roadObservations"].append((timestamp, box.foot[0], box.foot[1]))
        self.active["subjects"] = sorted(subjects.values(), key=lambda item: item["class"])
        if timestamp - self.active["lastEvidence"] >= 4.0 and len(self.active["evidence"]) < 12:
            path = self.evidence_frame(self.active["id"], frame, timestamp)
            self.active["evidence"].append({"at": iso_time(timestamp), "frame": path})
            self.active["lastEvidence"] = timestamp
        zones = self.active["zones"]
        labels = self.active["labels"]
        self.active["priority"] = priority_for(labels, zones)
        noun = ", ".join(item["class"] for item in self.active["subjects"][:3]) or "activity"
        self.active["title"] = f"{noun.title()} detected"
        self.active["summary"] = f"Fast pass detected {noun} in {', '.join(zones)}. Detailed analysis pending."

    def event_clip(self, event: dict[str, Any]) -> str | None:
        start, end = event["start"] - 10, event["last"] + 20
        selected = [segment for segment in self.catalog if segment["at"] + segment["duration"] >= start and segment["at"] <= end]
        if not selected:
            return None
        event_dir = EVENT_ROOT / event["id"]
        output = event_dir / "event.mp4"
        playlist = event_dir / "event.m3u8"
        lines = ["#EXTM3U", "#EXT-X-VERSION:3", f"#EXT-X-TARGETDURATION:{max(2, int(max(item['duration'] for item in selected) + 1))}", "#EXT-X-MEDIA-SEQUENCE:0"]
        for segment in selected:
            lines.extend([f"#EXTINF:{segment['duration']:.3f},", segment["url"]])
        lines.append("#EXT-X-ENDLIST")
        playlist.write_text("\n".join(lines) + "\n", encoding="utf-8")
        command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file,http,https,tcp,tls,crypto", "-i", str(playlist), "-c", "copy", "-movflags", "+faststart", str(output)]
        try:
            subprocess.run(command, check=True, timeout=180)
            playlist.unlink(missing_ok=True)
            return str(output)
        except (subprocess.SubprocessError, OSError) as error:
            LOG.warning("clip creation failed for %s: %s", event["id"], error)
            return None

    def finalize_if_ready(self, newest_time: float) -> None:
        if self.active is None or newest_time < self.active["last"] + 20:
            return
        event = self.active
        self.active = None
        observations = event.get("roadObservations", [])
        if observations:
            event["labels"] = sorted(set(event["labels"]) | {
                "prompt_road_crossing" if prompt_road_crossing(observations) else "unusual_road_behavior"
            })
            event["priority"] = priority_for(event["labels"], event["zones"])
            event["summary"] = (
                "A person crossed the road promptly. Detailed analysis pending."
                if "prompt_road_crossing" in event["labels"]
                else "A person remained in or moved unusually through the road. Detailed analysis pending."
            )
            STORE.update_collection(event)
        clip = self.event_clip(event)
        STORE.finalize(event["id"], iso_time(event["last"]), clip)
        LOG.info("event %s queued; clip=%s", event["id"], bool(clip))

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
                    STORE.set_state("last_processed_at", self.last_processed_at)
                    self.finalize_if_ready(segment["at"] + segment["duration"])
                if self.catalog:
                    newest = self.catalog[-1]["at"] + self.catalog[-1]["duration"]
                    self.backlog_seconds = max(0.0, newest - (parse_time(self.last_processed_at) if self.last_processed_at else newest))
                    self.finalize_if_ready(newest)
                self.detector_error = None
            except Exception as error:  # keep the recorder-independent service alive
                self.detector_error = str(error)
                LOG.exception("fast-pass iteration failed")
            self.stop.wait(POLL_SECONDS)

    def load_detail_model(self) -> Any:
        if self.detail_model is not None:
            return self.detail_model
        import torch
        from transformers import AutoModelForCausalLM, BitsAndBytesConfig
        device = "cuda" if torch.cuda.is_available() and torch.cuda.mem_get_info()[0] >= 2800 * 1024**2 else "cpu"
        if device == "cuda":
            torch.cuda.set_per_process_memory_fraction(0.30)
        LOG.info("loading Moondream detail model on %s", device)
        quantization = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
        ) if device == "cuda" else None
        self.detail_model = AutoModelForCausalLM.from_pretrained(
            MOONDREAM_MODEL,
            revision=os.environ.get("NOVA_CAMERA_EVENTS_MOONDREAM_REVISION", "2025-06-21"),
            trust_remote_code=True,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
            device_map="auto" if device == "cuda" else {"": "cpu"},
            quantization_config=quantization,
            low_cpu_mem_usage=True,
        )
        return self.detail_model

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

    def detail_event(self, row: sqlite3.Row) -> None:
        from PIL import Image
        frames = json.loads(row["evidence_json"])
        answers: list[str] = []
        model = self.load_detail_model()
        prompt = (
            "Describe only observable activity in this daytime security-camera frame. "
            "Mention people, cats, dogs, other non-bird animals, packages, road behavior, and interaction with a black ute. "
            "Do not infer identity or intent. Use 'unclear' when uncertain."
        )
        frame_paths: list[Path] = []
        for evidence in frames[:8]:
            path = Path(evidence["frame"])
            if path.exists():
                frame_paths.append(path)
                result = model.query(Image.open(path).convert("RGB"), prompt)
                answers.append(str(result.get("answer", result) if isinstance(result, dict) else result))
        text = " ".join(answers).strip()
        lower = text.lower()
        labels = json.loads(row["labels_json"])
        if any(word in lower for word in ("package", "parcel", "delivery", "placing an item", "leaves an item")):
            labels.append("possible_delivery")
        for phrase, label in (
            ("walking", "walking"), ("running", "running"), ("waiting", "waiting"),
            ("standing", "standing"), ("carrying", "carrying"), ("placing", "placing_item"),
            ("crouch", "crouching"), ("fallen", "person_fallen"), ("lying in the road", "person_fallen"),
            ("walking a dog", "dog_walking"), ("chasing", "chasing"), ("being chased", "being_chased"),
        ):
            if phrase in lower:
                labels.append(label)
        if "person" in labels and any(zone in json.loads(row["zones_json"]) for zone in ("front_path", "gate_entry", "rear_laneway")):
            labels.append("possible_visitor")
        if "vehicle_proximity" in labels and any(word in lower for word in ("touch", "door", "interact", "reaching", "beside the vehicle")):
            labels.append("possible_vehicle_interaction")
        if "person" in labels and "road" in json.loads(row["zones_json"]) and any(word in lower for word in ("standing", "waiting", "fallen", "lying", "stopped")):
            labels.append("unusual_road_behavior")
        if "dog" in labels and "cat" in labels and any(word in lower for word in ("chasing", "attack", "fight", "lunging")):
            labels.append("possible_animal_attack")
        subjects = json.loads(row["subjects_json"])
        if "cat" in labels:
            identity = self.reference_identity("cat", frame_paths)
            if identity:
                name, confidence = identity
                labels.append("household_cat_candidate")
                for subject in subjects:
                    if subject.get("class") == "cat":
                        subject.update({"identity": name, "identityConfidence": confidence, "identityTentative": True})
                text = f"Possible household cat {name} ({confidence:.0%} visual match). {text}"
        if "vehicle_proximity" in labels:
            ute_match = self.reference_identity("ute", frame_paths)
            if ute_match:
                labels.append("black_ute_candidate")
        labels = sorted(set(labels))
        priority = priority_for(labels, json.loads(row["zones_json"]))
        summary = text[:1200] if text else row["summary"]
        title = next((label.replace("_", " ").title() for label in ("possible_animal_attack", "possible_vehicle_interaction", "possible_delivery", "unusual_road_behavior") if label in labels), row["title"])
        with STORE.lock:
            STORE.connection.execute(
                """UPDATE events SET status='analysed',updated_at=?,priority=?,title=?,summary=?,labels_json=?,subjects_json=?,
                   detail_model=?,detail_error=NULL WHERE id=?""",
                (utc_now(), priority, title, summary, json.dumps(labels), json.dumps(subjects), MOONDREAM_MODEL, row["id"]),
            )
            STORE.connection.commit()
        if priority in {"important", "urgent"}:
            self.notify(row["id"], title, summary)

    def notify(self, event_id: str, title: str, summary: str) -> None:
        settings = STORE.get_setting("analysis") or {}
        if not settings.get("alertsEnabled", False):
            return
        base = os.environ.get("HA_URL", "http://127.0.0.1:8123").rstrip("/")
        token = os.environ.get("HA_TOKEN")
        if not token:
            return
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        link = f"/dashboard/outside?cameraEvent={event_id}"
        try:
            response = requests.post(f"{base}/api/services/notify/notify", headers=headers, json={"title": title, "message": summary, "data": {"url": link}}, timeout=8)
            response.raise_for_status()
            state = "sent"
        except requests.RequestException:
            try:
                response = requests.post(f"{base}/api/services/persistent_notification/create", headers=headers, json={"title": title, "message": f"{summary}\n\n{link}", "notification_id": f"nova_camera_{event_id}"}, timeout=8)
                response.raise_for_status()
                state = "persistent"
            except requests.RequestException as error:
                LOG.warning("HA alert failed: %s", error)
                state = "failed"
        with STORE.lock:
            STORE.connection.execute("UPDATE events SET alert_state=? WHERE id=?", (state, event_id))
            STORE.connection.commit()

    def detail_loop(self) -> None:
        while not self.stop.is_set():
            if not DETAIL_ENABLED:
                self.stop.wait(30)
                continue
            with STORE.lock:
                row = STORE.connection.execute("SELECT * FROM events WHERE status='queued' ORDER BY started_at LIMIT 1").fetchone()
                if row:
                    STORE.connection.execute("UPDATE events SET status='analysing',updated_at=? WHERE id=?", (utc_now(), row["id"]))
                    STORE.connection.commit()
            if not row:
                self.stop.wait(10)
                continue
            try:
                self.detail_event(row)
                self.detail_error = None
            except Exception as error:
                self.detail_error = str(error)
                LOG.exception("detail analysis failed for %s", row["id"])
                with STORE.lock:
                    STORE.connection.execute("UPDATE events SET status='analysis_failed',detail_error=?,updated_at=? WHERE id=?", (str(error)[:1000], utc_now(), row["id"]))
                    STORE.connection.commit()

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


PIPELINE = Pipeline()
THREADS: list[threading.Thread] = []


@asynccontextmanager
async def lifespan(_: FastAPI):
    for target, name in ((PIPELINE.run, "fast-pass"), (PIPELINE.detail_loop, "detail-pass"), (PIPELINE.retention, "retention")):
        thread = threading.Thread(target=target, name=name, daemon=True)
        thread.start()
        THREADS.append(thread)
    yield
    PIPELINE.stop.set()
    for thread in THREADS:
        thread.join(timeout=5)


app = FastAPI(title="Nova Camera Events", lifespan=lifespan)


@app.get("/healthz")
def health() -> dict[str, Any]:
    with STORE.lock:
        queued = STORE.connection.execute("SELECT count(*) FROM events WHERE status IN ('queued','analysing')").fetchone()[0]
    usage = shutil.disk_usage(DATA_ROOT)
    return {
        "ok": PIPELINE.detector_error is None,
        "cameraId": CAMERA_ID,
        "source": SOURCE_URL,
        "detectorModel": DETECTOR_MODEL,
        "detailModel": MOONDREAM_MODEL,
        "lastProcessedAt": PIPELINE.last_processed_at,
        "backlogSeconds": round(PIPELINE.backlog_seconds, 1),
        "queueDepth": queued,
        "detectorError": PIPELINE.detector_error,
        "detailError": PIPELINE.detail_error,
        "freeBytes": usage.free,
    }


@app.get("/events")
def events(
    limit: int = Query(50, ge=1, le=200), priority: str | None = None, zone: str | None = None,
    subject: str | None = None, reviewed: bool | None = None, starred: bool | None = None,
) -> dict[str, Any]:
    return {"events": STORE.list(limit=limit, priority=priority, zone=zone, subject=subject, reviewed=reviewed, starred=starred)}


@app.get("/events/{event_id}")
def event(event_id: str) -> dict[str, Any]:
    value = STORE.get(event_id)
    if not value:
        raise HTTPException(404, "Event not found")
    return value


@app.put("/events/{event_id}")
def update_event(event_id: str, patch: EventPatch) -> dict[str, Any]:
    value = STORE.patch(event_id, patch)
    if not value:
        raise HTTPException(404, "Event not found")
    return value


@app.delete("/events/{event_id}")
def delete_event(event_id: str) -> dict[str, bool]:
    if not STORE.delete(event_id):
        raise HTTPException(404, "Event not found")
    return {"ok": True}


def asset(event_id: str, column: str, media_type: str) -> FileResponse:
    row = STORE.raw(event_id)
    if not row or not row[column]:
        raise HTTPException(404, "Event media not found")
    path = Path(row[column]).resolve()
    if EVENT_ROOT.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "Event media not found")
    return FileResponse(path, media_type=media_type)


@app.get("/events/{event_id}/thumbnail")
def thumbnail(event_id: str) -> FileResponse:
    return asset(event_id, "thumbnail", "image/jpeg")


@app.get("/events/{event_id}/clip")
def clip(event_id: str) -> FileResponse:
    return asset(event_id, "clip", "video/mp4")


@app.get("/settings")
def settings() -> dict[str, Any]:
    return STORE.get_setting("analysis")


@app.put("/settings")
def update_settings(body: SettingsBody) -> dict[str, Any]:
    for zone in body.zones:
        points = zone.get("points", [])
        if not zone.get("id") or len(points) < 3 or any(len(point) != 2 or not all(0 <= float(value) <= 1 for value in point) for point in points):
            raise HTTPException(400, "Each zone needs an id and at least three normalized points")
    value = body.model_dump()
    STORE.set_setting("analysis", value)
    return value


@app.get("/frame")
def current_frame() -> Response:
    with PIPELINE.last_frame_lock:
        frame = PIPELINE.last_frame.copy() if PIPELINE.last_frame is not None else None
    if frame is None:
        raise HTTPException(503, "No processed camera frame is available yet")
    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise HTTPException(500, "Could not encode camera frame")
    return Response(bytes(encoded), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/references")
def references(kind: str | None = None) -> dict[str, Any]:
    with STORE.lock:
        rows = STORE.connection.execute(
            "SELECT id,kind,name,created_at FROM subject_references" + (" WHERE kind=?" if kind else "") + " ORDER BY name,created_at",
            (kind,) if kind else (),
        ).fetchall()
    return {"references": [dict(row) for row in rows]}


@app.post("/references")
async def add_reference(kind: str, name: str, image: UploadFile = File(...)) -> dict[str, Any]:
    if kind not in {"cat", "ute"} or not name.strip():
        raise HTTPException(400, "Reference kind must be cat or ute and name is required")
    data = await image.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Reference image is too large")
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise HTTPException(400, "Reference is not a supported image")
    reference_id = uuid.uuid4().hex
    directory = REFERENCE_ROOT / kind
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{reference_id}.jpg"
    cv2.imwrite(str(path), decoded, [cv2.IMWRITE_JPEG_QUALITY, 92])
    with STORE.lock:
        STORE.connection.execute("INSERT INTO subject_references(id,kind,name,path,created_at) VALUES(?,?,?,?,?)", (reference_id, kind, name.strip(), str(path), utc_now()))
        STORE.connection.commit()
    return {"id": reference_id, "kind": kind, "name": name.strip()}


@app.delete("/references/{reference_id}")
def delete_reference(reference_id: str) -> dict[str, bool]:
    with STORE.lock:
        row = STORE.connection.execute("SELECT path FROM subject_references WHERE id=?", (reference_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Reference not found")
        STORE.connection.execute("DELETE FROM subject_references WHERE id=?", (reference_id,))
        STORE.connection.commit()
    Path(row["path"]).unlink(missing_ok=True)
    return {"ok": True}
