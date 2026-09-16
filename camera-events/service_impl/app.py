"""The FastAPI app instance and the health-check route.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import shutil
from typing import Any

from fastapi import FastAPI

from .constants import CAMERA_ID, DATA_ROOT, DETECTOR_MODEL, MOONDREAM_MODEL, POLICY, POLICY_CONFIGURED, SOURCE_URL
from .pipeline import PIPELINE, lifespan
from .store import STORE


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
