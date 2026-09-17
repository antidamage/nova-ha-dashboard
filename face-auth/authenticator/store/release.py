"""Release wraps: the short-lived second seal a face decision mints."""

from __future__ import annotations

import os
import sqlite3
import time
import uuid

from ..ctap import AuthenticatorConfig
from .primitives import SALT_BYTES, secret_box, wipe


class ReleaseMixin:
    # -- release wraps ----------------------------------------------------

    def mint_release(
        self,
        subject_id: str,
        config: AuthenticatorConfig,
        token: str,
        *,
        ttl_seconds: int,
        now: float | None = None,
    ) -> bool:
        """Re-seal the credential under a face-session token, for one use.

        Called with a token the face service has just minted for a face it has
        just verified. Returns False when the subject has no credential, which
        the caller reports rather than papering over.
        """

        now = time.time() if now is None else now
        row = self.credential_row(subject_id, config.rp_id)
        if row is None:
            return False
        salt = os.urandom(SALT_BYTES)
        durable = self._durable_key(subject_id, config.rp_id, bytes(row["kdf_salt"]))
        scalar: bytes | None = None
        release: bytearray | None = None
        try:
            with secret_box(durable) as box:
                scalar = box.decrypt(bytes(row["sealed_key"]))
            release = self._release_key(subject_id, token, salt)
            with secret_box(release) as box:
                sealed = box.encrypt(scalar)
        finally:
            wipe(scalar)
            wipe(release)
            wipe(durable)
        with self.lock:
            self.connection.execute("DELETE FROM credential_releases WHERE expires_at < ?", (now,))
            self.connection.execute(
                "INSERT INTO credential_releases(id, credential_row, subject_id, token_sha, salt, sealed,"
                " issued_at, expires_at, used_at) VALUES(?,?,?,?,?,?,?,?,NULL)",
                (
                    uuid.uuid4().hex, row["id"], subject_id, self._token_sha(token), salt, sealed,
                    now, now + ttl_seconds,
                ),
            )
            self.connection.commit()
        return True

    def _consume_release(self, subject_id: str, token: str, now: float) -> sqlite3.Row | None:
        """Atomic single-use consumption, on the UPDATE's rowcount.

        The same discipline as the nonce, for the same reason: two concurrent
        submissions of one token cannot both win, because the decision is the
        rowcount of a conditional write rather than a read followed by a write.
        The subject is part of the WHERE clause, so a token minted for one
        subject cannot release another's credential.
        """

        token_sha = self._token_sha(token)
        with self.lock:
            cursor = self.connection.execute(
                "UPDATE credential_releases SET used_at=? WHERE token_sha=? AND subject_id=?"
                " AND used_at IS NULL AND expires_at >= ?",
                (now, token_sha, subject_id, now),
            )
            self.connection.commit()
            if cursor.rowcount != 1:
                return None
            return self.connection.execute(
                "SELECT * FROM credential_releases WHERE token_sha=?", (token_sha,)
            ).fetchone()

    def _next_sign_count(self, credential_row_id: str) -> int:
        """Increment and persist before signing. Monotonic across restarts."""

        with self.lock:
            self.connection.execute(
                "UPDATE credentials SET sign_count = sign_count + 1 WHERE id=?", (credential_row_id,)
            )
            self.connection.commit()
            row = self.connection.execute(
                "SELECT sign_count FROM credentials WHERE id=?", (credential_row_id,)
            ).fetchone()
        return int(row["sign_count"])

