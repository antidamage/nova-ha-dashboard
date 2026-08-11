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

from core import Box, evaluate_policy, event_window_closed, normalized_crop_bounds, point_distance, point_in_polygon, priority_for, prompt_road_crossing, subject_gap_seconds, vehicle_proximity


logging.basicConfig(level=os.environ.get("NOVA_CAMERA_EVENTS_LOG_LEVEL", "INFO"))
LOG = logging.getLogger("nova-camera-events")

DATA_ROOT = Path(os.environ.get("NOVA_CAMERA_EVENTS_DATA", "/data"))
EVENT_ROOT = DATA_ROOT / "events"
REFERENCE_ROOT = DATA_ROOT / "references"
DAYLIGHT_FRAME_PATH = DATA_ROOT / "calibration-daylight.jpg"
DB_PATH = DATA_ROOT / "events.sqlite3"
POLICY_PATH = Path(os.environ.get("NOVA_CAMERA_EVENTS_POLICY", str(DATA_ROOT / "policy.json")))
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

# Event windows are measured in analysed media time, never against the live edge.
# The fast pass is deliberately allowed to lag realtime, so a subject can still be
# walking through segments this process has not looked at yet.
EVENT_GAP_SECONDS = float(os.environ.get("NOVA_CAMERA_EVENTS_GAP_SECONDS", "20"))
# People drop out of the detector for long stretches when they pass behind the
# tree, the hedge or a parked vehicle. One traverse should stay one event rather
# than fragmenting into several short clips.
PERSON_GAP_SECONDS = float(os.environ.get("NOVA_CAMERA_EVENTS_PERSON_GAP_SECONDS", "45"))
# Upper bound so a stuck detection cannot grow an unbounded clip.
MAX_EVENT_SECONDS = float(os.environ.get("NOVA_CAMERA_EVENTS_MAX_SECONDS", "600"))
CLIP_PRE_ROLL_SECONDS = float(os.environ.get("NOVA_CAMERA_EVENTS_PRE_ROLL", "10"))
CLIP_POST_ROLL_SECONDS = float(os.environ.get("NOVA_CAMERA_EVENTS_POST_ROLL", "20"))
# If the recorder stops publishing, analysed media time stops advancing too. Close
# the open event on wall clock rather than holding it open forever.
STALL_SECONDS = float(os.environ.get("NOVA_CAMERA_EVENTS_STALL_SECONDS", "120"))

COCO_INTEREST = {0, 1, 2, 3, 5, 7, 15, 16, 17, 18, 19, 20, 21, 22, 23}
BIRD_CLASS = 14
SUBJECT_NAMES = {
    0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck",
    15: "cat", 16: "dog", 17: "horse", 18: "sheep", 19: "cow", 20: "elephant",
    21: "bear", 22: "zebra", 23: "giraffe",
}

FALLBACK_POLICY: dict[str, Any] = {
    "version": 1,
    "candidateSubjects": ["person", "cat", "dog"],
    "zones": {"road": ["road"], "property": [], "laneway": [], "frontage": [], "blackUte": []},
    "thresholds": {"vehicleStopSeconds": 8, "vehicleProximitySeconds": 2, "groupDistance": 0.25, "ownerSimilarity": 0.82, "ownerMinimumFrames": 2},
    # Fail open for review if the local policy is unavailable; never silently
    # discard safety footage because a private runtime file was lost.
    "rules": [{"id": "policy_unavailable", "match": {}, "retain": True, "alert": False, "priority": "important"}],
}


def load_policy() -> tuple[dict[str, Any], bool]:
    try:
        value = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("rules"), list):
            raise ValueError("policy must be an object with a rules array")
        return value, True
    except (OSError, ValueError, json.JSONDecodeError) as error:
        LOG.warning("private camera policy unavailable; retaining candidates for review: %s", error)
        return FALLBACK_POLICY, False


POLICY, POLICY_CONFIGURED = load_policy()

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


