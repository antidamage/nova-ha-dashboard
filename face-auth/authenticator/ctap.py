"""WebAuthn structures for a host authenticator.

`fido2` is used here for CBOR and COSE encoding **only**. It never holds a key:
custody is `store.py`'s, so the sealing and the zeroing are behaviour this
repository proves in a test rather than assumes from a library.

The origin and the RP ID are pinned configuration, supplied once at startup
from `/etc/nova-face-auth.env` and never taken from a request. See
`AuthenticatorConfig` for why that is the only construction that means
anything here.
"""

from __future__ import annotations

import base64
import hashlib
import json
import struct
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fido2 import cbor
from fido2.cose import ES256

# Flags in authenticatorData, per the WebAuthn level 2 spec.
FLAG_UP = 0x01  # user present
FLAG_UV = 0x04  # user verified
FLAG_AT = 0x40  # attested credential data included

# A host authenticator has no hardware identity to attest, and self-attestation
# would assert something untrue. AAGUID is all zeroes, which is the defined way
# to say "no attestation identity".
AAGUID = b"\x00" * 16


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


@dataclass(frozen=True)
class AuthenticatorConfig:
    """The pinned relying party. Both values are configuration, never constants.

    They are household hostnames and this repository is public, so they arrive
    from the environment at startup and the defaults here are empty.

    The oracle constructs `clientDataJSON` itself with `origin`, whatever the
    caller sent. That is correct rather than a shortcut: in the ordinary
    WebAuthn split the browser computes `clientDataJSON` because the browser is
    the thing that knows which origin the user is on and enforces same-origin,
    while the authenticator receives an opaque hash. Here the authenticator and
    the client are one process with no browser in it. An origin supplied by the
    caller would be attacker-chosen and would assert nothing; pinning it is the
    only construction under which the field means what a relying party reads it
    to mean.

    Consequently the relying party's origin check provides no security here and
    is not counted as a control anywhere. The controls are the network binding,
    the lockout and release caps, the single-use nonce, and the Discord veto.
    """

    rp_id: str
    origin: str

    def __post_init__(self) -> None:
        if not self.rp_id or not self.origin:
            raise ValueError("WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN must both be configured")
        if not self.origin.startswith("https://"):
            raise ValueError("the pinned origin must be https")


def rp_id_hash(rp_id: str) -> bytes:
    return hashlib.sha256(rp_id.encode("utf-8")).digest()


def client_data_json(challenge: str, config: AuthenticatorConfig, *, ceremony: str = "webauthn.get") -> bytes:
    """The client data the oracle asserts, with the pinned origin.

    `challenge` is the base64url WebAuthn challenge exactly as the relying
    party issued it; it is re-encoded from its decoded bytes so a caller cannot
    smuggle padding or non-canonical alphabet through into the signed
    structure.
    """

    document = {
        "type": ceremony,
        "challenge": b64url(b64url_decode(challenge)),
        "origin": config.origin,
        "crossOrigin": False,
    }
    return json.dumps(document, separators=(",", ":"), sort_keys=False).encode("utf-8")


def authenticator_data(
    config: AuthenticatorConfig,
    sign_count: int,
    *,
    user_present: bool = True,
    user_verified: bool = True,
    attested_credential: bytes | None = None,
) -> bytes:
    """rpIdHash ‖ flags ‖ counter ‖ optional attested credential data.

    UV is set because a face was verified — that is the whole point of the
    release condition — and UP because the same face was in front of a camera
    in this ceremony. The counter is the store's persisted, monotonic value; a
    relying party that sees it go backwards is seeing a cloned authenticator.
    """

    flags = 0
    if user_present:
        flags |= FLAG_UP
    if user_verified:
        flags |= FLAG_UV
    if attested_credential is not None:
        flags |= FLAG_AT
    data = rp_id_hash(config.rp_id) + struct.pack(">BI", flags, sign_count)
    if attested_credential is not None:
        data += attested_credential
    return data


def cose_public_key(public_key: ec.EllipticCurvePublicKey) -> bytes:
    """COSE_Key CBOR for an ES256/P-256 public key."""

    return cbor.encode(dict(ES256.from_cryptography_key(public_key)))


def attested_credential_data(credential_id: bytes, public_key: ec.EllipticCurvePublicKey) -> bytes:
    """AAGUID ‖ credential id length ‖ credential id ‖ COSE public key."""

    return AAGUID + struct.pack(">H", len(credential_id)) + credential_id + cose_public_key(public_key)


def signature_base(authenticator_data_bytes: bytes, client_data: bytes) -> bytes:
    """authenticatorData ‖ SHA-256(clientDataJSON) — what gets signed."""

    return authenticator_data_bytes + hashlib.sha256(client_data).digest()


def sign(private_key: ec.EllipticCurvePrivateKey, authenticator_data_bytes: bytes, client_data: bytes) -> bytes:
    """ES256 over the standard base. DER, as WebAuthn requires for ES256."""

    return private_key.sign(
        signature_base(authenticator_data_bytes, client_data),
        ec.ECDSA(hashes.SHA256()),
    )
