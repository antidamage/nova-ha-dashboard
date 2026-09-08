"""Nova face authentication service.

A stateless verifier of clips submitted to it. The service never opens a
capture device — the kiosk browser and the satellites do that and post the
result — which keeps camera plumbing off the GPU host and means a browser, a
satellite and a script are all clients on equal terms.

Face is a release condition on a key. It is never a bearer credential: nothing
downstream accepts "the face service said it was X" as proof. `/verify` mints a
short-lived face session for the recognition-only callers; `/assert` mints one
and spends it inside the same request on a WebAuthn assertion, which the
browser then submits to the identity provider. The browser drives the flow, as
it would for a hardware key — this service is not a WebAuthn client, and
`/auth/face` from the previous pass is retired.

Four gates run before any model does: the nonce, the network binding, the armed
state, and the lockout and release-rate counters. That ordering is the control
— a locked-out or off-network caller costs no GPU and takes no queue position
behind a voice turn.

Enrolment is of consenting members of one household. There is no path to
identifying somebody who has not enrolled: `/identify` returns null for an
unknown face, never a nearest neighbour.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

import core
from core import (
    aggregate_frames,
    clip_bounds_reason,
    cosine_match,
    detection_reason,
    framing_reason,
    quarter_turns_to_upright,
    roll_degrees,
    enrolment_consistency,
    even_frame_indices,
    gallery_scores,
    l2_normalise,
    liveness_decision,
)
from authenticator.authentik import AuthentikClient, AuthentikError
from models import FaceModels

logging.basicConfig(level=os.environ.get("NOVA_FACE_AUTH_LOG_LEVEL", "INFO"))
LOG = logging.getLogger("nova-face-auth")

VERSION = "1"
DATA_ROOT = Path(os.environ.get("NOVA_FACE_AUTH_DATA", "/data"))
THUMBNAIL_ROOT = DATA_ROOT / "thumbnails"
DB_PATH = DATA_ROOT / "faces.sqlite3"

# No default key and no unauthenticated mode. A missing secret is a refusal to
# boot, not a permissive fallback — the unit's ExecStartPre asserts the env file
# exists for the same reason.
API_KEY = os.environ.get("NOVA_FACE_KEY", "").strip()


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


# Thresholds: named, defaulted from the spec, env-overridable, read once here.
# Calibration is an ops action against /etc/nova-face-auth.env, never a code
# change — see "Calibration" in specs/face-auth.md.
DET_SCORE_MIN = _float("FACE_DET_SCORE_MIN", core.DET_SCORE_MIN)
BOX_MIN_PX = _int("FACE_BOX_MIN_PX", core.BOX_MIN_PX)
MATCH_COSINE = _float("FACE_MATCH_COSINE", core.MATCH_COSINE)
MATCH_MARGIN = _float("FACE_MATCH_MARGIN", core.MATCH_MARGIN)
MIN_AGREEING_FRAMES = _int("FACE_MIN_AGREEING_FRAMES", core.MIN_AGREEING_FRAMES)
LIVENESS_RESIDUAL_MIN = _float("FACE_LIVENESS_RESIDUAL_MIN", core.LIVENESS_RESIDUAL_MIN)
LIVENESS_RESIDUAL_MAX = _float("FACE_LIVENESS_RESIDUAL_MAX", core.LIVENESS_RESIDUAL_MAX)
LIVENESS_MIN_FRAMES = _int("FACE_LIVENESS_MIN_FRAMES", core.LIVENESS_MIN_FRAMES)
ANTISPOOF_MIN = _float("FACE_ANTISPOOF_MIN", core.ANTISPOOF_MIN)
CLIP_MIN_SECONDS = _float("FACE_CLIP_MIN_SECONDS", core.CLIP_MIN_SECONDS)
CLIP_MAX_SECONDS = _float("FACE_CLIP_MAX_SECONDS", core.CLIP_MAX_SECONDS)
CLIP_MIN_FPS = _float("FACE_CLIP_MIN_FPS", core.CLIP_MIN_FPS)
CLIP_MAX_BYTES = _int("FACE_CLIP_MAX_BYTES", core.CLIP_MAX_BYTES)
NONCE_TTL_SECONDS = _int("FACE_NONCE_TTL_SECONDS", 20)
SESSION_TTL_SECONDS = _int("FACE_SESSION_TTL_SECONDS", 60)
ENROL_CENTROID_MAX = _float("FACE_ENROL_CENTROID_MAX", core.ENROL_CENTROID_MAX)
ENROL_MIN_CLIPS = _int("FACE_ENROL_MIN_CLIPS", core.ENROL_MIN_CLIPS)

# Controls. Same discipline: named, defaulted, read once, overridden in
# /etc/nova-face-auth.env.
#
# The allowed-CIDR default is the tailnet CGNAT range alone. The household LAN
# prefix is deliberately absent from this repository — it is public, and the
# spec's secrets rule forbids a host address in shipped code or a default. An
# unprovisioned host therefore allows the tailnet and nothing else, and a
# malformed list allows nothing at all.
ALLOWED_CIDRS = core.parse_cidrs(os.environ.get("FACE_ALLOWED_CIDRS", core.ALLOWED_CIDRS_DEFAULT))
TRUST_FORWARDED_FOR = os.environ.get("FACE_TRUST_FORWARDED_FOR", "1").strip() not in {"0", "false", "no"}
LOCKOUT_FAILURES = _int("FACE_LOCKOUT_FAILURES", core.LOCKOUT_FAILURES)
LOCKOUT_GLOBAL_FAILURES = _int("FACE_LOCKOUT_GLOBAL_FAILURES", core.LOCKOUT_GLOBAL_FAILURES)
LOCKOUT_WINDOW_SECONDS = _int("FACE_LOCKOUT_WINDOW_SECONDS", core.LOCKOUT_WINDOW_SECONDS)
RELEASE_MAX_PER_HOUR = _int("FACE_RELEASE_MAX_PER_HOUR", core.RELEASE_MAX_PER_HOUR)
VETO_LINK_TTL_SECONDS = _int("FACE_VETO_LINK_TTL_SECONDS", core.VETO_LINK_TTL_SECONDS)

# Secrets and household identifiers, every one of them out of band. No
# defaults: a missing value is a refusal, never a fallback.
HOST_SECRET = os.environ.get("NOVA_FACE_HOST_SECRET", "").strip()
WEBAUTHN_RP_ID = os.environ.get("WEBAUTHN_RP_ID", "").strip()
WEBAUTHN_ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "").strip()
AUTHENTIK_BASE_URL = os.environ.get("AUTHENTIK_BASE_URL", "").strip()
AUTHENTIK_TOKEN = os.environ.get("AUTHENTIK_TOKEN", "").strip()
# Where the Discord module listens for the veto hook, and the public origin the
# fallback link is built on. Both are configuration for the same reason.
VETO_HOOK_URL = os.environ.get("NOVA_FACE_VETO_HOOK_URL", "").strip()
# The shared key the veto module checks on its ingress route. Without it every
# hook is refused 401, which the client treats as UNKNOWN -- so releases went
# through with the veto silently undelivered, which is the one state the design
# calls worse than having no veto at all.
VETO_HOOK_KEY = os.environ.get("NOVA_FACE_VETO_KEY", "").strip()
PUBLIC_BASE_URL = os.environ.get("NOVA_FACE_PUBLIC_URL", "").strip()

# The header the dashboard's authentik-gated proxy asserts an identity in, and
# the separate secret that says the assertion came from the proxy at all.
#
# The API key cannot vouch for this. Every satellite, camera-events, every
# script and everyone in the `docker` group holds that key, and Caddy's
# `handle_path /face/*` forwards whatever headers a caller sends — so a key
# holder could otherwise clear a lockout with nothing but
# `-H "X-authentik-username: anyone"`. The spec concedes root on the host; it
# does not concede that.
#
# `NOVA_FACE_PROXY_SECRET` is a *different* secret held only by the dashboard's
# server-side proxy, which sits behind authentik forward-auth and only ever
# populates the identity headers from Caddy's `copy_headers`. One credential
# may not vouch for two different things, so this is checked in addition to
# the API key on every identity-bearing route, and identity headers arriving
# without it are refused rather than believed.
AUTHENTIK_IDENTITY_HEADERS = ("x-authentik-username", "x-nova-authentik-user")
PROXY_SECRET_HEADER = "x-nova-face-proxy"
PROXY_SECRET = os.environ.get("NOVA_FACE_PROXY_SECRET", "").strip()

# The subject-id allowlist itself is `core.valid_subject_id`, where it is
# tested: letters, digits, underscore and hyphen, first character alphanumeric,
# 64 characters. No dot, therefore no `..`; no separator, therefore no
# traversal.

# A hard ceiling on decode work regardless of what the container claims about
# duration; a malformed file can otherwise advertise a short clip and stream
# frames forever.
MAX_DECODE_FRAMES = 600

MODELS = FaceModels()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def iso_time(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


# Quarter turns, counted the way `quarter_turns_to_upright` counts them: n is
# how far the image is rotated clockwise, corrected by turning it back. Shared
# so a probe rotation and a landmark correction compose by addition mod 4.
QUARTER_TURN = {
    1: cv2.ROTATE_90_COUNTERCLOCKWISE,
    2: cv2.ROTATE_180,
    3: cv2.ROTATE_90_CLOCKWISE,
}


class Refusal(HTTPException):
    """A refusal that names its reason in a stable machine-readable string.

    The UI renders these. `liveness_rigid` and `antispoof` deliberately show
    the same text there — the distinction belongs in `attempts`, where it is
    useful, not in the UI, where it is a tuning aid for an attacker.
    """

    def __init__(self, status: int, reason: str, **extra: Any) -> None:
        super().__init__(status_code=status, detail={"reason": reason, **extra})
        self.reason = reason


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class Store:
    """SQLite in the shape of camera-events' store: base schema by
    CREATE TABLE IF NOT EXISTS, then a PRAGMA table_info read and an ALTER per
    missing column, so adding a column never costs a data wipe."""

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

    # -- challenges -------------------------------------------------------

    def issue_challenge(self) -> tuple[str, float]:
        nonce = secrets.token_hex(32)
        expires = time.time() + NONCE_TTL_SECONDS
        with self.lock:
            # Opportunistic sweep: expired and spent rows have no further value
            # and this is the only moment the table is guaranteed to be touched.
            self.connection.execute("DELETE FROM challenges WHERE expires_at < ? OR used_at IS NOT NULL", (utc_now(),))
            self.connection.execute(
                "INSERT INTO challenges(nonce, issued_at, expires_at, used_at) VALUES(?,?,?,NULL)",
                (nonce, utc_now(), iso_time(expires)),
            )
            self.connection.commit()
        return nonce, expires

    def challenge_is_live(self, nonce: str) -> bool:
        """Read-only nonce check, for the preflight.

        The gates are evaluated before the nonce is *spent* so that an
        off-network or locked-out caller does not burn a legitimate nonce on
        its way to a refusal. Spending is still the atomic UPDATE below, and it
        still happens before any model runs.
        """

        if not nonce:
            return False
        with self.lock:
            row = self.connection.execute(
                "SELECT 1 FROM challenges WHERE nonce=? AND used_at IS NULL AND expires_at >= ?",
                (nonce, utc_now()),
            ).fetchone()
        return row is not None

    def consume_challenge(self, nonce: str) -> bool:
        """Atomic. Two concurrent submissions of one nonce cannot both win —
        the decision is the UPDATE's rowcount, not a read-then-write."""

        with self.lock:
            cursor = self.connection.execute(
                "UPDATE challenges SET used_at=? WHERE nonce=? AND used_at IS NULL AND expires_at >= ?",
                (utc_now(), nonce, utc_now()),
            )
            self.connection.commit()
            return cursor.rowcount == 1

    # -- subjects and embeddings -----------------------------------------

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

    # -- attempts and sessions -------------------------------------------

    def record_attempt(
        self,
        endpoint: str,
        nonce: str | None,
        decision: str,
        reason: str | None,
        signals: dict[str, Any],
        elapsed_ms: int,
        *,
        client_ip: str | None = None,
    ) -> None:
        """Every attempt, pass or fail. This is the audit trail and the
        calibration data set at once — thresholds get tuned from it rather than
        guessed a second time."""

        with self.lock:
            self.connection.execute(
                "INSERT INTO attempts(id, nonce, created_at, decision, reason, residual, antispoof,"
                " agreeing_frames, usable_frames, subject_id, top_score, runner_up, elapsed_ms, endpoint,"
                " client_ip, authentik_session_id, veto_delivered)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    uuid.uuid4().hex, nonce, utc_now(), decision, reason,
                    signals.get("residual"), signals.get("antispoof"),
                    signals.get("agreeingFrames"), signals.get("usableFrames"),
                    signals.get("subject"), signals.get("topScore"), signals.get("runnerUp"),
                    elapsed_ms, endpoint, client_ip,
                    signals.get("authentikSessionId"),
                    None if signals.get("vetoDelivered") is None else int(bool(signals["vetoDelivered"])),
                ),
            )
            self.connection.commit()

    # -- lockouts, armed state, release rate ------------------------------

    def lockout(self, scope: str) -> core.LockoutState:
        """Read one scope's durable counter.

        Durable, not in process memory: restarting a container is the cheapest
        thing an attacker on the LAN can cause, and a restart must not clear a
        lockout.
        """

        with self.lock:
            row = self.connection.execute("SELECT * FROM lockouts WHERE scope=?", (scope,)).fetchone()
        if row is None:
            return core.LockoutState()
        return core.LockoutState(
            failures=int(row["failures"]),
            window_start=float(row["window_start"]),
            armed=bool(row["armed"]),
        )

    def _write_lockout(self, scope: str, state: core.LockoutState, *, disarmed_by: str | None = None) -> None:
        with self.lock:
            self.connection.execute(
                "INSERT INTO lockouts(scope, failures, window_start, armed) VALUES(?,?,?,?)"
                " ON CONFLICT(scope) DO UPDATE SET failures=excluded.failures,"
                " window_start=excluded.window_start, armed=excluded.armed",
                (scope, state.failures, state.window_start, int(state.armed)),
            )
            if not state.armed:
                self.connection.execute(
                    "UPDATE lockouts SET disarmed_at=?, disarmed_by=? WHERE scope=?",
                    (utc_now(), disarmed_by or "lockout", scope),
                )
            self.connection.commit()

    def note_failure(self, subject_id: str | None, now: float | None = None) -> None:
        """Fold a refusal into the global counter and, when attributable, the
        subject's.

        The global scope exists because a refused clip usually has no subject —
        per-subject counting alone cannot see a spoof campaign, which is
        exactly the thing worth seeing.
        """

        now = time.time() if now is None else now
        globally = core.register_failure(
            self.lockout("global"), now,
            max_failures=LOCKOUT_GLOBAL_FAILURES, window_seconds=LOCKOUT_WINDOW_SECONDS,
        )
        self._write_lockout("global", globally)
        if subject_id:
            scope = f"subject:{subject_id}"
            state = core.register_failure(
                self.lockout(scope), now,
                max_failures=LOCKOUT_FAILURES, window_seconds=LOCKOUT_WINDOW_SECONDS,
            )
            self._write_lockout(scope, state)
            if not state.armed:
                # A subject tripping their own limit disarms the service, not
                # just themselves: the spoof attempts are against the service.
                self.set_armed(False, actor=f"lockout:{scope}")

    def set_armed(self, armed: bool, *, actor: str) -> None:
        """The one durable switch. `armed = False` is reachable from a lockout,
        a rate trip and a Discord veto; `armed = True` is reachable only from
        `/arm`, which requires a password + TOTP authentik session. Nothing
        that presents a face can reach it."""

        state = self.lockout("global")
        with self.lock:
            self.connection.execute(
                "INSERT INTO lockouts(scope, failures, window_start, armed) VALUES('global',?,?,?)"
                " ON CONFLICT(scope) DO UPDATE SET armed=excluded.armed",
                (state.failures, state.window_start, int(armed)),
            )
            if armed:
                # Re-arming clears the counters as well; leaving them set would
                # re-trip on the next bad-lighting refusal.
                self.connection.execute(
                    "UPDATE lockouts SET failures=0, window_start=0, armed=1, cleared_at=?, cleared_by=?",
                    (utc_now(), actor),
                )
            else:
                self.connection.execute(
                    "UPDATE lockouts SET disarmed_at=?, disarmed_by=? WHERE scope='global'",
                    (utc_now(), actor),
                )
            self.connection.commit()
        LOG.warning("face release %s by %s", "armed" if armed else "DISARMED", actor)

    def armed(self) -> bool:
        return self.lockout("global").armed

    def recent_releases(self, now: float) -> list[float]:
        with self.lock:
            self.connection.execute(
                "DELETE FROM releases WHERE released_at < ?", (now - core.RELEASE_WINDOW_SECONDS * 2,)
            )
            rows = self.connection.execute(
                "SELECT released_at FROM releases WHERE released_at >= ?",
                (now - core.RELEASE_WINDOW_SECONDS,),
            ).fetchall()
            self.connection.commit()
        return [float(row["released_at"]) for row in rows]

    def record_release(self, subject_id: str, now: float) -> None:
        with self.lock:
            self.connection.execute(
                "INSERT INTO releases(id, subject_id, released_at) VALUES(?,?,?)",
                (uuid.uuid4().hex, subject_id, now),
            )
            self.connection.commit()

    # -- vetoes -----------------------------------------------------------

    def create_veto(self, subject_id: str, username: str | None, session_id: str | None, now: float) -> str:
        veto_id = secrets.token_urlsafe(18)
        with self.lock:
            self.connection.execute("DELETE FROM vetoes WHERE expires_at < ?", (now,))
            self.connection.execute(
                "INSERT INTO vetoes(veto_id, subject_id, authentik_session_id, authentik_username,"
                " issued_at, expires_at, used_at, action, actor) VALUES(?,?,?,?,?,?,NULL,NULL,NULL)",
                (veto_id, subject_id, session_id, username, now, now + VETO_LINK_TTL_SECONDS),
            )
            self.connection.commit()
        return veto_id

    def consume_veto(self, veto_id: str, action: str, actor: str, now: float) -> sqlite3.Row | None:
        """Single use, on the UPDATE's rowcount — the same discipline as the
        nonce, because a fallback link that works twice is a standing
        capability rather than a one-shot escape hatch."""

        with self.lock:
            cursor = self.connection.execute(
                "UPDATE vetoes SET used_at=?, action=?, actor=? WHERE veto_id=? AND used_at IS NULL"
                " AND expires_at >= ?",
                (now, action, actor, veto_id, now),
            )
            self.connection.commit()
            if cursor.rowcount != 1:
                return None
            return self.connection.execute("SELECT * FROM vetoes WHERE veto_id=?", (veto_id,)).fetchone()

    # --- quick-profile sessions and their idle timeout ---------------------
    #
    # `quick` and `image` mint a session that ends after a period of inactivity.
    # authentik's user_login stage offers only an absolute `session_duration`,
    # so the idle part is enforced here: rows are opened at release, touched by
    # the dashboard's heartbeat, and swept when they go quiet.
    #
    # Enforcement is server-side on purpose. A client that stops heartbeating —
    # a closed tab, a killed browser, a machine that went to sleep, or a caller
    # that simply chose not to — reaches the same end as one that reports
    # honestly. There is nothing a client can withhold to stay signed in.

    def open_quick_session(
        self,
        subject_id: str,
        username: str | None,
        profile: str,
        idle_timeout: int,
        now: float,
        prior_session_ids: list[str] | None = None,
    ) -> str:
        """Open a row, recording which authentik sessions already existed.

        The snapshot is what makes the later binding exact rather than a guess.
        This runs before the browser has submitted the assertion, so authentik
        has not yet created the session this sign-in will produce: any session
        for this user that is NOT in the snapshot appeared afterwards, and is
        therefore a candidate. Picking "the newest" instead would happily latch
        onto a password session signed in from another tab a minute later and
        terminate that.
        """

        session_key = secrets.token_urlsafe(16)
        with self.lock:
            self.connection.execute(
                "INSERT INTO quick_sessions(id, subject_id, authentik_username, profile,"
                " idle_timeout_seconds, issued_at, last_seen, prior_session_ids)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (
                    session_key, subject_id, username, profile, idle_timeout, now, now,
                    json.dumps(sorted(prior_session_ids or [])),
                ),
            )
            self.connection.commit()
        return session_key

    def touch_quick_sessions(self, username: str, now: float) -> int:
        """Heartbeat. Extends every open row for this person.

        Keyed on the authentik username rather than a row id because the client
        doing the heartbeating is the browser, and the browser is never told
        which row it belongs to — handing it one would make the row id a thing
        worth stealing.
        """

        with self.lock:
            cursor = self.connection.execute(
                "UPDATE quick_sessions SET last_seen=? WHERE closed_at IS NULL AND authentik_username=?",
                (now, username),
            )
            self.connection.commit()
            return cursor.rowcount

    def open_quick_sessions(self) -> list[sqlite3.Row]:
        return list(
            self.connection.execute("SELECT * FROM quick_sessions WHERE closed_at IS NULL ORDER BY issued_at")
        )

    def bind_quick_session(self, session_key: str, authentik_session_id: str) -> None:
        with self.lock:
            self.connection.execute(
                "UPDATE quick_sessions SET authentik_session_id=? WHERE id=?",
                (authentik_session_id, session_key),
            )
            self.connection.commit()

    def close_quick_session(self, session_key: str, reason: str, now: float) -> None:
        with self.lock:
            self.connection.execute(
                "UPDATE quick_sessions SET closed_at=?, closed_reason=? WHERE id=? AND closed_at IS NULL",
                (now, reason, session_key),
            )
            self.connection.commit()

    def mint_session(self, subject_id: str, nonce: str | None) -> tuple[str, float]:
        token = secrets.token_urlsafe(32)
        expires = time.time() + SESSION_TTL_SECONDS
        with self.lock:
            self.connection.execute("DELETE FROM face_sessions WHERE expires_at < ?", (utc_now(),))
            self.connection.execute(
                "INSERT INTO face_sessions(token, subject_id, nonce, issued_at, expires_at, used_at) VALUES(?,?,?,?,?,NULL)",
                (token, subject_id, nonce, utc_now(), iso_time(expires)),
            )
            self.connection.commit()
        return token, expires

    def consume_session(self, token: str) -> sqlite3.Row | None:
        """Single use, same atomic-UPDATE discipline as the nonce."""

        with self.lock:
            cursor = self.connection.execute(
                "UPDATE face_sessions SET used_at=? WHERE token=? AND used_at IS NULL AND expires_at >= ?",
                (utc_now(), token, utc_now()),
            )
            self.connection.commit()
            if cursor.rowcount != 1:
                return None
            return self.connection.execute("SELECT * FROM face_sessions WHERE token=?", (token,)).fetchone()


