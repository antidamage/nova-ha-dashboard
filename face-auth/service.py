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
        THUMBNAIL_ROOT.mkdir(parents=True, exist_ok=True)
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

    def set_thumbnail(self, subject_id: str, path: Path) -> None:
        with self.lock:
            self.connection.execute("UPDATE subjects SET thumbnail=? WHERE id=?", (str(path), subject_id))
            self.connection.commit()

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


def decode_clip(payload: bytes) -> tuple[list[np.ndarray], float, float]:
    """Decode a submitted clip to sampled BGR frames.

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
        reason = clip_bounds_reason(
            duration, fps,
            min_seconds=CLIP_MIN_SECONDS, max_seconds=CLIP_MAX_SECONDS, min_fps=CLIP_MIN_FPS,
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
            if reason:
                self.rejections.append(reason)
                continue
            self.detections.append((frame, best))

    @property
    def usable(self) -> int:
        return len(self.detections)

    def require_frames(self) -> None:
        if self.usable >= LIVENESS_MIN_FRAMES:
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


def run_liveness(analysis: ClipAnalysis) -> tuple[float, float]:
    """Both signals enforce, and both are returned so both get logged.

    The residual does not stand alone: a video replay on a screen is not
    geometrically rigid and passes it. The nonce and the texture model exist
    because of that.
    """

    decision = liveness_decision(
        analysis.track(),
        residual_min=LIVENESS_RESIDUAL_MIN,
        residual_max=LIVENESS_RESIDUAL_MAX,
        min_frames=LIVENESS_MIN_FRAMES,
    )
    if not decision.ok:
        raise Refusal(decision.status, decision.reason or "too_few_frames", residual=decision.residual)
    LOG.info("liveness residual %.5f by landmark %s", decision.residual, decision.per_landmark)
    antispoof = analysis.antispoof()
    if antispoof < ANTISPOOF_MIN:
        raise Refusal(401, "antispoof", residual=decision.residual, antispoof=round(antispoof, 4))
    return float(decision.residual or 0.0), antispoof


def identify_frames(analysis: ClipAnalysis, gallery: dict[str, list[np.ndarray]]):
    votes = [
        cosine_match(embedding, gallery, threshold=MATCH_COSINE, margin=MATCH_MARGIN)
        for embedding in analysis.embeddings()
    ]
    return votes, aggregate_frames(votes, min_agreeing=MIN_AGREEING_FRAMES)


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
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
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
    MODELS.warm_up()
    yield


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


def verify_clip(payload: bytes, nonce: str, endpoint: str, *, client_ip: str | None = None) -> dict[str, Any]:
    """The shared face half of /verify and /assert.

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
    signals: dict[str, Any] = {}
    reason: str | None = None
    try:
        if not store().consume_challenge(nonce):
            raise Refusal(401, "nonce_invalid")
        frames = decode_clip(payload)[0]
        analysis = ClipAnalysis(frames)
        analysis.require_frames()
        signals["usableFrames"] = analysis.usable
        residual, antispoof = run_liveness(analysis)
        signals.update({"residual": round(residual, 6), "antispoof": round(antispoof, 4)})
        gallery = store().gallery()
        votes, aggregate = identify_frames(analysis, gallery)
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


@app.post("/verify")
async def verify(request: Request, clip: UploadFile = File(...), nonce: str = Form(...)) -> dict[str, Any]:
    return verify_clip(await read_bounded(request, clip), nonce, "/verify", client_ip=client_ip(request))


@app.post("/assert")
async def assert_credential(
    request: Request,
    clip: UploadFile = File(...),
    nonce: str = Form(...),
    challenge: str = Form(...),
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

    payload = await read_bounded(request, clip)
    address = client_ip(request)
    oracle = require_oracle()
    now = time.time()

    result = verify_clip(payload, nonce, "/assert", client_ip=address)
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
    require_authentik_identity(request)
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
    if not row["thumbnail"]:
        store().set_thumbnail(subject, write_thumbnail(subject, frame, detection.bbox))
    return progress(True, report.as_dict())


def write_thumbnail(subject_id: str, frame: np.ndarray, bbox: tuple[float, float, float, float]) -> Path:
    """One 256 px crop per subject, for the gallery UI. Nothing else is kept.

    The id has already passed the allowlist at the route boundary. This
    resolves the final path and asserts it is inside `THUMBNAIL_ROOT` anyway —
    the check costs a `stat` and it is the last thing standing between a future
    caller that forgets `require_subject_id` and an arbitrary file write as the
    service user.
    """

    path = (THUMBNAIL_ROOT / f"{subject_id}.jpg").resolve()
    if path.parent != THUMBNAIL_ROOT.resolve():
        raise Refusal(422, "invalid_subject")

    height, width = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    margin_x, margin_y = (x2 - x1) * 0.25, (y2 - y1) * 0.25
    crop = frame[
        max(0, int(y1 - margin_y)): min(height, int(y2 + margin_y)),
        max(0, int(x1 - margin_x)): min(width, int(x2 + margin_x)),
    ]
    cv2.imwrite(str(path), cv2.resize(crop, (256, 256)))
    return path


@app.get("/subjects")
def subjects(request: Request) -> list[dict[str, Any]]:
    # Listing subjects enumerates the household; deleting one deletes a
    # credential. Both are admin actions.
    require_authentik_identity(request)
    with store().lock:
        rows = store().connection.execute("SELECT * FROM subjects ORDER BY created_at").fetchall()
    result = []
    for row in rows:
        clips = len(store().embeddings(row["id"]))
        result.append({
            "id": row["id"], "name": row["name"], "clips": clips,
            "ready": clips >= ENROL_MIN_CLIPS and bool(row["enabled"]),
            "thumbnailUrl": f"/subjects/{row['id']}/thumbnail" if row["thumbnail"] else None,
            "createdAt": row["created_at"],
        })
    return result


@app.get("/subjects/{subject_id}/thumbnail")
def thumbnail(request: Request, subject_id: str) -> FileResponse:
    # A household member's face photo. The shared key is not a gate on it: the
    # dashboard proxy injects that key for whoever asked, so without this check
    # the route serves a face crop to anyone who can reach the dashboard. Same
    # identity requirement as every sibling subject route.
    require_authentik_identity(request)
    require_subject_id(subject_id)
    row = store().subject(subject_id)
    if row is None or not row["thumbnail"] or not Path(row["thumbnail"]).is_file():
        raise Refusal(404, "not_found")
    return FileResponse(row["thumbnail"], media_type="image/jpeg")


@app.delete("/subjects/{subject_id}")
def delete_subject(request: Request, subject_id: str) -> dict[str, Any]:
    require_authentik_identity(request)
    require_subject_id(subject_id)
    if not store().delete_subject(subject_id):
        raise Refusal(404, "not_found")
    return {"deleted": subject_id}
