"""Store CRUD/query methods, mixed into Store (see store.py).

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path
from typing import Any

from .constants import CAMERA_ID, DETECTOR_MODEL, EVENT_ROOT, POLICY
from .helpers import utc_now
from .schema import EventPatch


class StoreCrudMixin:
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