STORE: Store | None = None


def store() -> Store:
    if STORE is None:  # pragma: no cover - only before startup
        raise RuntimeError("store is not initialised")
    return STORE


# ---------------------------------------------------------------------------
# Gates
#
# All of this decides before a model is touched. The ordering lives in
# core.preflight_reason, where it is asserted by a test rather than inferred
# from the shape of an `if` chain.
# ---------------------------------------------------------------------------

# The paths whose callers must be inside the bound networks and whose access
# the armed state governs. /healthz, /detect, /embed and /identify are the
# recognition half — camera-events and the kiosk use them and they release
# nothing — so they carry the key requirement but not the login gates.
GATED_PATHS = ("/challenge", "/verify", "/assert", "/enrol")


def client_ip(request: Request) -> str | None:
    """Caddy's forwarded client, falling back to the direct peer.

    Caddy terminates TLS and is the only thing in front of this service, so its
    forwarded client is authoritative. `FACE_TRUST_FORWARDED_FOR=0` is for a
    topology where the service is directly reachable and the header would be
    attacker-supplied; there it is ignored outright rather than merely
    preferred less.
    """

    peer = request.client.host if request.client else None
    return core.client_address(
        request.headers.get("x-forwarded-for"), peer, trust_forwarded=TRUST_FORWARDED_FOR
    )


