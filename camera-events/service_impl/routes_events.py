"""Event list/detail/patch/delete/asset routes.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException, Query
from fastapi.responses import FileResponse

from .app import app
from .constants import EVENT_ROOT
from .schema import BulkDeleteBody, EventPatch
from .store import STORE


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
