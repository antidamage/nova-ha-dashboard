"""Settings and live-frame routes.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
from fastapi import HTTPException
from fastapi.responses import Response

from .app import app
from .constants import DAYLIGHT_FRAME_PATH
from .pipeline import PIPELINE
from .schema import SettingsBody
from .store import STORE


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