def lockout_state_reason(now: float) -> str | None:
    """`disarmed`, `locked_out`, or None.

    The global scope is the one that can be judged before a model runs — the
    subject is not known until the clip has been through identification, and a
    refused clip usually has no subject at all. The per-subject counter is
    folded in afterwards by `note_failure`, which disarms the service when a
    subject trips its own limit, so the effect of the per-subject rule is
    visible to this gate on the next request.
    """

    return core.lockout_reason(
        store().lockout("global"), now,
        max_failures=LOCKOUT_GLOBAL_FAILURES, window_seconds=LOCKOUT_WINDOW_SECONDS,
    )


def gate_request(request: Request, now: float) -> str | None:
    """The network and armed/lockout gates, without the nonce.

    Run from the middleware so an off-network or locked-out caller is refused
    before Starlette parses an 8 MiB multipart body, let alone before a model
    sees a frame.
    """

    address = client_ip(request)
    reason = core.preflight_reason(
        nonce_ok=True,
        network_ok=core.network_allowed(address, ALLOWED_CIDRS),
        lockout=lockout_state_reason(now),
        rate_ok=True,
    )
    if reason == "network_denied":
        LOG.warning("network gate refused %s for %s", address, request.url.path)
    return reason


def require_authentik_identity(request: Request) -> str:
    """The identity the dashboard's authentik-gated proxy asserts, and proof
    that it was the proxy that asserted it.

    Two separate checks, because they answer two separate questions.

    The API key answers "may this caller talk to the service at all", and every
    satellite, camera-events, every script and everyone in the `docker` group
    can answer it. Caddy's `handle_path /face/*` forwards arbitrary headers, so
    a key holder sending `X-authentik-username: anyone` would otherwise clear a
    lockout with no authentik session in the picture. These routes are the
    credential-issuing and lockout-clearing ones; that is not a gap the spec's
    root-on-the-host concession covers.

    `NOVA_FACE_PROXY_SECRET` answers the second question — "did this come
    through the dashboard's server-side proxy, which sits behind authentik
    forward-auth" — and only that proxy holds it. An identity header arriving
    without it is refused rather than believed: a request that reaches here
    with only the shared key is, by construction, a request whose identity
    nobody vouched for.

    A missing `NOVA_FACE_PROXY_SECRET` refuses these routes outright. There is
    no unprovisioned mode in which the header alone starts working again —
    that would be the failure this check exists to prevent, arriving by way of
    an empty variable.
    """

    supplied = request.headers.get(PROXY_SECRET_HEADER, "")
    if not PROXY_SECRET or not hmac.compare_digest(supplied, PROXY_SECRET):
        LOG.warning(
            "identity-bearing request to %s without proxy provenance from %s",
            request.url.path, client_ip(request),
        )
        raise Refusal(403, "authentik_session_required")
    for header in AUTHENTIK_IDENTITY_HEADERS:
        value = request.headers.get(header, "").strip()
        if value:
            return value
    raise Refusal(403, "authentik_session_required")


def require_dashboard_proxy(request: Request) -> str | None:
    """Proof the request came through the dashboard's proxy. Identity optional.

    For enrolment and the subject routes, decided 2026-09-03. Adeline: "I don't
    care about spoofing. this is a convenience thing. assume that nobody with
    malicious intent will have access to my house."

    The enrolment UI already sits behind the /config forward-auth gate, so
    reaching it at all means passing authentik. Requiring the identity header
    on the XHR as well meant the outpost answered an unauthenticated fetch with
    a 302 to the IdP, and a cross-origin redirect on an XHR is an opaque CORS
    error in the browser rather than "log in again" -- which is exactly how
    live enrolment failed.

    The proxy secret is still required, so this is not open: the request must
    still have come through the dashboard's server-side proxy, and the shared
    API key alone does not satisfy it. What is dropped is the second, redundant
    proof of *who* was logged in. The identity is still returned when present,
    so the audit row keeps it.

    `/arm` keeps `require_authentik_identity`: clearing a lockout is the one
    face route that grants rather than records.
    """

    supplied = request.headers.get(PROXY_SECRET_HEADER, "")
    if not PROXY_SECRET or not hmac.compare_digest(supplied, PROXY_SECRET):
        LOG.warning(
            "request to %s without dashboard proxy provenance from %s",
            request.url.path, client_ip(request),
        )
        raise Refusal(403, "authentik_session_required")
    for header in AUTHENTIK_IDENTITY_HEADERS:
        value = request.headers.get(header, "").strip()
        if value:
            return value
    return None


