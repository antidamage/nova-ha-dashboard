"""Quick-profile sessions and their idle timeout, and `/verify`'s face sessions.

`quick` and `image` mint a session that ends after a period of inactivity.
authentik's user_login stage offers only an absolute `session_duration`, so
the idle part is enforced here: rows are opened at release, touched by the
dashboard's heartbeat, and swept when they go quiet.

Enforcement is server-side on purpose. A client that stops heartbeating — a
closed tab, a killed browser, a machine that went to sleep, or a caller that
simply chose not to — reaches the same end as one that reports honestly.
There is nothing a client can withhold to stay signed in.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time

from ..config import SESSION_TTL_SECONDS, iso_time, utc_now


class QuickSessionsMixin:
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
