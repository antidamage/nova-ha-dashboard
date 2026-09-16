"""The Discord-veto fallback-link table."""

from __future__ import annotations

import secrets
import sqlite3

from ..config import VETO_LINK_TTL_SECONDS


class VetoesMixin:
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