def require_subject_id(subject_id: str) -> str:
    """Validate a subject id at the boundary. Reject, never sanitise.

    It becomes a SQLite primary key and a thumbnail filename, and a silently
    rewritten id is worse than a refused one: it becomes a second subject
    nobody asked for, with its own gallery, matching nothing.
    """

    if not core.valid_subject_id(subject_id):
        raise Refusal(422, "invalid_subject")
    return subject_id


def require_release_capacity(now: float) -> None:
    """The release-rate cap, checked before signing and enforced as an attack
    signal rather than as backpressure: exceeding it disarms."""

    if core.release_rate_exceeded(store().recent_releases(now), now, max_per_hour=RELEASE_MAX_PER_HOUR):
        store().set_armed(False, actor="rate_limit")
        raise Refusal(core.GATE_STATUS["rate_limited"], "rate_limited")


# ---------------------------------------------------------------------------
# Upload and decode
# ---------------------------------------------------------------------------


async def read_bounded(request: Request, upload: UploadFile) -> bytes:
    """Read an upload with two independent bounds.

    `Content-Length` is checked first so an oversized body is refused before it
    is read at all — but the header is attacker-controlled, so the streamed
    read is capped at the same bound regardless of what it claimed.
    """

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > CLIP_MAX_BYTES:
        raise HTTPException(status_code=413, detail={"reason": "clip_too_large"})
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > CLIP_MAX_BYTES:
            raise HTTPException(status_code=413, detail={"reason": "clip_too_large"})
        chunks.append(chunk)
    if not total:
        raise Refusal(422, "clip_undecodable")
    return b"".join(chunks)


def decode_clip(payload: bytes, profile: core.CaptureProfile | None = None) -> tuple[list[np.ndarray], float, float]:
    """Decode a submitted clip to sampled BGR frames.

    `profile` supplies the length bounds. `standard` passes None and gets the
    service's configured FACE_CLIP_* values; `quick` carries its own shorter
    window because a 1 s clip is `clip_too_short` under the standard floor.

    The temp file is removed in a `finally` that runs on every exception path.
    An exception mid-decode must not leave a video of somebody's face on disk;
    that is the whole reason raw frames are never retained anywhere else
    either.
    """

    handle, temp_path = tempfile.mkstemp(suffix=".clip", dir=str(DATA_ROOT))
    os.close(handle)
    path = Path(temp_path)
    capture = None
    try:
        path.write_bytes(payload)
        capture = cv2.VideoCapture(str(path))
        if not capture.isOpened():
            raise Refusal(422, "clip_undecodable")
        frames: list[np.ndarray] = []
        last_position_ms = 0.0
        while len(frames) < MAX_DECODE_FRAMES:
            ok, frame = capture.read()
            if not ok:
                break
            position = capture.get(cv2.CAP_PROP_POS_MSEC)
            if position and position > 0:
                last_position_ms = position
            frames.append(frame)
        if len(frames) < 2:
            raise Refusal(422, "clip_undecodable")
        # MediaRecorder's webm routinely reports fps 0 and no frame count, so
        # the container's own numbers are a hint, not the source of truth.
        reported_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        duration = last_position_ms / 1000.0
        if duration <= 0 and reported_fps > 0:
            duration = len(frames) / reported_fps
        fps = reported_fps if reported_fps > 0 else (len(frames) / duration if duration > 0 else 0.0)
        min_seconds = CLIP_MIN_SECONDS if profile is None or profile.clip_min_seconds is None else profile.clip_min_seconds
        max_seconds = CLIP_MAX_SECONDS if profile is None or profile.clip_max_seconds is None else profile.clip_max_seconds
        reason = clip_bounds_reason(
            duration, fps,
            min_seconds=min_seconds, max_seconds=max_seconds, min_fps=CLIP_MIN_FPS,
        )
        if reason:
            raise Refusal(422, reason, duration=round(duration, 3), fps=round(fps, 2))
        sampled = [frames[index] for index in even_frame_indices(len(frames), core.SAMPLE_FRAMES)]
        return sampled, duration, fps
    finally:
        if capture is not None:
            capture.release()
        path.unlink(missing_ok=True)


def decode_image(payload: bytes) -> np.ndarray:
    frame = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise Refusal(422, "clip_undecodable")
    return frame


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


class ClipAnalysis:
    def __init__(self, frames: list[np.ndarray]) -> None:
        self.detections = []
        self.rejections: list[str] = []
        frames, self.quarter_turns = self._upright(frames)
        for frame in frames:
            faces = MODELS.detect(frame, with_embedding=True)
            best = max(faces, key=lambda item: item.score) if faces else None
            reason = detection_reason(
                len(faces),
                best.score if best else None,
                best.short_side if best else None,
                det_score_min=DET_SCORE_MIN, box_min_px=BOX_MIN_PX,
            )
            if reason == "multiple_faces":
                # No "pick the biggest" rule. The biggest face is not
                # necessarily the one asking to be let in, and one of the
                # others may be the person being walked past the camera.
                raise Refusal(422, "multiple_faces")
            if not reason and best is not None:
                # Framing is checked here, with the frame in hand, because the
                # anti-spoof crop widens this box by up to 4x. A face touching a
                # frame edge has no pixels out there to widen into, and the crop
                # would reflect the border — asking the model to judge texture
                # that was invented rather than captured.
                reason = framing_reason(best.bbox, frame.shape[1], frame.shape[0])
            if reason:
                self.rejections.append(reason)
                continue
            self.detections.append((frame, best))

    @staticmethod
    def _upright(frames: list[np.ndarray]) -> tuple[list[np.ndarray], int]:
        """Rotate a sideways capture upright before anything judges it.

        Phones record portrait by writing landscape frames plus a rotation
        flag, and that flag does not survive a `MediaRecorder` re-encode or
        `cv2.VideoCapture`, which ignores it. The frames arrive on their side.

        Nothing downstream notices on its own: measured 2026-09-03, a
        90-degree-rotated capture still detected at 0.791 and produced 25
        usable frames, so the pipeline went on to score anti-spoof against a
        sideways face. The eye landmarks are the only orientation cue that
        survives, which is what makes this checkable at all — the bounding box
        carries no rotation and the metadata is exactly what was lost.

        Orientation is decided ONCE, from the first frame with a confident
        detection, and applied to the whole clip. Per-frame decisions would let
        the geometry change mid-clip, and the liveness residual compares frames
        to each other — a rotation appearing halfway through would read as
        motion that never happened.
        """

        probes = frames[: min(len(frames), 5)]
        for frame in probes:
            turns = ClipAnalysis._turns_from_landmarks(frame)
            if turns is None:
                continue
            if turns:
                LOG.info("clip arrived rotated; correcting by %d quarter turn(s)", turns)
            return ClipAnalysis._rotate(frames, turns), turns

        # Nothing was detected at the incoming orientation.
        #
        # The landmark check above can only correct a rotation it can SEE, and
        # it sees nothing until a face is detected. That is fine for a phone,
        # which is off by a quarter turn at most and still detects. It is not
        # fine for a camera mounted on its side: rotation then decides whether
        # there is a detection AT ALL, and the clip is refused `no_face` for a
        # face that is plainly in the frame.
        #
        # So probe the other three cardinal orientations before giving up. One
        # frame each, and only on this path — a clip that detected normally
        # costs nothing extra, and the worst case is three extra detections on a
        # clip that was going to be refused anyway.
        if probes:
            for pre in (1, 2, 3):
                turns = ClipAnalysis._turns_from_landmarks(cv2.rotate(probes[0], QUARTER_TURN[pre]))
                if turns is None:
                    continue
                total = (pre + turns) % 4
                LOG.info(
                    "no face at the incoming orientation; detected after %d quarter turn(s), "
                    "correcting the clip by %d",
                    pre,
                    total,
                )
                return ClipAnalysis._rotate(frames, total), total
        return frames, 0

    @staticmethod
    def _turns_from_landmarks(frame: np.ndarray) -> int | None:
        """Quarter turns to upright from one frame, or None if no confident face.

        The eye landmarks are the only orientation cue that survives a
        re-encode; the bounding box carries no rotation.
        """
        faces = MODELS.detect(frame)
        if not faces:
            return None
        best = max(faces, key=lambda item: item.score)
        if best.score < DET_SCORE_MIN:
            return None
        return quarter_turns_to_upright(roll_degrees(best.landmarks))

    @staticmethod
    def _rotate(frames: list[np.ndarray], turns: int) -> list[np.ndarray]:
        turns %= 4
        if turns == 0:
            return frames
        return [cv2.rotate(item, QUARTER_TURN[turns]) for item in frames]

    @property
    def usable(self) -> int:
        return len(self.detections)

    def require_frames(self, min_frames: int | None = None) -> None:
        if self.usable >= (LIVENESS_MIN_FRAMES if min_frames is None else min_frames):
            return
        # Name what actually went wrong when the frames agree on a cause; a
        # bare "too_few_frames" for a subject standing too far away is a
        # refusal the person cannot act on.
        if self.rejections:
            dominant = max(set(self.rejections), key=self.rejections.count)
            if self.rejections.count(dominant) >= len(self.rejections) * 0.6:
                raise Refusal(422, dominant, usableFrames=self.usable)
        raise Refusal(422, "too_few_frames", usableFrames=self.usable)

    def track(self) -> np.ndarray:
        return np.stack([detection.landmarks for _, detection in self.detections])

    def antispoof(self) -> float:
        scores = [MODELS.antispoof_score(frame, detection.bbox) for frame, detection in self.detections]
        return float(np.mean(scores))

    def embeddings(self) -> list[np.ndarray]:
        return [
            l2_normalise(detection.embedding)
            for _, detection in self.detections
            if detection.embedding is not None
        ]

    def mean_embedding(self) -> np.ndarray:
        vectors = self.embeddings()
        if not vectors:
            raise Refusal(422, "no_face")
        return core.centroid(vectors)

    def best_detection(self):
        return max(self.detections, key=lambda item: item[1].score)


