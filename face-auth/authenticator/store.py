"""Credential custody: sealing, unsealing, signing, and zeroing.

Every private key this service holds lives here, sealed with libsodium
`crypto_secretbox` under a key derived by Argon2id. **No function in this
module returns raw key bytes to a caller.** `sign_assertion()` is the only path
that ever materialises a plaintext scalar, it holds it in a `bytearray` it
owns, and it wipes that buffer in a `finally` that runs on the exception paths
as well as the successful one.

What the seal buys, stated honestly: blast-radius reduction and replay
binding. It does not buy secrecy from root on the host — the host secret is in
a file that root can read, and the unit passes it with `--env-file`, so anyone
in the `docker` group can read it out of `docker inspect`. The spec's threat
model says so in those words and this module does not claim more.

### Deviation from the spec's one-line description, and why

`specs/face-auth.md` says the data-encryption key is "derived by Argon2id over
(host secret, subject id, the face-session token)". Taken as the *only* wrap,
that cannot work for a credential used more than once: the token is single-use
and expires in 60 seconds, so a key sealed under token N is unopenable by the
time token N+1 exists. The construction here keeps the property the sentence
was reaching for — a signature is impossible without a live face-session token
— by wrapping twice:

1. **The durable seal.** `Argon2id(host_secret ‖ subject_id ‖ rp_id, salt)`
   protects the credential at rest. Subject and RP are inside the KDF input, so
   a blob lifted from one subject's row cannot be opened as another's.
2. **The release wrap.** When a face session is minted, the durable blob is
   opened once and immediately re-sealed under
   `Argon2id(host_secret ‖ subject_id ‖ face_session_token, release_salt)`.
   `sign_assertion()` opens *that* blob and never touches the durable one, so
   the token is genuinely a KDF input to the key that signs, exactly as the
   spec intends. The release row is consumed by the same atomic-`UPDATE`
   rowcount discipline as the nonce, so one token cannot mint two signatures,
   and it carries its own expiry, so a token that outlived its TTL opens
   nothing.

Only the SHA-256 of the token is stored. A database lifted on its own
therefore does not carry the value that would unwrap the release blob.
"""

from __future__ import annotations

import ctypes
import hashlib
import os
import secrets
import sqlite3
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Callable

import nacl.pwhash
import nacl.secret
from cryptography.hazmat.primitives.asymmetric import ec

from . import ctap
from .ctap import AuthenticatorConfig

KEY_BYTES = nacl.secret.SecretBox.KEY_SIZE
SALT_BYTES = nacl.pwhash.argon2id.SALTBYTES
SCALAR_BYTES = 32  # P-256 private scalar

# Argon2id parameters. The host secret is high-entropy machine-generated
# material, not a human password, so the cost here is domain separation and a
# speed bump rather than password strengthening — and this sits on an
# interactive login path that also has to run three ONNX models. INTERACTIVE
# (64 MiB, 2 passes) twice per assertion is tens of milliseconds; MODERATE
# would be 256 MiB twice on a host with a documented memory-pressure history.
OPSLIMIT = nacl.pwhash.argon2id.OPSLIMIT_INTERACTIVE
MEMLIMIT = nacl.pwhash.argon2id.MEMLIMIT_INTERACTIVE

_BYTES_HEADER = sys.getsizeof(b"") - 1


def wipe(buffer: bytearray | bytes | None) -> None:
    """Overwrite a secret buffer in place, best effort and honestly labelled.

    A `bytearray` is overwritten properly. A `bytes` object is immutable and
    Python gives no supported way to erase one, so its storage is overwritten
    through `ctypes` — the standard trick, and the only option when a C library
    hands back an immutable buffer. It is applied only to objects created by a
    crypto call inside this module, never to a literal or an interned value.

    This does not defeat a memory dump taken mid-call, and it does not reach
    OpenSSL's own copy inside the `cryptography` key object. It shortens the
    window in which a scalar sits in the heap after a signature, which is the
    property being claimed, and nothing more.
    """

    if buffer is None:
        return
    if isinstance(buffer, bytearray):
        length = len(buffer)
        if length:
            ctypes.memset((ctypes.c_char * length).from_buffer(buffer), 0, length)
        return
    if isinstance(buffer, bytes) and buffer:
        try:
            ctypes.memset(id(buffer) + _BYTES_HEADER, 0, len(buffer))
        except Exception:  # pragma: no cover - platform-dependent, never fatal
            pass


