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

Split into mixins by the section comments the class already carried, the same
shape as `service/store/`; see `nova-ha-dashboard/specs/agent-token-footprint.md`.
The method bodies are unchanged.
"""

from __future__ import annotations

from .primitives import (
    KEY_BYTES,
    MEMLIMIT,
    OPSLIMIT,
    SALT_BYTES,
    SCALAR_BYTES,
    _BYTES_HEADER,
    _now_iso,
    RegisteredCredential,
    secret_box,
    wipe,
)
from .registration import RegistrationMixin
from .release import ReleaseMixin
from .schema import SchemaMixin
from .signing import SigningMixin


class CredentialStore(
    SchemaMixin,
    RegistrationMixin,
    ReleaseMixin,
    SigningMixin,
):
    """Credentials, their release wraps, and the only key material in Nova.

    The connection is injected rather than opened here so the service can hand
    it the same SQLite handle the rest of the state lives in — one file, one
    WAL, one backup — and so a test can pass a temporary database.
    """


__all__ = [
    "KEY_BYTES",
    "MEMLIMIT",
    "OPSLIMIT",
    "SALT_BYTES",
    "SCALAR_BYTES",
    "CredentialStore",
    "RegisteredCredential",
    "secret_box",
    "wipe",
]