def run_liveness(analysis: ClipAnalysis, profile: core.CaptureProfile | None = None) -> tuple[float | None, float | None]:
    """Both signals enforce, and both are returned so both get logged.

    The residual does not stand alone: a video replay on a screen is not
    geometrically rigid and passes it. The nonce and the texture model exist
    because of that.

    A profile can switch either signal off, and then that signal is not measured
    at all rather than measured and ignored — running a model whose verdict is
    discarded costs GPU time on the path that exists to be fast, and a logged
    score nothing enforced would read in `attempts` as though a gate had passed.
    `None` in the returned pair means "not run", which is what the caller logs.
    """

    profile = profile or core.CAPTURE_PROFILES[core.DEFAULT_CAPTURE_PROFILE]
    if not profile.liveness and not profile.antispoof:
        LOG.info("liveness and antispoof SKIPPED for profile=%s", profile.name)
        return None, None

    residual: float | None = None
    if profile.liveness:
        decision = liveness_decision(
            analysis.track(),
            residual_min=LIVENESS_RESIDUAL_MIN,
            residual_max=LIVENESS_RESIDUAL_MAX,
            min_frames=LIVENESS_MIN_FRAMES,
        )
        if not decision.ok:
            # Log the refusal too, not just the pass. The first live enrolment
            # produced a run of 401s whose only visible evidence was the residual
            # line -- which is emitted AFTER this branch, so every refusal here was
            # silent and indistinguishable from the anti-spoof refusal below.
            LOG.info(
                "liveness REFUSED reason=%s residual=%s frames=%d",
                decision.reason, decision.residual, analysis.usable,
            )
            raise Refusal(decision.status, decision.reason or "too_few_frames", residual=decision.residual)
        LOG.info("liveness residual %.5f by landmark %s", decision.residual, decision.per_landmark)
        residual = float(decision.residual or 0.0)

    antispoof: float | None = None
    if profile.antispoof:
        antispoof = analysis.antispoof()
        # Always log the score, pass or fail. The spec's whole calibration story is
        # "record the actual score of every signal on every attempt so thresholds
        # can be tuned from real logs rather than guessed twice" -- and this is the
        # signal whose threshold is explicitly a guess. Logging it only on success
        # would hide exactly the data the guess needs.
        LOG.info("antispoof score %.4f (min %.4f) -> %s",
                 antispoof, ANTISPOOF_MIN, "pass" if antispoof >= ANTISPOOF_MIN else "REFUSE")
        if antispoof < ANTISPOOF_MIN:
            raise Refusal(401, "antispoof", residual=residual, antispoof=round(antispoof, 4))

    return residual, antispoof


def identify_frames(analysis: ClipAnalysis, gallery: dict[str, list[np.ndarray]], min_agreeing: int | None = None):
    votes = [
        cosine_match(embedding, gallery, threshold=MATCH_COSINE, margin=MATCH_MARGIN)
        for embedding in analysis.embeddings()
    ]
    return votes, aggregate_frames(
        votes, min_agreeing=MIN_AGREEING_FRAMES if min_agreeing is None else min_agreeing
    )


# ---------------------------------------------------------------------------
# The signing oracle and the veto channel
# ---------------------------------------------------------------------------


class Oracle:
    """The authenticator, in this process.

    Same process as the face decision on purpose: the decision never crosses a
    boundary before it authorises a signature, so there is no socket on which
    a "the face matched" message could be injected by anything that had not
    already compromised the process that would have signed anyway.
    """

    def __init__(self) -> None:
        from authenticator import AuthenticatorConfig, CredentialStore

        self.config = AuthenticatorConfig(rp_id=WEBAUTHN_RP_ID, origin=WEBAUTHN_ORIGIN)
        self.store = CredentialStore(
            store().connection, host_secret=HOST_SECRET, lock=store().lock
        )


ORACLE: Oracle | None = None


def require_oracle() -> Oracle:
    """The credential half, or a 503.

    Its absence is not a startup failure: the recognition half — `/identify`,
    `/detect`, `/embed`, which camera-events and the kiosk use — keeps working
    on a host that has not been given a host secret or a relying party yet.
    What it must never do is fall back to some other way of letting somebody
    in.
    """

    if ORACLE is None:
        raise Refusal(503, "service_unavailable")
    return ORACLE


# Two distinct "no mapping" answers, because they mean opposite things. The
# module saying "nobody is mapped to that subject" is a refusal: an unvetoable
# release is not a release. The module not answering at all is a third-party
# outage, and a third-party outage must not lock the household out of its own
    # house.
UNMAPPED = object()
UNKNOWN = object()


class VetoClient:
    """The Discord veto, over the module's hook endpoint.

    Revocation only, in both directions. Nothing this client sends can approve
    an assertion, and nothing it receives is treated as an authorisation — the
    only thing it can report that changes an outcome is "this subject has no
    account mapped", which *refuses*.
    """

    def __init__(self, url: str) -> None:
        self.url = url

    def _post(self, payload: dict[str, Any], timeout: float = 4.0) -> tuple[int, dict[str, Any]] | None:
        """POST the hook. `None` means the module did not answer at all."""

        if not self.url:
            return None
        headers = {"Content-Type": "application/json"}
        if VETO_HOOK_KEY:
            headers["X-Nova-Face-Veto-Key"] = VETO_HOOK_KEY
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                return response.status, (json.loads(body) if body else {})
        except urllib.error.HTTPError as error:
            body = error.read()
            try:
                return error.code, (json.loads(body) if body else {})
            except ValueError:
                return error.code, {}
        except Exception as error:  # noqa: BLE001 - any other failure is "unknown"
            LOG.warning("veto channel unreachable: %s", error.__class__.__name__)
            return None

    def resolve(self, subject: str):
        """UNMAPPED, UNKNOWN, or the account row for the subject.

        Only an explicit answer means unmapped: `{"mapped": false}`, or a 409
        from the module. Every other non-answer — no hook URL configured, a
        404 from a module that has not implemented the resolve hook, a 5xx, a
        timeout — is UNKNOWN, and the caller proceeds while logging an
        undelivered veto. That asymmetry is deliberate: refusing on "the module
        did not answer" would make a Discord outage a household lockout, which
        the spec forbids in as many words.
        """

        answer = self._post({"hook": "face.account.resolve", "subject": subject}, timeout=2.0)
        if answer is None:
            return UNKNOWN
        status, body = answer
        if status == 409 or (status < 400 and body.get("mapped") is False):
            return UNMAPPED
        if status >= 400:
            LOG.warning("veto channel could not resolve subject mapping: status %s", status)
            return UNKNOWN
        return body.get("account") or {}

    def session_opened(
        self,
        *,
        subject: str,
        username: str | None,
        client_ip: str | None,
        surface: str,
        veto_id: str,
        session_id: str | None = None,
    ) -> bool:
        """`face.session.opened`. Failure to deliver is logged, not fatal."""

        payload = {
            "hook": "face.session.opened",
            "subject": subject,
            "authentikUsername": username,
            "sessionId": session_id,
            "clientIp": client_ip,
            "surface": surface,
            "at": utc_now(),
            "vetoId": veto_id,
            "fallbackUrl": self.fallback_url(veto_id),
        }
        answer = self._post(payload)
        if answer is None or answer[0] >= 400 or answer[1].get("delivered") is False:
            # Loudly. A veto channel that is quietly down is worse than none at
            # all, because the owner believes a session opening will reach her
            # phone and it will not. It still does not block the response — a
            # third-party outage must not lock her out of her own house — so
            # the log line and the `attempts` row are the whole of the alarm.
            LOG.error(
                "VETO UNDELIVERED for subject %s: a session was opened and nobody was told (%s)",
                subject,
                "no answer" if answer is None else f"status {answer[0]}",
            )
            return False
        return True

    @staticmethod
    def fallback_url(veto_id: str, action: str = "disarm") -> str | None:
        """The HMAC-signed single-use escape hatch, when nothing else works."""

        if not (HOST_SECRET and PUBLIC_BASE_URL):
            return None
        expiry = int(time.time() + VETO_LINK_TTL_SECONDS)
        query = f"a={action}&v={veto_id}&e={expiry}"
        signature = hmac.new(HOST_SECRET.encode(), query.encode(), hashlib.sha256).hexdigest()
        return f"{PUBLIC_BASE_URL.rstrip('/')}/face/veto?{query}&sig={signature}"


