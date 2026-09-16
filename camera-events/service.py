"""Nova daytime camera event service.

The service consumes the existing rolling HLS feed. It deliberately does not
own capture: Nocturnium remains the sole recorder, while this process samples
completed segments, creates compact event clips and runs queued local models.

This module is a thin facade: the implementation lives in `service_impl/`,
split by file-role (see `specs/agent-token-footprint.md`). `uvicorn
service:app` and the Dockerfile's `COPY` both name this file, so it keeps its
path and re-exports the same public names the single-file version had.
Import order below matches the original file's top-to-bottom definition
order, which matters because importing `.app` and the `routes_*` modules
registers FastAPI routes onto `app` as a side effect, in the same sequence
they were originally declared in.
"""

from __future__ import annotations

from service_impl.constants import (
    AUTH_HEADERS,
    BIRD_CLASS,
    CAMERA_ID,
    CLIP_POST_ROLL_SECONDS,
    CLIP_PRE_ROLL_SECONDS,
    CLIP_TAIL_MARGIN_SECONDS,
    COCO_INTEREST,
    DATA_ROOT,
    DAYLIGHT_FRAME_PATH,
    DB_PATH,
    DEFAULT_ZONES,
    DETAIL_ENABLED,
    DETECTOR_DEVICE,
    DETECTOR_MODEL,
    EVENT_GAP_SECONDS,
    EVENT_ROOT,
    FALLBACK_POLICY,
    LOG,
    MAX_EVENT_SECONDS,
    MIN_FREE_BYTES,
    MOONDREAM_MODEL,
    PERSON_GAP_SECONDS,
    POLICY,
    POLICY_CONFIGURED,
    POLICY_PATH,
    POLL_SECONDS,
    REFERENCE_ROOT,
    RETENTION_BYTES,
    RETENTION_DAYS,
    SAMPLE_FPS,
    SOURCE_TOKEN,
    SOURCE_URL,
    STALL_SECONDS,
    SUBJECT_NAMES,
    load_policy,
)
from service_impl.helpers import frame_quality, iso_time, parse_time, utc_now, zone_for, zones_for
from service_impl.schema import BulkDeleteBody, EventPatch, SettingsBody
from service_impl.store import STORE, Store
from service_impl.pipeline import PIPELINE, THREADS, Pipeline, lifespan
from service_impl.app import app, health
from service_impl.routes_events import (
    asset,
    clip,
    delete_event,
    delete_events,
    event,
    events,
    thumbnail,
    update_event,
)
from service_impl.routes_settings import current_frame, settings, update_settings
from service_impl.routes_references import add_reference, delete_reference, reference_image, references

__all__ = [
    "AUTH_HEADERS",
    "BIRD_CLASS",
    "CAMERA_ID",
    "CLIP_POST_ROLL_SECONDS",
    "CLIP_PRE_ROLL_SECONDS",
    "CLIP_TAIL_MARGIN_SECONDS",
    "COCO_INTEREST",
    "DATA_ROOT",
    "DAYLIGHT_FRAME_PATH",
    "DB_PATH",
    "DEFAULT_ZONES",
    "DETAIL_ENABLED",
    "DETECTOR_DEVICE",
    "DETECTOR_MODEL",
    "EVENT_GAP_SECONDS",
    "EVENT_ROOT",
    "FALLBACK_POLICY",
    "LOG",
    "MAX_EVENT_SECONDS",
    "MIN_FREE_BYTES",
    "MOONDREAM_MODEL",
    "PERSON_GAP_SECONDS",
    "POLICY",
    "POLICY_CONFIGURED",
    "POLICY_PATH",
    "POLL_SECONDS",
    "REFERENCE_ROOT",
    "RETENTION_BYTES",
    "RETENTION_DAYS",
    "SAMPLE_FPS",
    "SOURCE_TOKEN",
    "SOURCE_URL",
    "STALL_SECONDS",
    "SUBJECT_NAMES",
    "load_policy",
    "utc_now",
    "parse_time",
    "iso_time",
    "zones_for",
    "zone_for",
    "frame_quality",
    "EventPatch",
    "SettingsBody",
    "BulkDeleteBody",
    "Store",
    "STORE",
    "Pipeline",
    "PIPELINE",
    "THREADS",
    "lifespan",
    "app",
    "health",
    "events",
    "event",
    "update_event",
    "delete_event",
    "delete_events",
    "asset",
    "thumbnail",
    "clip",
    "settings",
    "update_settings",
    "current_frame",
    "references",
    "add_reference",
    "reference_image",
    "delete_reference",
]
