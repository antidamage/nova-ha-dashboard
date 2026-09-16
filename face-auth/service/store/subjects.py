"""Subjects and their enrolled embeddings."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import numpy as np

from ..config import ENROL_MIN_CLIPS, THUMBNAIL_ROOT, utc_now


class SubjectsMixin:
    def subject(self, subject_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.connection.execute("SELECT * FROM subjects WHERE id=?", (subject_id,)).fetchone()

    def ensure_subject(self, subject_id: str) -> sqlite3.Row:
        existing = self.subject(subject_id)
        if existing is not None:
            return existing
        with self.lock:
            # The name is whatever the caller enrolled under. It is data in
            # SQLite, never a constant in this repo.
            self.connection.execute(
                "INSERT INTO subjects(id, name, created_at, thumbnail, enabled) VALUES(?,?,?,NULL,1)",
                (subject_id, subject_id, utc_now()),
            )
            self.connection.commit()
        return self.subject(subject_id)  # type: ignore[return-value]

    def embeddings(self, subject_id: str) -> list[np.ndarray]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT vector FROM face_embeddings WHERE subject_id=? ORDER BY created_at", (subject_id,)
            ).fetchall()
        return [np.frombuffer(row["vector"], dtype=np.float32).astype(np.float64) for row in rows]

    def gallery(self, *, exclude: str | None = None, ready_only: bool = True) -> dict[str, list[np.ndarray]]:
        with self.lock:
            rows = self.connection.execute("SELECT id FROM subjects WHERE enabled=1").fetchall()
        result: dict[str, list[np.ndarray]] = {}
        for row in rows:
            if exclude is not None and row["id"] == exclude:
                continue
            vectors = self.embeddings(row["id"])
            if ready_only and len(vectors) < ENROL_MIN_CLIPS:
                continue
            if vectors:
                result[row["id"]] = vectors
        return result

    def add_embedding(self, subject_id: str, vector: np.ndarray, det_score: float, short_side: float, capture: dict[str, Any]) -> None:
        with self.lock:
            self.connection.execute(
                "INSERT INTO face_embeddings(id, subject_id, vector, det_score, box_short_side, capture_json, created_at)"
                " VALUES(?,?,?,?,?,?,?)",
                (
                    uuid.uuid4().hex, subject_id, np.asarray(vector, dtype=np.float32).tobytes(),
                    float(det_score), float(short_side), json.dumps(capture), utc_now(),
                ),
            )
            self.connection.commit()

    def purge_thumbnails(self) -> int:
        """Delete every stored face crop and forget the paths. Runs at startup.

        Thumbnails were written until 2026-09-03. Removing the code that writes
        them would have left the ones already on disk, which is the half of the
        change that actually matters — the point is that no image of anybody is
        retained, not that no new ones appear.
        """

        removed = 0
        with self.lock:
            for row in self.connection.execute(
                "SELECT thumbnail FROM subjects WHERE thumbnail IS NOT NULL"
            ).fetchall():
                if row["thumbnail"]:
                    Path(row["thumbnail"]).unlink(missing_ok=True)
                    removed += 1
            self.connection.execute("UPDATE subjects SET thumbnail=NULL WHERE thumbnail IS NOT NULL")
            self.connection.commit()
        # Anything orphaned in the directory too, then the directory itself.
        if THUMBNAIL_ROOT.is_dir():
            for stray in THUMBNAIL_ROOT.glob("*"):
                if stray.is_file():
                    stray.unlink(missing_ok=True)
                    removed += 1
            if not any(THUMBNAIL_ROOT.iterdir()):
                THUMBNAIL_ROOT.rmdir()
        return removed

    def delete_subject(self, subject_id: str) -> bool:
        with self.lock:
            row = self.connection.execute("SELECT thumbnail FROM subjects WHERE id=?", (subject_id,)).fetchone()
            if row is None:
                return False
            self.connection.execute("DELETE FROM face_embeddings WHERE subject_id=?", (subject_id,))
            self.connection.execute("DELETE FROM credentials WHERE subject_id=?", (subject_id,))
            self.connection.execute("DELETE FROM face_sessions WHERE subject_id=?", (subject_id,))
            # Including any live release wrap: deleting a subject must not
            # leave a sealed key behind that a token could still open.
            self.connection.execute("DELETE FROM credential_releases WHERE subject_id=?", (subject_id,))
            self.connection.execute("DELETE FROM lockouts WHERE scope=?", (f"subject:{subject_id}",))
            self.connection.execute("DELETE FROM subjects WHERE id=?", (subject_id,))
            self.connection.commit()
        if row["thumbnail"]:
            Path(row["thumbnail"]).unlink(missing_ok=True)
        return True