VETO = VetoClient(VETO_HOOK_URL)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    global STORE, ORACLE
    if not API_KEY:
        raise RuntimeError("NOVA_FACE_KEY is not set; refusing to start without authentication")
    STORE = Store()
    if HOST_SECRET and WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN:
        ORACLE = Oracle()
    else:
        # The recognition half still serves. The credential half refuses with a
        # 503 rather than inventing a way to let somebody in — see
        # require_oracle.
        LOG.warning("credential half disabled: host secret or relying party not configured")
    if not ALLOWED_CIDRS:
        LOG.warning("FACE_ALLOWED_CIDRS is empty or unparseable; every gated route will refuse")
    # Deliberately uncaught. Anti-spoof weights that will not load mean the
    # service cannot tell a photograph from a person, and a service that cannot
    # do that must not serve. Never fail open.
    MODELS.load_antispoof()
    removed = store().purge_thumbnails()
    if removed:
        LOG.info("removed %d stored face crop(s); thumbnails are no longer retained", removed)
    MODELS.warm_up()

    # The idle sweep. 60 s cadence against a 900 s timeout: the granularity is
    # a minute, which is the right resolution for "has this person walked away"
    # and costs one authentik list call per user with an open row.
    sweep_task = asyncio.create_task(quick_session_sweeper())
    try:
        yield
    finally:
        sweep_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweep_task


app = FastAPI(title="Nova face auth", version=VERSION, lifespan=lifespan)


@app.middleware("http")
async def require_key(request: Request, call_next):
    """First, before anything touches the request body, on every route.

    `/healthz` included — an unauthenticated health endpoint on this service
    would advertise how many people are enrolled and which provider is live.
    """

    supplied = request.headers.get("x-nova-face-key", "")
    if not API_KEY or not hmac.compare_digest(supplied, API_KEY):
        return JSONResponse({"reason": "forbidden"}, status_code=403)
    # Then the network binding and the armed state, still before the body is
    # parsed. One middleware rather than two so the order is the order written
    # here: Starlette runs the most recently added middleware outermost, so a
    # second decorator would have run *before* the key check rather than after
    # it. A refused caller must not cost an 8 MiB multipart parse, a GPU queue
    # slot, or a position behind a voice turn.
    #
    # `/veto` is exempt from the gates because revocation has to work when
    # nothing else does — that is the situation it exists for — and it carries
    # an HMAC over its whole query string plus single use instead.
    path = request.url.path
    if STORE is not None and any(path.startswith(prefix) for prefix in GATED_PATHS):
        reason = gate_request(request, time.time())
        if reason:
            return JSONResponse({"reason": reason}, status_code=core.GATE_STATUS[reason])
    return await call_next(request)


@app.exception_handler(HTTPException)
async def refusal_handler(request: Request, error: HTTPException):
    detail = error.detail if isinstance(error.detail, dict) else {"reason": str(error.detail)}
    return JSONResponse(detail, status_code=error.status_code)


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    with store().lock:
        subjects = store().connection.execute("SELECT COUNT(*) FROM subjects").fetchone()[0]
    health = MODELS.health()
    return {
        "ok": MODELS.loaded,
        "subjects": int(subjects),
        "version": VERSION,
        # The armed state is health: a disarmed service answers every login
        # with a refusal, and a dashboard that cannot see that is a dashboard
        # that reports a lockout as a broken camera.
        "armed": store().armed(),
        "credentialHalf": ORACLE is not None,
        "networkBound": bool(ALLOWED_CIDRS),
        **health,
    }


@app.post("/challenge")
def challenge() -> dict[str, Any]:
    nonce, expires = store().issue_challenge()
    return {"nonce": nonce, "expiresAt": iso_time(expires)}


@app.post("/detect")
async def detect(request: Request, image: UploadFile = File(...)) -> list[dict[str, Any]]:
    frame = decode_image(await read_bounded(request, image))
    return [item.as_dict() for item in MODELS.detect(frame)]


@app.post("/embed")
async def embed(request: Request, image: UploadFile = File(...)) -> dict[str, Any]:
    frame = decode_image(await read_bounded(request, image))
    faces = MODELS.detect(frame, with_embedding=True)
    best = max(faces, key=lambda item: item.score) if faces else None
    reason = detection_reason(
        len(faces), best.score if best else None, best.short_side if best else None,
        det_score_min=DET_SCORE_MIN, box_min_px=BOX_MIN_PX,
    )
    if reason:
        raise Refusal(422, reason)
    return {
        "embedding": [round(float(value), 6) for value in l2_normalise(best.embedding)],
        "bbox": [round(float(value), 2) for value in best.bbox],
        "score": round(float(best.score), 4),
    }


@app.post("/identify")
async def identify(request: Request, clip: UploadFile | None = File(None), image: UploadFile | None = File(None)) -> dict[str, Any]:
    """Recognition only: no liveness, no nonce, no token.

    Deliberately so — this is the endpoint a background analysis pass can use
    for "is the owner in the room", and it is never sufficient to let anybody
    in. An unknown face returns null, never a nearest neighbour.
    """

    upload = clip or image
    if upload is None:
        raise Refusal(422, "clip_undecodable")
    payload = await read_bounded(request, upload)
    frames = decode_clip(payload)[0] if clip is not None else [decode_image(payload)]
    analysis = ClipAnalysis(frames)
    if not analysis.detections:
        raise Refusal(422, analysis.rejections[0] if analysis.rejections else "no_face")
    gallery = store().gallery()
    votes, aggregate = identify_frames(analysis, gallery)
    ordered = gallery_scores(analysis.mean_embedding(), gallery)
    return {
        "subject": aggregate.subject if aggregate else None,
        "score": round(aggregate.top_score, 4) if aggregate else (round(ordered[0][1], 4) if ordered else None),
        "runnerUp": round(ordered[1][1], 4) if len(ordered) > 1 else None,
        "frames": {"usable": analysis.usable, "agreeing": aggregate.agreeing if aggregate else 0, "sampled": len(frames)},
    }


def verify_clip(
    payload: bytes,
    nonce: str,
    endpoint: str,
    *,
    client_ip: str | None = None,
    profile: core.CaptureProfile | None = None,
) -> dict[str, Any]:
    """The shared face half of /verify and /assert.

    `profile` decides which gates run and how the payload is decoded — a clip
    for `standard`/`quick`, a single still for `image`. It is recorded on the
    `attempts` row on every path, because with the model gates off on two of the
    three profiles the row is the only remaining record of what was actually
    enforced, and a row that does not name its profile cannot be read as
    calibration data at all.

    Writes an `attempts` row on every path — success and refusal alike — before
    the response leaves, and folds every refusal into the lockout counters.

    A refusal that is not the caller's fault is still counted. That is
    deliberate: the counters exist to notice a campaign, and an attacker whose
    clips are being rejected for "no face" is exactly the campaign they are
    meant to notice. The cost is that a badly-lit household member can lock the
    service; the spec's calibration procedure sets the limit above what that
    costs in practice, and re-arming is a password + TOTP action rather than an
    outage.
    """

    started = time.time()
    profile = profile or core.CAPTURE_PROFILES[core.DEFAULT_CAPTURE_PROFILE]
    signals: dict[str, Any] = {"profile": profile.name}
    reason: str | None = None
    try:
        if not store().consume_challenge(nonce):
            raise Refusal(401, "nonce_invalid")
        frames = [decode_image(payload)] if profile.single_image else decode_clip(payload, profile)[0]
        analysis = ClipAnalysis(frames)
        analysis.require_frames(profile.min_frames)
        signals["usableFrames"] = analysis.usable
        residual, antispoof = run_liveness(analysis, profile)
        # A skipped gate logs as null, never as a score. A row reading
        # "antispoof: 0.0" would be indistinguishable from a model that ran and
        # returned nothing, and the two mean opposite things.
        signals.update({
            "residual": None if residual is None else round(residual, 6),
            "antispoof": None if antispoof is None else round(antispoof, 4),
        })
        gallery = store().gallery()
        votes, aggregate = identify_frames(analysis, gallery, profile.min_agreeing)
        ordered = gallery_scores(analysis.mean_embedding(), gallery)
        signals["topScore"] = round(ordered[0][1], 4) if ordered else None
        signals["runnerUp"] = round(ordered[1][1], 4) if len(ordered) > 1 else None
        if aggregate is None:
            named = sum(1 for vote in votes if vote is not None)
            # Ambiguity and thin agreement are different failures and are logged
            # as such, even though both are a 401 to the caller.
            raise Refusal(401, "too_few_agreeing" if named else "ambiguous", **signals)
        signals.update({
            "subject": aggregate.subject,
            "agreeingFrames": aggregate.agreeing,
            "topScore": round(aggregate.top_score, 4),
            "runnerUp": round(aggregate.runner_up, 4),
        })
        token, expires = store().mint_session(aggregate.subject, nonce)
        return {
            "subject": aggregate.subject,
            "faceSession": token,
            "expiresAt": iso_time(expires),
            "signals": {
                "residual": signals["residual"], "antispoof": signals["antispoof"],
                "agreeingFrames": aggregate.agreeing, "usableFrames": analysis.usable,
                "topScore": signals["topScore"], "runnerUp": signals["runnerUp"],
            },
        }
    except HTTPException as error:
        detail = error.detail if isinstance(error.detail, dict) else {}
        reason = detail.get("reason", "error")
        signals.update({key: value for key, value in detail.items() if key != "reason"})
        raise
    finally:
        if reason:
            # `nonce_invalid` counts too: a caller replaying nonces is not
            # having a bad day with the lighting.
            store().note_failure(signals.get("subject"), started)
        store().record_attempt(
            endpoint, nonce, "refused" if reason else "accepted", reason, signals,
            int((time.time() - started) * 1000), client_ip=client_ip,
        )