class BulkDeleteBody(BaseModel):
    ids: list[str]


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
              detail_error TEXT, detail_attempts INTEGER NOT NULL DEFAULT 0
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
        columns = {row[1] for row in self.connection.execute("PRAGMA table_info(events)")}
        if "detail_attempts" not in columns:
            self.connection.execute("ALTER TABLE events ADD COLUMN detail_attempts INTEGER NOT NULL DEFAULT 0")
        for column, definition in (
            ("retained", "INTEGER NOT NULL DEFAULT 1"),
            ("retained_reason", "TEXT"),
            ("alert_reason", "TEXT"),
            ("behavior_confidence", "REAL"),
            ("owner_present", "INTEGER NOT NULL DEFAULT 0"),
            ("policy_version", "INTEGER"),
        ):
            if column not in columns:
                self.connection.execute(f"ALTER TABLE events ADD COLUMN {column} {definition}")
        reference_columns = {row[1] for row in self.connection.execute("PRAGMA table_info(subject_references)")}
        if "role" not in reference_columns:
            self.connection.execute("ALTER TABLE subject_references ADD COLUMN role TEXT")
        for column, definition in (
            ("source_name", "TEXT"),
            ("crop_json", "TEXT"),
            ("image_width", "INTEGER"),
            ("image_height", "INTEGER"),
        ):
            if column not in reference_columns:
                self.connection.execute(f"ALTER TABLE subject_references ADD COLUMN {column} {definition}")
        # A container restart can interrupt an in-flight offline pass. Return it
        # to the bounded retry path instead of leaving it stuck forever.
        self.connection.execute(
            "UPDATE events SET status='analysis_failed', detail_error='analysis interrupted by restart', updated_at=? WHERE status='analysing'",
            (utc_now(),),
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
            ("detail_attempts", "detailAttempts"),
            ("retained_reason", "retainedReason"), ("alert_reason", "alertReason"),
            ("behavior_confidence", "behaviorConfidence"), ("owner_present", "ownerPresent"),
            ("policy_version", "policyVersion"),
        ):
            value[target] = value.pop(source)
        value["reviewed"] = bool(value["reviewed"])
        value["starred"] = bool(value["starred"])
        value["ownerPresent"] = bool(value["ownerPresent"])
        value.pop("retained", None)
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
                  zones_json,subjects_json,labels_json,evidence_json,detector_model,thumbnail,clip,retained,policy_version
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    event["id"], CAMERA_ID, event["startedAt"], None, utc_now(), utc_now(), "collecting",
                    event["priority"], event["title"], event["summary"], json.dumps(event["zones"]),
                    json.dumps(event["subjects"]), json.dumps(event["labels"]), json.dumps(event["evidence"]),
                    DETECTOR_MODEL, event.get("thumbnail"), None, 0, int(POLICY.get("version", 1)),
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
        clauses, values = ["camera_id=?", "retained=1"], [CAMERA_ID]
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


def zones_for(box: Box, zones: list[dict[str, Any]]) -> list[str]:
    for zone in zones:
        if zone.get("kind") == "exclude" and point_in_polygon(box.foot, zone.get("points", [])):
            return []
    return [zone["id"] for zone in zones if zone.get("kind") != "exclude" and point_in_polygon(box.foot, zone.get("points", []))]


