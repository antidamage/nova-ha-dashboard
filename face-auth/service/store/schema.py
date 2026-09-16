"""The Store's connection, schema, and additive migrations.

Base schema by CREATE TABLE IF NOT EXISTS, then a PRAGMA table_info read and
an ALTER per missing column, so adding a column never costs a data wipe —
the same shape as camera-events' store.
"""

from __future__ import annotations

import sqlite3
import threading

from ..config import DATA_ROOT, DB_PATH


class SchemaMixin:
    def __init__(self) -> None:
        DATA_ROOT.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS subjects (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
              thumbnail TEXT, enabled INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS face_embeddings (
              id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, vector BLOB NOT NULL,
              det_score REAL NOT NULL, box_short_side REAL NOT NULL,
              capture_json TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS face_embeddings_subject ON face_embeddings(subject_id);
            CREATE TABLE IF NOT EXISTS challenges (
              nonce TEXT PRIMARY KEY, issued_at TEXT NOT NULL,
              expires_at TEXT NOT NULL, used_at TEXT
            );
            CREATE TABLE IF NOT EXISTS attempts (
              id TEXT PRIMARY KEY, nonce TEXT, created_at TEXT NOT NULL,
              decision TEXT NOT NULL, reason TEXT, residual REAL, antispoof REAL,
              agreeing_frames INTEGER, usable_frames INTEGER, subject_id TEXT,
              top_score REAL, runner_up REAL, elapsed_ms INTEGER, endpoint TEXT
            );
            CREATE INDEX IF NOT EXISTS attempts_created ON attempts(created_at DESC);
            CREATE TABLE IF NOT EXISTS face_sessions (
              token TEXT PRIMARY KEY, subject_id TEXT NOT NULL, nonce TEXT,
              issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
            );
            CREATE TABLE IF NOT EXISTS credentials (
              id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, rp_id TEXT NOT NULL,
              credential_id BLOB NOT NULL, sealed_key BLOB NOT NULL,
              sign_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS credentials_subject ON credentials(subject_id);
            -- Owned by authenticator/store.py, which migrates it; declared here
            -- too so deleting a subject can clear its release wraps on a host
            -- where the credential half has never been configured.
            CREATE TABLE IF NOT EXISTS credential_releases (
              id TEXT PRIMARY KEY, credential_row TEXT NOT NULL, subject_id TEXT NOT NULL,
              token_sha BLOB NOT NULL UNIQUE, salt BLOB NOT NULL, sealed BLOB NOT NULL,
              issued_at REAL NOT NULL, expires_at REAL NOT NULL, used_at REAL
            );
            CREATE TABLE IF NOT EXISTS lockouts (
              scope TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0,
              window_start REAL NOT NULL DEFAULT 0, armed INTEGER NOT NULL DEFAULT 1,
              disarmed_at TEXT, disarmed_by TEXT, cleared_at TEXT, cleared_by TEXT
            );
            CREATE TABLE IF NOT EXISTS releases (
              id TEXT PRIMARY KEY, subject_id TEXT, released_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS releases_at ON releases(released_at DESC);
            CREATE TABLE IF NOT EXISTS quick_sessions (
              id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, authentik_username TEXT,
              profile TEXT NOT NULL, idle_timeout_seconds INTEGER NOT NULL,
              issued_at REAL NOT NULL, last_seen REAL NOT NULL,
              prior_session_ids TEXT, authentik_session_id TEXT,
              closed_at REAL, closed_reason TEXT
            );
            CREATE INDEX IF NOT EXISTS quick_sessions_open ON quick_sessions(closed_at, last_seen);
            CREATE TABLE IF NOT EXISTS vetoes (
              veto_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL,
              authentik_session_id TEXT, authentik_username TEXT,
              issued_at REAL NOT NULL, expires_at REAL NOT NULL,
              used_at REAL, action TEXT, actor TEXT
            );
            """
        )
        for table, additions in (
            ("subjects", (("enabled", "INTEGER NOT NULL DEFAULT 1"), ("thumbnail", "TEXT"))),
            (
                "attempts",
                (
                    ("endpoint", "TEXT"), ("elapsed_ms", "INTEGER"), ("client_ip", "TEXT"),
                    ("authentik_session_id", "TEXT"), ("veto_delivered", "INTEGER"),
                ),
            ),
            ("credentials", (("sign_count", "INTEGER NOT NULL DEFAULT 0"),)),
            ("quick_sessions", (("prior_session_ids", "TEXT"),)),
        ):
            columns = {row[1] for row in self.connection.execute(f"PRAGMA table_info({table})")}
            for column, definition in additions:
                if column not in columns:
                    self.connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        self.connection.commit()