def resolve_profile(name: str | None) -> core.CaptureProfile:
    """Turn a submitted profile name into a profile, or refuse.

    Unknown names are refused rather than downgraded to `standard`. A surface
    that asked for a profile this build does not have has expectations that do
    not match what would run, and quietly substituting one is how a caller ends
    up believing it relaxed a gate that stayed on.
    """

    try:
        return core.capture_profile(name)
    except ValueError:
        raise Refusal(422, "unknown_profile") from None


async def read_capture(
    request: Request, profile: core.CaptureProfile, clip: UploadFile | None, image: UploadFile | None
) -> bytes:
    """The submitted capture, checked against what the profile expects.

    A profile and a payload that disagree are refused rather than reconciled:
    `image` with a clip attached is a caller that thinks it is on a different
    path than it is.
    """

    upload = image if profile.single_image else clip
    if upload is None:
        raise Refusal(422, "clip_undecodable")
    return await read_bounded(request, upload)


@app.post("/verify")
async def verify(
    request: Request,
    clip: UploadFile | None = File(None),
    image: UploadFile | None = File(None),
    nonce: str = Form(...),
    profile: str | None = Form(None),
) -> dict[str, Any]:
    resolved = resolve_profile(profile)
    payload = await read_capture(request, resolved, clip, image)
    return verify_clip(payload, nonce, "/verify", client_ip=client_ip(request), profile=resolved)


@app.post("/assert")
async def assert_credential(
    request: Request,
    clip: UploadFile | None = File(None),
    image: UploadFile | None = File(None),
    nonce: str = Form(...),
    challenge: str = Form(...),
    profile: str | None = Form(None),
) -> dict[str, Any]:
    """The endpoint the ceremony turns on: face in, WebAuthn assertion out.

    `/verify` plus signing, in one call. The face session is minted and spent
    inside this request and is never handed to a caller — a token that reached
    a client would be a bearer credential, which is the one thing face must
    never become. `challenge` is the base64url WebAuthn challenge exactly as
    the identity provider issued it; this service does not check where it came
    from, and the spec's threat model says plainly that it cannot.

    Order of events, and each one is load-bearing:

    1. The network and armed gates have already refused off-network and
       locked-out callers in the middleware, before this body was parsed.
    2. `verify_clip` spends the nonce atomically, then runs the models, and
       writes an `attempts` row whatever happens.
    3. The subject must map to a Discord account, or there is no signature: an
       unvetoable release is not a release.
    4. The release-rate cap is checked, and trips the armed state if exceeded.
    5. The credential is released for exactly one signature.
    6. The veto DM goes out before the assertion is returned to the browser.
    """

    resolved = resolve_profile(profile)
    payload = await read_capture(request, resolved, clip, image)
    address = client_ip(request)
    oracle = require_oracle()
    now = time.time()

    result = verify_clip(payload, nonce, "/assert", client_ip=address, profile=resolved)
    subject = result["subject"]

    # Resolve the veto channel *before* signing. A subject with no mapped
    # account gets no DM and no signature; a Discord outage is a different
    # thing entirely and must not become a household lockout, so an
    # unreachable module is "unknown", not "unmapped".
    mapping = VETO.resolve(subject)
    if mapping is UNMAPPED:
        store().record_attempt(
            "/assert", nonce, "refused", "no_veto_channel", {"subject": subject}, 0, client_ip=address
        )
        raise Refusal(403, "no_veto_channel")

    require_release_capacity(now)

    # Spend the face session in this service's own table first, so a token can
    # never be presented twice even in the window before its TTL expires, and
    # only then wrap the credential under it for exactly one use.
    face_session = result["faceSession"]
    if store().consume_session(face_session) is None:
        raise Refusal(401, "face_session_invalid")
    if not oracle.store.mint_release(subject, oracle.config, face_session, ttl_seconds=SESSION_TTL_SECONDS, now=now):
        raise Refusal(403, "no_credential")
    try:
        assertion = oracle.store.sign_assertion(
            subject_id=subject, challenge=challenge, config=oracle.config,
            release_token=face_session, now=now,
        )
    except PermissionError as error:
        raise Refusal(401, "face_session_invalid" if str(error) == "face_session_invalid" else "no_credential")

    store().record_release(subject, now)

    # A relaxed capture buys a session that ends when the person stops using it.
    # Opened here rather than after the flow completes because this is the last
    # point that knows which profile released the credential; the sweep resolves
    # the authentik session id afterwards, once authentik has actually made one.
    if resolved.idle_timeout_seconds is not None:
        quick_username = None if mapping is UNKNOWN else mapping.get("authentikUsername")
        store().open_quick_session(
            subject, quick_username, resolved.name, resolved.idle_timeout_seconds, now,
            prior_session_ids=list_session_ids(quick_username),
        )

    delivered = VETO.session_opened(
        subject=subject,
        username=None if mapping is UNKNOWN else mapping.get("authentikUsername"),
        client_ip=address,
        surface=request.headers.get("x-nova-surface", "browser"),
        veto_id=store().create_veto(subject, None if mapping is UNKNOWN else mapping.get("authentikUsername"), None, now),
    )
    store().record_attempt(
        "/assert", nonce, "released", None,
        {**result.get("signals", {}), "subject": subject, "vetoDelivered": delivered},
        int((time.time() - now) * 1000), client_ip=address,
    )
    return assertion


@app.post("/arm")
def arm(request: Request) -> dict[str, Any]:
    """Clear the lockout and re-arm face release. Password + TOTP only.

    The API key is explicitly **not** sufficient here: every LAN service that
    talks to this oracle holds it. The dashboard's authentik-gated proxy route
    asserts the authenticated identity in a header, and this endpoint refuses
    without one.

    There is no face path to this endpoint, no Discord action that reaches it,
    and no link that arms anything. That asymmetry — a compromised Discord
    account can disable face login but never grant it — is the property that
    makes it safe to put a control on a service Nova does not operate, and any
    future "convenience" re-arm is the exact thing it exists to refuse.
    """

    store().set_armed(True, actor=f"authentik:{require_authentik_identity(request)}")
    return {"armed": True}


@app.post("/disarm")
async def disarm(request: Request) -> dict[str, Any]:
    """Switch face release off. Ungated, deliberately, and it is the pair to
    `/arm` rather than a parameter of it.

    The asymmetry is the whole control: **every path that reduces access is
    cheap to reach, every path that increases it is expensive.** `/arm` grants,
    so it sits behind authentik forward-auth and needs a password + TOTP
    session. `/disarm` only takes access away, so it needs nothing but the
    service key the Discord module already holds — it has to work in the
    seconds after a DM lands on a phone, and a revocation that first demands a
    login is a revocation that arrives too late.

    That is also what makes it safe to hang a security control off a
    third-party service Nova does not operate: a compromised Discord account
    can reach this endpoint and can reach `/sessions/revoke`, and neither of
    them can let anybody in.

    `vetoToken` and `reason` are recorded for the audit trail and are **not**
    required to be valid. A veto that fails closed on a malformed token is a
    veto that does not fire, and a veto that does not fire is the failure mode
    this design cannot afford. Collapsing the two endpoints into one taking a
    boolean would put the grant behind the same nothing.
    """

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - a malformed body must not block a veto
        body = {}
    token = str(body.get("vetoToken") or "")[:64]
    reason = str(body.get("reason") or "unspecified")[:200]
    store().set_armed(False, actor=f"veto:{token or 'no-token'}:{reason}")
    return {"armed": False}


@app.post("/activity")
async def activity(request: Request) -> dict[str, Any]:
    """Heartbeat for quick-profile sessions.

    Identity-bearing and therefore gated the same way `/arm` is: the API key
    alone is not enough, because every satellite and every script holds it, and
    a caller who can assert `X-authentik-username: adeline` with only the shared
    key could keep a session alive indefinitely without holding one. The proxy
    secret is what makes the username mean anything.

    Extending is all it can do. There is no shape of this request that signs
    anybody in, and a person with no open quick session gets `touched: 0`.
    """

    username = require_authentik_identity(request)
    touched = store().touch_quick_sessions(username, time.time())
    return {"touched": touched, "idleTimeoutSeconds": core.QUICK_IDLE_TIMEOUT_SECONDS}


def list_session_ids(username: str | None) -> list[str]:
    """This user's current authentik session ids, or an empty list.

    Fails soft on purpose. An authentik that cannot be reached must not turn a
    successful sign-in into a refusal — the assertion has already been signed by
    the time this runs. An empty snapshot only costs precision later: the sweep
    then sees more candidates than it should and declines to bind rather than
    binding the wrong one.
    """

    if not username:
        return []
    try:
        return [
            str(session.get("uuid") or session.get("pk") or "")
            for session in AuthentikClient(base_url=AUTHENTIK_BASE_URL, token=AUTHENTIK_TOKEN).sessions_for(username)
            if session.get("uuid") or session.get("pk")
        ]
    except AuthentikError as error:
        LOG.warning("could not snapshot sessions for %s: %s", username, error)
        return []


QUICK_SWEEP_INTERVAL_SECONDS = 60


async def quick_session_sweeper() -> None:
    """Run the sweep forever, and never die of one bad pass.

    A sweep that raised would stop every future sweep, and the failure mode of
    that is quick sessions living indefinitely — the exact thing the timeout
    exists to prevent. So every pass is wrapped, and the loop continues.
    """

    while True:
        await asyncio.sleep(QUICK_SWEEP_INTERVAL_SECONDS)
        try:
            closed = await asyncio.to_thread(sweep_quick_sessions)
            if closed:
                LOG.info("quick-session sweep closed %d session(s)", closed)
        except Exception:  # noqa: BLE001
            LOG.exception("quick-session sweep failed; continuing")


