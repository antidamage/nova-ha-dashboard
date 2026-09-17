"""The injected connection, the additive migrations, and key derivation.

Moved verbatim out of `store.py`. `__init__` lives here, as in
`service/store/schema.py`: every other mixin's methods use the
`self.connection` / `self.lock` / `self._host_secret` it sets up.
"""

from __future__ import annotations

import hashlib
import sqlite3
import threading

import nacl.pwhash

from .primitives import KEY_BYTES, MEMLIMIT, OPSLIMIT


class SchemaMixin:

    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        host_secret: bytes | str,
        lock: threading.RLock | None = None,
        opslimit: int = OPSLIMIT,
        memlimit: int = MEMLIMIT,
    ) -> None:
        if isinstance(host_secret, str):
            host_secret = host_secret.encode("utf-8")
        if not host_secret:
            # No default and no unsealed mode. A missing host secret is a
            # refusal to operate, matching the unit's ExecStartPre on the env
            # file.
            raise ValueError("NOVA_FACE_HOST_SECRET is not set; refusing to hold credentials")
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.lock = lock or threading.RLock()
        self._host_secret = bytes(host_secret)
        self.opslimit = opslimit
        self.memlimit = memlimit
        self._migrate()

    # -- schema -----------------------------------------------------------

    def _migrate(self) -> None:
        with self.lock:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS credentials (
                  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, rp_id TEXT NOT NULL,
                  credential_id BLOB NOT NULL, sealed_key BLOB NOT NULL,
                  sign_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS credentials_subject ON credentials(subject_id);
                CREATE TABLE IF NOT EXISTS credential_releases (
                  id TEXT PRIMARY KEY, credential_row TEXT NOT NULL, subject_id TEXT NOT NULL,
                  token_sha BLOB NOT NULL UNIQUE, salt BLOB NOT NULL, sealed BLOB NOT NULL,
                  issued_at REAL NOT NULL, expires_at REAL NOT NULL, used_at REAL
                );
                CREATE INDEX IF NOT EXISTS credential_releases_subject ON credential_releases(subject_id);
                """
            )
            columns = {row[1] for row in self.connection.execute("PRAGMA table_info(credentials)")}
            for column, definition in (
                ("kdf_salt", "BLOB"),
                ("public_key", "BLOB"),
                ("sign_count", "INTEGER NOT NULL DEFAULT 0"),
            ):
                if column not in columns:
                    self.connection.execute(f"ALTER TABLE credentials ADD COLUMN {column} {definition}")
            self.connection.commit()

    # -- key derivation ---------------------------------------------------

    def _derive(self, purpose: bytes, parts: tuple[bytes, ...], salt: bytes) -> bytearray:
        """Argon2id to a `bytearray` the caller is expected to wipe.

        `purpose` separates the durable seal from the release wrap so the two
        can never collide even with identical remaining inputs, and the parts
        are length-prefixed rather than concatenated so that
        (`"ab"`, `"c"`) and (`"a"`, `"bc"`) are different passwords.
        """

        password = b"nova-face-auth/1|" + purpose
        for part in (self._host_secret,) + parts:
            password += b"|" + len(part).to_bytes(4, "big") + part
        return bytearray(
            nacl.pwhash.argon2id.kdf(
                KEY_BYTES, password, salt, opslimit=self.opslimit, memlimit=self.memlimit
            )
        )

    def _durable_key(self, subject_id: str, rp_id: str, salt: bytes) -> bytearray:
        return self._derive(b"durable", (subject_id.encode(), rp_id.encode()), salt)

    def _release_key(self, subject_id: str, token: str, salt: bytes) -> bytearray:
        return self._derive(b"release", (subject_id.encode(), token.encode()), salt)

    @staticmethod
    def _token_sha(token: str) -> bytes:
        return hashlib.sha256(token.encode("utf-8")).digest()