def zone_for(box: Box, zones: list[dict[str, Any]]) -> str | None:
    candidates = zones_for(box, zones)
    return candidates[-1] if candidates else (None if any(
        zone.get("kind") == "exclude" and point_in_polygon(box.foot, zone.get("points", [])) for zone in zones
    ) else "unmapped")


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
        self.analysed_through: float = parse_time(self.last_processed_at) if self.last_processed_at else 0.0
        self.last_progress_wall: float = time.monotonic()
        self.backlog_seconds = 0.0
        self.active: dict[str, Any] | None = None
        self.catalog: list[dict[str, Any]] = []
        self.vehicle_proximity_since: float | None = None
        self.road_vehicle_state: dict[str, Any] | None = None
        self.identity_model: Any = None
        self.identity_processor: Any = None
        self.identity_cache: dict[str, np.ndarray] = {}

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
            memberships = zones_for(box, zones)
            detection = {**detection, "zone": zone, "zones": memberships or ["unmapped"]}
            resolved.append(detection)
            if detection["class"] in {"car", "truck", "bus", "motorcycle"}:
                vehicles.append((detection, box))
            elif detection["class"] == "person":
                people.append((detection, box))
            elif detection["class"] not in {"bicycle"}:
                animals.append((detection, box))

        candidate_subjects = set(POLICY.get("candidateSubjects", ["person", "cat", "dog"]))
        meaningful = [item for item in resolved if item["class"] in candidate_subjects]
        black_ute_zones = set(POLICY.get("zones", {}).get("blackUte", []))
        person_in_black_ute_zone = any(black_ute_zones & set(person.get("zones", [])) for person, _ in people)
        vehicle_near = person_in_black_ute_zone or any(vehicle_proximity(person_box, vehicle_box) for _, person_box in people for _, vehicle_box in vehicles)
        near_animal = any(
            point_distance(cat_box.centre, dog_box.centre) < 0.16
            for cat, cat_box in animals if cat["class"] == "cat"
            for dog, dog_box in animals if dog["class"] == "dog"
        )
        thresholds = POLICY.get("thresholds", {})
        if vehicle_near:
            self.vehicle_proximity_since = self.vehicle_proximity_since or timestamp
        else:
            self.vehicle_proximity_since = None
        confirmed_vehicle_near = self.vehicle_proximity_since is not None and timestamp - self.vehicle_proximity_since >= float(thresholds.get("vehicleProximitySeconds", 2))

        frontage_zones = set(POLICY.get("zones", {}).get("frontage", []))
        frontage_vehicles = [(item, box) for item, box in vehicles if frontage_zones & set(item["zones"])]
        vehicle_stopped = False
        if frontage_vehicles:
            item, box = max(frontage_vehicles, key=lambda pair: pair[0]["confidence"])
            centre = box.centre
            state = self.road_vehicle_state
            if state is None or timestamp - state["last"] > 4:
                state = {"centre": centre, "last": timestamp, "moving": False, "stoppedSince": None}
            else:
                distance = point_distance(centre, state["centre"])
                if distance > 0.012:
                    state["moving"] = True
                    state["stoppedSince"] = None
                elif state["moving"]:
                    state["stoppedSince"] = state["stoppedSince"] or timestamp
                state["centre"] = centre
                state["last"] = timestamp
            self.road_vehicle_state = state
            vehicle_stopped = state["stoppedSince"] is not None and timestamp - state["stoppedSince"] >= float(thresholds.get("vehicleStopSeconds", 8))
        elif self.road_vehicle_state is not None and timestamp - self.road_vehicle_state["last"] > 4:
            self.road_vehicle_state = None

        if not meaningful and not confirmed_vehicle_near and not vehicle_stopped:
            return

        labels = {item["class"] for item in resolved}
        if confirmed_vehicle_near:
            labels.add("vehicle_proximity")
            if person_in_black_ute_zone:
                labels.add("black_ute_candidate")
        if near_animal:
            labels.add("animal_close_proximity")
        if vehicle_stopped:
            labels.add("vehicle_stopped_at_house")
        zone_ids = {zone for item in resolved for zone in item["zones"]}
        road_zones = set(POLICY.get("zones", {}).get("road", []))
        property_zones = set(POLICY.get("zones", {}).get("property", []))
        group_distance = float(thresholds.get("groupDistance", 0.25))
        if any(item["class"] == "cat" and road_zones & set(item["zones"]) for item in resolved):
            labels.add("cat_in_road")
        if any(item["class"] == "dog" and property_zones & set(item["zones"]) for item in resolved):
            labels.add("dog_on_property")
        dog_accompanied = any(
            point_distance(dog_box.centre, person_box.centre) <= group_distance
            for dog, dog_box in animals if dog["class"] == "dog"
            for _, person_box in people
        ) if any(item["class"] == "dog" for item, _ in animals) else False
        if "dog" in labels and not dog_accompanied:
            labels.add("dog_unaccompanied_candidate")
        if "cat" in labels and "person" in labels and any(
            point_distance(cat_box.centre, person_box.centre) <= 0.20
            for cat, cat_box in animals if cat["class"] == "cat"
            for _, person_box in people
        ):
            labels.add("person_cat_proximity")

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
            if detection["class"] == "person" and "road" in detection.get("zones", [detection["zone"]]):
                box = Box(*detection["box"])
                self.active["roadObservations"].append((timestamp, box.foot[0], box.foot[1]))
        self.active["subjects"] = sorted(subjects.values(), key=lambda item: item["class"])
        if timestamp - self.active["lastEvidence"] >= 4.0 and len(self.active["evidence"]) < 12:
            path = self.evidence_frame(self.active["id"], frame, timestamp)
            self.active["evidence"].append({
                "at": iso_time(timestamp), "frame": path,
                "subjects": [{"class": item["class"], "box": item["box"], "confidence": item["confidence"], "zones": item.get("zones", [item["zone"]])} for item in detections],
            })
            self.active["lastEvidence"] = timestamp
        zones = self.active["zones"]
        labels = self.active["labels"]
        self.active["priority"] = priority_for(labels, zones)
        noun = ", ".join(item["class"] for item in self.active["subjects"][:3]) or "activity"
        self.active["title"] = f"{noun.title()} detected"
        self.active["summary"] = f"Fast pass detected {noun} in {', '.join(zones)}. Detailed analysis pending."

    def event_clip(self, event: dict[str, Any]) -> str | None:
        start, end = event["start"] - CLIP_PRE_ROLL_SECONDS, event["last"] + CLIP_POST_ROLL_SECONDS
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

    def finalize_if_ready(self, analysed_through: float, stalled: bool = False) -> None:
        """Close the open event once analysed media time shows the subject has gone.

        `analysed_through` is how far the fast pass has actually looked, not how far
        the recorder has published; see `event_window_closed`.
        """
        if self.active is None:
            return
        gap = subject_gap_seconds(
            {item["class"] for item in self.active.get("subjects", [])} | set(self.active.get("labels", [])),
            default_gap=EVENT_GAP_SECONDS,
            person_gap=PERSON_GAP_SECONDS,
        )
        closed = event_window_closed(
            self.active["start"], self.active["last"], analysed_through,
            gap=gap, max_duration=MAX_EVENT_SECONDS,
        )
        if not stalled and not closed:
            return
        event = self.active
        self.active = None
        observations = event.get("roadObservations", [])
        if observations:
            event["labels"] = sorted(set(event["labels"]) | {
                "prompt_road_crossing" if prompt_road_crossing(observations) else "road_behavior_candidate"
            })
            event["priority"] = priority_for(event["labels"], event["zones"])
            event["summary"] = (
                "A person crossed the road promptly. Detailed analysis pending."
                if "prompt_road_crossing" in event["labels"]
                else "Roadside pedestrian behavior requires detailed analysis."
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

    def load_detail_model(self) -> Any:
        if self.detail_model is not None:
            return self.detail_model
        import torch
        from transformers import AutoModelForCausalLM
        # Iridium's GPU is deliberately reserved for the always-on voice stack
        # and the tiny fast detector. The detailed pass is asynchronous, so run
        # Moondream in host RAM rather than risking a voice-model CUDA OOM.
        device = os.environ.get("NOVA_CAMERA_EVENTS_DETAIL_DEVICE", "cpu")
        LOG.info("loading Moondream detail model on %s", device)
        self.detail_model = AutoModelForCausalLM.from_pretrained(
            MOONDREAM_MODEL,
            revision=os.environ.get("NOVA_CAMERA_EVENTS_MOONDREAM_REVISION", "2025-06-21"),
            trust_remote_code=True,
            torch_dtype=torch.bfloat16,
            device_map={"": device},
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

    def detail_event(self, row: sqlite3.Row) -> None:
        from PIL import Image
        frames = json.loads(row["evidence_json"])
        answers: list[str] = []
        model = self.load_detail_model()
        prompt = (
            "Describe only observable activity in this daytime security-camera frame. "
            "Mention people, cats, dogs, other non-bird animals, packages, road behavior, whether a dog and person move together, "
            "and any observable touching, reaching, chasing, following, waiting, damage, dumping, fighting, or interaction with a cat or black ute. "
            "Do not infer identity or intent. Distinguish an observed action from an unclear possibility. Use 'unclear' when uncertain."
        )
        frame_paths: list[Path] = []
        selected_frames = frames if len(frames) <= 2 else [frames[0], frames[-1]]
        for evidence in selected_frames:
            path = Path(evidence["frame"])
            if path.exists():
                frame_paths.append(path)
                result = model.query(
                    Image.open(path).convert("RGB"),
                    prompt,
                    settings={"max_tokens": 96, "temperature": 0.1, "variant": None},
                )
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
        if "person" in labels and any(word in lower for word in ("waiting", "standing still", "stopped", "pausing", "lingering")):
            labels.append("person_pausing_outside")
        if "person" in labels and any(word in lower for word in ("damage", "vandal", "dumping", "throwing rubbish", "harass", "threaten", "fighting", "prowling", "trying a door")):
            labels.append("possible_antisocial_behavior")
        if "person_cat_proximity" in labels and any(word in lower for word in ("touch", "reach", "pick up", "grab", "chase", "follow", "interact", "approach the cat")):
            labels.append("possible_person_cat_interaction")
        if "dog" in labels and "cat" in labels and any(word in lower for word in ("chasing", "attack", "fight", "lunging")):
            labels.append("possible_animal_attack")

        if "dog" in labels:
            group_distance = float(POLICY.get("thresholds", {}).get("groupDistance", 0.25))
            dog_frames = 0
            grouped_frames = 0
            for evidence in frames:
                frame_subjects = evidence.get("subjects", [])
                dogs = [Box(*item["box"]) for item in frame_subjects if item.get("class") == "dog"]
                people = [Box(*item["box"]) for item in frame_subjects if item.get("class") == "person"]
                if dogs:
                    dog_frames += 1
                if any(point_distance(dog.centre, person.centre) <= group_distance for dog in dogs for person in people):
                    grouped_frames += 1
            text_supports_group = any(phrase in lower for phrase in ("walking a dog", "on a leash", "moving together", "accompanied by"))
            if grouped_frames >= 2 and grouped_frames >= max(1, dog_frames // 2) and text_supports_group:
                labels.append("dog_accompanied")
            else:
                labels.append("dog_unaccompanied")
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
        vehicle_match = self.vehicle_identity(frames) if any(
            subject.get("class") in {"car", "truck", "bus", "motorcycle"} for subject in subjects
        ) else None
        if vehicle_match is None and "vehicle_proximity" in labels:
            legacy_match = self.reference_identity("ute", frame_paths)
            if legacy_match:
                vehicle_match = (legacy_match[0], legacy_match[1], True)
        if vehicle_match:
            vehicle_name, vehicle_confidence, legacy_ute = vehicle_match
            labels.append("known_vehicle_candidate")
            if legacy_ute:
                labels.append("black_ute_candidate")
            for subject in subjects:
                if subject.get("class") in {"car", "truck", "bus", "motorcycle"}:
                    subject.update({"identity": vehicle_name, "identityConfidence": vehicle_confidence, "identityTentative": True})
            text = f"Possible known vehicle {vehicle_name} ({vehicle_confidence:.0%} visual match). {text}"

        owner_match = self.owner_identity(frames) if "person" in labels else None
        owner_present = owner_match is not None
        if owner_match:
            owner_name, owner_confidence = owner_match
            labels.append("owner_present")
            for subject in subjects:
                if subject.get("class") == "person":
                    subject.update({"identity": owner_name, "identityConfidence": owner_confidence, "identityTentative": False})
        labels = sorted(set(labels))
        zones = json.loads(row["zones_json"])
        decision = evaluate_policy(POLICY, labels, zones, owner_present=owner_present)
        if not decision["retain"]:
            LOG.info("event %s discarded by private policy: labels=%s zones=%s", row["id"], labels, zones)
            STORE.delete(row["id"])
            return
        priority = decision["priority"]
        summary = text[:1200] if text else row["summary"]
        title = next((label.replace("_", " ").title() for label in (
            "possible_animal_attack", "cat_in_road", "dog_on_property", "dog_unaccompanied",
            "possible_person_cat_interaction", "possible_vehicle_interaction", "vehicle_stopped_at_house",
            "possible_antisocial_behavior", "person_pausing_outside", "unusual_road_behavior",
        ) if label in labels), row["title"])
        behavior_confidence = 0.8 if any(label.startswith("possible_") or label in {"person_pausing_outside", "unusual_road_behavior"} for label in labels) else None
        with STORE.lock:
            STORE.connection.execute(
                """UPDATE events SET status='analysed',updated_at=?,priority=?,title=?,summary=?,labels_json=?,subjects_json=?,
                   detail_model=?,detail_error=NULL,retained=1,retained_reason=?,alert_reason=?,behavior_confidence=?,
                   owner_present=?,policy_version=? WHERE id=?""",
                (
                    utc_now(), priority, title, summary, json.dumps(labels), json.dumps(subjects), MOONDREAM_MODEL,
                    ",".join(decision["reasons"]), ",".join(decision["alertReasons"]) or None,
                    behavior_confidence, int(owner_present), int(POLICY.get("version", 1)), row["id"],
                ),
            )
            STORE.connection.commit()
        if decision["alert"]:
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
                retry_before = iso_time(time.time() - 60)
                row = STORE.connection.execute(
                    """SELECT * FROM events
                       WHERE status='queued'
                          OR (status='analysis_failed' AND detail_attempts<3 AND updated_at<=?)
                       ORDER BY started_at LIMIT 1""",
                    (retry_before,),
                ).fetchone()
                if row:
                    STORE.connection.execute(
                        "UPDATE events SET status='analysing',detail_attempts=detail_attempts+1,updated_at=? WHERE id=?",
                        (utc_now(), row["id"]),
                    )
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
                exhausted = int(row["detail_attempts"]) >= 2
                labels = json.loads(row["labels_json"])
                zones = json.loads(row["zones_json"])
                fallback_decision = evaluate_policy(POLICY, labels, zones) if exhausted else None
                with STORE.lock:
                    STORE.connection.execute(
                        """UPDATE events SET status='analysis_failed',detail_error=?,updated_at=?,retained=?,
                           retained_reason=?,priority=?,policy_version=? WHERE id=?""",
                        (
                            str(error)[:1000], utc_now(), int(exhausted),
                            "detail_analysis_failed_fail_open" if exhausted else None,
                            fallback_decision["priority"] if fallback_decision and fallback_decision["retain"] else "important",
                            int(POLICY.get("version", 1)), row["id"],
                        ),
                    )
                    STORE.connection.commit()
                if exhausted and fallback_decision and fallback_decision["alert"]:
                    self.notify(row["id"], "Camera safety event", row["summary"])

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
        "policyConfigured": POLICY_CONFIGURED,
        "policyVersion": POLICY.get("version", 1),
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


@app.delete("/events")
def delete_events(body: BulkDeleteBody) -> dict[str, Any]:
    event_ids = list(dict.fromkeys(body.ids))
    if not event_ids or len(event_ids) > 200:
        raise HTTPException(400, "Select between one and 200 events")
    deleted: list[str] = []
    for event_id in event_ids:
        if STORE.delete(event_id):
            deleted.append(event_id)
    return {"ok": True, "deleted": deleted, "count": len(deleted)}


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
def current_frame(daylight: bool = False) -> Response:
    if daylight:
        path = DAYLIGHT_FRAME_PATH
        if not path.is_file():
            with STORE.lock:
                row = STORE.connection.execute(
                    "SELECT thumbnail FROM events WHERE thumbnail IS NOT NULL ORDER BY started_at DESC LIMIT 1"
                ).fetchone()
            path = Path(row["thumbnail"]) if row and row["thumbnail"] else path
        if path.is_file():
            return Response(path.read_bytes(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
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
    requested_kind = "vehicle" if kind == "ute" else kind
    where = " WHERE kind IN ('vehicle','ute')" if requested_kind == "vehicle" else (" WHERE kind=?" if requested_kind else "")
    with STORE.lock:
        rows = STORE.connection.execute(
            "SELECT id,kind,name,role,created_at,source_name,crop_json,image_width,image_height FROM subject_references" + where + " ORDER BY name,created_at",
            (requested_kind,) if requested_kind and requested_kind != "vehicle" else (),
        ).fetchall()
    values = []
    for row in rows:
        value = dict(row)
        if value["kind"] == "ute":
            value["kind"] = "vehicle"
            value["legacy"] = True
        crop_json = value.pop("crop_json", None)
        value["crop"] = json.loads(crop_json) if crop_json else None
        values.append(value)
    return {"references": values}


@app.post("/references")
async def add_reference(
    kind: str,
    name: str,
    image: UploadFile = File(...),
    role: str | None = None,
    crop: str | None = None,
    source_name: str | None = None,
) -> dict[str, Any]:
    normalized_kind = "vehicle" if kind == "ute" else kind
    normalized_name = name.strip()
    if normalized_kind not in {"cat", "vehicle", "person"} or not normalized_name:
        raise HTTPException(400, "Reference kind must be cat, vehicle, or person and name is required")
    if len(normalized_name) > 80:
        raise HTTPException(400, "Reference name must be 80 characters or fewer")
    normalized_role = "owner" if normalized_kind == "person" and role == "owner" else None
    data = await image.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Reference image is too large")
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise HTTPException(400, "Reference is not a supported image")
    image_height, image_width = decoded.shape[:2]
    normalized_crop = None
    if crop is not None:
        try:
            crop_value = json.loads(crop)
            normalized_crop = {
                "x": float(crop_value["x"]), "y": float(crop_value["y"]),
                "width": float(crop_value["width"]), "height": float(crop_value["height"]),
            }
            if normalized_crop["width"] <= 0 or normalized_crop["height"] <= 0:
                raise ValueError("crop width and height must be positive")
            x1, y1, x2, y2 = normalized_crop_bounds(
                (
                    normalized_crop["x"], normalized_crop["y"],
                    normalized_crop["x"] + normalized_crop["width"],
                    normalized_crop["y"] + normalized_crop["height"],
                ),
                image_width,
                image_height,
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise HTTPException(400, f"Invalid reference crop: {error}") from error
        decoded = decoded[y1:y2, x1:x2]
    elif normalized_kind == "vehicle":
        raise HTTPException(400, "Vehicle references require a designated crop")
    reference_id = uuid.uuid4().hex
    directory = REFERENCE_ROOT / normalized_kind
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{reference_id}.jpg"
    if not cv2.imwrite(str(path), decoded, [cv2.IMWRITE_JPEG_QUALITY, 92]):
        raise HTTPException(500, "Could not store reference image")
    safe_source_name = Path(source_name or image.filename or "photo").name[:255]
    with STORE.lock:
        STORE.connection.execute(
            """INSERT INTO subject_references(
                 id,kind,name,path,created_at,role,source_name,crop_json,image_width,image_height
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                reference_id, normalized_kind, normalized_name, str(path), utc_now(), normalized_role,
                safe_source_name, json.dumps(normalized_crop) if normalized_crop else None, image_width, image_height,
            ),
        )
        STORE.connection.commit()
    return {
        "id": reference_id, "kind": normalized_kind, "name": normalized_name, "role": normalized_role,
        "source_name": safe_source_name, "crop": normalized_crop,
    }


@app.get("/references/{reference_id}/image")
def reference_image(reference_id: str) -> FileResponse:
    with STORE.lock:
        row = STORE.connection.execute("SELECT path FROM subject_references WHERE id=?", (reference_id,)).fetchone()
    if not row or not Path(row["path"]).is_file():
        raise HTTPException(404, "Reference image not found")
    return FileResponse(row["path"], media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


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
