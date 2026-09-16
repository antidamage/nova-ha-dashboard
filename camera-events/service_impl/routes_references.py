"""Subject-reference (cat / vehicle / person) list/add/image/delete routes.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from core import normalized_crop_bounds
from .app import app
from .constants import REFERENCE_ROOT
from .helpers import utc_now
from .store import STORE


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
