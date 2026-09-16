"""Configuration constants, environment defaults and the private camera policy.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any


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
# The LAN camera proxy (nocturnium-camera-proxy.py) now requires a bearer
# token on every /camera/** request; this service is a direct LAN consumer of
# it, same as the dashboard's server-side camera-proxy route, and reads the
# same token. See authentik/specs/authentik-sso.md "Camera bypass contract".
SOURCE_TOKEN = os.environ.get("NOVA_CAMERA_TOKEN", "").strip()
AUTH_HEADERS = {"Authorization": f"Bearer {SOURCE_TOKEN}"} if SOURCE_TOKEN else {}
if SOURCE_TOKEN:
    # cv2.VideoCapture's FFmpeg backend has no per-call header argument; this
    # process-wide env var is FFmpeg's own mechanism and is safe here because
    # this service only ever opens captures against SOURCE_URL.
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"headers;Authorization: Bearer {SOURCE_TOKEN}\r\n"
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
# The clip is cut at finalisation, so the gap must clear the post-roll by more
# than one segment or the trailing segments are not published yet and the clip
# loses its tail.
CLIP_TAIL_MARGIN_SECONDS = float(os.environ.get("NOVA_CAMERA_EVENTS_TAIL_MARGIN", "6"))
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


