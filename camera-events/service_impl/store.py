"""Event/settings/state SQLite store.

Split from service.py; see service.py for the module-level overview.
"""

from __future__ import annotations

import sqlite3
import threading

from .constants import DATA_ROOT, DB_PATH, DEFAULT_ZONES, EVENT_ROOT, REFERENCE_ROOT
from .helpers import utc_now
from .store_crud import StoreCrudMixin


class Store(StoreCrudMixin):
    def __init__(self) -> None:
        DATA_ROOT.mkdir(parents=True, exist_ok=True)
        EVENT_ROOT.mkdir(parents=True, exist_ok=True)
        REFERENCE_ROOT.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
              id TEXT PRIMARY KEY, camera_id TEXT NOT NULL, started_at TEXT NOT NULL,
              ended_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              status TEXT NOT NULL, priority TEXT NOT NULL, title TEXT NOT NULL,
              summary TEXT NOT NULL, zones_json TEXT NOT NULL, subjects_json TEXT NOT NULL,
              labels_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
              detector_model TEXT NOT NULL, detail_model TEXT,
              thumbnail TEXT, clip TEXT, reviewed INTEGER NOT NULL DEFAULT 0,
              starred INTEGER NOT NULL DEFAULT 0, corrected_labels_json TEXT,
              corrected_identity TEXT, alert_state TEXT NOT NULL DEFAULT 'none',
              detail_error TEXT, detail_attempts INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS events_started ON events(started_at DESC);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS subject_references (
              id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
              path TEXT NOT NULL, created_at TEXT NOT NULL
            );
            """
        )
        columns = {row[1] for row in self.connection.execute("PRAGMA table_info(events)")}
        if "detail_attempts" not in columns:
            self.connection.execute("ALTER TABLE events ADD COLUMN detail_attempts INTEGER NOT NULL DEFAULT 0")
        for column, definition in (
            ("retained", "INTEGER NOT NULL DEFAULT 1"),
            ("retained_reason", "TEXT"),
            ("alert_reason", "TEXT"),
            ("behavior_confidence", "REAL"),
            ("owner_present", "INTEGER NOT NULL DEFAULT 0"),
            ("policy_version", "INTEGER"),
        ):
            if column not in columns:
                self.connection.execute(f"ALTER TABLE events ADD COLUMN {column} {definition}")
        reference_columns = {row[1] for row in self.connection.execute("PRAGMA table_info(subject_references)")}
        if "role" not in reference_columns:
            self.connection.execute("ALTER TABLE subject_references ADD COLUMN role TEXT")
        for column, definition in (
            ("source_name", "TEXT"),
            ("crop_json", "TEXT"),
            ("image_width", "INTEGER"),
            ("image_height", "INTEGER"),
        ):
            if column not in reference_columns:
                self.connection.execute(f"ALTER TABLE subject_references ADD COLUMN {column} {definition}")
        # A container restart can interrupt an in-flight offline pass. Return it
        # to the bounded retry path instead of leaving it stuck forever.
        self.connection.execute(
            "UPDATE events SET status='analysis_failed', detail_error='analysis interrupted by restart', updated_at=? WHERE status='analysing'",
            (utc_now(),),
        )
        self.connection.commit()
        if self.get_setting("analysis") is None:
            self.set_setting("analysis", {"enabled": True, "alertsEnabled": False, "zones": DEFAULT_ZONES})


STORE = Store()
