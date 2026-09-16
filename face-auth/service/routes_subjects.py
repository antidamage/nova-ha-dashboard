"""`/subjects` and `/subjects/{subject_id}` — enumerate and delete. Admin actions."""

from __future__ import annotations

from typing import Any

from fastapi import Request

from .app import app
from .config import ENROL_MIN_CLIPS
from .errors import Refusal
from .gates import require_dashboard_proxy, require_subject_id
from .store import store


@app.get("/subjects")
def subjects(request: Request) -> list[dict[str, Any]]:
    # Listing subjects enumerates the household; deleting one deletes a
    # credential. Both are admin actions.
    require_dashboard_proxy(request)
    with store().lock:
        rows = store().connection.execute("SELECT * FROM subjects ORDER BY created_at").fetchall()
    result = []
    for row in rows:
        clips = len(store().embeddings(row["id"]))
        result.append({
            "id": row["id"], "name": row["name"], "clips": clips,
            "ready": clips >= ENROL_MIN_CLIPS and bool(row["enabled"]),
            "createdAt": row["created_at"],
        })
    return result


@app.delete("/subjects/{subject_id}")
def delete_subject(request: Request, subject_id: str) -> dict[str, Any]:
    require_dashboard_proxy(request)
    require_subject_id(subject_id)
    if not store().delete_subject(subject_id):
        raise Refusal(404, "not_found")
    return {"deleted": subject_id}
