"""The Pipeline class (composed from mixins) and its lifespan wiring.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI

from .helpers import parse_time
from .pipeline_capture import PipelineCaptureMixin
from .pipeline_detail_analysis import PipelineDetailAnalysisMixin
from .pipeline_detail_loop import PipelineDetailLoopMixin
from .pipeline_events import PipelineEventsMixin
from .pipeline_finalize import PipelineFinalizeMixin
from .pipeline_identity import PipelineIdentityMixin
from .store import STORE


class Pipeline(
    PipelineCaptureMixin,
    PipelineEventsMixin,
    PipelineFinalizeMixin,
    PipelineIdentityMixin,
    PipelineDetailAnalysisMixin,
    PipelineDetailLoopMixin,
):
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
