"""Constants, the zeroing and sealing primitives, and the credential record.

Everything `store.py` defined that is not a `CredentialStore` method, moved
here verbatim; see `nova-ha-dashboard/specs/agent-token-footprint.md`.
"""

from __future__ import annotations

import ctypes
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import nacl.pwhash
import nacl.secret

from .. import ctap

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



def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