@contextmanager
def secret_box(key: bytearray):
    """A `SecretBox` whose key copies are wiped when the block ends.

    `SecretBox` takes `bytes` and keeps its own reference, so handing it
    `bytes(dek)` quietly creates a second live copy of the key that outlives
    the `finally` wiping the `bytearray`. This wipes both — the copy passed in
    and the one the box retained — so the only key material left after the
    block is the sealed blob.
    """

    material = bytes(key)
    box = nacl.secret.SecretBox(material)
    try:
        yield box
    finally:
        wipe(getattr(box, "_key", None))
        wipe(material)


@dataclass(frozen=True)
class RegisteredCredential:
    """What registration hands back. Public material only, by construction."""

    credential_id: bytes
    cose_public_key: bytes
    attested_credential_data: bytes
    rp_id: str
    subject_id: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "credentialId": ctap.b64url(self.credential_id),
            "publicKey": ctap.b64url(self.cose_public_key),
            "rpId": self.rp_id,
            "subject": self.subject_id,
        }


class CredentialStore:
    """Credentials, their release wraps, and the only key material in Nova.

    The connection is injected rather than opened here so the service can hand
    it the same SQLite handle the rest of the state lives in — one file, one
    WAL, one backup — and so a test can pass a temporary database.
    """

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

    # -- registration -----------------------------------------------------

    def register(self, subject_id: str, config: AuthenticatorConfig) -> RegisteredCredential:
        """Create one resident credential for a subject under the pinned RP.

        One credential per subject per relying party: a second call for the
        same pair replaces the first rather than accumulating credentials that
        a caller could then choose between.
        """

        if self.credential_row(subject_id, config.rp_id) is not None:
            self.delete_credential(subject_id, config.rp_id)

        private_key = ec.generate_private_key(ec.SECP256R1())
        credential_id = secrets.token_bytes(32)
        salt = os.urandom(SALT_BYTES)
        scalar = bytearray(private_key.private_numbers().private_value.to_bytes(SCALAR_BYTES, "big"))
        dek = self._durable_key(subject_id, config.rp_id, salt)
        plain = bytes(scalar)
        try:
            with secret_box(dek) as box:
                sealed = box.encrypt(plain)
        finally:
            wipe(plain)
            wipe(scalar)
            wipe(dek)

        public = ctap.cose_public_key(private_key.public_key())
        attested = ctap.attested_credential_data(credential_id, private_key.public_key())
        with self.lock:
            self.connection.execute(
                "INSERT INTO credentials(id, subject_id, rp_id, credential_id, sealed_key, kdf_salt,"
                " public_key, sign_count, created_at) VALUES(?,?,?,?,?,?,?,0,?)",
                (
                    uuid.uuid4().hex, subject_id, config.rp_id, credential_id, sealed, salt,
                    public, _now_iso(),
                ),
            )
            self.connection.commit()
        return RegisteredCredential(
            credential_id=credential_id,
            cose_public_key=public,
            attested_credential_data=attested,
            rp_id=config.rp_id,
            subject_id=subject_id,
        )

    def credential_row(self, subject_id: str, rp_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.connection.execute(
                "SELECT * FROM credentials WHERE subject_id=? AND rp_id=?", (subject_id, rp_id)
            ).fetchone()

    def has_credential(self, subject_id: str, rp_id: str) -> bool:
        return self.credential_row(subject_id, rp_id) is not None

    def delete_credential(self, subject_id: str, rp_id: str | None = None) -> None:
        with self.lock:
            if rp_id is None:
                self.connection.execute("DELETE FROM credentials WHERE subject_id=?", (subject_id,))
            else:
                self.connection.execute(
                    "DELETE FROM credentials WHERE subject_id=? AND rp_id=?", (subject_id, rp_id)
                )
            self.connection.execute("DELETE FROM credential_releases WHERE subject_id=?", (subject_id,))
            self.connection.commit()

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

    # -- signing ----------------------------------------------------------

    def sign_assertion(
        self,
        *,
        subject_id: str,
        challenge: str,
        config: AuthenticatorConfig,
        release_token: str,
        now: float | None = None,
        _observe_plaintext: Callable[[bytearray], None] | None = None,
    ) -> dict[str, Any]:
        """Release one use of a subject's credential. The only signing path.

        There is no `rp_id` parameter, deliberately. The relying party comes
        from the pinned configuration and nowhere else, so there is no argument
        a caller can supply that would make this sign for a different RP: the
        credential is looked up by `(subject, config.rp_id)`, the rpIdHash is
        computed from `config.rp_id`, and the origin in `clientDataJSON` is
        `config.origin`.

        Raises `PermissionError` when there is no credential or no live
        release. Both are refusals, and both leave the release row consumed if
        it existed — a token that failed to produce a signature is still spent.
        """

        now = time.time() if now is None else now
        release = self._consume_release(subject_id, release_token, now)
        if release is None:
            raise PermissionError("face_session_invalid")
        row = self.credential_row(subject_id, config.rp_id)
        if row is None or row["id"] != release["credential_row"]:
            raise PermissionError("no_credential")

        sign_count = self._next_sign_count(row["id"])
        client_data = ctap.client_data_json(challenge, config)
        auth_data = ctap.authenticator_data(config, sign_count)

        scalar: bytearray | None = None
        dek: bytearray | None = None
        opened: bytes | None = None
        private_key = None
        try:
            dek = self._release_key(subject_id, release_token, bytes(release["salt"]))
            with secret_box(dek) as box:
                opened = box.decrypt(bytes(release["sealed"]))
            scalar = bytearray(opened)
            wipe(opened)
            if _observe_plaintext is not None:
                # Test seam only: hands the test the very buffer this method
                # owns, so "it was zeroed" is an assertion about the real
                # object rather than about a copy.
                _observe_plaintext(scalar)
            private_key = ec.derive_private_key(int.from_bytes(scalar, "big"), ec.SECP256R1())
            signature = ctap.sign(private_key, auth_data, client_data)
        finally:
            # Every path, including the exception paths. The scalar does not
            # outlive the call. What this cannot reach is OpenSSL's own copy
            # inside the `cryptography` key object; dropping the reference is
            # the whole of the available remedy there and the docstring says so.
            wipe(scalar)
            wipe(opened)
            wipe(dek)
            private_key = None

        return {
            "subject": subject_id,
            "credentialId": ctap.b64url(bytes(row["credential_id"])),
            "clientDataJSON": ctap.b64url(client_data),
            "authenticatorData": ctap.b64url(auth_data),
            "signature": ctap.b64url(signature),
            "userHandle": ctap.b64url(subject_id.encode("utf-8")),
            "signCount": sign_count,
        }

    # -- introspection ----------------------------------------------------

    def public_key(self, subject_id: str, rp_id: str) -> bytes | None:
        """The COSE public key. Public material; there is no private equivalent."""

        row = self.credential_row(subject_id, rp_id)
        return None if row is None else bytes(row["public_key"])

    def sign_count(self, subject_id: str, rp_id: str) -> int | None:
        row = self.credential_row(subject_id, rp_id)
        return None if row is None else int(row["sign_count"])


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
