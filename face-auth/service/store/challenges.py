"""Nonce lifecycle: issue, live-check, single-use consume."""

from __future__ import annotations

import secrets
import time

from ..config import NONCE_TTL_SECONDS, iso_time, utc_now


class ChallengesMixin:
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