def sweep_quick_sessions(now: float | None = None) -> int:
    """Terminate quick sessions that have gone quiet. Returns how many.

    Two jobs, in this order, because the first is what makes the second
    possible. `/assert` runs before authentik has created a session — the
    assertion it returns has not been submitted to the flow executor yet — so
    the row is opened with a snapshot of the sessions that already existed, and
    bound here on a later pass to whichever session appeared that was not in
    that snapshot and is not claimed by another row.

    Exactly one candidate binds. Zero or several does not: a guess here logs
    somebody out of a session the face never released, possibly a password
    session in active use, and a quick session outliving its timeout is the
    lesser failure. Ambiguity is logged and the row closes without terminating.

    A row that cannot be bound is still closed on time. It simply has nothing to
    terminate, which is the honest outcome when the sign-in never completed:
    there is no session to end because none was ever made.
    """

    now = time.time() if now is None else now
    closed = 0
    rows = store().open_quick_sessions()
    if not rows:
        return 0
    client = AuthentikClient(base_url=AUTHENTIK_BASE_URL, token=AUTHENTIK_TOKEN)
    sessions_by_user: dict[str, list[dict[str, Any]]] = {}

    for row in rows:
        username = row["authentik_username"]
        session_id = row["authentik_session_id"]

        if not session_id and username:
            if username not in sessions_by_user:
                try:
                    sessions_by_user[username] = client.sessions_for(username)
                except AuthentikError as error:
                    LOG.warning("quick-session sweep could not list sessions for %s: %s", username, error)
                    sessions_by_user[username] = []
            try:
                prior = set(json.loads(row["prior_session_ids"] or "[]"))
            except (TypeError, ValueError):
                prior = set()
            # Already claimed by another open row: two quick sign-ins in the
            # same window must not both bind the same session.
            claimed = {
                other["authentik_session_id"]
                for other in rows
                if other["authentik_session_id"] and other["id"] != row["id"]
            }
            candidates = [
                candidate_id
                for candidate_id in (
                    str(session.get("uuid") or session.get("pk") or "")
                    for session in sessions_by_user[username]
                )
                if candidate_id and candidate_id not in prior and candidate_id not in claimed
            ]
            if len(candidates) == 1:
                session_id = candidates[0]
                store().bind_quick_session(row["id"], session_id)
            elif len(candidates) > 1:
                # Ambiguous: more than one session appeared after this row was
                # opened, so nothing here can say which one the face released.
                # Terminating a guess could sign her out of a password session
                # she is actively using, and that is a worse outcome than a
                # quick session outliving its timeout — so this declines, says
                # so, and lets the row close without terminating anything.
                LOG.warning(
                    "quick session %s cannot be bound: %d candidate sessions for %s",
                    row["id"], len(candidates), username,
                )

        if now - row["last_seen"] < row["idle_timeout_seconds"]:
            continue

        if session_id:
            try:
                client.terminate_session(session_id)
                LOG.info(
                    "quick session idle-timed out: subject=%s profile=%s session=%s idle=%.0fs",
                    row["subject_id"], row["profile"], session_id, now - row["last_seen"],
                )
            except AuthentikError as error:
                # Leave the row open so the next pass tries again. A session that
                # could not be reached is still a session that must end.
                LOG.error("quick-session termination failed for %s: %s", session_id, error)
                continue
            store().close_quick_session(row["id"], "idle_timeout", now)
        else:
            # Never bound: the sign-in did not complete, the user is unmapped,
            # or the candidates were ambiguous. There is nothing to terminate —
            # which for an incomplete sign-in is the honest outcome, because no
            # session was ever created.
            store().close_quick_session(row["id"], "unbound", now)
        closed += 1

    return closed


@app.post("/sessions/revoke")
async def revoke_session(request: Request) -> dict[str, Any]:
    """Terminate one authentik session. Ungated for the same reason as
    `/disarm`: it can only log somebody out.

    Leaves the armed state alone — Revoke and Disarm are two buttons because
    they are two decisions. Press both if both are wanted.
    """

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    session_id = str(body.get("sessionId") or "").strip()
    token = str(body.get("vetoToken") or "")[:64]
    reason = str(body.get("reason") or "unspecified")[:200]
    if not session_id:
        raise Refusal(422, "session_id_required")
    LOG.warning("session revoke requested: session=%s veto=%s reason=%s", session_id, token or "-", reason)
    try:
        applied = AuthentikClient(base_url=AUTHENTIK_BASE_URL, token=AUTHENTIK_TOKEN).terminate_session(session_id)
    except AuthentikError as error:
        LOG.error("session revoke could not reach authentik: %s", error)
        raise Refusal(503, "service_unavailable")
    return {"revoked": session_id, "applied": bool(applied)}


@app.get("/veto")
def veto(request: Request, a: str = "", v: str = "", e: str = "", sig: str = "") -> dict[str, Any]:
    """The HMAC-signed, single-use fallback link. Revocation only.

    Safe to leave ungated because it can only revoke: a leaked link disables
    face login or kills a session. It cannot enable one, cannot enrol, and
    cannot clear a lockout. There is no third action, and adding one that
    grants anything would break the control rather than extend it.
    """

    if a not in {"revoke", "disarm"}:
        raise Refusal(400, "unknown_action")
    if not HOST_SECRET:
        raise Refusal(503, "service_unavailable")
    expected = hmac.new(
        HOST_SECRET.encode(), f"a={a}&v={v}&e={e}".encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected):
        LOG.warning("veto link rejected: signature mismatch")
        raise Refusal(403, "forbidden")
    now = time.time()
    if not e.isdigit() or float(e) < now:
        raise Refusal(403, "veto_expired")
    row = store().consume_veto(v, a, "fallback_link", now)
    if row is None:
        raise Refusal(403, "veto_expired")
    if a == "disarm":
        store().set_armed(False, actor="veto_link")
        return {"action": a, "applied": True}
    username = row["authentik_username"]
    if not username:
        return {"action": a, "applied": False}
    try:
        client = AuthentikClient(base_url=AUTHENTIK_BASE_URL, token=AUTHENTIK_TOKEN)
        session_id = row["authentik_session_id"]
        applied = bool(
            client.terminate_session(session_id) if session_id else client.terminate_all_sessions(username)
        )
    except AuthentikError as error:
        LOG.warning("veto could not reach authentik: %s", error)
        raise Refusal(503, "service_unavailable")
    return {"action": a, "applied": applied}


@app.post("/enrol/{subject}")
async def enrol(request: Request, subject: str, clip: UploadFile = File(...), nonce: str | None = Form(None)) -> dict[str, Any]:
    """Same liveness gate as authentication.

    An enrolment path that skips liveness is a path to enrolling a photograph,
    and the gallery it builds then authenticates one.

    Raw frames are not retained: an embedding plus one thumbnail. A 512-d
    ArcFace vector is not reversible to a photograph, and a directory of face
    crops is a different liability with no feature behind it.
    """

    # Registering a face is a credential-issuing action and gets the strongest
    # gate available: password + TOTP, from the tailnet origin.
    require_dashboard_proxy(request)
    require_subject_id(subject)
    payload = await read_bounded(request, clip)
    if nonce is not None and not store().consume_challenge(nonce):
        raise Refusal(401, "nonce_invalid")
    row = store().ensure_subject(subject)
    accepted_before = store().embeddings(subject)

    def progress(accepted: bool, consistency: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
        count = len(accepted_before) + (1 if accepted else 0)
        return {
            "accepted": accepted, "clipsSoFar": count, "needed": ENROL_MIN_CLIPS,
            "remaining": max(0, ENROL_MIN_CLIPS - count), "consistency": consistency,
            **({"reason": reason} if reason else {}),
        }

    try:
        frames = decode_clip(payload)[0]
        analysis = ClipAnalysis(frames)
        analysis.require_frames()
        run_liveness(analysis)
        candidate = analysis.mean_embedding()
    except HTTPException as error:
        detail = error.detail if isinstance(error.detail, dict) else {}
        return JSONResponse(progress(False, {}, detail.get("reason", "error")), status_code=error.status_code)

    report = enrolment_consistency(
        accepted_before + [candidate],
        others=store().gallery(exclude=subject, ready_only=False),
        centroid_max=ENROL_CENTROID_MAX, match_cosine=MATCH_COSINE,
    )
    if not report.ok:
        # The offending index is named. When it is not the candidate the
        # existing gallery is the problem, and re-recording will not fix it.
        return JSONResponse(
            {**progress(False, report.as_dict(), report.reason), "offendingIndex": report.index},
            status_code=422,
        )

    frame, detection = analysis.best_detection()
    store().add_embedding(subject, candidate, detection.score, detection.short_side, {
        "detScore": round(float(detection.score), 4),
        "boxShortSide": round(float(detection.short_side), 1),
        "frames": analysis.usable,
        "at": utc_now(),
    })
    return progress(True, report.as_dict())


# No thumbnail is written. Adeline, 2026-09-03: "I don't want to store the video
# and thumbnail at all for a user."
#
# What a subject leaves on disk is now the embeddings and the capture metadata,
# and nothing that is an image of anybody. A 512-d ArcFace vector is not
# invertible to a photograph; a 256px face crop is a photograph. The gallery UI
# lists people by name instead.
#
# The clip itself was never retained: decode_clip writes a temp file and removes
# it in a `finally` on every path, including exceptions.

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
